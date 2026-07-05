# examples/

Two live demos of Filament, both settling in **fUSD** (a UDT stablecoin minted on the devnet) and
verified end-to-end against real fnn nodes. Same incandescent design system.

> Prereqs: the devnet up (`bash infra/scripts/devnet-windows.sh`), fUSD minted + whitelisted, and
> `npm run build` (the demos import from `dist/`). Set `export NO_PROXY=127.0.0.1,localhost`.

## `merchant-demo/` — accept a stablecoin payment

A checkout page for a coffee roaster. Click **Pay with Fiber** → a real **$8.00 fUSD** invoice + QR →
a buyer node pays it (routed customer2 → hub → customer1) → the page ignites to **PAID** the moment
the invoice flips from observed on-chain state. *The product thesis, demonstrated.*

```bash
node examples/merchant-demo/server.mjs      # http://127.0.0.1:4001
```

## `paid-api-demo/` — L402 pay-per-call for agents

A premium-data endpoint gated by the L402 middleware. Click **Run agent** → `GET /api/data` returns
**402** with a fresh **$0.05 fUSD** invoice → the agent pays it → retries with the preimage in the
`L402` auth header → **200 OK**, data unlocked. *The machine-payments story in one screen.*

```bash
node examples/paid-api-demo/server.mjs      # http://127.0.0.1:4002
```

Both open the required fUSD channels on boot and wait for gossip to settle, so the first request
routes cleanly. The same code path swaps fUSD for **RUSD** on mainnet — see [deploy/](../deploy/).
