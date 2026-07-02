import type { FastifyReply, FastifyRequest } from "fastify";
import type { InvoiceService } from "../invoices/index.js";
import type { Db } from "../db/index.js";

/**
 * Phase 5 — L402 (pay-per-request) middleware. ~100 lines on top of Phase 4; the agent-payments
 * demo. Flow:
 *   1. Request without valid payment auth -> 402 with a header carrying a FRESH Fiber invoice.
 *   2. Client pays, retries with the preimage in the Authorization header.
 *   3. Middleware verifies preimage against the paid-invoice record in the DB -> request passes.
 *
 * STATUS: skeleton — the gate structure is real; wire verification once Phase 4 marks invoices
 * PAID from observed node state.
 */
export interface L402Options {
  priceShannons: bigint;
  invoices: InvoiceService;
  db: Db;
}

const AUTH_SCHEME = "L402";

export function l402Guard(opts: L402Options) {
  return async function guard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const preimage = extractPreimage(req.headers.authorization);

    if (preimage && isPaid(opts.db, preimage)) {
      return; // authorized — fall through to the route handler
    }

    // No / invalid proof: mint a fresh invoice and challenge with 402.
    const invoice = await opts.invoices.create({
      amountShannons: opts.priceShannons,
      description: "L402 access",
    });
    reply
      .code(402)
      .header("WWW-Authenticate", `${AUTH_SCHEME} invoice="${invoice.invoiceAddress}"`)
      .send({ error: "payment_required", invoice: invoice.invoiceAddress });
  };
}

function extractPreimage(authHeader?: string): string | undefined {
  if (!authHeader?.startsWith(`${AUTH_SCHEME} `)) return undefined;
  const token = authHeader.slice(AUTH_SCHEME.length + 1).trim();
  return /^0x[0-9a-fA-F]{64}$/.test(token) ? token : undefined;
}

function isPaid(db: Db, preimage: string): boolean {
  const row = db
    .prepare(`SELECT status FROM invoices WHERE preimage = ?`)
    .get(preimage) as { status?: string } | undefined;
  return row?.status === "PAID";
}
