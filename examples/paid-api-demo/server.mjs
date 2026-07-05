// Filament — L402 pay-per-call demo (the agent-payments story), priced in fUSD.
// A "premium data" endpoint is gated by the L402 middleware: no payment -> 402 + a fresh $0.05
// fUSD invoice; an agent pays it (routed through the hub); the preimage then admits the request.
//
// Run (devnet up + fUSD minted):  node examples/paid-api-demo/server.mjs
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { RawFiberClient, normalizeChannelState, ChannelState } from "../../dist/rpc/index.js";
import { openDb } from "../../dist/db/index.js";
import { InvoiceService } from "../../dist/invoices/create.js";
import { InvoiceWatcher } from "../../dist/invoices/watch.js";
import { l402Guard } from "../../dist/l402/index.js";

const FUSD = {
  decimals: 8n,
  script: {
    code_hash: "0xe1e354d6d643ad42724d40967e334984534e0367405c5ae42a9d7d63d77df419",
    hash_type: "data2",
    args: "0x32e555f3ff8e135cece1351a6a2971518392c1e30375c1e006ad0ce8eac07947",
  },
};
const usd = (d) => BigInt(Math.round(d * 1e8));
const PRICE_USD = 0.05;

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DEMO_PORT ?? 4002);
const CKB = process.env.CKB_RPC_URL ?? "http://127.0.0.1:8114";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hub = new RawFiberClient("hub", process.env.HUB_RPC_URL ?? "http://127.0.0.1:8227");
const provider = new RawFiberClient("customer1", process.env.CUSTOMER1_RPC_URL ?? "http://127.0.0.1:8237"); // API provider = receiver
const agent = new RawFiberClient("customer2", process.env.CUSTOMER2_RPC_URL ?? "http://127.0.0.1:8247");     // paying agent = buyer

const db = openDb(join(__dirname, "demo.sqlite"));
const invoices = new InvoiceService(provider, db);
const watcher = new InvoiceWatcher(provider, db, { async deliver() { return true; } }, 1200);
const guard = l402Guard({ priceShannons: usd(PRICE_USD), invoices, db, udtTypeScript: FUSD.script, description: `$${PRICE_USD.toFixed(2)} fUSD per call` });

// The "premium" payload the agent is paying for.
const PREMIUM = {
  signal: "CKB/USD 30d momentum",
  score: 0.732,
  regime: "risk-on",
  updated: "just now",
  note: "Model output — for the demo. You paid $0.05 in a stablecoin to read this line.",
};

async function mine(n = 1) { for (let i = 0; i < n; i++) await fetch(CKB, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "generate_block", params: [] }) }); }
const stateOf = (c) => normalizeChannelState(typeof c?.state === "string" ? c.state : c?.state?.state_name);
const isFusd = (c) => c.funding_udt_type_script && c.funding_udt_type_script.code_hash === FUSD.script.code_hash;
async function ensureFusdChannel(from, peerPubkey, peerAddr, fundUsd, minLocalUsd = 10) {
  const min = usd(minLocalUsd);
  const usable = (c) => c.pubkey === peerPubkey && isFusd(c) && stateOf(c) === ChannelState.ChannelReady && BigInt(c.local_balance ?? "0x0") >= min;
  const have = (await from.listChannels()).channels.find(usable);
  if (have) return have.channel_id;
  await from.connectPeer({ address: peerAddr }).catch(() => {});
  await sleep(1500);
  await from.openChannel({ pubkey: peerPubkey, funding_amount: "0x" + usd(fundUsd).toString(16), public: true, funding_udt_type_script: FUSD.script });
  for (let i = 0; i < 45; i++) { await mine(3); const c = (await from.listChannels()).channels.find(usable); if (c) return c.channel_id; await sleep(1200); }
  throw new Error("fUSD channel never ready");
}

let ready = false, readyError = null;
async function bootstrap() {
  const [h, p] = await Promise.all([hub.nodeInfo(), provider.nodeInfo()]);
  console.log("[l402] ensuring fUSD liquidity: hub->provider and agent->hub ...");
  await ensureFusdChannel(hub, p.pubkey, p.addresses[0], 100000);
  await ensureFusdChannel(agent, h.pubkey, h.addresses[0], 100000);
  await mine(4); await sleep(8000);
  watcher.start();
  ready = true;
  console.log("[l402] ready. open http://127.0.0.1:" + PORT);
}

// ── HTTP with the L402 gate on /api/data ──────────────────────────────────────
const json = (res, code, body, headers = {}) => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
async function readBody(req) { let s = ""; for await (const c of req) s += c; return s ? JSON.parse(s) : {}; }
// Minimal Fastify-like adapter so we can reuse l402Guard (which speaks reply.code/.header/.send).
function replyAdapter(res) { let code = 200; const headers = {}; return { code(c) { code = c; return this; }, header(k, v) { headers[k] = v; return this; }, send(body) { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body)); }, get _sent() { return res.writableEnded; } }; }

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(await readFile(join(__dirname, "index.html"), "utf8")); }
    if (req.method === "GET" && url.pathname === "/api/ready") return json(res, 200, { ready, error: readyError, priceUsd: PRICE_USD });

    if (req.method === "GET" && url.pathname === "/api/data") {
      if (!ready) return json(res, 503, { error: "liquidity not ready" });
      const reply = replyAdapter(res);
      await guard({ headers: req.headers }, reply);   // 402 + invoice, or passes through
      if (res.writableEnded) return;                  // guard already sent the 402
      return json(res, 200, PREMIUM);                 // authorized -> deliver the premium payload
    }

    if (req.method === "POST" && url.pathname === "/api/pay") {
      // The agent pays the challenge invoice (routed agent -> hub -> provider), then we hand back
      // the preimage it "learned" from paying so it can retry with proof.
      const { invoice } = await readBody(req);
      let status = "", ph;
      for (let a = 0; a < 6 && status !== "Success"; a++) {
        try { const pay = await agent.sendPayment({ invoice }); ph = pay.payment_hash; status = pay.status;
          for (let i = 0; i < 20 && status !== "Success" && status !== "Failed"; i++) { await sleep(700); status = (await agent.getPayment({ payment_hash: ph })).status; }
        } catch { status = ""; await sleep(1500); }
      }
      // Wait for the watcher to observe PAID, then reveal the preimage from our record.
      let preimage = null;
      for (let i = 0; i < 15; i++) { await watcher.tick(); const row = db.prepare("SELECT preimage,status FROM invoices WHERE invoice_address = ?").get(invoice); if (row?.status === "PAID") { preimage = row.preimage; break; } await sleep(800); }
      return json(res, 200, { status, preimage });
    }

    res.writeHead(404).end("not found");
  } catch (err) { json(res, 500, { error: String(err?.message ?? err) }); }
});

server.listen(PORT, "127.0.0.1", () => console.log(`[l402] http://127.0.0.1:${PORT} (booting fUSD liquidity...)`));
bootstrap().catch((e) => { readyError = String(e?.message ?? e); console.error("[l402] bootstrap failed:", e); });
