# Phase 5 — managed code distribution & responsibilities

*Goal: the cluster becomes **managed**. A manager seeds role-code into a **signed
Hyperdrive**; a generic worker — shipping no business logic — replicates the drive
by the **key it trusts**, pulls a role, and **runs it**. A client then calls the
service, proving the worker is running code distributed to it at runtime. This is
where the roadmap invariant becomes real: **the application owns all runtime code,
trust = a signed key.***

## What it does

A bootstrap + a **manager** + a generic **worker** + a **client**:

1. **manager** derives a Hyperdrive from `CLUSTER_SEED` (the app's signing secret),
   seeds `roles/echo.js` into it, and serves the drive on the private DHT. The
   drive's key is logged — it equals the `DRIVE_KEY` in `.env`.
2. **worker** is configured with `DRIVE_KEY` only (never the seed). It replicates
   the drive read-only, **pulls** `/roles/echo.js`, and **runs** it — picking up a
   responsibility from code it did not ship with.
3. the pulled **role** stands up the same `avsc-rpc` echo service phase-3 served —
   but as *distributed* code.
4. **client** calls `echo` and logs `echo@worker-a: ping #N`. A response is proof
   the managed code is live (see `session.jsonl`: `role-pulled` → `role-loaded` →
   `role-serving`, then 11 `rpc-call`/`rpc-serve`/`rpc-response` triples).

```
cd phase-5-managed-code && ./capture.sh     # Ctrl-C to stop; writes a session log
```

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

## Scope of 5.0 / what's next

5.0 proves the core mechanic: one manager, one role, one worker, one client. Honest
scope: the role physically ships in the shared image too, but the worker's code path
*only ever obtains it by replication* — proving the distribution path. The
**data-driven assignment manifest** ("what runs where", multiple roles, multiple
workers self-assigning) is 5.1; the fuller managed capstone is 5.2. True
drive-as-module-root resolution (the deep Pear-loader path) stays deferred. Image
tag: `5.0`.
