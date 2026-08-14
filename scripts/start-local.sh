#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node || true)"

if [[ -z "$NODE_BIN" ]]; then
  echo "AURA 控制台需要 Node.js 22.13 或更高版本，但当前 PATH 中没有 node。"
  exit 1
fi

NODE_VERSION="$($NODE_BIN -p 'process.versions.node')"
NODE_OK="$($NODE_BIN -p 'const [a,b]=process.versions.node.split(".").map(Number); Number(a>22 || (a===22 && b>=13))')"
if [[ "$NODE_OK" != "1" ]]; then
  echo "AURA 控制台需要 Node.js 22.13 或更高版本，当前为 v${NODE_VERSION}。"
  exit 1
fi

cd "$PROJECT_DIR"
export WRANGLER_LOG_PATH=.wrangler/wrangler.log

"$NODE_BIN" node_modules/vinext/dist/cli.js dev &
WEB_PID=$!
"$NODE_BIN" scripts/lan-camera-server.mjs &
CAMERA_PID=$!

cleanup() {
  kill "$WEB_PID" "$CAMERA_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
wait
