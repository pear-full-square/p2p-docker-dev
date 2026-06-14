#!/bin/bash
# Run the swarm. Ctrl-C to stop.
# First run: start platform alone to get the drive key, then add to .env.
#   docker compose up platform    # read driveKey from the log
#   # paste driveKey into .env as DRIVE_KEY
#   docker compose up             # both containers
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example — start platform alone first to get the drive key."
fi

docker compose build
docker compose up "$@"
