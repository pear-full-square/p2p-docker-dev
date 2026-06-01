# Phase 4 — publish/subscribe over a mesh

*Goal: the **other** messaging primitive — one node emits, the others receive —
for contrast with phase-3's request/response. No hub: every member joins the
topic as both server+client, the swarm meshes them, and a publish goes to every
live connection.*

## The contrast (why this exists alongside phase-3)

| | phase-3 — RPC | phase-4 — pub/sub mesh |
|---|---|---|
| shape | request/response, **1:1** | publish/fan-out, **1:many** |
| topology | client → server (one announcer) | every peer server+client (**full mesh**) |
| who connects | client dials the serving peer | everyone dials everyone |
| "send" | call a named service, get a reply | write a line to all live connections |
| correlation | one `cid`, two peers | one `cid`, **many** receivers |
| RPC layer | yes (`avsc-rpc`) | **no** — just connections + JSON lines |

Both are foundational: RPC is *ask one peer and get an answer*; pub/sub is *emit
an event and everyone subscribed hears it* — the shape a stream/record fabric
leans on.

## What it does

- Every node `join(topic, {server:true, client:true})` → Hyperswarm meshes all
  members (each connects to every other).
- Holds a `peers` set of live connections — the local subscriber set.
- Publishes a **line-delimited JSON** message to all peers every 3s.
- On `data`, splits on newlines and logs `received` `{from, cid, text}`.
- Cluster (`docker-compose.yml`): a bootstrap + `member-a` / `b` / `c` on topic
  `events`. Each publishes; each receives the other two — verified in `session.jsonl`
  (e.g. `member-c-0` is `published` by member-c and `received` by a *and* b).

## Why mesh, not hub

In Hyperswarm `server` = *announce*, `client` = *look up*, and a link needs one
announcer + one looker. With **every** member `{server:true, client:true}`, all
peers find and connect to all — no relay, no single point. The alternative is a
**hub-relay** (clients `client`-only, one `server`-only announcer fanning out);
phase-3's named-server shape leans that way, but for pure pub/sub the mesh is
simpler and more P2P-native.

Logging uses the same thin emitter as phase-3 (`log.js`). Image ~148MB (lighter —
no RPC layer). Tag: `phase-4.0`.
