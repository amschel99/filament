# Fiber LSP — Devnet Build Plan

**Project:** `fiber-lsp` — an LSP (liquidity service provider) + payments API for Fiber Network. Product thesis: *"accept Fiber payments in one API call."*

**Environment:** single local machine, local CKB devnet, Fiber Network Node (FNN) `v0.9.0-rc5`.

**Stack:** TypeScript + Node 20, `@ckb-ccc/fiber` with a raw JSON-RPC fallback, SQLite (better-sqlite3) for LSP state, Fastify for the HTTP API.

**Scope of this build:** the LSP node + API surface, with a thin L402 (pay-per-request) middleware demo on top. Hosted-node fleets, TEE signing, MPC custody, and mainnet/testnet deployment are explicitly **out of scope** for devnet v0.

**Biggest risk, stated up front:** Phase 1.2 (deploying `fiber-scripts` to a local CKB devnet and writing a correct devnet `config.yml`) is the least-documented part of the whole stack. Budget roughly half of total debugging time there. The fastest path may be lifting the fiber repo's own e2e/test harness wholesale rather than hand-rolling deployment.

---

## Architecture overview

```
┌──────────────────────┐
│   Demo app / curl    │   merchant or agent client
└──────────┬───────────┘
           │ HTTPS (API key)
           ▼
┌──────────────────────┐
│  LSP API service     │   Fastify + SQLite
│  (TypeScript)        │   invoices, liquidity, webhooks, L402
└──────────┬───────────┘
           │ JSON-RPC :8227 (and :8237/:8247 for customer nodes)
           ▼
┌──────────────┐   payment    ┌────────────────┐   ┌────────────────┐
│  Hub fnn     │◀──channels──▶│ Customer1 fnn  │   │ Customer2 fnn  │
│  (LSP node)  │              │ (merchant sim) │   │ (buyer sim)    │
└──────┬───────┘              └───────┬────────┘   └───────┬────────┘
       │                              │                    │
       ▼                              ▼                    ▼
┌────────────────────────────────────────────────────────────────────┐
│           Local CKB devnet: ckb node + miner + fiber-scripts       │
└────────────────────────────────────────────────────────────────────┘
```

Topology: hub is the always-liquid center. Customer1 receives (merchant), customer2 sends (buyer), and multi-hop payments route customer2 → hub → customer1, earning the hub a routing fee.

---

## 0. Repo layout

```
fiber-lsp/
├── PLAN.md                  # this document
├── CLAUDE.md                # standing instructions
├── infra/
│   ├── devnet/              # CKB devnet chain spec, deployed script artifacts
│   │   └── scripts.json     # canonical record of deployed script hashes + cell deps
│   ├── nodes/
│   │   ├── hub/             # hub fnn: config.yml, ckb/key, fiber/ data dir
│   │   ├── customer1/       # simulated merchant node
│   │   └── customer2/       # simulated buyer node (multi-hop tests)
│   └── scripts/             # bash tooling
│       ├── start-devnet.sh
│       ├── reset.sh
│       ├── fund.sh
│       ├── start-nodes.sh
│       └── smoke.sh
├── src/
│   ├── rpc/                 # typed Fiber JSON-RPC client (thin, hand-rolled)
│   ├── lsp/                 # liquidity engine: channel opens, monitoring, rebalance
│   ├── invoices/            # invoice creation, status watcher, webhook dispatch
│   ├── api/                 # Fastify routes
│   ├── l402/                # 402 pay-per-request middleware demo
│   └── db/                  # SQLite schema + queries
├── test/                    # integration tests against live devnet
└── examples/
    ├── merchant-demo/       # page: create invoice → QR → paid webhook
    └── paid-api-demo/       # endpoint behind L402 middleware
```

---

## Phase 1 — Devnet foundation

**Goal:** a local CKB chain with fiber-scripts deployed, three funded `fnn` nodes running, and one channel opened, paid through, and closed — entirely by hand via `fnn-cli`. **Nothing else proceeds until this works.**

