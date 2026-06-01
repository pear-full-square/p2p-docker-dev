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

The latest phase — **[phase-2-rpc](phase-2-rpc/)** — is a private DHT bootstrap
plus nodes that discover each other, connect over an encrypted P2P stream, and
round-trip an **AVRO RPC** with a correlation id traced across both peers. Run it:

```
cd phase-2-rpc && ./capture.sh     # Ctrl-C to stop; writes a session log
```

## The journey

| Phase | What it establishes |
|-------|---------------------|
| **[phase-0-node-and-monitoring](phase-0-node-and-monitoring/)** | A containerised Bare node + the one-structured-event-stream monitoring substrate (no P2P). |
| **[phase-1-peers-connect](phase-1-peers-connect/)** | Peers discover + connect on a private DHT. Includes the connection investigation: the flat-bridge `firewalled:false` direct-connect finding, with its committed probes. |
| **[phase-2-rpc](phase-2-rpc/)** | avsc-rpc over the swarm — the AVRO RPC layer (the one spl rides) on a P2P duplex; first cross-peer correlation id. |

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
