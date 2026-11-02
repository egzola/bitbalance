const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const ElectrumClient = require('electrum-client');

const ecc = require('tiny-secp256k1');
const { BIP32Factory } = require('bip32');
const bip32 = BIP32Factory(ecc);

const { zpubToXpub, ypubToXpub } = require('./derive');


const isDocker = fs.existsSync("/.dockerenv");

const appVersion = require('./package.json').version || "1.0.0";

const HOST = process.env.ELECTRUM_HOST || "127.0.0.1";
const PORT = parseInt(process.env.ELECTRUM_PORT || "50001", 10);

const appPort = process.env.PORT || 3710;

const DATA_DIR = isDocker ? "/data" : __dirname + "/data";
const DATA_FILE = DATA_DIR + "/wallets.json";


const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('web'));

let wallets = [];
let electrum = null;
// ScriptHashes inscritos na conexão Electrum atual.
// O cache é zerado sempre que uma nova conexão é criada.

console.log("DATA_DIR:", DATA_DIR)
console.log("DATA_FILE:", DATA_FILE)

try {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  console.log("dir ensured")

  if (!fs.existsSync(DATA_FILE)) {
    console.log("creating wallets.json...")
    fs.writeFileSync(DATA_FILE, "[]")
  }

} catch (e) {
  console.error("INIT FS ERROR:", e)
}

try {
  const raw = fs.readFileSync(DATA_FILE, 'utf8')
  wallets = JSON.parse(raw || "[]")
} catch (e) {
  console.error("READ ERROR:", e)
  wallets = []
}


async function connectElectrum() {

  try {

    electrum = new ElectrumClient(PORT, HOST, 'tcp')
    subscribedScriptHashes = new Set()

    electrum.onClose = () => {
      console.log("Electrum disconnected")
      setTimeout(connectElectrum, 5000)
    }

    await electrum.connect()

    await electrum.server_version("bitBalance", "1.4")

    console.log("Electrum connected")

  } catch (e) {

    console.error("Electrum connect error:", e)

    setTimeout(connectElectrum, 5000)

  }

}


function addressToScriptHash(address) {

  const script = bitcoin.address.toOutputScript(
    address,
    bitcoin.networks.bitcoin
  )

  const hash = crypto
    .createHash('sha256')
    .update(script)
    .digest()

  return Buffer.from(hash.reverse()).toString('hex')
}



async function getAddressBalance(address) {

  const sh = addressToScriptHash(address);

  const utxos =
    await electrum.blockchainScripthash_listunspent(sh);

  if (!utxos || utxos.length === 0)
    return 0;

  let total = 0;

  for (const u of utxos) {
    total += u.value;
  }

  return total;
}



function validateKey(key) {

  if (key.length < 100) {
    throw new Error("Invalid XPUB/ZPUB length")
  }

}



async function scanBranch(root, change, type, isBranch = false) {


  if (type === "auto") {
    throw new Error("scanBranch must receive a single type")
  }

  const branch = isBranch ? root : root.derive(change)

  //const types = type === "auto" ? ["p2pkh", "p2wpkh", "p2sh"] : [type];

  //const types = [type];

  let index = 0
  let gap = 0
  let total = 0

  const concurrency = 100; // Restaurado ao valor original após o teste com 2 consultas.
  const gapLimit = 20;

  while (gap < gapLimit) {

    const batch = []

    for (let i = 0; i < concurrency; i++) {

      const child = branch.derive(index)

      let payment;

      if (type === "p2wpkh") {
        payment = bitcoin.payments.p2wpkh({
          pubkey: child.publicKey,
          network: bitcoin.networks.bitcoin
        })
      }

      if (type === "p2sh") {
        payment = bitcoin.payments.p2sh({
          redeem: bitcoin.payments.p2wpkh({
            pubkey: child.publicKey,
            network: bitcoin.networks.bitcoin
          })
        })
      }

      if (type === "p2pkh") {
        payment = bitcoin.payments.p2pkh({
          pubkey: child.publicKey,
          network: bitcoin.networks.bitcoin
        })
      }

      if (!payment) {
        throw new Error("Invalid address type")
      }

      batch.push(payment.address)

      index++
    }

    const startBatch = Date.now();

    const balances = await Promise.all(
      batch.map(a =>
        withTimeout(getAddressBalance(a)).catch(err => {
          console.error("Electrum timeout:", err.message);
          return 0;
        })
      )
    );

    const elapsed = Date.now() - startBatch;

    console.log(
      `[SCAN] type=${type} branch=${change} ` +
      `indexes=${index - concurrency}-${index - 1} ` +
      `time=${elapsed}ms`
    );

    for (let i = 0; i < concurrency; i++) {

      const balance = balances[i]

      if (balance > 0) {
        gap = 0
      } else {
        gap++
      }

      total += balance
    }

    await new Promise(r => setTimeout(r, 10)); // pequena pausa para evitar sobrecarregar o Electrum com muitas requisições em sequência
  }

  return total / 100000000;
}




function normalizeXpub(key) {

  key = key.trim()

  if (key.startsWith("zpub")) {
    return {
      type: "p2wpkh",
      key: zpubToXpub(key)
    }
  }

  if (key.startsWith("ypub")) {
    return {
      type: "p2sh",
      key: ypubToXpub(key)
    }
  }

  if (key.startsWith("xpub")) {
    return {
      type: "auto",
      key: key
    }
  }

  throw new Error("Unsupported key prefix")
}


