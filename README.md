# p2p-docker-dev

Round 1 of the SPLectrum P2P POCs: a **managed dev cluster of P2P nodes**,
built straight on **Bare** with native P2P (Hyperswarm / HyperDHT / Hyperdrive).
Each node is a single-concern container; all nodes are monitored via container
**stdout/stderr**. Self-contained on one machine (docker-compose + a private
DHT). Non-spl, non-Pear.

It's built in the open, one phase at a time. Each phase is a goal; iterations
(0.1, 0.2, …) grow it until it's met, marked by git tags (e.g. `phase-0.1`):

- **Phase 0** — runnable node + monitoring ✓
- **Phase 1** — peers connect (private DHT) ✓
- **Phase 2** — avsc-rpc over Hyperswarm *(here)*
- **Phase 3** — roles & routing (name → topic)
- **Phase 4** — managed code distribution & responsibilities

## Running it now (Phase 2)

A private DHT bootstrap + an RPC server node + an RPC client node. The client
round-trips an **AVRO RPC** (`avsc-rpc`) over the encrypted P2P stream; captured
as **one structured event stream**:

```
./capture.sh        # Ctrl-C to stop, remove the containers, and finish the log
```

You get a `logs/session-*.jsonl` covering the whole life of the cluster — daemon
`create`/`start`, `bootstrap-ready`, `peer-connected`, the RPC exchange
(`rpc-call` → `rpc-serve` → `rpc-response`), then `die`/`destroy`. Each RPC
carries a **correlation id** (`cid`) that appears in both peers' streams — the
first cross-peer trace. See
[`journey/phase-2-session.jsonl`](journey/phase-2-session.jsonl) for a sample and
[the Phase 2 writeup](journey/phase-2-rpc.md).

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
