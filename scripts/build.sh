#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/.."
if [ -x .dev/anchor/bin/anchor ]; then export PATH="$PWD/.dev/anchor/bin:$PATH"; fi
if [ -d .dev/linux-tools/node_modules ]; then export NODE_PATH="$PWD/.dev/linux-tools/node_modules${NODE_PATH:+:$NODE_PATH}"; fi
anchor --version
solana --version
anchor build
npx tsx scripts/sync-idl.ts
