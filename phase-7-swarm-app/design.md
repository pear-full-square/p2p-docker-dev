# Swarm App — Design

The swarm app composes the proven P2P primitives into a user-facing
entrypoint. One container per swarm membership. The container is the
engine; the FUSE drive is the steering wheel.

## Architecture

**Node container** — a general-purpose swarm membership manager. One
container = one swarm membership. Handles connectivity, replication, key
management, drive maintenance, the HTTP API and browser UI. Runs both
bare (for swarm-native code) and Node.js (for FUSE). This is the node as
far as the swarm is concerned. Joining a swarm is as easy as spinning up
a container — no further steps.

**FUSE drive** — the Hyperdrive mounted as a local filesystem, projected
from inside the container to the host (bind mount with shared
propagation). The drive carries everything: apps, the bare binary,
tools (eventually p2p-git). Read-write where needed. The filesystem is
the interface — any language, any runtime, anything that reads and writes
files works.

**Data world view drive** — each node's own Hyperdrive that captures what
the node knows and has done: replicated content, run history, local
state, peer status. The node publishes its state onto this drive. Both
access paths (API and FUSE) expose the same world view. Schema evolves;
for the POC, whatever structure makes the demo legible.

## Two tiers of execution

**Container-side (node internals)** — the swarm connection, replication,
key management, drive maintenance, the HTTP API. Infrastructure that runs
continuously and needs the credentials. Starts with the container, runs
unattended.

**Host-side (user tools)** — git, apps, anything the user interacts with.
Runs from the FUSE drive with bare, operates on files, doesn't need
credentials or a swarm connection. Talks to the node through the
filesystem boundary.

## Filesystem as interface

Apps don't need a ctx with drive objects and swarm connections. An app
is just a program that reads and writes files on the drive.

An app that needs swarm awareness (peer status, connection info) reads
from status files the node maintains on the drive — it doesn't query
the swarm directly. Write results go back as files. The node picks
them up.

The API path is a convenience layer on top of the same model — it reads
and writes on behalf of the app, same boundary, same trust model, just
a different transport.

## Git on the FUSE drive

The git binary (p2p-git) lives on the drive at `/bin/p2p-git`. It
operates on the FUSE-mounted drive as its working tree. Blobs, trees,
commits, refs — all content-addressed files that map naturally onto the
Hyperdrive layout. Git writes through FUSE, the node receives it as a
drive put, signs it, replicates it to the swarm. Git thinks it's writing
to a local filesystem. The node handles the P2P mechanics underneath.

```
cd /mnt/drive
./bin/p2p-git status
./bin/p2p-git commit -m "updated from host"
```

Git operations happen locally (fast, native). Replication happens through
the node (P2P, automatic). This is the Mycelium design — git for mutable
structure, Hypercore for distribution — surfaced as a filesystem.

(Git integration is deferred from the current POC round.)

## Security model

The architecture produces a clean security boundary:

**The container is the trust boundary, not the network.** The node holds
the private keys, the swarm connection, the signing authority. Nothing
reaches the swarm or the keys without passing through a gate the node
controls.

**Untrusted code runs outside (host, via FUSE). Trusted code runs inside
(the node).** The FUSE mount and the API are boundary processes — the
only surfaces the container exposes. At those boundaries, the node can
vet everything:

- A file write through FUSE goes through the mount handler — the node
  can validate content, check permissions, enforce schemas, reject what
  doesn't belong.
- An API call goes through the HTTP handler — same validation before
  acting.

**The private key is protected by process isolation.** Apps never touch
the signing key. An app that writes to the drive says "put this here"
and the node signs it. The key never leaves the node process. Even
swarm-aware apps don't need credentials — they read published state
files, not raw swarm objects.

**Container hardening.** The `privileged: true` for FUSE is the POC
shortcut. Production scopes to `SYS_ADMIN` + `/dev/fuse` only. Further:
minimal image, no shell, read-only root filesystem, dropped capabilities,
non-root user, secrets injected at runtime, signed container images,
restricted Docker socket access.

**Launch integrity.** The container image and compose config specify
exactly what the node can do. The launch process itself can be locked
down and audited.

## What we're not doing yet

- Git integration (architecture supports it, deferred)
- World view schema design (POC uses ad-hoc structure)
- Multi-platform local integration (Linux only)
- Boundary validation / capability scoping (POC has open API)
- Container hardening (POC uses privileged mode)

## POC phases

### Phase 1+2 — Seed node, peer node, browser UI (done)

Two containers: seed (DHT bootstrapper + Hyperdrive host on persistent
volume) and peer (joins swarm, replicates drive). Both serve a browser
UI — seed has a dashboard with node switcher, each node runs an SPA
with drive browser and status views.

### Phase 3 — Apps on the drive, code mobility (done)

App registry on the drive, three demo apps (hello, drive-stats,
peer-ping). `/api/run` endpoint loads app source from the drive, evals
it, runs it with a ctx. Apps tab in the browser UI. Code replicated
from seed to peer and executed on both — code mobility proven.

### Phase 4+5 — FUSE drive, local execution (done)

Container runs both Node.js (for FUSE via fuse-native) and bare (for
swarm). Single process, same drive object, no lock conflicts. FUSE
mount inside the container projected to host via rshared bind mount.
Drive carries the bare binary at `/bin/bare` and executable apps at
`/apps/`. Proven: `ls` the drive from the host, run an app with bare
from the FUSE mount, no install required.

### Phase 6 — Data world view drive

Each node gets its own writable Hyperdrive as a personal ledger. The
node publishes its state there (peers, status, run history). Apps
read/write through the filesystem. Both API and FUSE expose the same
view.

Demo: run an app, see its output on the drive; read peer status from
a file the node maintains.

### Phase 7 — Read-write FUSE, boundary validation

Enable writes through the FUSE mount. The node validates and signs
writes. Demonstrate the boundary: an app writes a result file through
FUSE, the node accepts it, it replicates to the swarm.

Demo: write a file from the host, see it appear on a peer's drive.
