let chart
let walletsCache = []
var totalBTC = 0;
var btcPriceUSD = 0;

function btcToSats(btc) {
    return Math.round(btc * 100000000)
}


async function loadBTCPrice() {

    try {

        const r = await fetch(
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
        )

        const data = await r.json()

        btcPriceUSD = data.bitcoin.usd

    } catch (e) {

        console.error("BTC price error", e)

    }

}

async function load() {

    await loadBTCPrice();

    clearTable();

    const r = await fetch("/wallets")
    const wallets = await r.json()

    walletsCache = wallets

    let rows = ""
    let total = 0

    const labels = []
    const values = []

    for (const w of wallets) {

        const btc = w.balance
        total += btc

        labels.push(w.wallet)
        values.push(btc)

        rows += `
<tr onclick="editWallet('${w.xpub}')">
<td>${w.wallet}</td>
<td class="balance"
title="${btcToSats(btc).toLocaleString()} sats">
${btc.toFixed(8)}
</td>
<td class="chevron">›</td>
</tr>`
    }

    totalBTC = total;

    document.querySelector("#t tbody").innerHTML = rows

    document.getElementById("total").innerText = total.toFixed(8)
    document.getElementById("totalTop").innerText = total.toFixed(8) + " BTC";

    const usd = totalBTC * btcPriceUSD;
    document.getElementById("totalUSD").innerText = "$" + usd.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " USD";

    //renderChart(labels, values)
    requestAnimationFrame(() => {
        renderChart(labels, values)
    })

}


function clearTable() {
    document.querySelector("#t tbody").innerHTML = "<tr><td colspan='3' class='loading'>⌛ Loading...</td></tr>";
    document.getElementById("total").innerText = "-";
    document.getElementById("totalTop").innerText = "-";
    document.getElementById("totalUSD").innerText = "";
    if (chart) chart.destroy();
}



const innerShadow = {
    id: "innerShadow",

    afterDatasetsDraw(chart) {

        const { ctx } = chart
        const meta = chart.getDatasetMeta(0)

        if (!meta.data.length) return

        const x = meta.data[0].x
        const y = meta.data[0].y

        const innerRadius = meta.data[0].innerRadius

        ctx.save()

        const g = ctx.createRadialGradient(
            x, y, innerRadius * 0.7,
            x, y, innerRadius
        )

        g.addColorStop(0, "rgba(0,0,0,0)")
        g.addColorStop(1, "rgba(0,0,0,0.35)")

        ctx.fillStyle = g

        ctx.beginPath()
        ctx.arc(x, y, innerRadius, 0, Math.PI * 2)
        ctx.fill()

        ctx.restore()
    }
}


const dimOthers = {
    id: "dimOthers",

    beforeDatasetsDraw(chart) {

        const active = chart.getActiveElements()

        if (!active.length) return

        const { ctx } = chart
        const meta = chart.getDatasetMeta(0)

        const activeIndex = active[0].index

        ctx.save()

        meta.data.forEach((arc, i) => {

            if (i === activeIndex) return

            const { x, y, innerRadius, outerRadius, startAngle, endAngle } = arc

            ctx.beginPath()
            ctx.arc(x, y, outerRadius, startAngle, endAngle)
            ctx.arc(x, y, innerRadius, endAngle, startAngle, true)
            ctx.closePath()

            ctx.fillStyle = "rgba(0,0,0,0.35)"
            ctx.fill()

        })

        ctx.restore()
    }
}



function renderChart(labels, data) {

    const canvas = document.getElementById("chart").getContext("2d")

    if (chart) chart.destroy()

    chart = new Chart(canvas, {

        type: "doughnut",

        data: {
            labels,
            datasets: [{
                data: [], // inicia vazio para permitir animação
                backgroundColor: [
                    "#3b82f6",
                    "#22c55e",
                    "#f59e0b",
                    "#ef4444",
                    "#a855f7",
                    "#14b8a6"
                ],
                borderColor: "rgba(0,0,0,0.15)",
                borderWidth: 1,

                hoverBorderColor: "#0f1115",
                hoverOffset: 12,
                hoverBorderWidth: 3

            }]
        },

        plugins: [centerText, innerShadow],

        options: {

            cutout: "72%",

            layout: {
                padding: {
                    top: 16,
                    bottom: 16,
                    left: 16,
                    right: 16
                }
            },

            animation: {
                duration: 1200,
                easing: "easeOutQuart"
            },

            plugins: {

                legend: { position: "bottom" },

                tooltip: {
                    callbacks: {
                        label: (ctx) => {

                            const btc = ctx.raw;

                            const perc = totalBTC > 0
                                ? ((btc / totalBTC) * 100).toFixed(2)
                                : "0.00";

                            return `${perc}%   •   ${btc.toFixed(8)} BTC`
                        }
                    }
                }

            }

        }

    })

    // pequena espera para permitir estado inicial vazio
    setTimeout(() => {

        chart.data.datasets[0].data = data
        chart.update()

    }, 30)

}



