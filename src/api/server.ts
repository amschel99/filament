import Fastify, { type FastifyInstance } from "fastify";
import { config } from "../config.js";
import { getDb, type Db } from "../db/index.js";
import { makeClients, type FiberClient } from "../rpc/index.js";
import { ChannelMonitor } from "../lsp/index.js";
import { InvoiceWatcher, WebhookDispatcher } from "../invoices/index.js";
import { registerRoutes } from "./routes.js";

/**
 * Phase 5 — service entrypoint. Dependencies are injectable so the route suite can drive the app
 * with fake clients + an in-memory DB via app.inject(); production builds them from config.
 */
export interface ServerDeps {
  db?: Db;
  hub?: FiberClient;
  receiver?: FiberClient;
  apiKey?: string; // when set, requests must carry a matching x-api-key (health is always open)
  /** Start the background pollers (channel monitor + invoice watcher + webhook dispatch). */
  startPollers?: boolean;
}

export async function buildServer(deps: ServerDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel } });
  const db = deps.db ?? getDb();
  const clients = makeClients();
  const hub = deps.hub ?? clients.hub;
  const receiver = deps.receiver ?? clients.customer1;
  const apiKey = deps.apiKey ?? config.api.apiKey;

  // Single static API key on devnet (CLAUDE.md: mandatory to replace before testnet).
  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/v1/health" || !apiKey) return;
    if (req.headers["x-api-key"] !== apiKey) reply.code(401).send({ error: "unauthorized" });
  });

  await registerRoutes(app, { db, hub, receiver });

  if (deps.startPollers) {
    // Observed-state pollers (CLAUDE.md rule 4): the monitor reconciles channels, the watcher
    // flips invoices to PAID/RECEIVED from get_invoice and dispatches webhooks.
    const monitor = new ChannelMonitor(hub, db, config.pollers.channelMonitorMs);
    const dispatcher = new WebhookDispatcher(db, {
      maxAttempts: config.webhooks.maxAttempts,
      backoffBaseMs: config.webhooks.backoffBaseMs,
    });
    const watcher = new InvoiceWatcher(receiver, db, dispatcher, config.pollers.invoiceWatchMs);
    monitor.start();
    watcher.start();
    app.addHook("onClose", async () => {
      monitor.stop();
      watcher.stop();
    });
  }

  return app;
}

// Direct-run entrypoint.
if (import.meta.url === `file://${process.argv[1]}`) {
  buildServer({ startPollers: true })
    .then((app) => app.listen({ port: config.api.port, host: "127.0.0.1" }))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
