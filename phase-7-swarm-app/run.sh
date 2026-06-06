#!/bin/bash
# Phase 7 — swarm app launcher.
#
# First run:  ./run.sh init   — build, start seed, derive DRIVE_KEY into .env
# Normal:    ./run.sh          — start seed + peer
# Stop:      ./run.sh down
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || cp .env.example .env

case "${1:-up}" in
  init)
    echo "=== Building containers..."
    docker compose build

    echo "=== Starting seed node to derive drive key..."
    docker compose up -d seed
    sleep 3

    DRIVE_KEY=$(docker logs swarm-seed 2>&1 | grep '"event":"drive-ready"' | sed 's/.*"driveKey":"\([^"]*\)".*/\1/')
    if [ -z "$DRIVE_KEY" ]; then
      echo "ERROR: could not read drive key from seed logs"
      docker logs swarm-seed 2>&1
      exit 1
    fi
    echo "DRIVE_KEY=$DRIVE_KEY"
    sed -i "s/^DRIVE_KEY=.*/DRIVE_KEY=$DRIVE_KEY/" .env

    docker compose down
    echo "=== Init complete. DRIVE_KEY written to .env. Run './run.sh' to start."
    ;;
  up)
    docker compose up seed peer
    ;;
  down)
    docker compose down
    ;;
  logs)
    docker compose logs -f
    ;;
  clean)
    docker compose down -v
    ;;
  *)
    echo "usage: $0 [init|up|down|logs|clean]"
    ;;
esac
