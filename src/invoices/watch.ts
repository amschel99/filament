import type { FiberClient } from "../rpc/index.js";
import { normalizeInvoiceStatus, InvoiceStatus } from "../rpc/index.js";
import type { Db } from "../db/index.js";

/**
 * Phase 4 — invoice watcher. Polls open invoices via get_invoice and, on an OBSERVED status
 * change (CLAUDE.md rule 4), updates the DB and enqueues the matching webhook:
 *   Paid -> invoice.paid, Received (hold) -> invoice.received, Expired/Cancelled -> terminal.
 *
 * STATUS: skeleton. Wire the webhook enqueue in tick() once WebhookDispatcher lands.
 */
export class InvoiceWatcher {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly receiver: FiberClient,
    private readonly db: Db,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch(() => {}), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    const open = this.db
      .prepare(`SELECT payment_hash FROM invoices WHERE status IN ('OPEN','RECEIVED')`)
      .all() as { payment_hash: string }[];

    for (const row of open) {
      const raw = await this.receiver.getInvoice({ payment_hash: row.payment_hash as `0x${string}` });
      const status = normalizeInvoiceStatus(raw.status);
      // TODO(Phase 4): if status changed, UPDATE invoices + enqueue webhook via WebhookDispatcher.
      void status;
      void InvoiceStatus;
    }
  }
}
