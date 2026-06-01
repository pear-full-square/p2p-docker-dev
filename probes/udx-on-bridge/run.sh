#!/usr/bin/env bash
# Run the udx-on-bridge probe and refresh run.log (committed, scrubbed). Builds
# the app image (it carries udx-native) if missing.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || cp .env.example .env
set -a; . ./.env; set +a

docker image inspect "$APP_IMAGE" >/dev/null 2>&1 || docker build -t "$APP_IMAGE" ../.. >/dev/null
docker compose -p p2p-udx up -d >/dev/null 2>&1
raw="$(mktemp)"
timeout 8 docker compose -p p2p-udx logs -f --no-log-prefix >"$raw" 2>&1 || true
docker compose -p p2p-udx down >/dev/null 2>&1
{
  echo "# udx-on-bridge — run $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  cat "$raw"
} | ../../scrub.sh | tee run.log
rm -f "$raw"
