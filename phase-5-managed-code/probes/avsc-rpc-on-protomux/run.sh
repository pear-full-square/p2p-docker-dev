#!/usr/bin/env bash
# Re-run the probe and refresh run.log (committed). The image and node_modules it
# builds are generated artifacts and are NOT committed — run.log is the record.
set -euo pipefail
cd "$(dirname "$0")"
IMG="avsc-rpc-on-protomux-probe"
{
  echo "# avsc-rpc-on-protomux — run $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "## build"
  docker build -t "$IMG" . 2>&1 | tail -4
  echo
  echo "## load + versions (load.js)"
  docker run --rm "$IMG" load.js
  echo
  echo "## proof 1 — two avsc-rpc services over two named protomux channels (rpc.js)"
  docker run --rm "$IMG" rpc.js
  echo
  echo "## proof 2 — replication + avsc-rpc coexist on one connection (coexist.js)"
  docker run --rm "$IMG" coexist.js
  echo
  echo "## image size"
  docker images "$IMG" --format '{{.Size}}'
} 2>&1 | ../../scrub.sh | tee run.log
