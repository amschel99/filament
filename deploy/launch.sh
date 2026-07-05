#!/usr/bin/env bash
# Filament launcher — select a network and bring up the LSP service (and optionally the full
# devnet stack). Usage:
#   ./deploy/launch.sh devnet   full        # ckb + miner + 3 fnn + LSP (Docker; see caveat)
#   ./deploy/launch.sh devnet                # LSP only, against fnn nodes already running on host
#   ./deploy/launch.sh testnet               # LSP against a testnet fnn node (fill testnet.env first)
#   ./deploy/launch.sh mainnet               # LSP against a mainnet fnn node (fill mainnet.env first)
set -euo pipefail
NETWORK="${1:-devnet}"
MODE="${2:-lsp}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$DIR/networks/${NETWORK}.env"

[ -f "$ENV_FILE" ] || { echo "no env file: $ENV_FILE"; exit 1; }
echo "[launch] network=$NETWORK mode=$MODE env=$ENV_FILE"

# Guard: refuse to launch testnet/mainnet with unfilled stablecoin placeholders.
if grep -q '__FILL_' "$ENV_FILE"; then
  echo "[launch] ⚠ $ENV_FILE still has __FILL_...__ placeholders (stablecoin type script). Fill + verify them first (CLAUDE.md rule 2)." >&2
  [ "$NETWORK" != "devnet" ] && exit 1
fi

command -v docker >/dev/null || { echo "[launch] docker not found. On this machine Docker needs firmware virtualization (disabled); run the service natively instead:  NETWORK=$NETWORK npm start"; exit 1; }

if [ "$NETWORK" = "devnet" ] && [ "$MODE" = "full" ]; then
  echo "[launch] bringing up FULL devnet stack (ckb + miner + 3 fnn + LSP)"
  ( cd "$DIR/docker" && NETWORK=devnet docker compose -f docker-compose.devnet.yml up --build )
else
  echo "[launch] bringing up LSP service for $NETWORK"
  ( cd "$DIR/docker" && NETWORK="$NETWORK" docker compose --env-file "$ENV_FILE" up --build )
fi
