# examples/

Phase 6 demos — the product thesis, made concrete. Built only after M4 (the money loop) is green.

- **`merchant-demo/`** — a page that calls `POST /v1/invoices`, renders the invoice + QR, and
  flips to **paid** when the `invoice.paid` webhook fires (buyer = customer2's node pays it).
  *This artifact is the product thesis demonstrated.*
- **`paid-api-demo/`** — a `/quote` endpoint behind the L402 middleware. Client script: hit
  endpoint → `402` + invoice → pay → retry with preimage → receive data. The agent-payments
  story in ~50 lines.

Both are intentionally empty until Phase 6 — see [PLAN.md](../PLAN.md#phase-6--e2e-demos--multi-hop).
