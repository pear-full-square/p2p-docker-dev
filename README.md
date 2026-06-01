# p2p-docker-dev

Round 1 of the SPLectrum P2P POCs: a **managed dev cluster of P2P nodes**,
built straight on **Bare** with native P2P (Hyperswarm / HyperDHT / Hyperdrive).
Each node is a single-concern container; all nodes are monitored via container
**stdout/stderr**. Self-contained on one machine (docker-compose + a private
DHT). Non-spl, non-Pear.

It's built in the open, one phase at a time. Each phase is a goal; iterations
(0.1, 0.2, …) grow it until it's met, marked by git tags (e.g. `phase-0.1`):

- **Phase 0** — runnable node + monitoring ✓
- **Phase 1** — peers connect (private DHT) *(here)*
- **Phase 2** — avsc-rpc over Hyperswarm
- **Phase 3** — roles & routing (name → topic)
- **Phase 4** — managed code distribution & responsibilities

## Running it now (Phase 1)

A private DHT bootstrap + two nodes that join a topic, connect, and exchange a
hello over the encrypted stream — captured as **one structured event stream**:

```
./capture.sh        # Ctrl-C to stop, remove the containers, and finish the log
```

You get a `logs/session-*.jsonl` covering the whole life of the cluster — daemon
`create`/`start`, `bootstrap-ready`, each node's `join` / `peer-connected` /
`hello-received`, then `die`/`destroy` on teardown — merged chronologically.
Every line is `{"ts","source":"app"|"daemon","node","event",…}`; see
[`journey/phase-1-session.jsonl`](journey/phase-1-session.jsonl) for a sample.

Key detail: on the flat bridge there's no NAT between nodes, so nodes run the DHT
with `firewalled: false` and connect **directly** (holepunch is for NAT traversal
and would otherwise fail here — see
[the Phase 1 writeup](journey/phase-1-peers-connect.md)). The image bundles the
Holepunch stack under Bare (~148MB, no Node).

`probes/` holds the committed de-risking experiments (Holepunch-under-Bare, raw
UDX on the bridge, public-DHT bisect) — each re-runnable with a committed run log.

## The journey

So the path — from the first hello node to a managed P2P cluster — stays
legible, each phase is logged as its own page: what it set out to do, what got
built, and the decisions behind it.

- [Phase 0 — runnable node + monitoring](journey/phase-0-node-and-monitoring.md)
