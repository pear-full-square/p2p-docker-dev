#!/usr/bin/env bash
# Phase 0.2 — capture one cluster session as a single structured event stream.
#
# Merges two sources into one timestamped JSONL file:
#   • each node's own structured stdout — start / heartbeat        (source:"app")
#   • the Docker daemon's lifecycle     — create/start/die/destroy  (source:"daemon")
#
# App stdout is captured LIVE (container logs vanish on `compose down`). The
# daemon timeline is queried AFTER teardown (the daemon retains recent events),
# so die/destroy are never missed and carry the daemon's own event time. Every
# line is {"ts":"<utc>","source":..., ...}; the file is sorted chronologically
# at the end and is the basis for Round-2 test analysis.
#
# Usage:  ./capture.sh        # Ctrl-C to stop, remove the containers, finish the log
set -euo pipefail
cd "$(dirname "$0")"

PROJECT="p2p-docker-dev"
mkdir -p logs
LOG="logs/session-$(date +%Y%m%d-%H%M%S).jsonl"
START="$(date +%s)"
ts() { date -u +%Y-%m-%dT%H:%M:%S.%3NZ; }

finalize() {
  trap '' INT TERM EXIT
  printf '\n[capture] tearing down (removing containers) ...\n'
  docker compose -p "$PROJECT" down >/dev/null 2>&1 || true

  # Daemon lifecycle, authoritative, queried after the fact (teardown included),
  # tagged with the daemon's own event time so it interleaves correctly.
  docker events --since "$START" --until "$(( $(date +%s) + 2 ))" \
    --filter "label=com.docker.compose.project=${PROJECT}" --filter "type=container" \
    --format '{{.TimeNano}}|{{index .Actor.Attributes "name"}}|{{.Action}}|{{index .Actor.Attributes "exitCode"}}' \
  | while IFS='|' read -r nano name action ec; do
      sec=$(( nano / 1000000000 )); ms=$(( (nano / 1000000) % 1000 ))
      iso="$(date -u -d "@${sec}" +%Y-%m-%dT%H:%M:%S).$(printf '%03d' "$ms")Z"
      printf '{"ts":"%s","source":"daemon","node":"%s","event":"%s","exit":"%s"}\n' \
        "$iso" "$name" "$action" "$ec"
    done >> "$LOG"

  sort -o "$LOG" "$LOG"   # every line starts {"ts":"<iso>" -> lexical sort == chronological
  printf '[capture] session log -> %s\n' "$LOG"
}
trap finalize INT TERM EXIT

printf '[capture] session log -> %s\n' "$LOG"
printf '[capture] starting cluster — Ctrl-C to stop, remove, and finish the log\n\n'

docker compose -p "$PROJECT" up --build -d

# App stdout (already JSON, no compose prefix) -> tag with ts + source, live.
docker compose -p "$PROJECT" logs -f --no-log-prefix \
| while IFS= read -r l; do
    [ -z "$l" ] && continue
    case "$l" in
      \{*) printf '{"ts":"%s","source":"app",%s\n' "$(ts)" "${l#\{}" | tee -a "$LOG" ;;
      *)   printf '{"ts":"%s","source":"app","raw":"%s"}\n' "$(ts)" "$l" | tee -a "$LOG" ;;
    esac
  done
