# Report

## What I'm building

Filament. It's a payments API on top of Fiber Network (the off-chain payment layer on Nervos CKB).
The idea is simple: run one well-funded Fiber node ("hub") and put a normal HTTP API in front of it,
so a merchant or an agent can take Fiber payments without running a node or dealing with channels,
hex-shannon RPC, or any of the on-chain mechanics.

Three things it does:
- create an invoice, get a webhook when it's paid
- provision inbound liquidity (hub opens a channel to a customer node)
- L402 pay-per-request, so an API can charge per call

Scope is devnet only for now. TypeScript service, SQLite for state, Fastify for the API, talking to
`fnn` v0.9.0-rc5 over JSON-RPC.

## What I did today

- Set the repo up from scratch and settled the stack. Considered Rust, went with TypeScript because
  the service is a client on top of fnn, not a fork of it.
- Wrote the plan (PLAN.md) and the engineering rules (CLAUDE.md).
- Built the RPC layer: unit conversions (CKB/shannon/hex), state-enum normalization, and a raw
  JSON-RPC client behind one typed interface so nothing else talks to a node directly. Unit tests pass.
- Stubbed out the rest phase by phase: liquidity engine, invoices + webhooks, API routes, L402.
- Wrote the devnet infra scripts (reset, deploy, fund, render config, start nodes, smoke test).
- Fixed the gitignore properly (node keys, chain data, AI-tool junk) and wrote the README.

## Where it stands

Compiles, tests green, committed. Nothing real works yet though. Everything is gated on M1: getting
the local devnet up with fiber-scripts deployed and one channel opened/paid/closed. That deployment
step is the hard part and it's next.
