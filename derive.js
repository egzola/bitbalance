const ecc = require('tiny-secp256k1')
const { BIP32Factory } = require('bip32')
const bitcoin = require('bitcoinjs-lib')

const bip32 = BIP32Factory(ecc)

const bs58checkModule = require('bs58check')
const bs58check = bs58checkModule.default || bs58checkModule



function deriveAddresses(xpub, type, count = 20){

  const root = bip32.fromBase58(xpub, bitcoin.networks.bitcoin)

  const addresses = []

  for(const change of [0,1]){

    const branch = root.derive(change)

    for(let i=0;i<count;i++){

      const child = branch.derive(i)

      let address

      if(type === "p2wpkh"){
        address = bitcoin.payments.p2wpkh({
          pubkey: child.publicKey,
          network: bitcoin.networks.bitcoin
        }).address
      }

      if(type === "p2pkh"){
        address = bitcoin.payments.p2pkh({
          pubkey: child.publicKey,
          network: bitcoin.networks.bitcoin
        }).address
      }

      if(type === "p2sh"){
        address = bitcoin.payments.p2sh({
          redeem: bitcoin.payments.p2wpkh({
            pubkey: child.publicKey,
            network: bitcoin.networks.bitcoin
          }),
          network: bitcoin.networks.bitcoin
        }).address
      }

      addresses.push(address)

    }

  }

  return addresses
}


function zpubToXpub(zpub){

  try {

    const decoded = bs58check.decode(zpub)

    const data = Buffer.from(decoded)

    data.writeUInt32BE(0x0488b21e,0)

    return bs58check.encode(data)

  } catch(e) {

    console.error("Invalid zpub:", zpub)

    return null
  }
}


function ypubToXpub(ypub){

  try {

    const decoded = bs58check.decode(ypub)

    const data = Buffer.from(decoded)

    data.writeUInt32BE(0x0488b21e,0)

    return bs58check.encode(data)

  } catch(e) {

    console.error("Invalid ypub:", ypub)

    return null
  }
}



module.exports = {deriveAddresses, zpubToXpub, ypubToXpub}