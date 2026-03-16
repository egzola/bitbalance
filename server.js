const express = require('express')
const fs = require('fs')
const crypto = require('crypto')
const bitcoin = require('bitcoinjs-lib')
const ElectrumClient = require('electrum-client')

const ecc = require('tiny-secp256k1')
const { BIP32Factory } = require('bip32')
const bip32 = BIP32Factory(ecc)

const { zpubToXpub, ypubToXpub } = require('./derive')


const isDocker = fs.existsSync("/.dockerenv");

const HOST =
  process.env.ELECTRUM_HOST ||
  (isDocker ? "electrs" : "localhost");

const PORT =
  parseInt(process.env.ELECTRUM_PORT || "50001", 10);

const appPort = process.env.PORT || 3710;
const app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static('web'))

let wallets = []

try {
  wallets = JSON.parse(fs.readFileSync('wallets.json', 'utf8'))
} catch {
  wallets = []
}

let electrum = null


async function connectElectrum() {

  try {

    electrum = new ElectrumClient(PORT, HOST, 'tcp')

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

/*
async function getAddressBalance(address) {

  const sh = addressToScriptHash(address)

  const history = await electrum.blockchainScripthash_getHistory(sh)

  if (history.length === 0) {
    return 0
  }

  const r = await electrum.blockchainScripthash_getBalance(sh)

  return r.confirmed + r.unconfirmed
}
*/

async function getAddressBalance(address){

  const sh = addressToScriptHash(address)

  const utxos = await electrum.blockchainScripthash_listunspent(sh)

  if(!utxos || utxos.length === 0)
    return 0

  let total = 0

  for(const u of utxos){
    total += u.value
  }

  return total
}


function validateKey(key) {

  if (key.length < 100) {
    throw new Error("Invalid XPUB/ZPUB length")
  }

}

async function scanBranch(root, change, type) {

  const branch = root.derive(change)

  let index = 0;
  let gap = 0;
  let total = 0;

  const concurrency = 5;
  const gapLimit = 30;

  while (gap < gapLimit) {

    const batch = []

    for (let i = 0; i < concurrency; i++) {

      const child = branch.derive(index)

      let payment

      if (type === "p2wpkh") {
        payment = bitcoin.payments.p2wpkh({ pubkey: child.publicKey })
      }

      if (type === "p2sh") {
        payment = bitcoin.payments.p2sh({
          redeem: bitcoin.payments.p2wpkh({ pubkey: child.publicKey })
        })
      }

      if (type === "p2pkh") {
        payment = bitcoin.payments.p2pkh({ pubkey: child.publicKey })
      }

      const address = payment.address

      batch.push(address)

      index++
    }

    const balances = await Promise.all(
      batch.map(a => getAddressBalance(a))
    )

    for (const b of balances) {

      if (b > 0) {
        total += b
        gap = 0
      } else {
        gap++
      }

    }

  }

  return total
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
      type: "p2pkh",
      key: key
    }
  }

  throw new Error("Unsupported key prefix")
}


async function addressUsed(address) {

  const sh = addressToScriptHash(address)

  const h = await electrum.blockchainScripthash_getHistory(sh)

  return h.length > 0
}


async function getWalletBalance(xpub) {

  try {
    const info = normalizeXpub(xpub)

    const root = bip32.fromBase58(info.key, bitcoin.networks.bitcoin)

    const receive = await scanBranch(root, 0, info.type)
    const change = await scanBranch(root, 1, info.type)

    return receive + change
  } catch (e) {
    console.error("Error getting wallet balance:", e)
    return 0
  }
}



function loadWallets(){

  try{
    wallets = JSON.parse(fs.readFileSync("wallets.json","utf8"))
  }catch{
    wallets = []
  }

}

app.get("/wallets", async (req, res) => {

  loadWallets()

  const result = []
  const cache = {}

  for(const w of wallets){

    if(!cache[w.xpub]){
      cache[w.xpub] = await getWalletBalance(w.xpub)
    }

    result.push({
      wallet: w.wallet,
      xpub: w.xpub,
      balance: cache[w.xpub] / 1e8
    })

  }

  res.json(result)

})



app.post("/wallet", (req, res) => {

  const wallet = (req.body.wallet || "").trim()
  const xpub = (req.body.xpub || "").trim()

  if (!wallet || !xpub)
    return res.status(400).json({ error: "wallet/xpub required" })

  validateKey(xpub);

  wallets.push({ wallet, xpub })

  fs.writeFileSync(
    "wallets.json",
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
    "wallets.json",
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

  wallets[index].wallet = wallet
  wallets[index].xpub = xpub

  fs.writeFileSync(
    "wallets.json",
    JSON.stringify(wallets, null, 2)
  )

  res.json({ ok: true })

})



async function start() {

  await connectElectrum()


  app.listen(appPort, () => {
    console.log(`bitBalance running on port ${appPort}`)
  })

}

start()