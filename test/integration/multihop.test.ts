import { describe, it, expect } from "vitest";
import { FakeFiberNetwork, ckbToShannonHex, shannonHexToShannon } from "../../src/rpc/index.js";

/**
 * M5/Phase 6 — multi-hop routing through the hub. customer2 -> hub -> customer1 must succeed and
 * the hub must earn a nonzero forwarding fee (the plan's explicit assertion). This is the payment
 * topology that makes the hub a routing business, tested against the fake before the real triangle.
 */
describe("multi-hop payment through hub (Phase 6)", () => {
  it("customer2 pays a customer1 invoice via the hub, hub earns a fee > 0", async () => {
    const net = new FakeFiberNetwork();
    const hub = net.client("hub");
    const merchant = net.client("customer1");
    const buyer = net.client("customer2");

    // Buyer funds outbound to the hub; hub funds outbound to the merchant. Route: buyer -> hub -> merchant.
    await buyer.openChannel({ peer_id: hub.nodeId, funding_amount: ckbToShannonHex(500n) });
    await hub.openChannel({ peer_id: merchant.nodeId, funding_amount: ckbToShannonHex(500n) });
    net.mine();

    const inv = await merchant.newInvoice({ amount: ckbToShannonHex(100n), currency: "Fibd" });
    const pay = await buyer.sendPayment({ invoice: inv.invoice_address });

    expect(pay.status).toBe("Success");
    expect(shannonHexToShannon(pay.fee!)).toBeGreaterThan(0n);

    // The merchant's invoice is observed Paid.
    const observed = await merchant.getInvoice({ payment_hash: inv.payment_hash });
    expect(observed.status).toBe("Paid");
  });

  it("direct (single-hop) payment charges no forwarding fee", async () => {
    const net = new FakeFiberNetwork();
    const hub = net.client("hub");
    const merchant = net.client("customer1");
    await hub.openChannel({ peer_id: merchant.nodeId, funding_amount: ckbToShannonHex(500n) });
    net.mine();

    const inv = await merchant.newInvoice({ amount: ckbToShannonHex(100n), currency: "Fibd" });
    const pay = await hub.sendPayment({ invoice: inv.invoice_address });

    expect(pay.status).toBe("Success");
    expect(shannonHexToShannon(pay.fee!)).toBe(0n);
  });
});
