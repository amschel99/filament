import type { FastifyInstance } from "fastify";
import type { FiberClient } from "../rpc/index.js";
import type { Db } from "../db/index.js";
import { InvoiceService } from "../invoices/index.js";
import { LiquidityService } from "../lsp/index.js";

/**
 * Phase 5 — public API routes. Fastify · JSON · API-key auth · amounts are shannons-as-hex
 * in/out. Handlers below are wired to the service skeletons; each returns real data once the
 * underlying Phase 3/4 flows are un-stubbed. Kept intentionally thin: no business logic here.
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
    // TODO(Phase 5): node reachability + chain tip + channel counts + monitor lag.
    let hubReachable = false;
    try {
      await deps.hub.nodeInfo();
      hubReachable = true;
    } catch {
      hubReachable = false;
    }
    return { ok: true, hub_reachable: hubReachable };
  });

  app.post("/v1/invoices", async (req) => {
    const body = req.body as {
      amount_shannons: string;
      description?: string;
      expiry_seconds?: number;
      metadata?: Record<string, unknown>;
      webhook_url?: string;
      hold?: boolean;
    };
    const result = await invoices.create({
      amountShannons: BigInt(body.amount_shannons),
      description: body.description,
      expirySeconds: body.expiry_seconds,
      metadata: body.metadata,
      webhookUrl: body.webhook_url,
      hold: body.hold,
    });
    return {
      payment_hash: result.paymentHash,
      invoice_address: result.invoiceAddress,
      expires_at: result.expiresAt,
    };
  });

  app.get("/v1/invoices/:hash", async (req) => {
    const { hash } = req.params as { hash: string };
    const row = deps.db.prepare(`SELECT * FROM invoices WHERE payment_hash = ?`).get(hash);
    return row ?? { error: "not_found" };
  });

  app.post("/v1/liquidity", async (req) => {
    const body = req.body as { node_pubkey: string; node_address?: string; inbound_ckb: string };
    const { requestId } = await liquidity.provision({
      nodePubkey: body.node_pubkey,
      nodeAddress: body.node_address,
      inboundCkb: BigInt(body.inbound_ckb),
    });
    return { channel_request_id: requestId };
  });

  app.get("/v1/liquidity/:id", async (req) => {
    const { id } = req.params as { id: string };
    const row = deps.db.prepare(`SELECT * FROM channels WHERE request_id = ?`).get(id);
    return row ?? { error: "not_found" };
  });

  // TODO(Phase 5): /v1/invoices/:hash/settle, /cancel, /v1/payouts, /v1/balance, /v1/webhooks.
}
