# deploy/ — Docker + multi-network launch

Run the Filament LSP against **devnet** (proven), or **testnet / mainnet** with a real stablecoin.

## The one idea that makes multi-network trivial

fnn recognizes the **mainnet and testnet genesis hashes** and auto-loads the correct
FundingLock / CommitmentLock cell deps for each (`crates/fiber-lib/src/ckb/contracts.rs`). Any other
genesis is treated as "dev." So **nothing about the lock scripts changes between networks** — only:

1. the CKB RPC + chain the fnn node points at, and
2. the **stablecoin type script** the LSP denominates in (fUSD on devnet → RUSD on testnet/mainnet).

Both live in `deploy/networks/<network>.env`. Switching networks = switching env files.

## Files

| Path | Role |
|---|---|
| `networks/devnet.env` | LSP config for the local devnet + **fUSD** stablecoin (real, filled in) |
| `networks/testnet.env` | testnet template + **RUSD** placeholders to fill/verify |
| `networks/mainnet.env` | mainnet template + **RUSD** placeholders to fill/verify |
| `docker/Dockerfile.lsp` | the TypeScript LSP API service |
| `docker/Dockerfile.fnn` | fnn v0.9.0-rc5 node (Linux release binary) |
| `docker/docker-compose.yml` | LSP service only (any network, via env_file) |
| `docker/docker-compose.devnet.yml` | full local stack: ckb + miner + 3 fnn + LSP |
| `launch.sh` | `./deploy/launch.sh <network> [full]` |
| `stablecoins.md` | known stablecoin type scripts per network |

## Launch

```bash
# LSP only, against fnn nodes already running (e.g. the native devnet):
./deploy/launch.sh devnet

# full devnet stack in containers (see caveat below):
./deploy/launch.sh devnet full

# testnet / mainnet (fill + verify the RUSD type script in the env file first):
./deploy/launch.sh testnet
./deploy/launch.sh mainnet
```

`launch.sh` refuses testnet/mainnet while the stablecoin values are still `__FILL_...__`.

## ⚠ Honest status

- **devnet**: proven end-to-end **natively** on this machine (`infra/scripts/devnet-windows.sh` +
  `npm run test:e2e` + the merchant demo settling $8.00 fUSD). That is the trusted path.
- **Docker**: the images/compose are written to be correct but are **not verified here** — Docker
  Desktop needs hardware virtualization, which is disabled in this box's firmware. On a machine with
  Docker they should build and run; treat the first run as unproven.
- **testnet/mainnet**: templates only. You must (1) run/point at a real CKB node for that network,
  (2) fund the hub's CKB wallet, and (3) fill the **verified** RUSD type script (never guess hashes —
  CLAUDE.md rule 2). And complete `SECURITY.md` hardening before mainnet — real funds.

### Full devnet stack init

`docker-compose.devnet.yml` expects `./devnet-data/{ckb,nodes/1..3}` prepared once (dev chain with
the fiber contracts in genesis, funded wallets, rendered configs, fUSD minted). The native
`infra/scripts/devnet-windows.sh` does exactly this; a Linux `init-devnet.sh` doing the same is the
one remaining port for a pure-Docker cold start.
