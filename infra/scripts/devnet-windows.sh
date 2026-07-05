#!/usr/bin/env bash
# devnet-windows.sh — bring up the full Fiber devnet NATIVELY on Windows (Git Bash / MINGW64),
# no WSL, Docker, or virtualization required. This reproduces, from cold, the exact steps that
# passed the smoke + e2e suite:
#   download ckb/ckb-cli/fnn -> clone fiber rc5 harness -> init dev chain (contracts in genesis)
#   -> start ckb -> fund 3 nodes -> generate configs -> start 3 fnn nodes.
#
# Key facts (see CLAUDE.md + PLAN.md):
#   - fnn treats any non-main/test genesis as "dev" and loads FundingLock/CommitmentLock from
#     genesis outputs 5..8, so we MUST init the chain from fiber's own dev.toml + contracts.
#   - fnn v0.9.0-rc5 renamed open_channel.peer_id -> pubkey and node_info -> pubkey.
#
# Requires: bash, curl, tar, unzip, node. Run from the repo root:  bash infra/scripts/devnet-windows.sh
set -euo pipefail
export NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="$REPO/infra/bin"
VENDOR="$REPO/infra/vendor"
FIBER="$VENDOR/fiber"
DATA="$FIBER/tests/deploy/node-data"
NODES="$FIBER/tests/nodes"
CKB_RPC="http://127.0.0.1:8114"

FNN_URL="https://github.com/nervosnetwork/fiber/releases/download/v0.9.0-rc5/fnn_v0.9.0-rc5-x86_64-windows.tar.gz"
CKB_URL="https://github.com/nervosnetwork/ckb/releases/download/v0.207.0/ckb_v0.207.0_x86_64-pc-windows-msvc.zip"
CKBCLI_URL="https://github.com/nervosnetwork/ckb-cli/releases/download/v2.0.0/ckb-cli_v2.0.0_x86_64-pc-windows-msvc.zip"

log() { printf '\033[1;34m[devnet]\033[0m %s\n' "$*"; }

# ── 1. binaries ─────────────────────────────────────────────────────────────
mkdir -p "$BIN"
if [ ! -f "$BIN/fnn.exe" ]; then log "downloading fnn v0.9.0-rc5"; curl -sL "$FNN_URL" | tar xz -C "$BIN"; fi
if [ ! -f "$BIN/ckb.exe" ]; then
  log "downloading ckb"; curl -sL -o "$BIN/ckb.zip" "$CKB_URL"; unzip -oq "$BIN/ckb.zip" -d "$BIN"
  cp "$BIN"/ckb_v*_x86_64-pc-windows-msvc/ckb.exe "$BIN/ckb.exe"
fi
if [ ! -f "$BIN/ckb-cli.exe" ]; then
  log "downloading ckb-cli"; curl -sL -o "$BIN/ckb-cli.zip" "$CKBCLI_URL"; unzip -oq "$BIN/ckb-cli.zip" -d "$BIN"
  cp "$BIN"/ckb-cli_v*_x86_64-pc-windows-msvc/ckb-cli.exe "$BIN/ckb-cli.exe"
fi
export PATH="$BIN:$PATH"
log "ckb=$(ckb --version) | fnn=$(fnn --version)"

