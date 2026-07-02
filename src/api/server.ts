import Fastify from "fastify";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import { makeClients } from "../rpc/index.js";
import { registerRoutes } from "./routes.js";

/**
 * Phase 5 — service entrypoint. Boots Fastify, an API-key auth hook, and the routes. The
 * background pollers (ChannelMonitor, InvoiceWatcher) are started here once un-stubbed.
 */
export async function buildServer() {
  // Fastify uses pino internally; configuring the level here keeps the default logger typing
  // (injecting a custom pino instance narrows the FastifyInstance generics and breaks route typing).
  const app = Fastify({ logger: { level: config.logLevel } });
  const db = getDb();
  const clients = makeClients();

  // Single static API key on devnet (CLAUDE.md: mandatory to replace before testnet).
  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/v1/health") return;
    if (req.headers["x-api-key"] !== config.api.apiKey) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  await registerRoutes(app, { db, hub: clients.hub, receiver: clients.customer1 });

  // TODO(Phase 3/4): new ChannelMonitor(...).start(); new InvoiceWatcher(...).start();
  return app;
}

// Direct-run entrypoint.
if (import.meta.url === `file://${process.argv[1]}`) {
  buildServer()
    .then((app) => app.listen({ port: config.api.port, host: "127.0.0.1" }))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
