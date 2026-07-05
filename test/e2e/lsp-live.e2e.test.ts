import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  RawFiberClient,
  normalizeChannelState,
  ChannelState,
  shannonHexToShannon,
} from "../../src/rpc/index.js";
import { openDb, type Db } from "../../src/db/index.js";
import { LiquidityService } from "../../src/lsp/liquidity.js";
import { ChannelMonitor } from "../../src/lsp/monitor.js";
import { InvoiceService } from "../../src/invoices/create.js";
import { InvoiceWatcher, type Dispatcher } from "../../src/invoices/watch.js";
import { WebhookDispatcher, sign } from "../../src/invoices/webhooks.js";
import { buildServer } from "../../src/api/server.js";
import { l402Guard } from "../../src/l402/index.js";

/**
 * LIVE service e2e — drives the ACTUAL LSP application (LiquidityService, ChannelMonitor,
 * InvoiceService, InvoiceWatcher, the Fastify API, and the L402 gate) against real fnn v0.9.0-rc5
 * nodes on a local CKB devnet. Same code paths the fake integration suite proves, now certified
 * end to end on-chain. Opt-in via RUN_E2E=1; `npm run test:e2e`.
 *
 * Tests share on-chain state and run in order. Channels are funded on-chain, so we mine blocks
 * (CKB IntegrationTest generate_block) while polling for confirmation.
 */
const RUN = process.env.RUN_E2E === "1";
const HUB = process.env.HUB_RPC_URL ?? "http://127.0.0.1:8227";
const CUST1 = process.env.CUSTOMER1_RPC_URL ?? "http://127.0.0.1:8237";
const CUST2 = process.env.CUSTOMER2_RPC_URL ?? "http://127.0.0.1:8247";
const CKB = process.env.CKB_RPC_URL ?? "http://127.0.0.1:8114";
const CKB_SHANNON = 100_000_000n;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function mine(n = 1): Promise<void> {
  for (let i = 0; i < n; i++) {
    await fetch(CKB, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "generate_block", params: [] }),
    });
  }
}

const hub = new RawFiberClient("hub", HUB);
const c1 = new RawFiberClient("customer1", CUST1);
const c2 = new RawFiberClient("customer2", CUST2);

const stateOf = (ch: { state?: { state_name?: string } | string }) =>
  normalizeChannelState(typeof ch?.state === "string" ? ch.state : ch?.state?.state_name);

type ObservedChan = {
  channel_id?: string;
  pubkey?: string;
  local_balance?: string;
  state?: { state_name?: string } | string;
};

/**
 * Open (if needed) a ready channel from `from` to `peerPubkey` with at least `minLocalCkb` of
 * spendable local balance, mining until ChannelReady. Reusing a drained channel from a prior run
 * would make payments fail, so we skip channels below the threshold and fund a fresh one.
 */
async function ensureReadyChannel(
  from: RawFiberClient,
  peerPubkey: string,
  peerAddr: string,
  fundingCkb: bigint,
  minLocalCkb = fundingCkb / 3n,
): Promise<string> {
  const minLocal = minLocalCkb * CKB_SHANNON;
  const usable = (c: ObservedChan) =>
    c.pubkey === peerPubkey &&
    stateOf(c) === ChannelState.ChannelReady &&
    shannonHexToShannon(c.local_balance ?? "0x0") >= minLocal;

  const existing = (await from.listChannels()).channels as ObservedChan[];
  const ready = existing.find(usable);
  if (ready?.channel_id) return ready.channel_id;

  await from.connectPeer({ address: peerAddr }).catch(() => {});
  await sleep(1500);
  await from.openChannel({
    pubkey: peerPubkey,
    funding_amount: `0x${(fundingCkb * CKB_SHANNON).toString(16)}`,
    public: true,
  });
  for (let i = 0; i < 40; i++) {
    await mine(3);
    const chans = (await from.listChannels()).channels as ObservedChan[];
    const ch = chans.find(usable);
    if (ch?.channel_id) return ch.channel_id;
    await sleep(1200);
  }
  throw new Error(`channel ${from.name} -> ${peerPubkey.slice(0, 10)} never reached ready`);
}