# ── 2. fiber harness (dev.toml + prebuilt contracts + node keys) ────────────
mkdir -p "$VENDOR"
[ -d "$FIBER" ] || { log "cloning fiber rc5 harness"; git clone --depth 1 --branch v0.9.0-rc5 https://github.com/nervosnetwork/fiber.git "$FIBER"; }

# ── 3. init dev chain (contracts baked into genesis) ────────────────────────
if [ ! -d "$DATA/specs" ] || [ "${RESET:-}" = "1" ]; then
  log "init CKB dev chain"
  rm -rf "$DATA"
  ckb init -C "$DATA" -c dev --force --ba-arg 0xc8328aabcd9b9e8e64fbc566c4385c3bdeb219d7 >/dev/null
  cp "$NODES/deployer/dev.toml" "$DATA/specs/dev.toml"
  sed -i.bak 's|\.\./\.\./deploy/contracts|\.\./\.\./\.\./deploy/contracts|g' "$DATA/specs/dev.toml"
  grep -q 'IntegrationTest' "$DATA/ckb.toml" || sed -i.bak 's/\("Debug"\)/\1, "IntegrationTest"/' "$DATA/ckb.toml"
fi

# ── 4. start ckb + mine a few blocks ────────────────────────────────────────
if ! curl -s -X POST "$CKB_RPC" -d '{"id":1,"jsonrpc":"2.0","method":"get_tip_block_number","params":[]}' | grep -q result; then
  log "starting ckb node (+indexer)"
  ckb run -C "$DATA" --indexer > "$DATA/ckb-node.log" 2>&1 &
  for i in $(seq 1 20); do curl -s -X POST "$CKB_RPC" -d '{"id":1,"jsonrpc":"2.0","method":"get_tip_block_number","params":[]}' | grep -q result && break; sleep 1; done
fi
mine() { for _ in $(seq 1 "${1:-1}"); do curl -s -X POST "$CKB_RPC" -d '{"id":42,"jsonrpc":"2.0","method":"generate_block","params":[]}' >/dev/null; done; }
mine 10

# ── 5. fund node 1/2/3 from the deployer account ────────────────────────────
export HOME="$DATA"
DEP="$NODES/deployer/ckb/plain_key"
fund() { local n="$1" cap="$2"; local a; a=$(cat "$NODES/$n/ckb/wallet");
  ckb-cli --url "$CKB_RPC" wallet transfer --to-address "$a" --capacity "$cap" --fee-rate 2000 --privkey-path "$DEP" >/dev/null 2>&1 || true; mine 4; }
log "funding nodes (hub 1,000,000 / customers 200,000 CKB)"
fund 1 1000000; fund 2 200000; fund 3 200000

# ── 6. generate per-node config.yml (our port scheme) + dev.toml ────────────
gen_config() { local i="$1" rpc="$2" fib="$3"
  cp "$NODES/deployer/dev.toml" "$NODES/$i/dev.toml"
  cat > "$NODES/$i/config.yml" <<EOF
fiber:
  chain: dev.toml
  auto_announce_node: true
  announce_private_addr: true
  watchtower_check_interval_seconds: 1
  gossip_store_maintenance_interval_ms: 1000
  gossip_network_maintenance_interval_ms: 1000
  listening_addr: /ip4/0.0.0.0/tcp/$fib
  announced_addrs: [/ip4/127.0.0.1/tcp/$fib]
  announced_node_name: fiber-$i
rpc:
  listening_addr: 127.0.0.1:$rpc
  enabled_modules: [channel, payment, graph, info, invoice, peer, pubsub, watchtower, dev, prof]
ckb:
  rpc_url: http://127.0.0.1:8114
  tx_tracing_polling_interval_ms: 300
services: [fiber, rpc, ckb]
EOF
}
# hub=node1 (8227/8228) · customer1=node2 (8237/8238) · customer2=node3 (8247/8248)
gen_config 1 8227 8228; gen_config 2 8237 8238; gen_config 3 8247 8248

# ── 7. start the 3 fnn nodes ────────────────────────────────────────────────
cd "$NODES"
start_fnn() { local i="$1" pw="$2" rpc="$3";
  if curl -s -X POST "http://127.0.0.1:$rpc" -d '{"id":1,"jsonrpc":"2.0","method":"node_info","params":[]}' | grep -q result; then
    log "node $i already up on $rpc"; return; fi
  log "starting fnn node $i (rpc $rpc)"
  FIBER_SECRET_KEY_PASSWORD="$pw" RUST_LOG=info fnn -c "$i/config.yml" -d "$i" > "$i/node.log" 2>&1 &
  for _ in $(seq 1 20); do curl -s -X POST "http://127.0.0.1:$rpc" -d '{"id":1,"jsonrpc":"2.0","method":"node_info","params":[]}' | grep -q result && break; sleep 1; done
}
start_fnn 1 password1 8227; start_fnn 2 password2 8237; start_fnn 3 password3 8247

log "devnet UP.  hub :8227  customer1 :8237  customer2 :8247  |  ckb :8114"
log "smoke:  node infra/scripts/smoke.mjs"
log "e2e:    npm run test:e2e"
