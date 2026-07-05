import type { FastifyInstance } from "fastify";
import type { FiberClient, Hex } from "../rpc/index.js";
import type { Db } from "../db/index.js";
import { shannonHexToShannon, shannonToHex } from "../rpc/index.js";
import { InvoiceService, type InvoiceRow } from "../invoices/index.js";
import { LiquidityService } from "../lsp/index.js";

/**
 * Phase 5 — public API routes. Fastify · JSON · amounts are shannons-as-hex in/out. Handlers are
 * thin: they delegate to the Phase 3/4 services and read the DB (which the pollers keep in sync
 * from observed node state). No business logic lives here.
 */
export interface ApiDeps {
  db: Db;
  hub: FiberClient;
  receiver: FiberClient; // customer1 on devnet v0
}

export async function registerRoutes(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  const invoices = new InvoiceService(deps.receiver, deps.db);
  const liquidity = new LiquidityService(deps.hub, deps.db);

  app.get("/v1/health", async () => {
    let hubReachable = false;
    let node: unknown = null;
    try {
      node = await deps.hub.nodeInfo();
      hubReachable = true;
    } catch {
      hubReachable = false;
    }
    const counts = deps.db
      .prepare(`SELECT state, COUNT(*) n FROM channels GROUP BY state`)
      .all() as { state: string; n: number }[];
    return { ok: hubReachable, hub_reachable: hubReachable, node, channels: counts };
  });

  app.post("/v1/invoices", async (req, reply) => {
    const b = req.body as {
      amount_shannons: string;
      description?: string;
      expiry_seconds?: number;
      metadata?: Record<string, unknown>;
      webhook_url?: string;
      webhook_secret?: string;
      hold?: boolean;
    };
    if (!b?.amount_shannons) return reply.code(400).send({ error: "amount_shannons required" });
    const r = await invoices.create({
      amountShannons: shannonHexToShannon(b.amount_shannons),
      description: b.description,
      expirySeconds: b.expiry_seconds,
      metadata: b.metadata,
      webhookUrl: b.webhook_url,
      webhookSecret: b.webhook_secret,
      hold: b.hold,
    });
    return reply.code(201).send({
      payment_hash: r.paymentHash,
      invoice_address: r.invoiceAddress,
      expires_at: r.expiresAt,
    });
  });

  app.get("/v1/invoices/:hash", async (req, reply) => {
    const { hash } = req.params as { hash: string };
    const row = invoices.get(hash);
    return row ? reply.send(publicInvoice(row)) : reply.code(404).send({ error: "not_found" });
  });

  app.post("/v1/invoices/:hash/settle", async (req, reply) => {
    const { hash } = req.params as { hash: string };
    const body = (req.body ?? {}) as { preimage?: string };
    try {
      await invoices.settle(hash as Hex, body.preimage as Hex | undefined);
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(400).send({ error: msg(err) });
    }
  });

  app.post("/v1/invoices/:hash/cancel", async (req, reply) => {
    const { hash } = req.params as { hash: string };
    try {
      await invoices.cancel(hash as Hex);
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(400).send({ error: msg(err) });
    }
  });

  app.post("/v1/liquidity", async (req, reply) => {
    const b = req.body as { node_pubkey: string; node_address?: string; inbound_ckb: string };
    if (!b?.node_pubkey || !b?.inbound_ckb)
      return reply.code(400).send({ error: "node_pubkey and inbound_ckb required" });
    try {
      const { requestId } = await liquidity.provision({
        nodePubkey: b.node_pubkey,
        nodeAddress: b.node_address,
        inboundCkb: BigInt(b.inbound_ckb),
      });
      return reply.code(202).send({ channel_request_id: requestId });
    } catch (err) {
      return reply.code(400).send({ error: msg(err) });
    }
  });

  app.get("/v1/liquidity/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = liquidity.status(id);
    return row ? reply.send(row) : reply.code(404).send({ error: "not_found" });
  });

  app.post("/v1/payouts", async (req, reply) => {
    const b = req.body as { invoice?: string; target_pubkey?: string; amount_shannons?: string };
    try {
      const pay = await deps.hub.sendPayment({
        ...(b.invoice ? { invoice: b.invoice } : {}),
        ...(b.target_pubkey ? { target_pubkey: b.target_pubkey as Hex, keysend: true } : {}),
        ...(b.amount_shannons ? { amount: b.amount_shannons as Hex } : {}),
      });
      return reply.send(pay);
    } catch (err) {
      return reply.code(400).send({ error: msg(err) });
    }
  });

  app.get("/v1/balance", async () => {
    const rows = deps.db
      .prepare(
        `SELECT channel_id, peer_pubkey, local_balance, remote_balance
           FROM channels WHERE state = 'READY'`,
      )
      .all() as { channel_id: string; peer_pubkey: string; local_balance: string | null; remote_balance: string | null }[];
    let localTotal = 0n;
    let remoteTotal = 0n;
    for (const r of rows) {
      localTotal += r.local_balance ? shannonHexToShannon(r.local_balance) : 0n;
      remoteTotal += r.remote_balance ? shannonHexToShannon(r.remote_balance) : 0n;
    }
    return {
      channels: rows,
      total_local: shannonToHex(localTotal),
      total_remote: shannonToHex(remoteTotal),
    };
  });

  app.post("/v1/webhooks", async (req, reply) => {
    // v0: webhooks are attached per-invoice at creation (webhook_url/secret). A standalone
    // registry lands with multi-tenant support (hosted fleet). Acknowledge for now.
    const b = (req.body ?? {}) as { url?: string };
    if (!b.url) return reply.code(400).send({ error: "url required" });
    return reply.code(501).send({ error: "not_implemented", hint: "pass webhook_url when creating an invoice" });
  });
}

function publicInvoice(row: InvoiceRow) {
  // Never expose the preimage or webhook secret over the API.
  const { preimage, webhook_secret, ...safe } = row;
  void preimage;
  void webhook_secret;
  return safe;
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
