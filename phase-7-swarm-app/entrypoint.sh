#!/bin/bash
# Node container entrypoint — runs the swarm node under node.js.
# Single process: swarm + HTTP API + FUSE mount (if FUSE_MOUNT is set).
set -euo pipefail

FUSE_MOUNT="${FUSE_MOUNT:-}"
if [ -n "$FUSE_MOUNT" ]; then
  mkdir -p "$(dirname "$FUSE_MOUNT")"
  mkdir -p "$FUSE_MOUNT"
fi

exec node "$@"
