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

It works on a real devnet now. I got ckb + fnn running natively on Windows (no WSL — virtualization
is off in firmware, but there are native Windows binaries), initialized a CKB dev chain with the
fiber lock contracts baked into genesis, funded three fnn nodes, and ran the full loop: opened a
channel, paid a 100 CKB invoice through it, closed it. Then wired that same loop up as an automated
e2e test — it passes against the live nodes in ~9s.

So M1 (devnet + open/pay/close) and M2 (typed client vs a live node) are done for real, not just
against the fake. Along the way the live node caught the rc5 API drift I'd guessed wrong
(open_channel wants `pubkey`, not `peer_id`) — which is exactly what the version-drift test is for.

Next is wiring the LSP service's own API/liquidity flows to the live nodes (M3/M4 for real, not just
vs the fake), then the demos.
