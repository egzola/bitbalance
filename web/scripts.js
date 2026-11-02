let chart
let walletsCache = []
var totalBTC = 0;
var btcPriceUSD = 0;
var lastPriceFetch = 0

let scanCounter = 0
let scanInterval



function btcToSats(btc) {
    return Number(BigInt(Math.round(btc * 1e8)))
}

async function loadBTCPrice() {

    const now = Date.now()

    // cache de 5 minutos
    if (btcPriceUSD && now - lastPriceFetch < 300000) {
        return
    }

    try {

        const r = await fetch(
            "https://mempool.space/api/v1/prices"
        )

        const data = await r.json()

        btcPriceUSD = data.USD

        lastPriceFetch = now

    } catch (e) {

        console.error("BTC price error", e)

    }

}

async function updatePrices() {

    await loadBTCPrice();

    const usd = totalBTC * btcPriceUSD;

    document.getElementById("totalUSD").innerText = "$" + usd.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " USD";
    document.getElementById("btcPrice").innerText = "1 BTC = $" + btcPriceUSD.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " USD";

    const date = new Date(lastPriceFetch);
    document.getElementById("lastUpdated").innerText = date.toLocaleTimeString();

}


function startScanIndicator() {

    clearInterval(scanInterval);

    const tbody = document.querySelector("#t tbody")

    if (!tbody) return

    tbody.innerHTML = `
    <tr>
      <td colspan="3">
        <div class="scan-container">
            <div class="scanbar"></div>
            <div id="scanIndex">Scanning address 0</div>
        </div>
      </td>
    </tr>`

    scanCounter = 0

    scanInterval = setInterval(() => {

        const el = document.getElementById("scanIndex")
        if (!el) return

        el.innerText = `Scanning address ${scanCounter++}`

    }, 120)

}


function stopScanIndicator() {
    clearInterval(scanInterval)
}


function renderWallets(wallets) {
    walletsCache = wallets || [];

    const tbody = document.querySelector("#t tbody");
    if (!walletsCache.length) {
        tbody.innerHTML = `<tr><td colspan="4">ℹ️ No wallets configured yet</td></tr>`;
        totalBTC = 0;
        document.getElementById("totalTop").innerText = "0.00000000 BTC";
        document.getElementById("totalUSD").innerText = "";
        if (chart) chart.destroy();
        return;
    }

    // Só soma os saldos que já terminaram de ser consultados.
    const total = walletsCache.reduce((sum, w) =>
        sum + (w.pending ? 0 : (Number(w.balance) || 0)), 0);

    const labels = [];
    const values = [];

    const rows = walletsCache.map(w => {
        const pending = w.pending === true;
        const btc = pending ? 0 : (Number(w.balance) || 0);
        const perc = pending ? "—" :
            (total > 0 ? ((btc / total) * 100).toFixed(1) : "0.0");

        labels.push(w.wallet);
        values.push(pending ? 0 : btc);

        const balanceCell = pending
            ? `<span class="balance-loading" title="Consultando saldo"><span class="balance-spinner"></span></span>`
            : `<span title="${btcToSats(btc).toLocaleString()} sats">${btc.toFixed(8)}</span>`;

        return `
<tr onclick="editWallet('${String(w.xpub).replace(/'/g, "\\'")}')">
<td class="walletName">${w.wallet}</td>
<td class="percentage">${perc}</td>
<td class="balance">${balanceCell}</td>
<td class="chevron">›</td>
</tr>`;
    }).join("");

    tbody.innerHTML = rows;
    totalBTC = total;
    document.getElementById("totalTop").innerText = total.toFixed(8) + " BTC";

    updatePrices();
    requestAnimationFrame(() => renderChart(labels, values));
}

