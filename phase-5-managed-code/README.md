# Phase 5 — managed code distribution & responsibilities

*Goal: the cluster becomes **managed**. A manager seeds role-code AND an assignment
manifest into a **signed Hyperdrive**; generic workers — shipping no business logic
— replicate by the **key they trust**, read the manifest to learn **what they run**,
pull their role, and **run it**. Clients call the services, proving the workers run
code distributed to them at runtime. This is where the roadmap invariant becomes
real: **the application owns all runtime code, trust = a signed key.***

## What it does (5.1)

A bootstrap + a **manager** + three generic **workers** + two **clients**:

1. **manager** derives a Hyperdrive from `CLUSTER_SEED` (the app's signing secret),
   seeds every `roles/*.js` (`echo`, `reverse`) **and `assignments.json`** into it,
   and serves the drive on the private DHT. The drive key is logged — it equals
   `DRIVE_KEY` in `.env`.
2. each **worker** is configured with `DRIVE_KEY` only (never the seed) — and *not*
   told its role. It replicates the drive read-only, reads the **manifest**, looks
   up its own name to **self-assign** a role, pulls that role's source, and **runs
   it**. (No-role fallback: a worker absent from the manifest stays up and idles.)
3. the pulled **role** stands up an `avsc-rpc` service (the same shape phase-3
   served) — but as *distributed* code.
4. **clients** call their service and log e.g. `echo@worker-a: ping #N` /
   `reverse@worker-b: 5# gnip`. A response is proof the managed code is live.

The manifest places `echo` on **worker-a + worker-c** and `reverse` on **worker-b**
— so `session.jsonl` shows `client-echo` connecting to *both* echo workers
(many-workers-one-role) while `reverse` runs on its own.

```
cd phase-5-managed-code && ./capture.sh     # Ctrl-C to stop; writes a session log
```

## "What runs where" is data (the manifest)

`assignments.json` (`{ "worker-a": "echo", "worker-b": "reverse", "worker-c":
"echo" }`) is seeded into the signed drive at `/assignments.json`. Placement is
**data, distributed in the drive** — not configuration baked into each worker's
launch. Edit the manifest + re-seed to re-place responsibilities. Because it rides
the signed drive, the manifest carries the same trust as the code. (Live
re-assignment — the manager changing the manifest and workers re-picking-up without
a restart — is a later iteration; 5.1 reads it once at startup.)

## Trust = a signed key (intrinsic, not bolted on)

A Hyperdrive is backed by a signed Hypercore, so the **drive's key is the manager's
public key**. A worker configured to trust that key gets signature verification on
every replicated block for free — it can only ever materialize and run code the
holder of the seed authored. The DHT is a discovery rendezvous, never a code
source. The seed → key derivation is **deterministic** (`corestore` with a fixed
`primaryKey`), so the trust anchor is reproducible and configurable ahead of time —
the same way a Pear app is trusted by its known key.

## The execution pathway — the design frame

A worker pulls a role as a **source string**; how it runs it is the choice that
sets the phase's direction (`EXEC` in `.env`):

| `EXEC` | mechanism | role |
|--------|-----------|------|
| `memory` *(default)* | `new Function(src)` — code never touches the OS disk | the **P2P-native** leaning, toward the eventual **Pear model** (an app runs out of its drive) |
| `checkout` | `bare-fs` write to a checkout dir + `require()` | the deliberate **bridge into the non-P2P world** — testing, hybrid deployments, running pulled code in an ordinary runtime |

Both are proven in-cluster. The aim is the Pear-native model; materialize-to-checkout
is a first-class escape hatch, not a crutch — a worker pulling code from a drive and
materializing it to run is the *"filesystem as a derived checkout"* idea (the
streaming-fabric direction) in miniature.

## Topology note — one swarm, two connection purposes

The worker both **replicates** from the manager and **serves** the client on one
Hyperswarm. Mixing `corestore.replicate(conn)` and avsc-rpc's `createChannel(conn)`
on one raw stream would collide, so connections are **routed by topic**: a peer
found on the drive's discovery key is the manager (replicate the store); any other
peer is a service client (handed to the role's RPC server). The worker *dials* the
manager, so that connection's `PeerInfo.topics` carries the drive topic; client
connections fall to the service branch.

## Gotchas pinned (see `probes/hyperdrive-replicate-under-bare`)

- **`libatomic.so.1`** — corestore 7's storage backend (`rocksdb-native`) needs it;
  it is absent from `distroless/cc`. The Dockerfile installs `libatomic1` in the
  build stage and copies the `.so` into the runtime image. Image ~335MB.
- **reader sync** — a replica must call `drive.findingPeers()` before
  `drive.update()`, or the update resolves immediately as "no peers" and the read
  misses the not-yet-replicated content.
- **discovery race** — the client may join the service topic *before* the worker
  announces it (the worker replicates + starts the role first). An initial lookup
  that misses won't re-query on its own for a while, so the client **refreshes its
  discovery** each interval until a provider is found.

## Scope / what's next

- **5.0** proved the core mechanic: a manager seeds a signed drive, one worker pulls
  + runs one role, a client proves it live.
- **5.1** *(this)* makes placement **data-driven**: multiple roles, multiple workers
  self-assigning from the signed manifest, including a shared role.

Honest scope: roles + manifest physically ship in the shared image too, but each
worker's code path *only ever obtains them by replication* — proving the
distribution path. **One role per worker** here: a single worker serving *multiple*
service topics on one swarm reintroduces the connection-routing ambiguity (incoming
client connections don't carry the topic), so multi-role-per-worker is deferred (it
needs per-role connection routing — e.g. a swarm per role). **Live re-assignment**
(manager edits the manifest → workers re-pick-up without restart) and true
drive-as-module-root resolution (the deep Pear-loader path) also stay deferred.
Image tag: `5.1`.
