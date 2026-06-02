#!/usr/bin/env bash
# Re-run the probe and refresh run.log (committed). The image and node_modules it
# builds are generated artifacts and are NOT committed — run.log is the record.
set -euo pipefail
cd "$(dirname "$0")"
IMG="hyperdrive-replicate-under-bare-probe"
{
  echo "# hyperdrive-replicate-under-bare — run $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "## build"
  docker build -t "$IMG" . 2>&1 | tail -4
  echo
  echo "## load + versions (probe.js)"
  docker run --rm "$IMG" probe.js
  echo
  echo "## api surface (api.js)"
  docker run --rm "$IMG" api.js
  echo
  echo "## replicate by key + read (replicate.js)"
  docker run --rm "$IMG" replicate.js
  echo
  echo "## execute pulled code — both pathways (exec.js)"
  docker run --rm "$IMG" exec.js
  echo
  echo "## image size"
  docker images "$IMG" --format '{{.Size}}'
} 2>&1 | ../../scrub.sh | tee run.log
