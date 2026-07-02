#!/usr/bin/env bash
# start-devnet.sh — start the CKB node + miner as separate background processes, logging to files.
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

CHAIN_DIR="$DEVNET_DIR/data"
[ -d "$CHAIN_DIR/specs" ] || die "no chain at $CHAIN_DIR — run reset.sh first"

log "starting ckb node (rpc $CKB_RPC_URL)"
"$CKB_BIN" run -C "$CHAIN_DIR" > "$CHAIN_DIR/ckb-node.log" 2>&1 &
echo $! > "$CHAIN_DIR/ckb-node.pid"

# Give the node a moment to open its RPC before the miner dials it.
until curl -s -o /dev/null -X POST "$CKB_RPC_URL" \
      -H 'content-type: application/json' \
      -d '{"id":1,"jsonrpc":"2.0","method":"get_tip_block_number","params":[]}'; do
  sleep 0.5
done

log "starting ckb miner"
"$CKB_BIN" miner -C "$CHAIN_DIR" > "$CHAIN_DIR/ckb-miner.log" 2>&1 &
echo $! > "$CHAIN_DIR/ckb-miner.pid"

log "devnet up. node log: $CHAIN_DIR/ckb-node.log · miner log: $CHAIN_DIR/ckb-miner.log"