### 1.1 CKB devnet
- Install `ckb` and `ckb-cli`.
- `ckb init --chain dev` with a known miner lock; shorten epoch/block times so channel confirmations take seconds.
- Run node and miner as separate processes.
- Write `start-devnet.sh` (starts ckb node + miner, logs to files) and `reset.sh` (stop, nuke chain data, re-init — one command).

### 1.2 Deploy fiber-scripts  ⚠️ highest-risk step
- Clone `nervosnetwork/fiber-scripts`. Build **funding-lock** (2-of-2 multisig, uses `ckb-auth`) and **commitment-lock** (Daric revocation/penalty).
- Deploy both; record for each `code_hash`, `hash_type`, full cell-dep structure (testnet reference shows a `type_id` dep **plus** a `cell_dep` for `ckb_auth` — replicate exactly with devnet values).
- **Reuse** the fiber repo's dev/test tooling and `fiber-scripts/deployment/` before hand-rolling. If manual, use `ckb-cli deploy`.
- Output: `infra/devnet/scripts.json` — single source of truth. Never hardcode hashes elsewhere.

### 1.3 Three fnn nodes
- Pin `fnn` + `fnn-cli` at **v0.9.0-rc5**.
- Generate three CKB accounts; export each key (first line, 64 hex, no `0x`) to `<node_dir>/ckb/key`, `chmod 600`.
- Fund via `fund.sh`: hub ~1,000,000 devnet CKB; customer1/2 ~1,000 each.
- Render devnet `config.yml` per node from `scripts.json` (chain spec path, `ckb.rpc_url`, `fiber.scripts`, ports). Hub only: `announce_listening_addr: true` + generous auto-accept.
- `start-nodes.sh` exports `NO_PROXY=127.0.0.1,localhost` and `FIBER_SECRET_KEY_PASSWORD`, launches each `fnn -c config.yml -d <dir>`.

### 1.4 Smoke test (manual → scripted `smoke.sh`)
1. `connect_peer` customer1 → hub.
2. `open_channel` ≥ 500 CKB (usable = funded − 99).
3. Poll `list_channels` → `ChannelReady`.
4. `new_invoice` on customer1 (`Fibd`).
5. `send_payment` from hub; verify `Success` + balance movement.
6. `shutdown_channel`; confirm settlement tx lands.

**Exit criterion:** full open → pay → close via `smoke.sh`. Canary after every reset/upgrade.

---

## Phase 2 — Typed RPC client (`src/rpc/`)

One honest, tested interface to fnn; no other module talks to a node directly.

- `FiberClient` interface. Prefer `@ckb-ccc/fiber` (`FiberSDK`); raw JSON-RPC `invoke(method, params)` fallback. Swapping SDK↔raw = one line per method.
- One client per node from `{ name, rpcUrl }`.
- Methods: `nodeInfo` · `connectPeer` · `listPeers` · `openChannel` · `listChannels` · `shutdownChannel` · `updateChannel` · `acceptChannel` · `newInvoice` · `getInvoice` · `parseInvoice` · `cancelInvoice` · `settleInvoice` · `sendPayment` · `getPayment` · `listPayments` · `graphNodes` · `graphChannels` · `buildRouter` · `sendPaymentWithRouter`.
- `units.ts` / `parse.ts`: hex↔shannon (`ckbToShannonHex`, `shannonHexToCkb`; 1 CKB = 1e8 shannons); channel-state casing normalization; preimage gen (`crypto.randomBytes(32)`); default `ckb_hash`.
- `test/rpc.integration.test.ts` against the live devnet hub — **the version-drift detector.**

---

## Phase 3 — LSP core (`src/lsp/`)

