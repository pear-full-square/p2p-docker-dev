# p2p-docker-dev

Round 1 of the SPLectrum P2P POCs: a **managed dev cluster of P2P nodes**,
built straight on **Bare** with native P2P (Hyperswarm / HyperDHT / Hyperdrive).
Each node is a single-concern container; all nodes are monitored via container
**stdout/stderr**. Self-contained on one machine (docker-compose + a private
DHT). Non-spl, non-Pear.

It's built in the open, one phase at a time. Each phase is a goal; iterations
(0.1, 0.2, …) grow it until it's met, marked by git tags (e.g. `phase-0.1`):

- **Phase 0** — runnable node + monitoring *(here)*
- **Phase 1** — peers connect (private DHT)
- **Phase 2** — avsc-rpc over Hyperswarm
- **Phase 3** — roles & routing (name → topic)
- **Phase 4** — managed code distribution & responsibilities

## Running it now (Phase 0.2)

A few long-running Bare nodes, captured as **one structured event stream**:

```
./capture.sh        # Ctrl-C to stop, remove the containers, and finish the log
```

You get a `logs/session-*.jsonl` covering the whole life of the cluster — daemon
`create`/`start`, each node's `start`/`heartbeat`, then `die`/`destroy` on
teardown — merged chronologically. Every line is
`{"ts","source":"app"|"daemon","node","event",…}`; see
[`journey/phase-0.2-session.jsonl`](journey/phase-0.2-session.jsonl) for a sample.

Just watch them live, no capture:

```
docker compose up        # node-a / node-b / node-c heartbeating
```

The image is a slim multi-stage build — the Bare runtime on a minimal
distroless-cc base, no Node (~118MB). No P2P yet: this is the monitoring
substrate the swarm will be watched through. See the journey log for the why.

## The journey

So the path — from the first hello node to a managed P2P cluster — stays
legible, each phase is logged as its own page: what it set out to do, what got
built, and the decisions behind it.

- [Phase 0 — runnable node + monitoring](journey/phase-0-node-and-monitoring.md)