async function payAndWait(from: RawFiberClient, invoiceAddress: string, tries = 30): Promise<string> {
  const pay = (await from.sendPayment({ invoice: invoiceAddress })) as {
    payment_hash: `0x${string}`;
    status: string;
  };
  let status = pay.status;
  for (let i = 0; i < tries && status !== "Success" && status !== "Failed"; i++) {
    await sleep(1000);
    status = (await from.getPayment({ payment_hash: pay.payment_hash })).status as string;
  }
  return status;
}

let hubInfo: Awaited<ReturnType<RawFiberClient["nodeInfo"]>>;
let c1Info: typeof hubInfo;
let c2Info: typeof hubInfo;
let db: Db;

describe.skipIf(!RUN)("LIVE LSP services on devnet", () => {
  beforeAll(async () => {
    hubInfo = await hub.nodeInfo();
    c1Info = await c1.nodeInfo();
    c2Info = await c2.nodeInfo();
    db = openDb(":memory:");
    // Hub needs outbound liquidity to customer1 to pay its invoices (money loop / payout / L402).
    await ensureReadyChannel(hub, c1Info.pubkey!, c1Info.addresses![0]!, 2000n);
  }, 180_000);

  afterAll(() => db?.close());

  it("M3: LiquidityService.provision -> ChannelMonitor observes READY in the DB", async () => {
    const lsp = new LiquidityService(hub, db, { minCkb: 100n, maxCkb: 100_000n });
    const monitor = new ChannelMonitor(hub, db);

    const { requestId } = await lsp.provision({
      nodePubkey: c2Info.pubkey!,
      nodeAddress: c2Info.addresses![0]!,
      inboundCkb: 500n,
    });
    expect((lsp.status(requestId) as { state: string }).state).toBe("PROVISIONING");

    let row: { state: string; channel_id: string | null; local_balance: string | null } | undefined;
    for (let i = 0; i < 40; i++) {
      await mine(3);
      await monitor.tick();
      row = lsp.status(requestId) as typeof row;
      if (row?.state === "READY") break;
      await sleep(1200);
    }
    expect(row?.state).toBe("READY");
    expect(row?.channel_id).toMatch(/^0x/);
    // Observed hub-side balance came from list_channels, not assumed.
    expect(shannonHexToShannon(row!.local_balance!)).toBeGreaterThan(0n);
  }, 180_000);

  it("M4: create invoice on customer1, hub pays, watcher observes PAID and fires the webhook", async () => {
    // Local server to receive the real webhook.
    const received: { body: string; sig?: string }[] = [];
    const srv: Server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ body, sig: req.headers["x-fiber-signature"] as string | undefined });
        res.writeHead(200).end();
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/hook`;

    try {
      const invoices = new InvoiceService(c1, db);
      const dispatcher = new WebhookDispatcher(db, { maxAttempts: 3, backoffBaseMs: 50 });
      const watcher = new InvoiceWatcher(c1, db, dispatcher);

      const inv = await invoices.create({
        amountShannons: 100n * CKB_SHANNON,
        description: "live coffee",
        webhookUrl: url,
        webhookSecret: "shh",
        metadata: { orderId: "LIVE-1" },
      });
      expect(inv.paymentHash).toMatch(/^0x/);

      const status = await payAndWait(hub, inv.invoiceAddress);
      expect(status).toBe("Success");

      let changed = 0;
      for (let i = 0; i < 15 && changed === 0; i++) {
        changed = await watcher.tick();
        if (changed === 0) await sleep(1000);
      }
      expect(invoices.get(inv.paymentHash)?.status).toBe("PAID");

      expect(received).toHaveLength(1);
      const payload = JSON.parse(received[0]!.body);
      expect(payload.event).toBe("invoice.paid");
      expect(payload.payment_hash).toBe(inv.paymentHash);
      expect(received[0]!.sig).toBe(sign("shh", received[0]!.body));
      expect(payload.preimage_proof).toMatch(/^0x[0-9a-f]{64}$/);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  }, 120_000);

  it("M5: public API (buildServer) health, invoice, balance, payout over live nodes", async () => {
    const app: FastifyInstance = await buildServer({ db, hub, receiver: c1, apiKey: "k" });
    try {
      const health = await app.inject({ method: "GET", url: "/v1/health" });
      expect(health.statusCode).toBe(200);
      expect(health.json().hub_reachable).toBe(true);

      const create = await app.inject({
        method: "POST",
        url: "/v1/invoices",
        headers: { "x-api-key": "k" },
        payload: { amount_shannons: `0x${(5n * CKB_SHANNON).toString(16)}`, description: "api" },
      });
      expect(create.statusCode).toBe(201);

      const balance = await app.inject({ method: "GET", url: "/v1/balance", headers: { "x-api-key": "k" } });
      expect(balance.statusCode).toBe(200);
      // The READY hub->customer2 channel from M3 shows up as deployed liquidity.
      expect(shannonHexToShannon(balance.json().total_local)).toBeGreaterThan(0n);

      // Payout: hub pays a fresh customer1 invoice.
      const payee = await c1.newInvoice({ amount: `0x${(3n * CKB_SHANNON).toString(16)}`, currency: "Fibd" });
      const payout = await app.inject({
        method: "POST",
        url: "/v1/payouts",
        headers: { "x-api-key": "k" },
        payload: { invoice: payee.invoice_address },
      });
      expect(payout.statusCode).toBe(200);
      expect(["Success", "Created", "Inflight"]).toContain(payout.json().status);
    } finally {
      await app.close();
    }
  }, 120_000);

  it("L402: 402 challenge, pay, then the preimage admits the request", async () => {
    const invoices = new InvoiceService(c1, db);
    const noop: Dispatcher = { async deliver() { return true; } };
    const watcher = new InvoiceWatcher(c1, db, noop);

    const app = Fastify();
    app.get(
      "/quote",
      { preHandler: l402Guard({ priceShannons: 2n * CKB_SHANNON, invoices, db }) },
      async () => ({ data: "the paid quote" }),
    );
    await app.ready();

    try {
      const challenge = await app.inject({ method: "GET", url: "/quote" });
      expect(challenge.statusCode).toBe(402);
      const invoiceAddr = challenge.json().invoice as string;
      expect(invoiceAddr).toMatch(/^fibd/);

      expect(await payAndWait(hub, invoiceAddr)).toBe("Success");
      for (let i = 0; i < 15; i++) {
        if ((await watcher.tick()) > 0) break;
        await sleep(1000);
      }
      const row = db.prepare(`SELECT preimage FROM invoices WHERE invoice_address = ?`).get(invoiceAddr) as {
        preimage: string;
      };
      const ok = await app.inject({
        method: "GET",
        url: "/quote",
        headers: { authorization: `L402 ${row.preimage}` },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().data).toBe("the paid quote");
    } finally {
      await app.close();
    }
  }, 120_000);

  it("multi-hop: customer2 pays a customer1 invoice routed through the hub, fee > 0", async () => {
    // customer2 needs outbound to the hub; hub already has outbound to customer1 (beforeAll).
    await ensureReadyChannel(c2, hubInfo.pubkey!, hubInfo.addresses![0]!, 1000n);

    const inv = await c1.newInvoice({ amount: `0x${(50n * CKB_SHANNON).toString(16)}`, currency: "Fibd" });

    // Give gossip time to propagate the hub->c1 channel into customer2's graph.
    let payHash: `0x${string}` | undefined;
    let status = "";
    for (let attempt = 0; attempt < 12 && status !== "Success"; attempt++) {
      await mine(2);
      await sleep(2500);
      try {
        const pay = (await c2.sendPayment({ invoice: inv.invoice_address })) as {
          payment_hash: `0x${string}`;
          status: string;
        };
        payHash = pay.payment_hash;
        status = pay.status;
        for (let i = 0; i < 20 && status !== "Success" && status !== "Failed"; i++) {
          await sleep(1000);
          status = (await c2.getPayment({ payment_hash: payHash })).status as string;
        }
      } catch {
        status = "";
      }
    }
    expect(status, "multi-hop payment succeeded").toBe("Success");
    const fee = shannonHexToShannon((await c2.getPayment({ payment_hash: payHash! })).fee ?? "0x0");
    expect(fee).toBeGreaterThan(0n);
  }, 240_000);
});
