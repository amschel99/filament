#!/usr/bin/env bash
# Shared env + paths for all infra scripts. Source this first: `source "$(dirname "$0")/env.sh"`.
set -euo pipefail

# CLAUDE.md rule 7: the documented fnn-cli 503 footgun. Every script that touches a node needs this.
export NO_PROXY=127.0.0.1,localhost
export no_proxy=127.0.0.1,localhost

# Repo-relative paths.
INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$INFRA_DIR/.." && pwd)"
DEVNET_DIR="$INFRA_DIR/devnet"
NODES_DIR="$INFRA_DIR/nodes"
SCRIPTS_JSON="$DEVNET_DIR/scripts.json"

# Binaries — override via env if not on PATH. Pin fnn at v0.9.0-rc5 (CLAUDE.md rule 1).
CKB_BIN="${CKB_BIN:-ckb}"
CKB_CLI_BIN="${CKB_CLI_BIN:-ckb-cli}"
FNN_BIN="${FNN_BIN:-fnn}"
FNN_CLI_BIN="${FNN_CLI_BIN:-fnn-cli}"

# CKB devnet endpoints.
CKB_RPC_URL="${CKB_RPC_URL:-http://127.0.0.1:8114}"

# Node RPC/P2P ports (CLAUDE.md quick ref).
HUB_RPC_PORT=8227;      HUB_P2P_PORT=8228
CUST1_RPC_PORT=8237;    CUST1_P2P_PORT=8238
CUST2_RPC_PORT=8247;    CUST2_P2P_PORT=8248

log()  { printf '\033[1;34m[infra]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[err]\033[0m %s\n' "$*" >&2; exit 1; }
