![Bitcoin](https://img.shields.io/badge/Bitcoin-self--hosted-orange)
![Umbrel](https://img.shields.io/badge/Runs%20on-Umbrel-blue)
![License](https://img.shields.io/badge/license-MIT-green)


# bitBalance
<img src="./web/logo.png">

A simple and private **Bitcoin wallet balance tracker** for XPUB, YPUB and ZPUB.

bitBalance allows you to monitor multiple Bitcoin wallets using **your own Electrs server**, without relying on third-party APIs.

Runs locally on **Umbrel** and keeps all wallet data private.

---

## Why bitBalance?

Many wallet tracking services require sending your XPUB to external servers.

This exposes:

- all wallet addresses
- wallet balances
- transaction history

bitBalance avoids this by connecting **only to your own node**.

Architecture:

XPUB / YPUB / ZPUB  
↓  
bitBalance  
↓  
Electrs  
↓  
Bitcoin Core

Your wallet data never leaves your infrastructure.

---

## Features

- Track multiple Bitcoin wallets
- Supports **XPUB, YPUB and ZPUB**
- Connects to your **local Electrs server**
- No third-party APIs
- Fully self-hosted
- Lightweight and simple interface
- Runs locally on **Umbrel**

---

## Screenshot

![bitBalance Dashboard]([screenshot.png](https://github.com/egzola/bitBalance/blob/main/web/screenshot.png?raw=true))

---

## Supported Wallet Types

| Type | Standard | Script |
|-----|------|------|
| XPUB | BIP44 | Legacy |
| YPUB | BIP49 | Nested SegWit |
| ZPUB | BIP84 | Native SegWit |

---

## Requirements

- Umbrel
- Electrs installed

---

## Installation

Install **bitBalance** directly from the Umbrel App Store.

After installation the app will automatically connect to your **Electrs server**.

---

## Usage

1. Open bitBalance
2. Click **Add Wallet**
3. Enter a wallet name
4. Paste an **XPUB / YPUB / ZPUB**

The wallet balance will be tracked automatically.

---

## Privacy

bitBalance is designed with privacy in mind.

- No third-party APIs
- No analytics
- No external wallet queries
- Everything runs locally on your node

---

## Architecture

Browser  
↓  
bitBalance (Node.js backend)  
↓  
Electrs  
↓  
Bitcoin Core  

---

## Developer

Eduardo Zola

GitHub  
https://github.com/egzola

---

## License

MIT
