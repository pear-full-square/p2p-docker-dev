#!/usr/bin/env bash
# FUSE probe — needs --cap-add SYS_ADMIN --device /dev/fuse for kernel access.
set -euo pipefail
cd "$(dirname "$0")"
IMG="hyperdrive-fuse-readonly-probe"
{
  echo "# hyperdrive-fuse-readonly — run $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "## build"
  docker build -t "$IMG" . 2>&1 | tail -4
  echo
  echo "## read-only FUSE mount over Hyperdrive v11"
  docker run --rm --cap-add SYS_ADMIN --device /dev/fuse "$IMG" probe.mjs
  echo
  echo "## image size"
  docker images "$IMG" --format '{{.Size}}'
} 2>&1 | ../../scrub.sh | tee run.log
