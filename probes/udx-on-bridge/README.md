# probe: udx-on-bridge

**Question:** can one container reach another by IP:port over **UDX** (the exact
transport HyperDHT uses) on the Docker bridge, with **no DHT** involved? This is
the ground-truth network test for the Phase 1 connection investigation.

One container echoes UDX datagrams; the other pings it by IP and waits for a
`pong`. The echo script (`udx-echo.js`) is mounted into the app image, which
already carries `udx-native`.

## Run

```
./run.sh        # builds the app image if needed, runs ~8s, writes a scrubbed run.log
```

Config (subnet / server IP / port / app image) is in `.env` — `run.sh` creates it
from `.env.example` if missing.

## Result (`run.log`)

Clean bidirectional ping/pong — the bridge passes container-to-container UDP
fine. So the Phase 1 connection failure was **not** the network; it was HyperDHT
holepunch coordination (fixed with `firewalled: false` direct connect — see
`../../journey/phase-1-peers-connect.md`).
