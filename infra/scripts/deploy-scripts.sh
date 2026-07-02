#!/usr/bin/env bash
# deploy-scripts.sh — Phase 1.2, THE highest-risk step. Deploy funding-lock + commitment-lock
# to the devnet and write their real hashes/cell-deps into infra/devnet/scripts.json.
#
# CLAUDE.md rule 6: DO NOT hand-roll this before checking what already exists. Ground truth:
#   - nervosnetwork/fiber       -> tests/ (spins up devnet nodes), config/, docs/
#   - nervosnetwork/fiber-scripts -> deployment/ (deployment configs + migration JSONs)
# Reuse that tooling. This script is a documented placeholder for the manual `ckb-cli deploy`
# path, NOT a turnkey deploy — fill it in once you've read the fiber repo's harness.
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

die "Phase 1.2 not yet implemented — see the checklist below and CLAUDE.md rule 6.

  1. git clone https://github.com/nervosnetwork/fiber-scripts
  2. Build funding-lock (2-of-2, uses ckb-auth) and commitment-lock (Daric penalty).
  3. Deploy both to the devnet (prefer fiber-scripts/deployment/ configs or the fiber repo's
     own test harness; fall back to 'ckb-cli deploy' with a deployment config).
  4. For EACH lock record: code_hash, hash_type, and the FULL cell-dep list — a type_id dep
     PLUS a separate cell_dep for ckb_auth (replicate the testnet reference structure).
  5. Write those values into infra/devnet/scripts.json (set deployed_at, replace all 0x00…).
  6. Run render-config.sh, then start-nodes.sh, then smoke.sh.
"
