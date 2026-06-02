# probe: reactive-core

**Question:** the Mycelium execution model rests on one mechanic — *a repo reacts to a
data-change event, where the event is a new append on a log it subscribes to*, and its
own output is an append that wakes the next repo. Two things must hold under Bare: a
subscriber is **pushed** new appends over replication (not polling), and the reaction
can **emit to its own log**, cascading. This proves both — and the cursor (resumability)
that comes with it.

The probe runs a two-hop cascade: **source** appends events → **transform** live-tails
source, reacts, and emits a derived record to *its own* log → **sink** live-tails
transform and reacts. Two real replication hops (piped streams stand in for swarm
connections — swarm replication of cores is already proven in phase-5). `run.log` shows
appends and reactions interleaving in near-real-time, the cascade completing, and the
cursor (`contiguousLength`) advancing per stage.

## Run

```
./run.sh        # builds the probe image, runs the cascade, writes run.log
```

## Conclusion

The reactive core works under Bare: `core.createReadStream({ live: true })` yields each
append **as it arrives** (push), the reaction emits to the next log, and the cascade
flows — *data through logs, computation triggered by arrival*. The **offset is the
cursor** (`contiguousLength`), so each stage is resumable/replayable. This is the heart
of the streaming execution model (`plan/mycelium-streaming-layer.md`) and it **subsumes
live-reassignment** (M2 — "watch the manifest log, re-pick-up" is one instance of this).

**Scope.** This isolates the new mechanism in-process; the over-the-swarm version is
*composition* — phase-5 already replicates cores over the swarm (`store.replicate(conn)`),
so a distributed cascade is "this, with the piped streams replaced by swarm
connections." That lands in **Round 3**, where the records flowing are spl's real
stream-records rather than toy events — not a separate scaffolding exercise.

**Note (pinned):** `corestore.get({ keyPair })` namespaces the key (core.key ≠
keyPair.publicKey), so for *predictable* keys across peers use raw `Hypercore` with an
explicit keyPair (as here) — or distribute the corestore-derived key out-of-band. Only
relevant when a downstream peer must know an upstream's key ahead of time.
