#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/.."
# Dedicated ledger; no --reset, no removal of any existing ledger.
# A Linux filesystem is needed for the validator's Unix admin socket (WSL /mnt/* cannot host it).
exec solana-test-validator --ledger "${YAC_LEDGER_DIR:-/tmp/yet-another-cat-ledger}" --bind-address "${YAC_BIND_ADDRESS:-127.0.0.1}" --rpc-port 8899