- `LiquidityService.provision({ nodePubkey, nodeAddress?, inboundCkb })`: connect → open (`funding = inboundCkb + 99`, `public: true`) → persist `PROVISIONING` → background poll to `READY` (handle temp→permanent channel id) → terminal `FAILED` on peer-unreachable/reject/timeout.
- Channel monitor: ~5s poller reconciling `list_channels` into the DB (state, balances, closed). DB is source of truth for endpoints/rebalancing, but every value comes from **observed node state**.
- Rebalancer (v0 stub): detect low hub `local_balance`; circular `send_payment` (own pubkey, `keysend`, `allow_self_payment`). Testable only once Phase 6's triangle exists — stub with a clear TODO, do not fake.
- Policy: min/max provision, per-customer cap, `tlc_fee_proportional_millionths` via `update_channel`.

---

## Phase 4 — Invoices + webhooks (`src/invoices/`)

- `createInvoice({ amountShannons, description, expirySeconds, metadata, hold? })`: local preimage unless `hold`; `new_invoice` on the receiving node; persist. Hold = pass `payment_hash` only → `settle(hash, preimage)` / `cancel(hash)`.
- Watch: poll open invoices → `get_invoice` → on `Paid`/`Received`/`Expired`/`Cancelled` enqueue matching webhook.
- Webhooks: `POST` with HMAC over raw body; exponential backoff 3–5 attempts; `webhook_deliveries` log rows.

---

## Phase 5 — Public API (`src/api/`)

Fastify · JSON · API-key auth · amounts are shannons-as-hex in/out.

| Method & path | Purpose |
|---|---|
| `POST /v1/invoices` | Create invoice |
| `GET /v1/invoices/:hash` | Invoice status |
| `POST /v1/invoices/:hash/settle` | Settle a hold invoice |
| `POST /v1/invoices/:hash/cancel` | Cancel invoice |
| `POST /v1/liquidity` | Provision inbound channel |
| `GET /v1/liquidity/:id` | Provisioning status |
| `POST /v1/payouts` | Hub `send_payment` (invoice or keysend) |
| `GET /v1/balance` | Aggregated hub channel balances |
| `GET /v1/health` | Node reachability, chain tip, channel counts, monitor lag |
| `POST /v1/webhooks` | Register webhook URL + secret |

L402 middleware (`src/l402/`): no auth → `402` + fresh invoice header; client pays, retries with preimage; middleware verifies preimage vs paid-invoice DB record → passes through.

---

## Phase 6 — E2E demos + multi-hop

- `examples/merchant-demo`: page → create invoice → QR → buyer (customer2) pays → webhook → page flips paid.
- `examples/paid-api-demo`: `/quote` behind L402 → 402 → pay → retry with preimage → data.
- Multi-hop: customer2 ↔ hub channel; pay customer1 invoice from customer2 (routes c2 → hub → c1); assert `Success` **and** hub fee > 0. Un-stub the rebalancer on the real triangle.
- Failure drills: kill customer1 mid-payment; force-close; expire an invoice; overspend liquidity → clean API error, not a hang.

---

## Phase 7 — Hardening (devnet-scope)

- Docker-compose the whole stack (`docker compose up` = working env from cold).
- Backup drill: stop → tar node dir → restore, actually run a restore once.
- Observability: structured logging + metrics endpoint (channel count, liquidity deployed, invoice conversion, webhook success, monitor lag).
- `SECURITY.md`: key handling, no Biscuit auth on RPC (loopback-only), single static API key, no rate limits/CORS.

---

## Milestones & exit criteria

| # | Milestone | Exit criterion |
|---|---|---|
| **M1** | Devnet foundation | `smoke.sh` passes end-to-end. *Everything blocks on this.* |
| **M2** | RPC client | Integration suite green against live devnet. |
| **M3** | Liquidity | `POST /v1/liquidity` → observed `ChannelReady` in DB. |
| **M4** | Money loop | `POST /v1/invoices` → pay via fnn-cli → webhook received. **The product exists here.** |
| **M5** | Demos | L402 round-trips; multi-hop routes with nonzero fee; failure drills pass. |
| **M6** | Cold start | `docker compose up` → M1–M5 pass from scratch. |

Build strictly in order. Do not start a phase while the previous milestone is red.

---

See `src/db/schema.sql` for the database schema and `CLAUDE.md` for standing rules.
