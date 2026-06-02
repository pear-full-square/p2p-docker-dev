# probe: avsc-rpc-on-protomux

**Question:** phase-5.1 routes each connection to exactly one purpose (replicate
*or* the single role's RPC) because mixing `corestore.replicate(conn)` and
avsc-rpc's `createChannel(conn)` on one raw stream collides. That caps a worker at
one role and leans on a fragile `info.topics` check. The proper fix is **protomux**
— the multiplexer Hyperswarm/corestore already use — running each protocol as a
named channel over one connection. Before refactoring phase-5 onto it: does
protomux load under Bare, can **avsc-rpc (AVRO) ride a protomux channel**, and does
**replication coexist with RPC on one connection**?

Two proofs, plus a load/version check:

- **`rpc.js`** — two avsc-rpc services (`echo`, `reverse`) ride two **named protomux
  channels** over one connection. The role is identified by the **channel protocol
  name**, not by topic — this is what kills the `info.topics` hack and unlocks
  multi-role-per-worker. The bridge: avsc-rpc's `createChannel` takes a duplex, so a
  protomux channel is adapted to one (writes → protomux messages; incoming messages
  → readable). AVRO on top, protomux underneath.
- **`coexist.js`** — on a real `@hyperswarm/secret-stream` pair (what a Hyperswarm
  conn is), `store.replicate(conn)` + `Protomux.from(conn)` share one muxer, so a
  drive read and an RPC call both succeed over **one connection**.

## Run

```
./run.sh        # builds the probe image, runs all three, writes run.log
```

`run.log` (committed, scrubbed) is the record of the last run.

## Conclusion

protomux + compact-encoding load under Bare with no barification (they are
first-party Holepunch modules). avsc-rpc rides a protomux channel via a small
channel↔duplex adapter, and replication coexists with RPC on a single connection.
So phase-5.2 adopts protomux as the **connection substrate**:

- on each connection: `store.replicate(conn)`, then `Protomux.from(conn)` to share
  the muxer;
- each role serves on its **own named channel** (accepted by protocol name); a
  client opens the channel for the service it wants;
- replication rides the same connection — no second swarm, no topic-routing.

**Key gotcha pinned:** `corestore.replicate(x)` expects a boolean or a real protocol
stream whose `.noiseStream.userData` is the muxer (it calls
`Hypercore.createProtocolStream`) — passing a bare/home-rolled duplex throws
`Invalid Hypercore key`. The pattern is `store.replicate(conn)` on the **real
NoiseSecretStream**, then `Protomux.from(conn)` for your own channels — never
pre-wrap a plain duplex. The channel↔duplex adapter is for the **RPC payload**, not
for the replication transport. (libatomic + storage stack as in the hyperdrive
probe; this is the substrate spl's many-handlers-per-peer will inherit in Round 3.)
