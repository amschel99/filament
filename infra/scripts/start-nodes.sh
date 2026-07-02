#!/usr/bin/env bash
# start-nodes.sh — launch the three fnn nodes (hub, customer1, customer2), each with its own
# config.yml + data dir. CLAUDE.md rules 7 & 8: NO_PROXY set (via env.sh) and
# FIBER_SECRET_KEY_PASSWORD required at every start.
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

start_node() {
  local name="$1"
  local dir="$NODES_DIR/$name"
  [ -f "$dir/config.yml" ] || die "$dir/config.yml missing — run render-config.sh"
  [ -f "$dir/ckb/key" ]    || die "$dir/ckb/key missing — export node key (Phase 1.3)"

  # Per-node password. Override with e.g. HUB_PW / CUST1_PW / CUST2_PW; default is devnet-only.
  local pw_var
  case "$name" in
    hub)       pw_var="${HUB_PW:-devnet}";;
    customer1) pw_var="${CUST1_PW:-devnet}";;
    customer2) pw_var="${CUST2_PW:-devnet}";;
    *) die "unknown node $name";;
  esac

  log "starting fnn: $name (data dir $dir)"
  FIBER_SECRET_KEY_PASSWORD="$pw_var" RUST_LOG="${RUST_LOG:-info}" \
    "$FNN_BIN" -c "$dir/config.yml" -d "$dir" > "$dir/node.log" 2>&1 &
  echo $! > "$dir/node.pid"
}

start_node hub
start_node customer1
start_node customer2
log "all three fnn nodes launched. Tail logs: infra/nodes/<name>/node.log"
