# Running the Fiber devnet natively on Windows (no WSL/Docker)

This machine can't run WSL2 or Docker (virtualization is disabled in firmware). It doesn't need
to: **fnn, ckb, and ckb-cli all ship native Windows binaries**, and the whole devnet runs under
Git Bash. This is the path that passed the smoke test and the e2e suite.

## TL;DR

```bash
bash infra/scripts/devnet-windows.sh   # cold start: download → chain → fund → configs → 3 fnn nodes
node infra/scripts/smoke.mjs           # open → pay → close, end to end
npm run test:e2e                       # the same loop as an automated test
```

`RESET=1 bash infra/scripts/devnet-windows.sh` wipes chain state and re-inits.

## What it does (and why)

1. **Downloads pinned binaries** into `infra/bin/` (gitignored):
   `fnn v0.9.0-rc5`, `ckb v0.207.0`, `ckb-cli v2.0.0`.
2. **Clones the fiber rc5 harness** into `infra/vendor/fiber/` (gitignored). We reuse its
   `tests/deploy/contracts/` (prebuilt funding-lock/commitment-lock/auth), its `dev.toml`
   chain spec, and its pre-made node keys in `tests/nodes/{1,2,3}` — exactly what CLAUDE.md
   rule 6 says to do instead of hand-rolling deployment.
3. **Inits the CKB dev chain from fiber's `dev.toml`.** This is the crux of Phase 1.2: the lock
   contracts are **baked into the genesis block** as system cells. fnn then loads FundingLock and
   CommitmentLock from genesis outputs 5–8. fnn treats any non-mainnet/testnet genesis as "dev"
   (log line `Creating ContractsContext for dev`), so no script hashes ever need hand-configuring
   — which is why `infra/devnet/scripts.json` isn't used on this path.
4. **Starts ckb** with the `IntegrationTest` module so blocks are minted on demand via the
   `generate_block` RPC (no continuous miner needed).
5. **Funds** node 1/2/3 wallets from the deployer account (which holds the genesis issuance).
6. **Generates each node's `config.yml`** on our port scheme and starts three fnn nodes.

## Topology / ports

| Role | fnn node | RPC | P2P | password |
|---|---|---|---|---|
| hub (LSP) | node 1 | 8227 | 8228 | `password1` |
| customer1 (merchant) | node 2 | 8237 | 8238 | `password2` |
| customer2 (buyer) | node 3 | 8247 | 8248 | `password3` |
| CKB devnet | — | 8114 | — | — |

These match `.env.example` and the e2e test defaults.

## rc5 drift this shook out (CLAUDE.md rule 1)

The live node disagreed with our first guesses — exactly what the M2 tripwire is for. Confirmed
against v0.9.0-rc5 and fixed in `src/rpc/`:

- `node_info` returns **`pubkey`** (hex, **no `0x` prefix**) — not `node_id`/`peer_id`.
- `open_channel` takes **`pubkey`**, not `peer_id`.
- devnet invoice `currency` is **`Fibd`**.

## Gotchas

- Set `export NO_PROXY=127.0.0.1,localhost` (the scripts do this) — the documented fnn 503 footgun.
- The node processes are plain background jobs; they survive the launching shell but are not a
  service. To stop everything: `taskkill //IM fnn.exe //F && taskkill //IM ckb.exe //F`.
- Channel funding is on-chain, so you must mine blocks after `open_channel` for it to reach
  `ChannelReady` — the smoke and e2e do this via `generate_block` while polling.
