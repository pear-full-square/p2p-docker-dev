# p2p-docker-dev

Round 1 of the SPLectrum P2P POCs: a **managed dev cluster of P2P nodes**,
built straight on **Bare** with native P2P (Hyperswarm / HyperDHT / Hyperdrive).
Each node is a single-concern container; all nodes are monitored via container
**stdout/stderr**. Self-contained on one machine (docker-compose + a private
DHT). Non-spl, non-Pear.

Grown in **phases**, each iterated as needed (git tags mark POC states, e.g.
`phase-0.1`):

- **Phase 0** — runnable node + monitoring *(here)*
- **Phase 1** — peers connect (private DHT)
- **Phase 2** — avsc-rpc over Hyperswarm
- **Phase 3** — roles & routing (name → topic)
- **Phase 4** — managed code distribution & responsibilities

## Phase 0.1 — hello node

A Bare container that emits one structured event line on stdout, then exits.

```
docker build -t p2p-docker-dev:0.1 .
docker run --rm p2p-docker-dev:0.1
```

Expect a JSON event line, e.g. `{"node":"node-0","event":"hello","phase":"0.1"}`.
