# probe: observability-under-bare

**Question:** which observability building blocks actually run **under Bare**, and
do the Holepunch modules we bundle ship instrumentation we can tap for free?

Tests `pino-bare` (leveled structured logging) and `hypertrace` (within-process
tracing) under Bare on distroless-cc, and checks whether `hyperswarm` / `hyperdht`
/ `hypercore` / `dht-rpc` declare a `hypertrace` dependency.

## Run

```
./run.sh        # builds the probe image, runs probe.js, writes run.log
```

## Result (`run.log`)

- **pino-bare** — works; standard pino JSON (`level`/`time`/`msg`), child loggers
  carry bound context. Maintenance is light (early-stage).
- **hypertrace** — works (v1.4.2); trace fn receives `{id, object, parentObject,
  caller}`. **Within-process only** (no cross-peer correlation).
- **Holepunch stack is NOT hypertrace-instrumented** at the versions we bundle —
  so hypertrace would trace *our* classes, not hyperswarm internals.

Feeds the parent project's operational-visibility design.
