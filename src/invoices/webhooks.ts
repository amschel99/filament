import { createHmac } from "node:crypto";
import type { Db } from "../db/index.js";
import { now } from "../db/index.js";

/**
 * Phase 4 — webhook dispatch. POST to the registered URL with an HMAC signature over the raw
 * body; exponential backoff (3–5 attempts); one webhook_deliveries row per attempt.
 */
export type WebhookEvent =
  | "invoice.paid"
  | "invoice.received"
  | "invoice.expired"
  | "invoice.cancelled";

export interface WebhookPayload {
  event: WebhookEvent;
  payment_hash: string;
  amount: string; // hex shannons
  metadata?: Record<string, unknown>;
  preimage_proof?: string;
}

export function sign(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export class WebhookDispatcher {
  constructor(
    private readonly db: Db,
    private readonly opts: { maxAttempts: number; backoffBaseMs: number },
  ) {}

  /** Deliver with retry. Records every attempt; returns true if any attempt got a 2xx. */
  async deliver(url: string, secret: string | null, payload: WebhookPayload): Promise<boolean> {
    const rawBody = JSON.stringify(payload);
    for (let attempt = 1; attempt <= this.opts.maxAttempts; attempt++) {
      let statusCode: number | undefined;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(secret ? { "x-fiber-signature": sign(secret, rawBody) } : {}),
          },
          body: rawBody,
        });
        statusCode = res.status;
        this.record(payload.payment_hash, payload.event, attempt, statusCode, res.ok);
        if (res.ok) return true;
      } catch {
        this.record(payload.payment_hash, payload.event, attempt, statusCode ?? 0, false);
      }
      if (attempt < this.opts.maxAttempts) {
        await delay(this.opts.backoffBaseMs * 2 ** (attempt - 1));
      }
    }
    return false;
  }

  private record(
    paymentHash: string,
    event: string,
    attempt: number,
    statusCode: number,
    delivered: boolean,
  ): void {
    this.db
      .prepare(
        `INSERT INTO webhook_deliveries
           (payment_hash, event, attempt, status_code, delivered, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(paymentHash, event, attempt, statusCode, delivered ? 1 : 0, now());
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
