import "dotenv/config";

/** Central typed view of the environment. Import this, don't read process.env elsewhere. */
export const config = {
  api: {
    port: Number(process.env.API_PORT ?? 3000),
    apiKey: process.env.API_KEY ?? "devnet-static-key-change-me",
  },
  db: {
    path: process.env.DATABASE_PATH ?? "./data/lsp.sqlite",
  },
  nodes: {
    hubRpcUrl: process.env.HUB_RPC_URL ?? "http://127.0.0.1:8227",
    customer1RpcUrl: process.env.CUSTOMER1_RPC_URL ?? "http://127.0.0.1:8237",
    customer2RpcUrl: process.env.CUSTOMER2_RPC_URL ?? "http://127.0.0.1:8247",
  },
  lsp: {
    minProvisionCkb: BigInt(process.env.LSP_MIN_PROVISION_CKB ?? "100"),
    maxProvisionCkb: BigInt(process.env.LSP_MAX_PROVISION_CKB ?? "100000"),
    feeProportionalMillionths: BigInt(process.env.LSP_FEE_PROPORTIONAL_MILLIONTHS ?? "1000"),
    rebalanceThresholdCkb: BigInt(process.env.LSP_REBALANCE_THRESHOLD_CKB ?? "100"),
  },
  pollers: {
    channelMonitorMs: Number(process.env.CHANNEL_MONITOR_INTERVAL_MS ?? 5000),
    invoiceWatchMs: Number(process.env.INVOICE_WATCH_INTERVAL_MS ?? 3000),
  },
  webhooks: {
    maxAttempts: Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? 5),
    backoffBaseMs: Number(process.env.WEBHOOK_BACKOFF_BASE_MS ?? 2000),
  },
  logLevel: process.env.LOG_LEVEL ?? "info",
} as const;
