# p2p-docker-dev

Round 1 of the SPLectrum P2P POCs: building a **managed dev cluster of P2P nodes**
straight on **Bare** (Hyperswarm / HyperDHT / Hyperdrive), one self-contained step
at a time. Containerised single-concern nodes, monitored as one structured event
stream, self-contained on one machine.

This repo is **a sequence of tests leading to a product**, not one evolving
codebase. Each **phase is its own folder** — its own README (the story of that
step), its own code, scripts, config, logs, and de-risking probes. You can drop
into any phase and run *just that step* in isolation. The phases in order are the
journey; the latest is the current product.

## The product, right now

The **swarm app** composes the proven primitives into a user-facing entrypoint:
- **[phase-7-swarm-app](phase-7-swarm-app/)** — two containers: a **seed node**
  (DHT bootstrapper + Hyperdrive host on a persistent volume) and a **peer node**
  (joins the swarm, replicates the drive). Both serve a **browser UI** — the seed
  has a dashboard with a node switcher; each node runs an SPA with drive browser
  and status views. The swarm as a browsable, extensible surface.

Built on the managed-cluster foundation:
- **[phase-5-managed-code](phase-5-managed-code/)** — managed code distribution: a
  manager seeds role-code + a manifest into a signed drive; workers (shipping no
  business logic) replicate by the trusted key, read the manifest to learn **what
  they run**, pull their role, and run it; clients call the services — proving the
  workers run code distributed to them at runtime.

It also demonstrates **both messaging primitives** on the private DHT:
- **[phase-3-roles-routing](phase-3-roles-routing/)** — request/response (RPC):
  nodes serve named services, clients route to them by name (1:1).
- **[phase-4-pubsub-mesh](phase-4-pubsub-mesh/)** — publish/subscribe (mesh): one
  member emits, the others receive, no hub (1:many).

Run any phase from its folder:

```
cd phase-5-managed-code && ./capture.sh     # Ctrl-C to stop; writes a session log
```

## The journey

| Phase | What it establishes |
|-------|---------------------|
| **[phase-0-node-and-monitoring](phase-0-node-and-monitoring/)** | A containerised Bare node + the one-structured-event-stream monitoring substrate (no P2P). |
| **[phase-1-peers-connect](phase-1-peers-connect/)** | Peers discover + connect on a private DHT. Includes the connection investigation: the flat-bridge `firewalled:false` direct-connect finding, with its committed probes. |
| **[phase-2-rpc](phase-2-rpc/)** | avsc-rpc over the swarm — the AVRO RPC layer (the one spl rides) on a P2P duplex; first cross-peer correlation id. |
| **[phase-3-roles-routing](phase-3-roles-routing/)** | **RPC (1:1).** Nodes serve named services; clients route by name → topic → peer (multi-peer, no-peer fallback). Folds in the thin leveled observability emitter. |
| **[phase-4-pubsub-mesh](phase-4-pubsub-mesh/)** | **Pub/sub (1:many).** Every member meshes (server+client); one emits, the others receive — no hub. The contrast to phase-3. |
| **[phase-5-managed-code](phase-5-managed-code/)** | **Managed code distribution.** A manager seeds role-code **+ a signed registry** into a **Hyperdrive**; generic workers replicate by the **trusted key**, self-assign roles, pull and run them (in-memory / checkout). 5.2 puts the connection on **protomux** (named channels → multi-role-per-worker); 5.3 gives each worker a **keyed identity** + **connect-by-key** (target a specific worker). Trust = a signed key; the app owns all runtime code. First use of the storage stack. |
| **[phase-6-reactive-dataflow](phase-6-reactive-dataflow/)** | **Reactive dataflow — the execution-model heart.** A repo reacts to a data-change event (a new append on a subscribed log), processes, and **emits to its own log** — waking the next. Probe proves the cascade under Bare: source → transform → sink, each **live-tailing** (push, not poll), cursors advancing. The last exploratory POC; the over-the-swarm version composes phase-5's replication in Round 3. |
| **[phase-7-swarm-app](phase-7-swarm-app/)** | **Swarm app — the user-facing entrypoint.** Composes proven primitives into two containers: seed node (DHT + Hyperdrive + persistent storage + browser UI) and peer node (join + replicate + browser UI). Dashboard with node switcher on the seed; each node runs an SPA (drive browser, status). The swarm as a browsable surface — extensible for git integration and process execution. |

Each phase folder holds a `README.md` (the journey for that step), the runnable
code + `capture.sh`, a representative scrubbed `session.jsonl`, and any `probes/`
that de-risked it. Scripts are duplicated per phase on purpose, so each phase
stays self-contained and faithful to that step.

## Reusable components

The yield of this repo is not only the journey but a set of **reusable items** —
the node/monitoring pattern, `capture.sh`, `scrub.sh`, the bootstrap, the
RPC-over-swarm wiring. As each proves out, it graduates into a **component in its
own repo** (the way `avsc` / `avsc-rpc` live in `bare-for-pear`). Duplicated here
while still settling; extracted when the reusable shape is clear.

## Conventions

- **Config is parameterised** — addresses/ports/topics live in `.env` (from
  `.env.example`); nothing environment-specific is hardcoded in compose.
- **Committed logs are scrubbed** — `scrub.sh` partially masks IPs and hex ids
  (peer keys, topic hashes) so logs stay correlatable within a run without
  leaking specifics. Probe `run.sh`s pipe through it automatically.
