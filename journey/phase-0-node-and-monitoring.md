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
