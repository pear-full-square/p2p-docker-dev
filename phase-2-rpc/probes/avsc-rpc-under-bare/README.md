# probe: avsc-rpc-under-bare

**Question:** does `avsc-rpc` (the bare-for-pear fork — the AVRO RPC layer spl
rides) load and round-trip **under Bare**, now that its package.json declares
real dependencies? De-risks Phase 2 (avsc-rpc over Hyperswarm).

## Background — the module fix

`avsc-rpc` and its peer `avsc` fork shipped package.json with only `{name, main}`
— they resolve in spl6 via the `lib/` symlink, but couldn't be installed
standalone. We own `bare-for-pear`, so the fix went **at the module level**:
declare the real deps (avsc: `bare-crypto`/`fs`/`path`/`stream`; avsc-rpc: the
`avsc` fork + `streamx` + `bare-buffer`/`events`/`stream`), pushed upstream.

## Sourcing — why we clone, not `npm install <git>`

npm's git-dep handling for these non-registry forks is fragile: it normalises
`git+https` GitHub URLs to **ssh** (fails keyless) and hits **cacache tmp
collisions**. So the Dockerfile **clones the forks via anonymous https** into
`node_modules` and npm-installs their registry deps at top level as siblings —
the relative `require('../avsc')` then resolves to `node_modules/avsc`. This is
the sourcing pattern the Phase 2 app image uses too.

## Run

```
./run.sh        # builds, runs probe.js, writes run.log
```

## Result (`run.log`)

`require` ok (avsc-rpc 1.0.0, avsc 5.8.0); in-memory **echo round-trips** under
Bare (`res: "echo:ping"`). avsc-rpc is ready to ride a Hyperswarm duplex —
`server.createChannel(conn)` / `client.createChannel(conn)`, the same call spl
uses over TCP.
