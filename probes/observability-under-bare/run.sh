#!/usr/bin/env bash
# Re-run the observability probe and refresh run.log (committed). The image and
# node_modules are generated artifacts and are NOT committed.
set -euo pipefail
cd "$(dirname "$0")"
IMG="observability-under-bare-probe"
{
  echo "# observability-under-bare — run $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "## build"
  docker build -t "$IMG" . 2>&1 | tail -4
  echo
  echo "## probe.js"
  docker run --rm "$IMG" probe.js
} 2>&1 | tee run.log
