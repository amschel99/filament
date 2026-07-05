import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { FakeFiberNetwork, ckbToShannonHex } from "../../src/rpc/index.js";
import { openDb, type Db } from "../../src/db/index.js";
import { InvoiceService } from "../../src/invoices/create.js";
import { InvoiceWatcher, type Dispatcher } from "../../src/invoices/watch.js";
import { l402Guard } from "../../src/l402/index.js";

/**
 * M5 — L402 pay-per-request gate. Unpaid request -> 402 + fresh invoice; pay it; retry with the
 * preimage -> the route runs. The preimage a real client would learn from the node is read from
 * our DB here (the fake doesn't hand it back), which is the only simulation seam.
 */
const noopDispatcher: Dispatcher = { async deliver() { return true; } };

describe("L402 gate (M5)", () => {
  let net: FakeFiberNetwork;
  let db: Db;
  let merchant: ReturnType<FakeFiberNetwork["client"]>;
  let buyer: ReturnType<FakeFiberNetwork["client"]>;
  let app: FastifyInstance;

  beforeEach(async () => {
    net = new FakeFiberNetwork();
    db = openDb(":memory:");
    merchant = net.client("customer1");
    buyer = net.client("hub");
    const invoices = new InvoiceService(merchant, db);
    app = Fastify();
    app.get(
      "/quote",
      { preHandler: l402Guard({ priceShannons: 100n * 100_000_000n, invoices, db }) },
      async () => ({ data: "the paid quote" }),
    );
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  it("challenges with 402 + a fresh invoice, then admits a paid preimage", async () => {
    // 1. no auth -> 402 with an invoice.
    const challenge = await app.inject({ method: "GET", url: "/quote" });
    expect(challenge.statusCode).toBe(402);
    const invoiceAddr = challenge.json().invoice as string;
    expect(invoiceAddr).toMatch(/^fibd/);
    expect(challenge.headers["www-authenticate"]).toContain("L402");

    // 2. buyer pays the invoice over an open channel.
    await buyer.openChannel({ peer_id: merchant.nodeId, funding_amount: ckbToShannonHex(500n) });
    net.mine();
    const pay = await buyer.sendPayment({ invoice: invoiceAddr });
    expect(pay.status).toBe("Success");

    // 3. observed watcher tick flips the invoice to PAID in the DB.
    await new InvoiceWatcher(merchant, db, noopDispatcher).tick();

    // 4. client presents the preimage (learned from paying) -> route runs.
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
  });

  it("rejects a bogus preimage with another 402", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/quote",
      headers: { authorization: `L402 0x${"00".repeat(32)}` },
    });
    expect(res.statusCode).toBe(402);
  });
});
