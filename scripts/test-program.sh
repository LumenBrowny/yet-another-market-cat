#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export RUST_LOG=error
if [ -d .dev/linux-tools/node_modules ]; then export NODE_PATH="$PWD/.dev/linux-tools/node_modules${NODE_PATH:+:$NODE_PATH}"; fi
npm run test:program
