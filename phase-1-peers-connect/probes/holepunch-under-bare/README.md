# probe: holepunch-under-bare

**Question:** does the Holepunch P2P stack — Hyperswarm / HyperDHT and its native
addons (`udx-native`, `sodium-native`) plus `bare-signals` — install via npm,
copy as `node_modules`, and **load + run under Bare** on the cluster's
distroless-cc base? This de-risks Phase 1 (peers connect) before building it.

It also pins down the **API surface** Phase 1 depends on (`DHT.bootstrapper`,
the Hyperswarm methods, the signal handler), so a future upstream change shows
up as a diff against `run.log`.

## Run

```
./run.sh        # builds the probe image, runs probe.js + api.js, writes run.log
```

`run.log` (committed) is the record of the last run — versions, load results,
API surface, image size. The probe image and its `node_modules` are generated
artifacts and are not committed.

## Conclusion

The stack loads cleanly under Bare with no barification — Holepunch ships
Bare-compatible prebuilds. So the cluster bundles these deps the "absorbed at
build time" way (npm install → copy `node_modules` → run under Bare), consistent
with the *application owns all runtime code* invariant. See `run.log` for the
versions this was confirmed against.
