# probe: hyperdrive-replicate-under-bare

**Question:** phase-5 introduces two things the cluster hasn't touched — a
**Hyperdrive** (the manager seeds role-code into one; workers replicate it) and
**pull-and-run** (a worker executes code it didn't ship with). Before building the
phase: does the Holepunch storage stack (`corestore` / `hyperdrive`) load + run
under Bare on the distroless base, does a reader **replicate a drive by key and
read its content**, and can a worker **execute pulled source** under Bare?

Three proofs, isolated from the swarm (transport is already proven in phases 1-4):

- **`replicate.js`** — a writer drive seeds `/roles/echo.js`; a reader opened *from
  the writer's key* replicates over a piped stream and reads the source back,
  byte-for-byte. The drive key is the manager's signing public key, so **trust =
  the signed key** is intrinsic: hypercore verifies every block against it.
- **`exec.js`** — runs the pulled source two ways: **in-memory** (`new Function`,
  no OS disk — the P2P-native leaning, toward the Pear model) and **checkout**
  (`bare-fs` write + `require` — the deliberate bridge into conventional, non-P2P
  execution). Both work.
- **`probe.js` / `api.js`** — versions + the API surface the phase leans on, so an
  upstream change shows up as a diff against `run.log`.

## Run

```
./run.sh        # builds the probe image, runs all four, writes run.log
```

`run.log` (committed, scrubbed) is the record of the last run. The probe image and
its `node_modules` are generated artifacts and are not committed.

## Conclusion

The storage stack loads under Bare with **no barification** — `corestore`/`hyperdrive`
are first-party Pear-native modules (contrast the `avsc` forks, which needed git
clones). Replication-by-key and read work; both execution pathways work. So
phase-5 can be built directly: the manager seeds a signed Hyperdrive, workers
replicate by the trusted key and run the pulled code. Image ~335MB (heavier than
the swarm phases — the storage backend + libatomic). See `run.log` for the
versions this was confirmed against.

**Image gotcha pinned:** corestore 7's storage backend is `rocksdb-native`, whose
addon needs **`libatomic.so.1`** — absent from the `distroless/cc` base (the
swarm/RPC phases never pulled it in). The Dockerfile installs `libatomic1` in the
build stage and copies the `.so` into the runtime image. Without it the storage
stack fails to load (`libatomic.so.1: cannot open shared object file`).

**API gotcha pinned:** a reader must call `drive.findingPeers()` before
`drive.update()` or the update resolves immediately as "no peers, length 0" and the
read misses the not-yet-replicated content.

**Scope note:** in-memory exec passes the host's `require`, so a role's nested
requires resolve against the *worker's* bundled deps (fine under *application owns
all runtime code* — deps absorbed at build time); the drive-as-module-root path
(true Pear-loader resolution) is deferred.
