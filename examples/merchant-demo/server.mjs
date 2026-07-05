// Filament — merchant demo backend (STABLECOIN edition).
// Denominates in fUSD, a UDT stablecoin minted on the devnet. Opens UDT-denominated Fiber
// channels, issues fUSD invoices via the real InvoiceService, lets a buyer (customer2) pay routed
// through the hub, and the InvoiceWatcher flips the invoice to PAID from observed node state.
//
// Run (devnet up + fUSD minted):  node examples/merchant-demo/server.mjs
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import QRCode from "qrcode";
import { RawFiberClient, normalizeChannelState, ChannelState } from "../../dist/rpc/index.js";
import { openDb } from "../../dist/db/index.js";
import { InvoiceService } from "../../dist/invoices/create.js";
import { InvoiceWatcher } from "../../dist/invoices/watch.js";

// ── fUSD stablecoin (devnet SIMPLE_UDT minted by udt-init) ────────────────────
const FUSD = {
  name: "fUSD",
  symbol: "$",
  decimals: 8n, // $1.00 = 1e8 raw units (RUSD-style)
  script: {
    code_hash: "0xe1e354d6d643ad42724d40967e334984534e0367405c5ae42a9d7d63d77df419",
    hash_type: "data2",
    args: "0x32e555f3ff8e135cece1351a6a2971518392c1e30375c1e006ad0ce8eac07947",
  },
};
const usd = (dollars) => BigInt(Math.round(dollars * 1e8)); // -> raw fUSD units

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DEMO_PORT ?? 4001);
const CKB = process.env.CKB_RPC_URL ?? "http://127.0.0.1:8114";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hub = new RawFiberClient("hub", process.env.HUB_RPC_URL ?? "http://127.0.0.1:8227");
const merchant = new RawFiberClient("customer1", process.env.CUSTOMER1_RPC_URL ?? "http://127.0.0.1:8237");
const buyer = new RawFiberClient("customer2", process.env.CUSTOMER2_RPC_URL ?? "http://127.0.0.1:8247");

const db = openDb(join(__dirname, "demo.sqlite"));
const invoices = new InvoiceService(merchant, db);
const watcher = new InvoiceWatcher(merchant, db, { async deliver() { return true; } }, 1500);

async function mine(n = 1) {
  for (let i = 0; i < n; i++)
    await fetch(CKB, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "generate_block", params: [] }) });
}
const stateOf = (c) => normalizeChannelState(typeof c?.state === "string" ? c.state : c?.state?.state_name);
const isFusd = (c) => c.funding_udt_type_script && c.funding_udt_type_script.code_hash === FUSD.script.code_hash;

// Ensure a ready fUSD channel from `from` to peer WITH at least `minLocalUsd` of outbound
// liquidity. A channel below that (e.g. a tiny leftover from a smoke test) can't route real
// payments — "no path found" — so we open a fresh, well-funded one instead of reusing it.
async function ensureFusdChannel(from, peerPubkey, peerAddr, fundUsd, minLocalUsd = 100) {
  const min = usd(minLocalUsd);
  const usable = (c) =>
    c.pubkey === peerPubkey && isFusd(c) && stateOf(c) === ChannelState.ChannelReady &&
    BigInt(c.local_balance ?? "0x0") >= min;
  const ready = (await from.listChannels()).channels.find(usable);
  if (ready) return ready.channel_id;
  await from.connectPeer({ address: peerAddr }).catch(() => {});
  await sleep(1500);
  await from.openChannel({
    pubkey: peerPubkey,
    funding_amount: "0x" + usd(fundUsd).toString(16),
    public: true,
    funding_udt_type_script: FUSD.script,
  });
  for (let i = 0; i < 45; i++) {
    await mine(3);
    const c = (await from.listChannels()).channels.find(usable);
    if (c) return c.channel_id;
    await sleep(1200);
  }
  throw new Error(`fUSD channel ${from.name} -> peer never became ready`);
}

let ready = false, readyError = null;
async function bootstrap() {
  const [h, m] = await Promise.all([hub.nodeInfo(), merchant.nodeInfo()]);
  console.log("[demo] ensuring fUSD liquidity: hub->merchant and buyer->hub ...");
  await ensureFusdChannel(hub, m.pubkey, m.addresses[0], 100000);   // hub can pay the merchant in fUSD
  await ensureFusdChannel(buyer, h.pubkey, h.addresses[0], 100000); // buyer can pay via the hub
  console.log("[demo] waiting for gossip to propagate channels into the routing graph...");
  await mine(4); await sleep(8000);
  watcher.start();
  ready = true;
  console.log("[demo] ready. open http://127.0.0.1:" + PORT);
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
async function readBody(req) { let s = ""; for await (const c of req) s += c; return s ? JSON.parse(s) : {}; }

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(await readFile(join(__dirname, "index.html"), "utf8"));
    }
    if (req.method === "GET" && url.pathname === "/api/ready") return json(res, 200, { ready, error: readyError, token: FUSD.name });
    if (req.method === "POST" && url.pathname === "/api/checkout") {
      if (!ready) return json(res, 503, { error: "liquidity not ready yet" });
      const { amountUsd, description } = await readBody(req);
      const inv = await invoices.create({
        amountShannons: usd(Number(amountUsd)),   // raw fUSD units
        description: description ?? "Filament order",
        udtTypeScript: FUSD.script,               // <-- denominated in the stablecoin
      });
      const qr = await QRCode.toDataURL(inv.invoiceAddress, { margin: 1, color: { dark: "#f6b25a", light: "#00000000" }, width: 320 });
      return json(res, 201, { payment_hash: inv.paymentHash, invoice: inv.invoiceAddress, qr });
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/status/")) {
      const row = invoices.get(url.pathname.split("/").pop());
      return json(res, 200, { status: row?.status ?? "UNKNOWN" });
    }
    if (req.method === "POST" && url.pathname === "/api/pay") {
      const { invoice } = await readBody(req);
      // Buyer pays (routed customer2 -> hub -> merchant, in fUSD). Retry across gossip settling.
      let status = "", ph;
      for (let a = 0; a < 6 && status !== "Success"; a++) {
        try {
          const pay = await buyer.sendPayment({ invoice });
          ph = pay.payment_hash; status = pay.status;
          for (let i = 0; i < 20 && status !== "Success" && status !== "Failed"; i++) { await sleep(700); status = (await buyer.getPayment({ payment_hash: ph })).status; }
        } catch { status = ""; await sleep(1500); }
      }
      return json(res, 200, { status });
    }
    res.writeHead(404).end("not found");
  } catch (err) { json(res, 500, { error: String(err?.message ?? err) }); }
});

server.listen(PORT, "127.0.0.1", () => console.log(`[demo] http://127.0.0.1:${PORT} (booting fUSD liquidity...)`));
bootstrap().catch((e) => { readyError = String(e?.message ?? e); console.error("[demo] bootstrap failed:", e); });
