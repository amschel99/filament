# fiber-lsp

An LSP (liquidity service provider) + payments API for [Fiber Network](https://github.com/nervosnetwork/fiber).
Product thesis: **accept Fiber payments in one API call.**

TypeScript + Node 20 · `@ckb-ccc/fiber` (raw JSON-RPC fallback) · SQLite · Fastify. Devnet v0.

- **[PLAN.md](PLAN.md)** — the full phased build plan and milestones (M1→M6).
- **[CLAUDE.md](CLAUDE.md)** — standing engineering rules (version pinning, amount units, poll-don't-assume).
- **[infra/README.md](infra/README.md)** — Phase 1 devnet foundation (the M1 gate).

## Status

Scaffold. `src/` compiles; the RPC unit helpers (`src/rpc/units.ts`, `parse.ts`) are real, the
application modules are phase-tagged skeletons. **Everything downstream is gated on M1**
(`infra/scripts/smoke.sh` passing) — see PLAN.md.

## Quick start (service only — needs live fnn nodes for real calls)

```bash
npm install
cp .env.example .env
npm run typecheck      # verify the scaffold compiles
npm run dev            # boot the Fastify API on API_PORT (default 3000)
```

## Layout

```
src/rpc/       typed Fiber JSON-RPC client (the ONLY thing that talks to a node)
src/lsp/       liquidity engine: provision, monitor, rebalance
src/invoices/  invoice creation, watcher, webhook dispatch
src/api/       Fastify routes + server
src/l402/      pay-per-request (402) middleware demo
src/db/        SQLite schema + bootstrap
infra/         devnet chain, fiber-scripts deploy, 3 fnn nodes, smoke test
```
