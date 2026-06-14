# spl7 phase 1 — master data view on the swarm

The first spl7 POC step. A platform node initialises a swarm and seeds the
master data view — the six-folder tree structure designed in spl7
(`plan/master-data-view.md`). A joining node replicates the tree sparsely
via Hyperdrive.

## What it proves

- The designed tree structure (packages, modules, components, config, home,
  swarm) materialises as real Hyperdrive content
- A joining node receives the full structure via sparse P2P replication
- FUSE mounts expose the tree on the host filesystem
- The `_meta` metadata convention works (underscore-prefixed entries as the
  metadata dimension)

## The tree

```
/
  packages/_meta       available software catalog
  modules/_meta        installed software on this node
  components/_meta     SPLectrum component catalog
  config/_meta         runtime/execution configuration
  config/identity      node identity (role, drive key)
  home/_meta           own space — component instances
  swarm/_meta          full swarm data view
```

Each top-level folder carries a `_meta` file (underscore-prefixed = metadata
dimension, per the URI naming scheme). The platform node populates config
with its identity. Joining nodes get the full structure via replication.

## Two containers

**Platform node** — the swarm origin. Bootstraps a private DHT, creates a
Hyperdrive on persistent storage, seeds the master data view tree, and
serves it to peers. Equivalent to the seed node from phase-7, but with a
designed tree instead of ad-hoc content.

**Joining node** — connects to the swarm, replicates the drive sparsely,
verifies the tree arrived by reading each folder's `_meta`. Equivalent to
the peer node from phase-7, receiving a Mycelium structure instead of apps.

## Running

```bash
# First run — get the drive key
cp .env.example .env
docker compose build
docker compose up platform
# Read driveKey from the JSON log output, paste into .env as DRIVE_KEY
# Ctrl-C, then:

docker compose up          # both containers
```

## FUSE (optional)

To see the tree as a mounted filesystem on the host:

```bash
sudo mount --make-rshared /                                            # WSL2 prerequisite
docker compose -f docker-compose.yml -f docker-compose.fuse.yml up     # with FUSE
```

Then browse:

```bash
ls mnt/platform/drive/     # platform's view
ls mnt/node/drive/         # joining node's replicated view
cat mnt/node/drive/config/identity
```

## Structured output

Both containers emit JSON lines to stdout (the monitoring pattern from all
phases). Key events:

- `tree-seeded` — platform finished seeding the six-folder structure
- `tree-contents` — full file listing from the drive
- `synced` — joining node finished initial replication
- `folder-meta` — joining node read a folder's `_meta` (verification)
- `platform-identity` — joining node read the platform's identity
- `fuse-mounted` — FUSE drive projected to host

## What's next

spl7-phase-2: wire the mycelium module (select/get/put/remove) against this
Hyperdrive-backed tree — XPath navigation on the swarm's data surface.
