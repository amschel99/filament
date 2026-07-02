-- fiber-lsp SQLite schema (devnet v0).
-- All money amounts are stored as hex shannon strings (see src/rpc/units.ts) to match
-- the RPC wire format exactly and avoid JS number precision loss on bigint values.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY,
  request_id TEXT UNIQUE,                     -- returned by POST /v1/liquidity
  temp_channel_id TEXT,
  channel_id TEXT,                            -- permanent id once ready
  peer_pubkey TEXT NOT NULL,
  requested_inbound_shannons TEXT NOT NULL,   -- hex shannons
  state TEXT NOT NULL,                        -- PROVISIONING | READY | CLOSING | CLOSED | FAILED
  fail_reason TEXT,
  local_balance TEXT,                         -- hex shannons, from monitor (observed)
  remote_balance TEXT,                        -- hex shannons, from monitor (observed)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_channels_state ON channels(state);
CREATE INDEX IF NOT EXISTS idx_channels_channel_id ON channels(channel_id);

CREATE TABLE IF NOT EXISTS invoices (
  payment_hash TEXT PRIMARY KEY,
  invoice_address TEXT NOT NULL,              -- the bech32 invoice string handed to payers
  preimage TEXT,                              -- NULL for hold invoices until settle; never logged
  is_hold INTEGER NOT NULL DEFAULT 0,
  amount_shannons TEXT NOT NULL,              -- hex shannons
  status TEXT NOT NULL,                       -- OPEN | RECEIVED | PAID | CANCELLED | EXPIRED
  description TEXT,
  metadata TEXT,                              -- JSON blob
  webhook_url TEXT,
  webhook_secret TEXT,                        -- per-invoice HMAC secret (nullable)
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

CREATE TABLE IF NOT EXISTS payments (
  payment_hash TEXT PRIMARY KEY,
  direction TEXT NOT NULL,                    -- OUTBOUND (payouts) | REBALANCE
  amount_shannons TEXT NOT NULL,              -- hex shannons
  status TEXT NOT NULL,                       -- CREATED | INFLIGHT | SUCCESS | FAILED
  fee_shannons TEXT,                          -- hex shannons, observed on success
  failed_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY,
  payment_hash TEXT NOT NULL,
  event TEXT NOT NULL,                        -- invoice.paid | invoice.received | invoice.expired | ...
  attempt INTEGER NOT NULL,
  status_code INTEGER,
  delivered INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_hash ON webhook_deliveries(payment_hash);