async function getWalletBalance(xpub) {
  let total = 0

  try {
    const info = normalizeXpub(xpub)

    const root = bip32.fromBase58(info.key, bitcoin.networks.bitcoin)

    const types = info.type === "auto"
      ? ["p2pkh", "p2wpkh", "p2sh"]
      : [info.type]

    for (const t of types) {
      total += await scanBranch(root, 0, t)
      total += await scanBranch(root, 1, t)
    }

  } catch (e) {
    console.error("Error scanning wallet:", e)
    total = 0
  }

  return total
}


async function __getWalletBalance(xpub) {

  const info = normalizeXpub(xpub)

  if (!info || !info.key) {
    return 0
  }

  const root = bip32.fromBase58(info.key, bitcoin.networks.bitcoin)

  let total = 0

  try {

    // padrão normal
    total += await scanBranch(root, 0, info.type)
    total += await scanBranch(root, 1, info.type)

  } catch { }

  try {

    // fallback para xpub já no branch
    total += await scanBranch(root, null, info.type, true)

  } catch { }

  return total
}





async function loadWallets() {

  try {
    wallets = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
  } catch {
    wallets = []
  }

}

app.get("/appversion", async (req, res) => {
  res.json({ appversion: appVersion })
});

app.get("/health", async (req, res) => {
  res.json({ ok: true })
});



// Stream de resultados: envia cada carteira assim que sua varredura termina.
app.get("/wallets/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      res.flush?.();
    }
  };

  try {
    await loadWallets();
    wallets.sort((a, b) => a.wallet.localeCompare(b.wallet));

    send({ type: "start", total: wallets.length, wallets });

    for (let i = 0; i < wallets.length; i++) {
      if (res.writableEnded) return;

      const w = wallets[i];
      send({ type: "scanning", index: i, total: wallets.length, wallet: w.wallet });

      try {
        w.balance = await getWalletBalance(w.xpub);
      } catch (e) {
        console.error(`Error scanning ${w.wallet}:`, e);
        send({ type: "wallet-error", index: i, wallet: w.wallet, error: e.message });
      }

      // Persiste a cada carteira, não apenas no final da varredura.
      fs.writeFileSync(DATA_FILE, JSON.stringify(wallets, null, 2));

      send({ type: "wallet", index: i, total: wallets.length, wallet: w });
    }

    send({ type: "done", total: wallets.length, wallets });
  } catch (e) {
    console.error("Wallet stream error:", e);
    send({ type: "error", error: e.message });
  } finally {
    res.end();
  }
});

app.get("/wallets", async (req, res) => {

  let rescan = req.query.rescan === "true";

  await loadWallets();

  /*
    // removi para nao fazer muitas requisições em paralelo, o que pode travar o Electrum e causar timeouts. Agora as requisições são feitas de forma sequencial, o que é mais estável.
    await Promise.all(wallets.map(async w => {
      const balance = await getWalletBalance(w.xpub)
      w.balance = balance
    }))
  */

  if (rescan) {
    for (const w of wallets) {
      w.balance = await getWalletBalance(w.xpub);
    }

    // atualiza o arquivo com os novos saldos
    fs.writeFileSync(DATA_FILE, JSON.stringify(wallets, null, 2));
  }

  //wallets.sort((a, b) => a.order - b.order);
  // sort por nome da wallet
  wallets.sort((a, b) => a.wallet.localeCompare(b.wallet));

  res.json(wallets)

})



app.post("/wallet", (req, res) => {

  const wallet = (req.body.wallet || "").trim()
  const xpub = (req.body.xpub || "").trim()

  if (!wallet || !xpub)
    return res.status(400).json({ error: "wallet/xpub required" })

  validateKey(xpub);

  if (wallets.some(w => w.xpub === xpub)) {
    return res.status(400).json({ error: "xpub already exists" })
  }

  const id = wallets.length > 0 ? Math.max(...wallets.map(w => w.id)) + 1 : 0;
  const order = wallets.length;

  wallets.push({ id, order, wallet, xpub, balance: 0 });

  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(wallets, null, 2)
  )

  res.json({ ok: true })
})



app.post("/wallet/remove", (req, res) => {

  const xpub = (req.body.xpub || "").trim()

  if (!xpub) {
    return res.status(400).json({ error: "xpub required" })
  }

  wallets = wallets.filter(w => w.xpub !== xpub)

  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(wallets, null, 2)
  )

  res.json({ ok: true })

})


app.post("/wallet/update", (req, res) => {

  const oldXpub = (req.body.oldXpub || "").trim()
  const wallet = (req.body.wallet || "").trim()
  const xpub = (req.body.xpub || "").trim()

  if (!oldXpub || !wallet || !xpub) {
    return res.status(400).json({ error: "invalid data" })
  }

  validateKey(xpub)

  const index = wallets.findIndex(w => w.xpub === oldXpub)

  if (index === -1) {
    return res.status(404).json({ error: "wallet not found" })
  }

  if (wallets.some(w => w.xpub === xpub && w.xpub !== oldXpub)) {
    return res.status(400).json({ error: "xpub already exists" })
  }

  wallets[index].wallet = wallet;
  wallets[index].xpub = xpub;


  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(wallets, null, 2)
  )

  res.json({ ok: true })

})


function withTimeout(p, ms = 15000) {
  return Promise.race([
    p,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    )
  ])
}


async function start() {

  await connectElectrum()


  app.listen(appPort, () => {
    console.log(`bitBalance running on port ${appPort}`)
    console.log(`app Version: ${appVersion}`)
  })

}

start()
