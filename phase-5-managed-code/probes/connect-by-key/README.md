# probe: connect-by-key

**Question:** the worker-identity step (5.3) gives each worker a keyed identity and
adds the base **"target a specific worker"** op. Before building it: under Bare, is a
worker's identity keypair **deterministically derivable** from the cluster seed + its
name (so the manager can publish keys while a worker holds only its own secret), and
can a client **reach a specific node by its public key** (`joinPeer`) with **no shared
topic**?

- **derive** — `keyPair = DHT.keyPair(H(clusterSeed || name))`; same name → same key,
  distinct names → distinct keys. The seed (one-way hashed) never leaves the manager.
- **connect-by-key** — a keyed server joined to an *unrelated* topic; a client with no
  shared topic calls `swarm.joinPeer(serverPublicKey)` and connects to exactly that
  node (verified by matching the connection's remote key to the target).

## Run

```
./run.sh        # builds the probe image, runs both proofs, writes run.log
```

## Conclusion

Both work under Bare on the swarm stack (already proven to load in phase-1).
`joinPeer(publicKey)` is the base addressing primitive — HyperDHT's core op is
connect-to-key; topic discovery is the discover-many layer on top. So 5.3 gives each
worker a derived identity keypair (its swarm uses it), the manager publishes
name → public-key in a signed **registry** on the drive, and a client resolves a
target worker's key from the registry and connects to it directly — independent of
which services it serves. This is the management foundation (reach a *specific* node)
and matches how spl will address peers in Round 3.
