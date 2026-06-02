# Phase 5 — managed code distribution & responsibilities

*Goal: the cluster becomes **managed**. A manager seeds role-code AND an assignment
manifest into a **signed Hyperdrive**; generic workers — shipping no business logic
— replicate by the **key they trust**, read the manifest to learn **what they run**,
pull their role, and **run it**. Clients call the services, proving the workers run
code distributed to them at runtime. This is where the roadmap invariant becomes
real: **the application owns all runtime code, trust = a signed key.***

## What it does (5.3)

A bootstrap + a **manager** + **two workers** (both running `echo`) + a **client**
that targets one of them *by identity*:

1. **manager** derives a Hyperdrive from `CLUSTER_SEED`, seeds every `roles/*.js`,
   derives each worker's **identity keypair** (`H(CLUSTER_SEED‖name)` → `DHT.keyPair`),
   and seeds a signed **registry** `/registry.json` = `name → { key, roles }`. The
   drive key is logged — it equals `DRIVE_KEY` in `.env`.
2. each **worker** is handed only *its own* derived identity secret (never the seed).
   Its swarm runs under that keypair, so it is **reachable by key**. It replicates the
   drive, reads the registry to **self-assign** its roles, pulls them, and serves each
   on its own named protomux channel.
3. the **client** replicates the drive, reads the registry, **resolves worker-b's
   public key**, and connects to it directly with `swarm.joinPeer` — **no service
   topic**. It opens the `echo` channel over that connection and calls.
4. every reply is `echo@worker-b` and **worker-a serves nothing** — proof that
   connect-by-key reached the *specific* targeted node, not "any echo provider".
   `session.jsonl`: client `resolve` → `target` → `reached-target` → 13 RPC triples,
   all on worker-b; worker-a has zero `rpc-serve`.

```
cd phase-5-managed-code && ./capture.sh     # Ctrl-C to stop; writes a session log
```

## "What runs where" is data — the signed registry

`assignments.json` (authored) maps each worker to a role or **array of roles**. The
manager combines it with each worker's **derived public key** into a signed
**registry** `/registry.json` = `name → { key, roles }`, seeded into the drive. It
does double duty: **placement** (which roles a worker runs) *and* **directory** (how
to reach a worker by key). Workers read their roles from it; the client resolves a
target worker's key from it. Because it rides the signed drive, it carries the same
trust as the code. Edit `assignments.json` + re-seed to re-place responsibilities.
(Live re-assignment without a restart is a later step; it's read once at startup.)

## Worker identity & connect-by-key (5.3)

Each worker has a **keyed identity**: its secret is `H(CLUSTER_SEED ‖ name)` (derived
by the manager and handed to the worker; the seed itself never leaves the manager, H
being one-way), and its swarm runs under the matching keypair — so it is reachable at
its public key. The manager independently derives the *same* public key for the
registry, so they match without any registration round-trip.

**Targeting a specific worker** is then the base op `swarm.joinPeer(publicKey)` —
a direct connection to *that* node, independent of any topic. This is why both
workers can run `echo` yet the client deterministically reaches worker-b: it resolves
worker-b's key from the registry and connects by key, rather than discovering "any
echo provider". HyperDHT's core primitive is connect-to-key; topic discovery (used
for the drive and, in earlier iterations, services) is the discover-many layer above
it. De-risked in `probes/connect-by-key`.

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

## Two addressing modes — both now realized

We treat addressing as *building blocks*, not a single chosen design. Both modes now
exist in the cluster, for different needs:

- **service-addressed** (per-service topic; phases 3–5.2) — "find *any* provider of
  `echo`". Anycast; good for interchangeable, stateless work and spreading a service
  across workers.
- **identity-addressed** (connect-by-key; 5.3) — "reach *worker-b* specifically".
  Unicast to a named node; the base op for management, state, and per-node
  responsibility — and the more foundational of the two (HyperDHT's core primitive).

The registry binds them: a worker's identity key sits next to its roles, so a
service call can resolve through the registry to a worker key and become a
connect-by-key. The protomux substrate is neutral to *how* you found the node.

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
- **5.2** put the connection on **protomux** (named channels) — one worker runs
  **multiple roles**, each on its own channel, replication alongside, on one
  connection. (The substrate still stands; the 5.3 default topology just assigns one
  role each to keep the targeting demo crisp.)
- **5.3** *(this)* gives each worker a **keyed identity** and adds **connect-by-key**
  — the base "target a specific worker" op, with the manager publishing a signed
  registry of `name → {key, roles}`. Single concern: identity + targeting.

Honest scope: roles + registry physically ship in the shared image too, but each
worker's code path *only ever obtains them by replication* — proving the
distribution path. Deliberately deferred (each a future single-concern step, tracked
in `plan/p2p-building-blocks.md`): **live re-assignment** (manager edits the manifest
→ workers re-pick-up without restart), **pub/sub over protomux**, membership/health,
mutable shared structure (Hyperbee/Autobase), and true drive-as-module-root execution
(the deep Pear-loader path). Image tag: `5.3`.
