#!/bin/bash
set -euo pipefail

for mp in "${FUSE_MOUNT:-}"; do
  if [ -n "$mp" ]; then
    fusermount -u "$mp" 2>/dev/null || true
    rm -rf "$mp" 2>/dev/null || true
    mkdir -p "$mp"
  fi
done

exec node "$@"
