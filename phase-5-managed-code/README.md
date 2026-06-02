# Phase 5 — managed code distribution & responsibilities

*Goal: the cluster becomes **managed**. A manager seeds role-code AND an assignment
manifest into a **signed Hyperdrive**; generic workers — shipping no business logic
— replicate by the **key they trust**, read the manifest to learn **what they run**,
pull their role, and **run it**. Clients call the services, proving the workers run
code distributed to them at runtime. This is where the roadmap invariant becomes
real: **the application owns all runtime code, trust = a signed key.***

## What it does (5.2)

A bootstrap + a **manager** + a generic **worker** assigned *both* roles + a
**client** asking for both services:

1. **manager** derives a Hyperdrive from `CLUSTER_SEED` (the app's signing secret),
   seeds every `roles/*.js` (`echo`, `reverse`) **and `assignments.json`** into it,
   and serves the drive on the private DHT. The drive key is logged — it equals
   `DRIVE_KEY` in `.env`.
2. the **worker** is configured with `DRIVE_KEY` only (never the seed) — and *not*
   told its role. It replicates the drive read-only, reads the **manifest**, looks
   up its own name to **self-assign** (here `["echo","reverse"]`), pulls each role's
   source, and **runs it**. (No-role fallback: a worker absent from the manifest
   stays up and idles.)
3. each pulled **role** stands up an `avsc-rpc` service and serves on its **own
   named protomux channel** — distributed code, multiplexed.
4. the **client** asks for `echo,reverse`, reaches worker-a on **one connection**,
   and opens **one named channel per service** over it. Both reply
   (`echo@worker-a: ping #N`, `reverse@worker-a: 5# gnip`) — proof the managed code
   is live. `session.jsonl`: one `peer-connected`, two `channel-open`, 26
   `rpc-call`/`rpc-serve`/`rpc-response` (13 per service) on the single connection.

```
cd phase-5-managed-code && ./capture.sh     # Ctrl-C to stop; writes a session log
```

## "What runs where" is data (the manifest)

`assignments.json` maps each worker to a role or **array of roles** (here
`{ "worker-a": ["echo","reverse"] }`), seeded into the signed drive at
`/assignments.json`. Placement is **data, distributed in the drive** — not
configuration baked into each worker's launch. Edit the manifest + re-seed to
re-place responsibilities. Because it rides the signed drive, the manifest carries
the same trust as the code. (Live re-assignment — the manager changing the manifest
and workers re-picking-up without a restart — is a later iteration; the worker reads
it once at startup.)

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

## The connection substrate — protomux (5.2)

The worker both **replicates** from the manager and **serves** clients. Mixing
`corestore.replicate(conn)` and avsc-rpc's `createChannel(conn)` on one *raw* stream
would collide — which in 5.1 forced a fragile `info.topics` routing of each
connection to a single purpose, and capped a worker at one role.

5.2 puts everything on **protomux** — the multiplexer Hyperswarm/corestore already
use — so many protocols ride **named channels** over one connection. The worker's
connection handler is now uniform, with no routing decision:

```js
swarm.on('connection', (conn) => {
  store.replicate(conn)              // replication channels — activate only with the manager
  const mux = Protomux.from(conn)    // the same muxer corestore set up
  for (const role of running) role.accept(mux)   // each role accepts its own named channel
})
```

A role is identified by its **channel protocol name**, not by topic. So a worker
runs **many roles at once** (each a named channel), replication rides alongside, and
the `info.topics` hack is gone. avsc-rpc (AVRO) rides a channel via a small
channel↔duplex adapter (`channel.js`). All de-risked in
`probes/avsc-rpc-on-protomux`. This is the substrate spl's many-handlers-per-peer
will inherit in Round 3.

## Open: how a multi-role worker is discovered

5.2 keeps 5.1's **per-service-topic** discovery unchanged (a multi-role worker joins
each of its services' topics; a client finds it per service). The protomux substrate
is **neutral** to this — so the discovery model is a separate, still-open question,
deliberately not settled here. Two candidates under exploration:

- **per-service topic** *(used now)* — discovery stays per service; the worker is
  reachable on each role's topic. Smallest step; no client-side placement lookup.
- **worker identity / a worker topic** — a worker announces *itself*; a client that
  wants several services from one worker addresses the worker and selects services by
  channel name. Fewer topics, gives the worker a first-class identity — but pushes a
  placement lookup onto the client.

Both are live; neither is chosen. (A future single-concern step explores the
worker-identity model.)

## Gotchas pinned (see `probes/`)

- **`libatomic.so.1`** — corestore 7's storage backend (`rocksdb-native`) needs it;
  it is absent from `distroless/cc`. The Dockerfile installs `libatomic1` in the
  build stage and copies the `.so` into the runtime image. Image ~370MB.
- **reader sync** — a replica must call `drive.findingPeers()` before
  `drive.update()`, or the update resolves immediately as "no peers" and the read
  misses the not-yet-replicated content.
- **discovery race** — the client may join a service topic *before* the worker
  announces it (the worker replicates + starts roles first). An initial lookup that
  misses won't re-query on its own for a while, so the client **refreshes its
  discovery** each interval until a provider is found.
- **`corestore.replicate` needs a real protocol stream** — pass the Hyperswarm
  `conn` (a NoiseSecretStream); then `Protomux.from(conn)` for your own channels.
  A home-rolled duplex throws `Invalid Hypercore key`. The channel↔duplex adapter is
  for the RPC payload, *not* the replication transport.

## Scope / what's next

- **5.0** proved the core mechanic: a manager seeds a signed drive, one worker pulls
  + runs one role, a client proves it live.
- **5.1** made placement **data-driven**: multiple workers self-assigning roles from
  the signed manifest, including a shared role.
- **5.2** *(this)* puts the connection on **protomux** (named channels) — so one
  worker runs **multiple roles**, each on its own channel, replication alongside, on
  one connection. Single concern: the substrate + multi-role-per-worker.

Honest scope: roles + manifest physically ship in the shared image too, but each
worker's code path *only ever obtains them by replication* — proving the
distribution path. Deliberately deferred (each a future single-concern step):
**discovery model** (the worker-identity option above), **live re-assignment**
(manager edits the manifest → workers re-pick-up without restart), and true
drive-as-module-root resolution (the deep Pear-loader path). Image tag: `5.2`.
