import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { openDb } from "../../src/db/index.js";
import { WebhookDispatcher, sign, type WebhookPayload } from "../../src/invoices/webhooks.js";

/** Spin a throwaway HTTP server that records requests and answers with a scripted status. */
function server(handler: (body: string, headers: Record<string, string>) => number): Promise<{
  url: string;
  received: { body: string; sig?: string }[];
  close: () => Promise<void>;
}> {
  const received: { body: string; sig?: string }[] = [];
  const srv: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ body, sig: req.headers["x-fiber-signature"] as string | undefined });
      res.writeHead(handler(body, req.headers as Record<string, string>)).end();
    });
  });
  return new Promise((resolve) => {
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/hook`,
        received,
        close: () => new Promise((r) => srv.close(() => r())),
      });
    });
  });
}

const payload: WebhookPayload = { event: "invoice.paid", payment_hash: "0xabc", amount: "0x64" };

describe("WebhookDispatcher", () => {
  let closer: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await closer?.();
    closer = undefined;
  });

  it("delivers once with a valid HMAC signature over the raw body", async () => {
    const s = await server(() => 200);
    closer = s.close;
    const db = openDb(":memory:");
    const d = new WebhookDispatcher(db, { maxAttempts: 3, backoffBaseMs: 1 });

    const ok = await d.deliver(s.url, "shh", payload);
    expect(ok).toBe(true);
    expect(s.received).toHaveLength(1);
    expect(s.received[0]!.sig).toBe(sign("shh", s.received[0]!.body));

    const rows = db.prepare(`SELECT * FROM webhook_deliveries`).all() as { delivered: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.delivered).toBe(1);
  });

  it("retries on 500 then succeeds, logging every attempt", async () => {
    let hits = 0;
    const s = await server(() => (++hits < 3 ? 500 : 200));
    closer = s.close;
    const db = openDb(":memory:");
    const d = new WebhookDispatcher(db, { maxAttempts: 5, backoffBaseMs: 1 });

    const ok = await d.deliver(s.url, null, payload);
    expect(ok).toBe(true);
    expect(hits).toBe(3);
    const rows = db.prepare(`SELECT * FROM webhook_deliveries ORDER BY attempt`).all() as {
      attempt: number;
      status_code: number;
      delivered: number;
    }[];
    expect(rows.map((r) => r.status_code)).toEqual([500, 500, 200]);
    expect(rows.at(-1)!.delivered).toBe(1);
  });

  it("gives up after maxAttempts and reports failure", async () => {
    const s = await server(() => 503);
    closer = s.close;
    const db = openDb(":memory:");
    const d = new WebhookDispatcher(db, { maxAttempts: 3, backoffBaseMs: 1 });

    const ok = await d.deliver(s.url, null, payload);
    expect(ok).toBe(false);
    expect((db.prepare(`SELECT COUNT(*) c FROM webhook_deliveries`).get() as { c: number }).c).toBe(3);
  });
});
