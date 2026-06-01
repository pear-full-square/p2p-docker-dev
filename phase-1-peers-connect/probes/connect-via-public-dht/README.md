# probe: connect-via-public-dht

**Question (bisect step):** do two containers connect over the **public**
Holepunch DHT — to tell whether the Phase 1 failure is our private single-bootstrap
DHT, or something broader?

Two app nodes in `public` mode (no private bootstrap). Variants:
- `docker-compose.yml` — bridged.
- `docker-compose.host.yml` — `network_mode: host`.

## Run

```
docker compose -f docker-compose.yml      -p p2p-pub  up -d   # bridged
docker compose -f docker-compose.host.yml -p p2p-host up -d   # host net
# ... logs -f --no-log-prefix ... then down
```

## Result (`run.log`)

Neither bridged nor host-net connects — both nodes `join` the topic but never
`peer-connected`. Inconclusive on its own (two same-host containers share one
outbound NAT — a hard hairpin case). The decisive results came from the
**bare-metal baseline** (two `bare` processes on the host *do* connect
bidirectionally → our code is fine) and **`../udx-on-bridge`** (raw UDX on the
bridge works → the network is fine). Net: the blocker is HyperDHT holepunch on a
no-NAT network; fix is `firewalled: false` direct connect. See
`../../README.md`.