async function load(rescan = true) {
    clearTable();
    startScanIndicator();

    try {
        // Mostra imediatamente os últimos saldos salvos enquanto a nova varredura ocorre.
        const cachedResponse = await fetch("/wallets?rescan=false");
        const cachedWallets = await cachedResponse.json();

        if (!rescan) {
            stopScanIndicator();
            renderWallets(cachedWallets);
            return;
        }

        if (!cachedWallets.length) {
            stopScanIndicator();
            renderWallets([]);
            return;
        }

        // Lista todas as carteiras imediatamente, mas esconde os saldos antigos
        // e mostra um indicador individual enquanto cada consulta está pendente.
        const pendingWallets = cachedWallets.map(w => ({
            ...w,
            balance: null,
            pending: true
        }));
        renderWallets(pendingWallets);

        const source = new EventSource("/wallets/stream");

        source.onmessage = (message) => {
            const event = JSON.parse(message.data);

            if (event.type === "start") {
                if (!event.total) {
                    source.close();
                    stopScanIndicator();
                    renderWallets([]);
                }
            }

            if (event.type === "scanning") {
                const el = document.getElementById("scanIndex");
                if (el) el.innerText =
                    `Scanning wallet ${event.index + 1}/${event.total}: ${event.wallet}`;
            }

            if (event.type === "wallet") {
                const updated = event.wallet;
                const index = walletsCache.findIndex(w => w.xpub === updated.xpub);

                if (index >= 0) walletsCache[index] = updated;
                else walletsCache.push(updated);

                // Atualiza tabela, total e gráfico a cada carteira concluída.
                renderWallets(walletsCache);
            }

            if (event.type === "done") {
                source.close();
                stopScanIndicator();
                renderWallets(event.wallets || walletsCache);
            }

            if (event.type === "error") {
                console.error("Scan error:", event.error);
                source.close();
                stopScanIndicator();
            }
        };

        source.onerror = (error) => {
            console.error("Wallet stream connection error:", {
                readyState: source.readyState,
                url: source.url,
                event: error
            });

            // CONNECTING (0): navegador tentando reconectar.
            // CLOSED (2): conexão encerrada definitivamente.
            if (source.readyState === EventSource.CLOSED) {
                stopScanIndicator();
            }
        };

    } catch (e) {
        stopScanIndicator();
        console.error(e);
        document.querySelector("#t tbody").innerHTML =
            `<tr><td colspan="4">Error loading wallets</td></tr>`;
    }
}

function clearTable() {
    document.querySelector("#t tbody").innerHTML = "";
    //document.getElementById("total").innerText = "-";
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

            maintainAspectRatio: false,
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

    }, 50)

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
        confirmButtonText: "Save",

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

    load(true);
}


async function editWallet(xpub) {

    const wallet = walletsCache.find(w => w.xpub === xpub)

    let oldXpub = wallet.xpub;

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

        load(true);
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

    if (newXpub === oldXpub) return load(false);

    load();

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
        ctx.font = "600 18px system-ui"

        ctx.fillText(totalBTC.toFixed(8), x, y - 8)

        ctx.fillStyle = "#9ca3af"
        ctx.font = "400 14px system-ui"

        ctx.fillText("BTC", x, y + 14)

        ctx.restore()
    }
}



function copyText(text) {

    if (navigator.clipboard && navigator.clipboard.writeText) {

        navigator.clipboard.writeText(text)

    } else {

        const t = document.createElement("textarea")
        t.value = text
        document.body.appendChild(t)
        t.select()
        document.execCommand("copy")
        document.body.removeChild(t)

    }

    Swal.fire({
        toast: true,
        position: "top",
        icon: "success",
        title: "Lightning address copied",
        showConfirmButton: false,
        timer: 1500
    })

}



