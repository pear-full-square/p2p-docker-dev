#!/usr/bin/env bash
# Re-run the avsc-rpc probe and refresh run.log (committed). Image + node_modules
# are generated artifacts, not committed.
set -euo pipefail
cd "$(dirname "$0")"
IMG="avsc-rpc-under-bare-probe"
{
  echo "# avsc-rpc-under-bare — run $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "## build"
  docker build --no-cache -t "$IMG" . 2>&1 | tail -4
  echo
  echo "## probe.js"
  docker run --rm "$IMG" probe.js
} 2>&1 | tee run.log
