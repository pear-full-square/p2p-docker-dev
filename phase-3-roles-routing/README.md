# Phase 3 — roles & routing

*Goal: nodes carry responsibilities by **name**, and requests **route** to the
right node. A name hashes to a topic; a server announces its name's topic, a
client resolves a target name to that topic and connects to whoever serves it —
multi-peer, with a no-peer fallback. Also the first phase to use the thin
observability emitter.*

## What it does

- `node.js` runs as **server** (serves a named service) or **client** (calls one).
- A service **name → 32-byte topic** (`topicFor`) — the routing key.
- **server:** `join(topic, {server})` + an RPC server (`call(cid, payload) → "name: payload"`).
- **client:** hash target → `join(topic, {client})` → connect to the matching
  server → RPC `call(cid, …)`. No connection within 8s → **no-peer fallback** (warn).
- The cluster (`docker-compose.yml`): a bootstrap + **server-greet** + **server-time**
  + three clients calling **greet**, **time**, and **missing**.

A clean session (`session.jsonl`): `client-greet → "greet: ping…"`,
`client-time → "time: ping…"`, `client-missing → no-peer`. Routing is correct
*because each name has its own topic* — a client only matches the server
announcing that name, so it reaches the right peer with no explicit address.

## Observability — the thin emitter, folded in

`log.js` is the **Tier-1 emitter** from the observability design: owned,
pino-schema JSON (`level` / `time` / …context / `msg`), levels
(`info`/`warn`/`error`; `--debug` dials up — the first escalation lever), and
`.child()` to bind context. A **correlation id (`cid`)** is bound onto every line
of a call and appears on **both** peers — the client's `rpc-call`/`rpc-response`
*and* the server's `rpc-serve` — so one operation stitches together across more
than two nodes. `no-peer` is a `warn`; an RPC failure would be an `error`.
(Swappable for `pino-bare` later; env-driven `LOG_LEVEL` arrives once Bare gains
env access — for now `--debug` stands in.)

## Routing model + deferred

- Routing here is **name = topic**: a client reaches a server iff they share the
  name. "Multiple peers serving the *same* name" (load-sharing / failover) and
  richer name→topic schemes are natural extensions.
- **Managed code distribution** — who serves what, pushed as data so nodes pick up
  responsibilities — is Phase 4.

Tag: `phase-3.0`.
