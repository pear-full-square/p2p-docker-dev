#!/usr/bin/env bash
# scrub — partially mask volatile / internal values in a log stream before it is
# committed. Masks:
#   • IPv4 addresses        172.28.0.10        -> 172.x.x.x     (keep 1st octet)
#   • long hex tokens       5a83716b3304d4db   -> ************d4db   (peer keys,
#                                                       topic hashes, container ids)
# Hex tokens are masked like a card/account number — front starred, last 4 kept.
# IPs keep the network and mask the host (the reverse — the host is the sensitive
# part). Pure-digit numbers (timestamps, uptimes, ports) are left intact, and the
# JSON stays valid + readable. The same value always masks the same way and
# distinct values keep distinct tails — so it stays correlatable within a run,
# just not reusable outside it.
#
#   ./scrub.sh logs/session-XYZ.jsonl > journey/phase-N-session.jsonl
#   ./scrub.sh probes/foo/run.log | sponge probes/foo/run.log
set -euo pipefail
perl -pe '
  s/\b(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/$1.x.x.x/g;
  s/\b([0-9a-f]{12,})\b/ my $t=$1; $t =~ \/[a-f]\/ ? ("*" x (length($t)-4)).substr($t,-4) : $t /ge;
' "$@"
