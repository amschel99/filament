#!/usr/bin/env bash
# smoke.sh — the M1 canary. Full open -> pay -> close loop, customer1 <-> hub, via JSON-RPC.
# CLAUDE.md rule 5: run this after EVERY devnet reset and EVERY fnn upgrade before touching app code.
# Requires: curl, jq. Nodes must be running (start-devnet.sh + start-nodes.sh).
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
command -v jq >/dev/null || die "jq required"

HUB_RPC="http://127.0.0.1:${HUB_RPC_PORT}"
CUST1_RPC="http://127.0.0.1:${CUST1_RPC_PORT}"

# JSON-RPC helper: rpc <url> <method> <params-json>. fnn wraps params in a single-element array.
rpc() {
  local url="$1" method="$2" params="${3:-{}}"
  curl -s -X POST "$url" -H 'content-type: application/json' \
    -d "{\"id\":1,\"jsonrpc\":\"2.0\",\"method\":\"$method\",\"params\":[$params]}"
}
result() { jq -e -r '.result'; }

log "0. node_info for both nodes"
HUB_PUBKEY=$(rpc "$HUB_RPC" node_info | jq -r '.result.node_id // .result.pubkey // empty')
[ -n "$HUB_PUBKEY" ] || die "could not read hub pubkey — is the hub node up?"
log "   hub pubkey: $HUB_PUBKEY"

log "1. connect_peer: customer1 -> hub"
rpc "$CUST1_RPC" connect_peer "{\"address\":\"/ip4/127.0.0.1/tcp/${HUB_P2P_PORT}/p2p/${HUB_PUBKEY}\"}" >/dev/null
sleep 2

log "2. open_channel customer1 -> hub (>= 500 CKB; usable = funded - 99)"
# 500 CKB = 50000000000 shannons = 0xba43b7400
OPEN=$(rpc "$CUST1_RPC" open_channel "{\"peer_id\":\"${HUB_PUBKEY}\",\"funding_amount\":\"0xba43b7400\",\"public\":true}")
TEMP_ID=$(echo "$OPEN" | jq -r '.result.temporary_channel_id // empty')
[ -n "$TEMP_ID" ] || die "open_channel failed: $OPEN"
log "   temp channel id: $TEMP_ID"

log "3. poll list_channels until ChannelReady"
for i in $(seq 1 60); do
  STATE=$(rpc "$CUST1_RPC" list_channels "{}" | jq -r '.result.channels[0].state.state_name // .result.channels[0].state // empty')
  log "   [$i] state=$STATE"
  case "$STATE" in ChannelReady|CHANNEL_READY) break;; esac
  sleep 2
done
[ "$STATE" = "ChannelReady" ] || [ "$STATE" = "CHANNEL_READY" ] || die "channel never reached ready (last: $STATE)"

log "4. new_invoice on customer1 (100 CKB)"
INV=$(rpc "$CUST1_RPC" new_invoice "{\"amount\":\"0x2540be400\",\"currency\":\"Fibd\",\"description\":\"smoke\"}")
INVOICE=$(echo "$INV" | jq -r '.result.invoice_address // empty')
[ -n "$INVOICE" ] || die "new_invoice failed: $INV"
log "   invoice: $INVOICE"

log "5. send_payment from hub"
PAY=$(rpc "$HUB_RPC" send_payment "{\"invoice\":\"${INVOICE}\"}")
log "   payment: $(echo "$PAY" | jq -c '.result // .error')"
# TODO: poll get_payment until Success, then assert balance moved on both sides.

log "6. shutdown_channel (settle on-chain)"
CHAN_ID=$(rpc "$CUST1_RPC" list_channels "{}" | jq -r '.result.channels[0].channel_id // empty')
rpc "$CUST1_RPC" shutdown_channel "{\"channel_id\":\"${CHAN_ID}\"}" >/dev/null

log "SMOKE COMPLETE — verify payment Success + settlement tx in the node logs."
