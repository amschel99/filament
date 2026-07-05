import type { FiberClient } from "../rpc/index.js";
import { normalizeInvoiceStatus, InvoiceStatus } from "../rpc/index.js";
import type { Db } from "../db/index.js";
import { now } from "../db/index.js";
import type { WebhookEvent, WebhookPayload } from "./webhooks.js";

/** Anything that can deliver a webhook (real dispatcher, or a test spy). */
export interface Dispatcher {
  deliver(url: string, secret: string | null, payload: WebhookPayload): Promise<boolean>;
}

/**
 * Phase 4 — invoice watcher. Polls open/received invoices via get_invoice and, on an OBSERVED
 * status change (CLAUDE.md rule 4), updates the DB and dispatches the matching webhook:
 *   Paid -> invoice.paid · Received (hold) -> invoice.received · Expired/Cancelled -> terminal.
 */
const STATUS_MAP: Partial<Record<InvoiceStatus, { db: string; event?: WebhookEvent }>> = {
  [InvoiceStatus.Open]: { db: "OPEN" },
  [InvoiceStatus.Received]: { db: "RECEIVED", event: "invoice.received" },
  [InvoiceStatus.Paid]: { db: "PAID", event: "invoice.paid" },
  [InvoiceStatus.Cancelled]: { db: "CANCELLED", event: "invoice.cancelled" },
  [InvoiceStatus.Expired]: { db: "EXPIRED", event: "invoice.expired" },
};

interface WatchRow {
  payment_hash: string;
  status: string;
  amount_shannons: string;
  metadata: string | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  preimage: string | null;
  is_hold: number;
}

export class InvoiceWatcher {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly receiver: FiberClient,
    private readonly db: Db,
    private readonly dispatcher: Dispatcher,
    private readonly intervalMs = 3000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch(() => {}), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One reconciliation pass. Returns the number of invoices whose status changed. */
  async tick(): Promise<number> {
    const open = this.db
      .prepare(
        `SELECT payment_hash, status, amount_shannons, metadata, webhook_url, webhook_secret,
                preimage, is_hold
           FROM invoices WHERE status IN ('OPEN','RECEIVED')`,
      )
      .all() as WatchRow[];

    let changed = 0;
    for (const row of open) {
      const raw = await this.receiver.getInvoice({ payment_hash: row.payment_hash as `0x${string}` });
      const mapped = STATUS_MAP[normalizeInvoiceStatus(raw.status)];
      if (!mapped || mapped.db === row.status) continue;

      this.db
        .prepare(`UPDATE invoices SET status = ?, updated_at = ? WHERE payment_hash = ?`)
        .run(mapped.db, now(), row.payment_hash);
      changed++;

      if (mapped.event && row.webhook_url) {
        const payload: WebhookPayload = {
          event: mapped.event,
          payment_hash: row.payment_hash,
          amount: row.amount_shannons,
          ...(row.metadata ? { metadata: JSON.parse(row.metadata) } : {}),
          // Reveal the preimage proof only once the invoice is actually PAID.
          ...(mapped.db === "PAID" && row.preimage ? { preimage_proof: row.preimage } : {}),
        };
        await this.dispatcher.deliver(row.webhook_url, row.webhook_secret, payload);
      }
    }
    return changed;
  }
}
