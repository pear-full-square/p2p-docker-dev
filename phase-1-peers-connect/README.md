# Phase 1 — peers connect

*Goal: nodes discover and connect over a topic on the **private** DHT, and
exchange a hello over the encrypted stream. First real P2P; first bundled deps.*

## What it does

- `bootstrap.js` — a private DHT bootstrap node (`DHT.bootstrapper(port, host)`),
  the cluster's discovery rendezvous. Bound to a fixed IP on the bridge.
- `node.js` — creates a Hyperswarm on the private DHT, hashes a name to a 32-byte
  topic, `join`s it (server + client), and on each `connection` exchanges a hello
  over the encrypted (Noise) stream.
- Deps (`hyperswarm`, `hyperdht`, `sodium-native`, `bare-signals`) are bundled at
  build time (npm → `node_modules` → run under Bare) — the "absorbed at build
  time" path from the roadmap invariant. Image ~148MB.
- Graceful stop via `bare-signals` (`new Signal('SIGTERM')` → `Bare.exit(0)`),
  so nodes exit 0, not SIGKilled.

A clean session (`session.jsonl`): bootstrap-ready → both nodes
`joined` → both `peer-connected` + `hello-received` (bidirectional) → all `die 0`.

## The connection investigation (why this was not one-shot)

Out of the box, peers **discovered** each other but the connection never
completed: the client fired `peer-connected` then `connection timed out` (~11s);
the server never accepted. A four-step bisect (each kept as a probe) found why:

1. **`probes/holepunch-under-bare`** — the stack loads + runs under Bare. ✓ (not it)
2. **Bare-metal baseline** (two `bare node.js` processes on the WSL host, no
   Docker, public DHT) — **full bidirectional hello**. So our *code is correct*
   and *WSL is fine*. ⇒ Docker is the differentiator.
3. **`probes/connect-via-public-dht`** — two containers on the public DHT (bridged
   *and* `network_mode: host`) never connect. Same-host containers behind one
   outbound NAT is a hard holepunch case; host-mode didn't help. Ambiguous alone.
4. **`probes/udx-on-bridge`** — raw UDX datagrams container→container by IP:port,
   **no DHT**: clean bidirectional ping/pong. So the **bridge passes UDP fine** —
   the network is not the problem.

**Conclusion:** code ✓, WSL ✓, bridge UDP ✓ — the only thing left was **HyperDHT
holepunch coordination**. HyperDHT doesn't connect directly; it runs a holepunch
that assumes NAT traversal. On a flat bridge there is *no NAT between nodes*
(raw UDX reaches directly), so holepunch is both unnecessary and was failing.

## The fix

Tell HyperDHT the node is directly reachable so it **skips holepunch**:

```js
const dht = new DHT({ bootstrap, firewalled: false, port: 49800 })
const swarm = new Hyperswarm({ dht })
```

`firewalled: false` makes the node announce a directly-connectable address; peers
connect straight to the announced bridge address. Result: sub-second bidirectional
connect on the private bridge.

## Learnings worth keeping

- **Same-host peers are a *hard* P2P case, not an easy one** — they share one
  outbound NAT; holepunch to a shared reflexive IP is the hairpin case. The easy
  path is *direct* connect, which a flat bridge supports.
- **On a flat, directly-addressable network, disable holepunch** (`firewalled:
  false`). Holepunch is for NAT traversal; using it where there's no NAT *causes*
  the failure. Real NAT-traversal testing still needs distributed nodes (Ch 8).
- **Bundling deps under Bare is free** for the Holepunch stack (Bare-native
  prebuilds) — `npm install` → copy `node_modules`.
- **Graceful stop:** `bare-signals` + immediate `Bare.exit(0)` exits clean;
  `swarm.destroy()` in the handler can stall and get SIGKILLed — exit directly.

## Deferred

- The app-level `stop` line isn't captured at end-of-session teardown (the live
  log follower is already gone) — daemon `die 0` is the record. Mid-session node
  departures would capture it.
- Multi-peer (>2) topology and name→topic routing are Phase 3.

Tag: `phase-1.0`.