async function openWalletModal() {

    const result = await Swal.fire({

        title: "Add Wallet",

        customClass: { popup: "wallet-popup" },

        html: `
<input id="swal-wallet" class="swal2-input" placeholder="Wallet Name" maxlength="45">

<textarea id="swal-xpub"
class="swal2-textarea"
rows="2"
maxlength="130"
placeholder="XPUB / YPUB / ZPUB"
spellcheck="false"></textarea>

<div id="wallet-type" class="wallet-type"></div>
`,

        showCancelButton: true,
        confirmButtonText: "Add Wallet",

        willOpen: () => {

            const walletInput = document.getElementById("swal-wallet")
            const xpubInput = document.getElementById("swal-xpub")
            const label = document.getElementById("wallet-type")

            const btn = Swal.getConfirmButton()

            btn.disabled = true

            function validate() {

                const wallet = cleanInput(walletInput.value)
                const key = xpubInput.value.trim().toLowerCase()

                const validPrefix =
                    key.startsWith("xpub") ||
                    key.startsWith("ypub") ||
                    key.startsWith("zpub")

                const validLength = key.length > 100

                btn.disabled = !(wallet && validPrefix && validLength)
            }

            walletInput.addEventListener("input", validate)

            xpubInput.addEventListener("input", () => {

                const v = xpubInput.value.trim().toLowerCase()

                if (v.startsWith("zpub"))
                    label.innerText = "Detected: Native SegWit (BIP84)"

                else if (v.startsWith("ypub"))
                    label.innerText = "Detected: Nested SegWit (BIP49)"

                else if (v.startsWith("xpub"))
                    label.innerText = "Detected: Legacy (BIP44)"

                else
                    label.innerText = ""

                validate()
            })

        }

    })

    if (!result.isConfirmed) return

    const wallet = cleanInput(document.getElementById("swal-wallet").value)
    const xpub = document.getElementById("swal-xpub").value.trim()

    await fetch("/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, xpub })
    })

    load()
}


async function editWallet(xpub) {

    const wallet = walletsCache.find(w => w.xpub === xpub)

    const result = await Swal.fire({

        title: "Edit Wallet",

        html: `
<input id="swal-wallet" class="swal2-input" value="${wallet.wallet}">
<textarea id="swal-xpub" class="swal2-textarea" rows="2">${wallet.xpub || ""}</textarea>
`,

        showCancelButton: true,
        confirmButtonText: "Save",

        showDenyButton: true,
        denyButtonText: "Delete",
        denyButtonColor: "#ef4444"

    })

    if (result.isDismissed) return

    if (result.isDenied) {

        await fetch("/wallet/remove", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ xpub: xpub })
        })

        load()
        return
    }

    const newWallet = cleanInput(document.getElementById("swal-wallet").value);
    const newXpub = document.getElementById("swal-xpub").value.trim()

    await fetch("/wallet/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            oldXpub: xpub,
            wallet: newWallet,
            xpub: newXpub
        })
    })

    load()

}


function cleanInput(str) {

    return str
        .replace(/[^a-zA-Z0-9 _-]/g, "")   // remove caracteres especiais
        .replace(/\s+/g, " ")              // normaliza espaços
        .trim()

}



const centerText = {
    id: "centerText",
    afterDatasetsDraw(chart) {

        const { ctx } = chart

        const meta = chart.getDatasetMeta(0)
        if (!meta.data.length) return

        const x = meta.data[0].x
        const y = meta.data[0].y

        ctx.save()

        ctx.textAlign = "center"
        ctx.textBaseline = "middle"

        ctx.fillStyle = "#e6e6e6"
        ctx.font = "600 22px system-ui"

        ctx.fillText(totalBTC.toFixed(8), x, y - 8)

        ctx.fillStyle = "#9ca3af"
        ctx.font = "400 13px system-ui"

        ctx.fillText("BTC", x, y + 14)

        ctx.restore()
    }
}



load()