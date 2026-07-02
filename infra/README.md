# infra/ — Phase 1 devnet foundation

Everything here exists to reach **M1**: a local CKB chain with fiber-scripts deployed, three
funded `fnn` nodes, and one channel opened → paid → closed via `smoke.sh`. **Nothing in `src/`
is trusted until `smoke.sh` passes** (CLAUDE.md rules 5 & 14).

## Order of operations (cold start)

```bash
# all scripts source env.sh, which sets NO_PROXY (CLAUDE.md rule 7) and binary paths
infra/scripts/reset.sh            # 1.1  fresh dev chain (then hand-edit miner lock + block time)
infra/scripts/start-devnet.sh     #      ckb node + miner
infra/scripts/deploy-scripts.sh   # 1.2  ⚠ highest risk — deploy locks -> writes scripts.json
#   (Phase 1.3: ckb-cli account new x3, export keys to nodes/<n>/ckb/key, chmod 600)
infra/scripts/fund.sh             #      fund hub (1M) + customers (1k each)
infra/scripts/render-config.sh    #      generate each nodes/<n>/config.yml from scripts.json
infra/scripts/start-nodes.sh      # 1.3  launch the three fnn nodes
infra/scripts/smoke.sh            # 1.4  THE canary — open/pay/close loop
```

## Files

| Path | Role |
|---|---|
| `scripts/env.sh` | shared paths, ports, binaries, `NO_PROXY`. Source it first. |
| `scripts/reset.sh` | nuke + re-init the dev chain (run constantly) |
| `scripts/start-devnet.sh` | ckb node + miner as background processes |
| `scripts/deploy-scripts.sh` | **Phase 1.2** deploy stub — reuse the fiber repo harness (rule 6) |
| `scripts/fund.sh` | transfer devnet CKB to the three node addresses |
| `scripts/render-config.sh` | render `config.yml` per node **from `scripts.json`** |
| `scripts/start-nodes.sh` | launch hub + customer1 + customer2 |
| `scripts/smoke.sh` | M1 canary; re-run after every reset/upgrade |
| `devnet/scripts.json` | **single source of truth** for deployed script hashes + cell deps |
| `nodes/config.template.yml` | per-node config template (placeholders `{{...}}`) |
| `nodes/<n>/` | rendered `config.yml`, `ckb/key`, `fiber/` store (keys + store gitignored) |

## Ports

| Node | RPC | P2P |
|---|---|---|
| hub | 8227 | 8228 |
| customer1 | 8237 | 8238 |
| customer2 | 8247 | 8248 |
| ckb devnet | 8114 | — |

> **Windows note:** these are bash scripts. Run them under WSL2 or Git Bash — the CKB/fnn devnet
> toolchain is happiest on Linux. The `src/` TypeScript service runs natively on Windows.
