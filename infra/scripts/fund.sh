#!/usr/bin/env bash
# fund.sh — transfer devnet CKB from the miner account to the three node CKB addresses.
# hub gets ~1,000,000 CKB (liquidity provider); customer1/2 ~1,000 each.
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

# TODO(Phase 1.3): fill in from `ckb-cli account new` output for each node.
MINER_ADDRESS="${MINER_ADDRESS:-}"          # devnet miner lock (source of funds)
HUB_ADDRESS="${HUB_ADDRESS:-}"
CUST1_ADDRESS="${CUST1_ADDRESS:-}"
CUST2_ADDRESS="${CUST2_ADDRESS:-}"

[ -n "$MINER_ADDRESS" ] || die "set MINER_ADDRESS (and HUB/CUST1/CUST2_ADDRESS) — see Phase 1.3"

transfer() {
  local to="$1" ckb="$2"
  [ -n "$to" ] || die "empty destination address"
  log "funding $to with $ckb CKB"
  # ckb-cli uses DECIMAL CKB here (the wallet CLI), not shannons/hex. --tx-fee is CKB too.
  "$CKB_CLI_BIN" wallet transfer \
    --from-account "$MINER_ADDRESS" \
    --to-address "$to" \
    --capacity "$ckb" \
    --tx-fee 0.001
}

transfer "$HUB_ADDRESS"   1000000
transfer "$CUST1_ADDRESS" 1000
transfer "$CUST2_ADDRESS" 1000

log "funding submitted — mine a few blocks and check balances with: $CKB_CLI_BIN wallet get-capacity --address <addr>"