function donateModal() {
    const lightningAddr = "thanksalot@walletofsatoshi.com";
    const bitcoinAddr = "bc1q64rwm7nduv6w5x8tzptt7p8g0m4deduka46rts";

    Swal.fire({
        title: "Support the project ⚡",
        html: `
            <div style="margin-top:10px;font-size:15px;color:#888">
                If this tool is useful to you, consider a tip to support
                development and maintenance. Thank you! 🙏
            </div>

            <!-- Tabs -->
            <div style="
                display:flex;
                margin-top:20px;
                border-bottom:1px solid #ddd;
            ">
                <button
                    id="tabLightning"
                    style="
                        flex:1;
                        padding:10px;
                        border:none;
                        background:none;
                        font-weight:bold;
                        color:#0fa90f;
                        border-bottom:2px solid #0fa90f;
                        cursor:pointer;
                    "
                >
                    ⚡ Lightning
                </button>

                <button
                    id="tabOnchain"
                    style="
                        flex:1;
                        padding:10px;
                        border:none;
                        background:none;
                        font-weight:bold;
                        color:#888;
                        border-bottom:2px solid transparent;
                        cursor:pointer;
                    "
                >
                    ₿ On-chain
                </button>
            </div>

            <!-- Lightning content -->
            <div id="lightningContent" style="margin-top:15px;">
                <img
                    src="./donate_qrcode.png"
                    style="
                        width:180px;
                        max-width:80%;
                        margin:10px auto;
                        display:block;
                    "
                />

                <div style="
                    font-size:13px;
                    font-family:monospace;
                    word-break:break-all;
                    margin:10px 0;
                ">
                    ${lightningAddr}
                </div>

                <button
                    id="copyLightning"
                    class="swal2-confirm swal2-styled"
                    style="background:#0fa90f"
                >
                    Copy Lightning address
                </button>
            </div>

            <!-- On-chain content -->
            <div
                id="onchainContent"
                style="
                    margin-top:15px;
                    display:none;
                "
            >
                <img
                    src="./donate_btc_qrcode.png"
                    style="
                        width:180px;
                        max-width:80%;
                        margin:10px auto;
                        display:block;
                    "
                />

                <div style="
                    font-size:13px;
                    font-family:monospace;
                    word-break:break-all;
                    margin:10px 0;
                ">
                    ${bitcoinAddr}
                </div>

                <button
                    id="copyBitcoin"
                    class="swal2-confirm swal2-styled"
                    style="background:#f7931a"
                >
                    Copy Bitcoin address
                </button>
            </div>
        `,

        showConfirmButton: false,
        showCloseButton: true,

        didOpen: () => {

            const tabLightning =
                document.getElementById("tabLightning");

            const tabOnchain =
                document.getElementById("tabOnchain");

            const lightningContent =
                document.getElementById("lightningContent");

            const onchainContent =
                document.getElementById("onchainContent");

            // Lightning tab
            tabLightning.addEventListener("click", () => {

                lightningContent.style.display = "block";
                onchainContent.style.display = "none";

                tabLightning.style.color = "#0fa90f";
                tabLightning.style.borderBottom =
                    "2px solid #0fa90f";

                tabOnchain.style.color = "#888";
                tabOnchain.style.borderBottom =
                    "2px solid transparent";
            });

            // On-chain tab
            tabOnchain.addEventListener("click", () => {

                lightningContent.style.display = "none";
                onchainContent.style.display = "block";

                tabOnchain.style.color = "#f7931a";
                tabOnchain.style.borderBottom =
                    "2px solid #f7931a";

                tabLightning.style.color = "#888";
                tabLightning.style.borderBottom =
                    "2px solid transparent";
            });

            // Copy Lightning
            document
                .getElementById("copyLightning")
                .addEventListener("click", () => {

                    copyText(lightningAddr);

                    Swal.showValidationMessage(
                        "Lightning address copied! ⚡"
                    );
                });

            // Copy Bitcoin
            document
                .getElementById("copyBitcoin")
                .addEventListener("click", () => {

                    copyText(bitcoinAddr);

                    Swal.showValidationMessage(
                        "Bitcoin address copied! ₿"
                    );
                });
        }
    });
}



document.addEventListener('DOMContentLoaded', async function () {

    await new Promise(resolve => setTimeout(resolve, 500)); // pequena espera para garantir que tudo esteja pronto

    const appVersion = await fetch("/appversion")
        .then(res => res.json())
        .then(data => data.appversion)
        .catch(() => "1.0.0");

    document.title = `bitBalance ${appVersion}`;
    document.getElementById("app_version").innerText = `v${appVersion}`;


    load(false);

    document.getElementById("donateBtn").addEventListener("click", donateModal);

    setInterval(updatePrices, 60 * 1000); // atualiza preço a cada minuto


});

