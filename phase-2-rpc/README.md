# Phase 2 — avsc-rpc over the swarm

*Goal: the AVRO RPC layer (`avsc-rpc` — the one spl rides) travels over a
Hyperswarm duplex unchanged. Round-trip a real RPC over the encrypted P2P stream.
First cross-peer operation; first correlation id.*

## What it does

Builds on Phase 1's connection (private DHT, `firewalled:false` direct connect).
Defines an Echo RPC service `echo(cid, message) → string`, then:

- **server role:** on each connection, `server.createChannel(conn)` + an `onEcho`
  handler that echoes.
- **client role:** on each connection, `client.createChannel(conn)` + `client.echo(cid, …)`.

The whole game is one call — **`createChannel(conn)`** — the exact call spl uses
over TCP (`spl/avsc-rpc/server`), now on a P2P duplex. "Same protocol, different
pipe," demonstrated. A clean session (`session.jsonl`): connect →
`rpc-channel` → `rpc-call` → `rpc-serve` → `rpc-response` (`echo:ping from node-b`).

## First correlation id (Tier-1 observability)

The request carries a **cid** (correlation id). In the sample, `cid: "node-b-0"`
appears in **both** peers' streams — node-b's `rpc-call`/`rpc-response` *and*
node-a's `rpc-serve`. That's the first **cross-peer trace**: stitch one operation
together from separate nodes' logs. Here it's a simple per-call id; it settles
into the protocol/seam model as the fabric matures.

## Sourcing the RPC layer (the real work)

`avsc-rpc` isn't on npm — it and its `avsc` fork live in `bare-for-pear`, and
shipped package.json with only `{name, main}`, so neither installed standalone.
We own `bare-for-pear`, so the fix went **at the module level** (declared real
deps, pushed upstream). And because npm's git-dep handling for these forks is
fragile (ssh normalization, cacache collisions), the image **clones them via
anonymous https** into `node_modules` as siblings + npm-installs their registry
deps. De-risked in `probes/avsc-rpc-under-bare`. Image ~179MB.

## Deferred

- A richer service than echo — spl's `execute(StreamRecord) → StreamRecord` is Round 3.
- Multi-peer routing (name → topic) is Phase 3.

Tag: `phase-2.0`.
