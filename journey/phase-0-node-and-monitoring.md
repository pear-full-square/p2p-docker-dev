# Phase 0 — runnable node + monitoring

*Goal: a containerised Bare node you can run and watch — no P2P yet. This is
the foundation everything else stands on: a node, and a way to see it.*

## 0.1 — a node that speaks

`hello.js` is the smallest possible node: a Bare process that emits **one
structured event line** on stdout, then exits.

```js
const name = Bare.argv[2] || 'node-0'
console.log(JSON.stringify({ node: name, event: 'hello', phase: '0.1' }))
```

The design choice here is **structured stdout** — one JSON object per line. It's
how the rig (and later an agent) observes every node uniformly, with no extra
transport. The whole cluster's monitoring is built on this convention, so it's
worth fixing from the very first node.

Tag: `phase-0.1`.

## 0.1.1 — a slim image

The first image was **389MB** (a full `node` base). Slimmed to **118MB** with no
change in behaviour:

- **Multi-stage build.** `node:22-slim` is used *only* to fetch the Bare runtime
  (`npm install -g bare`); nothing from Node ships in the final image. The actual
  runtime is a single prebuilt binary, copied across.
- **distroless-cc base.** `ldd` on the Bare linux-x64 binary shows it's
  glibc-dynamic (`libc` / `libm` / `libstdc++` / `libgcc`). It needs glibc +
  libstdc++ — which rules out scratch / busybox / alpine (musl or static). The
  minimal fit is `distroless/cc-debian12`.
- **The ~94MB floor** is the Bare binary itself: it embeds a JS engine. Only a
  from-source QuickJS / static build would shrink it further — not worth it at
  this stage.

Tag: `phase-0.1.1`.

## 0.2 — a watchable cluster, one log stream

The one-shot node became **long-running** (`node.js`): it emits a `start` line,
then a `heartbeat` every interval, until it's stopped. `docker-compose.yml` runs a
few of them (node-a / b / c) at different intervals, each with **`init: true`** —
tini at PID 1, so `compose down` / `docker stop` (SIGTERM) reaches Bare and the
node exits cleanly and fast (exit **143**). Without it, Bare-as-PID-1 *ignores*
SIGTERM (the kernel applies no default disposition to PID 1) and the container is
SIGKILLed only after the 10s grace — the classic PID-1 problem.

`capture.sh` records a session as **one structured event stream** spanning the
whole life of the cluster — startup → output → removal:

- **App stdout** (`start` / `heartbeat`) is tailed *live* — container logs vanish
  on `down`, so they have to be caught while running.
- **Daemon lifecycle** (`create` / `start` / `kill` / `die` / `destroy`, with exit
  codes) is queried from `docker events` *after* teardown — the daemon retains
  recent events, so the removal is never missed. (A live listener dies with the
  same Ctrl-C and pipe-buffering drops the last events; querying after is the
  robust path.)
- Both carry timestamps and are merged + sorted into one `logs/session-*.jsonl`.

Every line is `{"ts", "source":"app"|"daemon", "node", "event", …}`. The daemon
source is authoritative for *came up / went away* (incl. the `die` exit code); the
app source is *what the node did*. A representative run is kept at
[`phase-0.2-session.jsonl`](phase-0.2-session.jsonl) — and this JSONL shape is the
basis for Round-2's automated test analysis. *(Forward view: this same
"containerised node + one structured event stream" is the foundation for managed,
monitored swarms.)*

Deferred to Phase 1 (where we bundle `node_modules` for Hyperswarm anyway): an
app-level graceful `stop` line via `bare-signals`. Until then the daemon's
`die` / `destroy` is the authoritative record of a node leaving.

Tag: `phase-0.2`.
