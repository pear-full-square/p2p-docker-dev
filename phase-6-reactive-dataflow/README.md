# Phase 6 — reactive dataflow (the execution-model heart)

*The Mycelium execution model: a repo computes by **reacting to data-change events** —
a new append on a log it subscribes to — processing locally and **emitting to its own
log**, whose append wakes the next repo. Data flows through logs; computation is
triggered by arrival. This phase proves that core.*

## What's here

- **[probes/reactive-core](probes/reactive-core/)** — the core mechanism, proven under
  Bare on distroless: a two-hop cascade (**source** appends → **transform** live-tails
  + reacts + emits → **sink** live-tails + reacts). `core.createReadStream({ live: true })`
  is **pushed** each append as it arrives (not polling), the reaction cascades, and the
  **offset is the cursor** (`contiguousLength`) so each stage is resumable/replayable.

This is the one load-bearing assumption the streaming design rested on
(`plan/mycelium-streaming-layer.md`), and it **subsumes live-reassignment** (M2 —
"watch the manifest log, re-pick-up" is just one instance of "react to a subscribed
log").

## Over the swarm = composition, not new scaffolding

The probe isolates the *new* mechanism in-process (piped replication). The distributed
version is composition: **phase-5 already replicates cores over the swarm**
(`store.replicate(conn)` + connect-by-key), so a cluster-wide cascade is "this, with
the piped streams replaced by swarm connections." That is deliberately deferred to
**Round 3**, where the records flowing are spl's real **stream-records** rather than toy
events — so the in-cluster demonstrator is built once, on the real fabric, not twice.

## Why this is the last exploratory POC

With the reactive core proven, every load-bearing primitive the native-P2P-Mycelium
design leans on is now demonstrated under Bare (see `plan/p2p-building-blocks.md`):
identity + connect-by-key, protomux multi-channel, replication, code mobility, native
git, and now reactive dataflow. The honest next move is the **Mycelium build (Round 3)**
— spl's fabric composed from these primitives, validated against the fs/TCP oracle —
not more POCs. Remaining open cells (retention/availability, membership/health,
fs-over-Hyperdrive shim, Autobase/shared-reality) are build-it-when-needed engineering
or deferred, not exploratory de-risking.
