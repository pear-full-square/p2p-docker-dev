#!/usr/bin/env bash
# Re-run the probe and refresh run.log (committed). Image + node_modules are
# generated artifacts and are NOT committed — run.log is the record.
set -euo pipefail
cd "$(dirname "$0")"
IMG="isomorphic-git-under-bare-probe"
{
  echo "# isomorphic-git-under-bare — run $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "## build"
  docker build -t "$IMG" . 2>&1 | tail -4
  echo
  echo "## version"
  docker run --rm --entrypoint /usr/local/bin/bare "$IMG" -e "console.log(require('isomorphic-git/package.json').version)" 2>/dev/null || true
  echo
  echo "## local git flow under Bare (init / add / commit x2 / log / checkout-reconstruct)"
  docker run --rm "$IMG" probe.mjs
  echo
  echo "## image size"
  docker images "$IMG" --format '{{.Size}}'
} 2>&1 | ../../scrub.sh | tee run.log
