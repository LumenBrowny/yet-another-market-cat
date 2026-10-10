#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/.."
solana --version
cargo build-sbf --manifest-path programs/cat_shit_mining/Cargo.toml
