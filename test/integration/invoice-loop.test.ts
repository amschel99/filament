import { describe, it, expect, beforeEach } from "vitest";
import { FakeFiberNetwork, ckbToShannonHex } from "../../src/rpc/index.js";
import { openDb, type Db } from "../../src/db/index.js";
import { InvoiceService } from "../../src/invoices/create.js";
import { InvoiceWatcher, type Dispatcher } from "../../src/invoices/watch.js";
import type { WebhookPayload } from "../../src/invoices/webhooks.js";

/**
 * M4 — the money loop, integration-tested against the fake fnn. This is the exact flow that will
 * re-run as e2e against a real devnet: create invoice on the merchant node, pay it from the hub,
 * observe Paid, fire the webhook. The fake stands in for the node; the application code is real.
 */
function recorder(): Dispatcher & { events: WebhookPayload[] } {
  const events: WebhookPayload[] = [];
  return { events, async deliver(_u, _s, payload) { events.push(payload); return true; } };
}

describe("invoice money loop (M4)", () => {
  let net: FakeFiberNetwork;
  let db: Db;
  let merchant: ReturnType<FakeFiberNetwork["client"]>;
  let buyer: ReturnType<FakeFiberNetwork["client"]>;

  beforeEach(() => {
    net = new FakeFiberNetwork();
    db = openDb(":memory:");
    merchant = net.client("customer1");
    buyer = net.client("hub");
  });

  async function openBuyerChannel() {
    await buyer.openChannel({ peer_id: merchant.nodeId, funding_amount: ckbToShannonHex(500n), public: true });
    net.mine(); // confirmations land -> ChannelReady
  }

  it("create -> pay -> observe Paid -> invoice.paid webhook (with preimage proof)", async () => {
    await openBuyerChannel();
    const rec = recorder();
    const svc = new InvoiceService(merchant, db);
    const watcher = new InvoiceWatcher(merchant, db, rec);

    const inv = await svc.create({
      amountShannons: 100n * 100_000_000n,
      description: "coffee",
      webhookUrl: "http://merchant.example/hook",
      metadata: { orderId: "A-1" },
    });

    expect(await watcher.tick()).toBe(0); // still OPEN before payment
    expect(svc.get(inv.paymentHash)?.status).toBe("OPEN");

    const pay = await buyer.sendPayment({ invoice: inv.invoiceAddress });
    expect(pay.status).toBe("Success");

    expect(await watcher.tick()).toBe(1); // observed Paid
    expect(svc.get(inv.paymentHash)?.status).toBe("PAID");

    expect(rec.events).toHaveLength(1);
    expect(rec.events[0]!.event).toBe("invoice.paid");
    expect(rec.events[0]!.payment_hash).toBe(inv.paymentHash);
    expect(rec.events[0]!.metadata).toEqual({ orderId: "A-1" });
    expect(rec.events[0]!.preimage_proof).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("hold invoice: pay -> Received -> settle -> Paid, two webhooks", async () => {
    await openBuyerChannel();
    const rec = recorder();
    const svc = new InvoiceService(merchant, db);
    const watcher = new InvoiceWatcher(merchant, db, rec);

    const inv = await svc.create({
      amountShannons: 50n * 100_000_000n,
      hold: true,
      webhookUrl: "http://merchant.example/hook",
    });

    await buyer.sendPayment({ invoice: inv.invoiceAddress });
    expect(await watcher.tick()).toBe(1);
    expect(svc.get(inv.paymentHash)?.status).toBe("RECEIVED");
    expect(rec.events.at(-1)!.event).toBe("invoice.received");

    await svc.settle(inv.paymentHash as `0x${string}`);
    expect(await watcher.tick()).toBe(1);
    expect(svc.get(inv.paymentHash)?.status).toBe("PAID");
    expect(rec.events.map((e) => e.event)).toEqual(["invoice.received", "invoice.paid"]);
  });

  it("payment with no route fails cleanly and leaves the invoice OPEN", async () => {
    // no channel opened
    const rec = recorder();
    const svc = new InvoiceService(merchant, db);
    const watcher = new InvoiceWatcher(merchant, db, rec);

    const inv = await svc.create({ amountShannons: 10n * 100_000_000n, webhookUrl: "http://x/h" });
    const pay = await buyer.sendPayment({ invoice: inv.invoiceAddress });

    expect(pay.status).toBe("Failed");
    expect(await watcher.tick()).toBe(0);
    expect(svc.get(inv.paymentHash)?.status).toBe("OPEN");
    expect(rec.events).toHaveLength(0);
  });
});
