#!/bin/bash
# Node container entrypoint — runs the swarm node under node.js.
# Single process: swarm + HTTP API + FUSE mounts.
set -euo pipefail

for mp in "${FUSE_MOUNT:-}" "${FUSE_WORLD_MOUNT:-}"; do
  if [ -n "$mp" ]; then
    fusermount -u "$mp" 2>/dev/null || true
    rm -rf "$mp" 2>/dev/null || true
    mkdir -p "$mp"
  fi
done

exec node "$@"
