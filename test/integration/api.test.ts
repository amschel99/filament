import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { FakeFiberNetwork, ckbToShannonHex } from "../../src/rpc/index.js";
import { openDb, type Db } from "../../src/db/index.js";
import { buildServer } from "../../src/api/server.js";

/**
 * M5 — public API surface, integration-tested against the fake fnn via Fastify inject.
 * Same handlers that will front a real devnet node; only the client is swapped.
 */
const KEY = "test-key";

describe("public API (M5)", () => {
  let net: FakeFiberNetwork;
  let db: Db;
  let hub: ReturnType<FakeFiberNetwork["client"]>;
  let merchant: ReturnType<FakeFiberNetwork["client"]>;
  let app: FastifyInstance;

  beforeEach(async () => {
    net = new FakeFiberNetwork();
    db = openDb(":memory:");
    hub = net.client("hub");
    merchant = net.client("customer1");
    app = await buildServer({ db, hub, receiver: merchant, apiKey: KEY });
  });
  afterEach(async () => {
    await app.close();
  });

  const auth = { "x-api-key": KEY };

  it("health is open and reports hub reachability", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().hub_reachable).toBe(true);
  });

  it("rejects unauthenticated writes", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/invoices", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("creates and reads an invoice without leaking the preimage", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: auth,
      payload: { amount_shannons: ckbToShannonHex(100n), description: "x", webhook_url: "http://h" },
    });
    expect(create.statusCode).toBe(201);
    const { payment_hash } = create.json();
    expect(payment_hash).toMatch(/^0x/);

    const get = await app.inject({ method: "GET", url: `/v1/invoices/${payment_hash}`, headers: auth });
    expect(get.statusCode).toBe(200);
    expect(get.json().preimage).toBeUndefined();
    expect(get.json().webhook_secret).toBeUndefined();
    expect(get.json().status).toBe("OPEN");
  });

  it("provisions liquidity and reports status", async () => {
    const prov = await app.inject({
      method: "POST",
      url: "/v1/liquidity",
      headers: auth,
      payload: { node_pubkey: merchant.nodeId, inbound_ckb: "500" },
    });
    expect(prov.statusCode).toBe(202);
    const { channel_request_id } = prov.json();

    const status = await app.inject({ method: "GET", url: `/v1/liquidity/${channel_request_id}`, headers: auth });
    expect(status.statusCode).toBe(200);
    expect(status.json().state).toBe("PROVISIONING");
  });

  it("pays out an invoice over an open channel", async () => {
    await hub.openChannel({ peer_id: merchant.nodeId, funding_amount: ckbToShannonHex(500n) });
    net.mine();
    const inv = await merchant.newInvoice({ amount: ckbToShannonHex(10n), currency: "Fibd" });

    const res = await app.inject({
      method: "POST",
      url: "/v1/payouts",
      headers: auth,
      payload: { invoice: inv.invoice_address },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("Success");
  });
});
