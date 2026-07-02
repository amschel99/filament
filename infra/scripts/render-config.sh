#!/usr/bin/env bash
# render-config.sh — generate each node's config.yml from config.template.yml + scripts.json.
# CLAUDE.md rule 2: script hashes/cell-deps come ONLY from scripts.json, never hardcoded.
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
command -v jq >/dev/null || die "jq required"

CHAIN_SPEC="${CHAIN_SPEC_PATH:-$DEVNET_DIR/data/specs/dev.toml}"
TEMPLATE="$NODES_DIR/config.template.yml"

# Refuse to render from placeholder (all-zero) hashes.
FUND_HASH=$(jq -r '.scripts.funding_lock.code_hash' "$SCRIPTS_JSON")
if [[ "$FUND_HASH" =~ ^0x0+$ ]]; then
  die "scripts.json still holds placeholder hashes — run Phase 1.2 deployment (deploy.sh) first"
fi

render_one() {
  local name="$1" rpc_port="$2" p2p_port="$3" announce="$4" auto_min="$5" auto_amt="$6"
  local dir="$NODES_DIR/$name"
  mkdir -p "$dir/ckb"

  local fund_deps commit_deps
  fund_deps=$(jq -c '.scripts.funding_lock.cell_deps    | map(del(._role))' "$SCRIPTS_JSON")
  commit_deps=$(jq -c '.scripts.commitment_lock.cell_deps | map(del(._role))' "$SCRIPTS_JSON")

  sed \
    -e "s#{{CHAIN_SPEC_PATH}}#${CHAIN_SPEC}#g" \
    -e "s#{{ANNOUNCE_LISTENING_ADDR}}#${announce}#g" \
    -e "s#{{P2P_PORT}}#${p2p_port}#g" \
    -e "s#{{RPC_PORT}}#${rpc_port}#g" \
    -e "s#{{AUTO_ACCEPT_MIN_CKB}}#${auto_min}#g" \
    -e "s#{{AUTO_ACCEPT_CKB}}#${auto_amt}#g" \
    -e "s#{{FUNDING_LOCK_CODE_HASH}}#$(jq -r '.scripts.funding_lock.code_hash' "$SCRIPTS_JSON")#g" \
    -e "s#{{FUNDING_LOCK_HASH_TYPE}}#$(jq -r '.scripts.funding_lock.hash_type' "$SCRIPTS_JSON")#g" \
    -e "s#{{COMMITMENT_LOCK_CODE_HASH}}#$(jq -r '.scripts.commitment_lock.code_hash' "$SCRIPTS_JSON")#g" \
    -e "s#{{COMMITMENT_LOCK_HASH_TYPE}}#$(jq -r '.scripts.commitment_lock.hash_type' "$SCRIPTS_JSON")#g" \
    -e "s#{{FUNDING_LOCK_CELL_DEPS}}#${fund_deps}#g" \
    -e "s#{{COMMITMENT_LOCK_CELL_DEPS}}#${commit_deps}#g" \
    "$TEMPLATE" > "$dir/config.yml"
  log "rendered $dir/config.yml"
}

# name       rpc            p2p            announce  auto_min auto_amt
render_one hub       "$HUB_RPC_PORT"   "$HUB_P2P_PORT"   true  200 50000
render_one customer1 "$CUST1_RPC_PORT" "$CUST1_P2P_PORT" false 0   0
render_one customer2 "$CUST2_RPC_PORT" "$CUST2_P2P_PORT" false 0   0
