#!/usr/bin/env bash
# reset.sh — one command to nuke devnet chain data and re-init a fresh dev chain.
# You WILL run this constantly during Phase 1 (CLAUDE.md rule 5: re-run smoke.sh after every reset).
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

log "stopping any running ckb / fnn processes"
pkill -f "$FNN_BIN -c" 2>/dev/null || true
pkill -f "ckb run"     2>/dev/null || true
pkill -f "ckb miner"   2>/dev/null || true

CHAIN_DIR="$DEVNET_DIR/data"
log "removing chain data at $CHAIN_DIR"
rm -rf "$CHAIN_DIR"
mkdir -p "$CHAIN_DIR"

log "ckb init --chain dev"
"$CKB_BIN" init --chain dev --force -C "$CHAIN_DIR"

# TODO(Phase 1.1): edit "$CHAIN_DIR/specs/dev.toml" + ckb.toml to shorten epoch/block times so
#   channel confirmations take seconds, and set a KNOWN miner lock. Also clear each node's
#   fiber/ store dir, since a fresh chain invalidates old channel state.
warn "chain re-initialized. Remember to: (1) set miner lock + shorten block time in $CHAIN_DIR,"
warn "(2) re-deploy fiber-scripts (deploy.sh) so scripts.json matches this fresh chain,"
warn "(3) wipe infra/nodes/*/fiber/ store dirs, then re-run smoke.sh."
