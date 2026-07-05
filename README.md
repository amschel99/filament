# fiber-lsp

**Accept Fiber payments in one API call.**

`fiber-lsp` is a Liquidity Service Provider (LSP) + payments API for
[Fiber Network](https://github.com/nervosnetwork/fiber) — the Lightning-style off-chain payment
layer on top of [Nervos CKB](https://github.com/nervosnetwork/ckb). It runs a well-funded "hub"
Fiber node and wraps it in a clean HTTP API so that a merchant or an AI agent can create invoices,
receive inbound liquidity, and settle payments without ever touching channel mechanics,
JSON-RPC, or on-chain transactions directly.

> **Scope:** this is **devnet v0** — a local, single-machine build. Hosted-node fleets, TEE
> signing, MPC custody, Biscuit-authed multi-tenant RPC, and testnet/mainnet are explicitly out
> of scope here. See [PLAN.md](PLAN.md) for the full roadmap.

---

## Why this exists

Fiber gives you fast, cheap, off-chain payments — but using it directly means running a node,
managing channels and liquidity, converting between hex-shannon RPC encodings, polling
asynchronous state machines, and handling penalty/revocation edge cases. That's a lot of surface
area for anyone who just wants to *get paid*.

`fiber-lsp` collapses all of that into three ideas:

1. **Invoices** — `POST /v1/invoices` → an invoice string + QR. When it's paid, you get a webhook.
2. **Liquidity** — `POST /v1/liquidity` → the hub opens an inbound channel to a customer node so
   they can *receive* payments immediately.
3. **L402** — a pay-per-request middleware: an HTTP `402` challenge carrying a fresh Fiber
   invoice, so an API (or an autonomous agent) can charge per call. This is the agent-payments story.

---

## Architecture

```
┌──────────────────────┐
│   Demo app / curl    │   merchant or agent client
└──────────┬───────────┘
           │ HTTP  (x-api-key)
           ▼
┌──────────────────────┐
│  LSP API service     │   Fastify + SQLite  (this repo, src/)
│  (TypeScript)        │   invoices · liquidity · webhooks · L402
└──────────┬───────────┘
           │ JSON-RPC :8227 (hub) · :8237 / :8247 (customer nodes)
           ▼
┌──────────────┐   payment    ┌────────────────┐   ┌────────────────┐
│  Hub  fnn    │◀──channels──▶│ Customer1 fnn  │   │ Customer2 fnn  │
│  (LSP node)  │              │ (merchant sim) │   │ (buyer sim)    │
└──────┬───────┘              └───────┬────────┘   └───────┬────────┘
       ▼                              ▼                    ▼
┌────────────────────────────────────────────────────────────────────┐
│           Local CKB devnet: ckb node + miner + fiber-scripts       │
└────────────────────────────────────────────────────────────────────┘
```

The hub is the always-liquid center. Customer1 simulates a merchant (receives), customer2 a buyer
(sends). Multi-hop payments route **customer2 → hub → customer1**, earning the hub a routing fee.

**The service never touches a node except through [src/rpc/](src/rpc/).** That one typed client is
the sole boundary to fnn, and its integration test suite is the tripwire for version drift.

---

## Tech stack

| Concern | Choice |
|---|---|
| Language / runtime | TypeScript · Node 20 (ESM) |
| Fiber client | `@ckb-ccc/fiber` where it fits, raw JSON-RPC fallback per method |
| HTTP API | Fastify 5 |
| State | SQLite via better-sqlite3 |
| Fiber node | `fnn` **v0.9.0-rc5** (pinned) |
| Chain | local CKB devnet |

Why TypeScript and not Rust: the service is a **client** on top of fnn (which is Rust). The hard,
correctness-critical protocol code — 2-of-2 funding, Daric penalties, HTLC routing — lives inside
fnn, which we *run*, not fork. Rust would only be the right call if the goal were forking or
embedding the node itself.

---

## Getting started

### Prerequisites
- Node 20+
- For the devnet (Phase 1): `ckb`, `ckb-cli`, and `fnn` / `fnn-cli` at `v0.9.0-rc5`, plus `jq`.
  On **Windows**, run the `infra/` bash scripts under **WSL2 or Git Bash** — the CKB/fnn toolchain
  is happiest on Linux. The `src/` TypeScript service runs natively on Windows.

### The service
```bash
npm install
cp .env.example .env      # fill in as needed; the defaults target local devnet ports
npm run typecheck         # verify the scaffold compiles
npm test                  # unit tests (RPC unit-conversion + state-normalization)
npm run dev               # boot the Fastify API on API_PORT (default 3000)
```

### The devnet (Phase 1 — the M1 gate)
Everything downstream is gated on the smoke test passing. From a WSL2 / bash shell:
```bash
infra/scripts/reset.sh            # fresh dev chain
infra/scripts/start-devnet.sh     # ckb node + miner
infra/scripts/deploy-scripts.sh   # ⚠ deploy fiber-scripts -> writes infra/devnet/scripts.json
infra/scripts/fund.sh             # fund hub + customers
infra/scripts/render-config.sh    # render each node's config.yml from scripts.json
infra/scripts/start-nodes.sh      # launch the 3 fnn nodes
infra/scripts/smoke.sh            # THE canary: open -> pay -> close
```
See **[infra/README.md](infra/README.md)** for the full walkthrough and the ports table.

---

## API surface (devnet v0)

All amounts are **shannon values as hex strings** (`1 CKB = 100,000,000 shannons`). Auth is a
single static `x-api-key` header (devnet only).

| Method & path | Purpose |
|---|---|
| `POST /v1/invoices` | Create an invoice → `{ payment_hash, invoice_address, expires_at }` |
| `GET /v1/invoices/:hash` | Invoice status |
| `POST /v1/invoices/:hash/settle` | Settle a hold invoice (escrow flows) |
| `POST /v1/invoices/:hash/cancel` | Cancel an open/received invoice |
| `POST /v1/liquidity` | Provision an inbound channel → `{ channel_request_id }` |
| `GET /v1/liquidity/:id` | Provisioning status (`PROVISIONING` → `READY` / `FAILED`) |
| `POST /v1/payouts` | Hub `send_payment` (invoice string, or keysend) |
| `GET /v1/balance` | Aggregated hub channel balances |
| `GET /v1/health` | Node reachability, chain tip, channel counts, monitor lag |
| `POST /v1/webhooks` | Register a webhook URL + HMAC secret |

Plus the **L402** middleware ([src/l402/](src/l402/)), which wraps any route: unpaid request →
`402` + fresh invoice; client pays and retries with the preimage → request passes through.

---

## Repository layout

```
fiber-lsp/
├── PLAN.md              full phased build plan + milestones (M1→M6)
├── CLAUDE.md            standing engineering rules (version pinning, units, poll-don't-assume)
├── src/
│   ├── rpc/             typed Fiber JSON-RPC client — the ONLY thing that talks to a node
│   │   ├── units.ts       hex↔shannon↔CKB conversion + channel-reserve / fee math  (implemented)
│   │   ├── parse.ts       state-enum normalization (handles both casings) + preimage (implemented)
│   │   ├── types.ts       FiberClient interface + request/response shapes
│   │   └── client.ts      RawFiberClient (raw JSON-RPC, per-method SDK escape hatch)
│   ├── lsp/             liquidity engine: provision, channel monitor, rebalancer
│   ├── invoices/        invoice creation, status watcher, webhook dispatch (HMAC + retry)
│   ├── api/             Fastify routes + server
│   ├── l402/            402 pay-per-request middleware
│   ├── db/              SQLite schema + bootstrap
│   └── config.ts        typed view of the environment
├── infra/              Phase 1 devnet: chain, fiber-scripts deploy, 3 fnn nodes, smoke test
├── test/               unit tests + (gated) live-devnet integration suite
└── examples/           Phase 6 demos: merchant-demo + paid-api-demo
```

---

## Status & roadmap

The application layer is **implemented and tested** against an in-memory fake fnn
([src/rpc/fake.ts](src/rpc/fake.ts)) — 25 unit + integration tests green — **and the core
open/pay/close loop is verified against a real CKB devnet** with live fnn v0.9.0-rc5 nodes running
natively on Windows (see [infra/DEVNET-WINDOWS.md](infra/DEVNET-WINDOWS.md)). The `test/e2e` suite
runs that loop against the live nodes and passes. Build proceeds strictly milestone by milestone.

| Milestone | Meaning | State |
|---|---|---|
| **M1** | Devnet foundation — open/pay/close on a live CKB devnet | ✅ **real** (native Windows, no WSL) |
| **M2** | Typed RPC client — suite green vs a live fnn rc5 node | ✅ **real** (e2e passes; caught rc5 drift) |
| **M3** | Liquidity — provision → observed `ChannelReady` in DB | ✅ implemented + tested (fake) |
| **M4** | Money loop — invoice → pay → webhook. *The product exists here.* | ✅ implemented + tested (fake) |
| **M5** | L402 round-trip · multi-hop with routing fee · full API | ✅ implemented + tested (fake) |
| **M6** | Cold start — `docker compose up` reproduces M1–M5 | not started |

> "vs fake" means the logic is proven against the in-memory node; it is not yet certified against a
> real fnn. M1 (a live `smoke.sh` pass) is what promotes ✅-vs-fake to ✅-for-real.

## Testing

```bash
npm run test:unit    # pure logic: unit conversions, state normalization, webhook HMAC/retry
npm run test:int     # application logic vs the fake fnn: invoices, liquidity, L402, API, multi-hop
npm run test:e2e     # RUN_E2E=1; the smoke loop vs a LIVE devnet (needs running nodes)
npm run check        # typecheck + unit + int (the pre-commit gate)
```

See **[PLAN.md](PLAN.md)** for the phase detail and risk notes (Phase 1.2 — deploying fiber-scripts
to devnet — is the stated biggest unknown).

---

## Security note (devnet)

This build is deliberately unsafe in ways that are fine on a loopback devnet and **must** change
before any network exposure: a single static API key, no rate limits, node keys encrypted-at-rest
but with the password in the environment, and **no Biscuit auth on the fnn RPC** (safe only while
every node binds `127.0.0.1`). Never bind an fnn RPC to a non-loopback address without setting
`rpc.biscuit_public_key` first — fnn will refuse to start, and that guard should not be worked
around. Losing `ckb/key` or the `fiber/store` can mean losing funds. See CLAUDE.md and PLAN.md
Phase 7.

## License

Unlicensed / private (devnet prototype).
