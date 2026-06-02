#!/usr/bin/env bash
# Re-run the probe and refresh run.log (committed). Image + node_modules are
# generated artifacts and are NOT committed — run.log is the record.
set -euo pipefail
cd "$(dirname "$0")"
IMG="reactive-core-probe"
{
  echo "# reactive-core — run $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "## build"
  docker build -t "$IMG" . 2>&1 | tail -4
  echo
  echo "## cascade: source append -> transform reacts+emits -> sink reacts (live tail, push)"
  docker run --rm "$IMG" probe.js
  echo
  echo "## image size"
  docker images "$IMG" --format '{{.Size}}'
} 2>&1 | ../../scrub.sh | tee run.log
