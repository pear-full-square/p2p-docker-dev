// Phase 1 — a private DHT bootstrap node.
//
// The cluster's discovery rendezvous: peers find each other through it, then
// connect directly. It is NOT a code source — provenance never rides the swarm
// (see the roadmap invariant). Self-contained: this is our own DHT, not the
// public one, so the cluster runs offline and deterministic.
//
//   bare bootstrap.js <port> <host>
const DHT = require('hyperdht')
const Signal = require('bare-signals')

// host must be a concrete IPv4 the node advertises and binds (dht-rpc rejects
// 0.0.0.0/:: and non-IPv4) — on the cluster it's the bootstrap's static IP.
const port = Number(Bare.argv[2]) || 49737
const host = Bare.argv[3] || '127.0.0.1'

function emit (event, extra = {}) {
  console.log(JSON.stringify({ node: 'bootstrap', event, phase: '2.0', ...extra }))
}

const node = DHT.bootstrapper(port, host)
emit('start', { port, host })
node.ready().then(() => emit('bootstrap-ready', { port, host }))

const sigterm = new Signal('SIGTERM')
sigterm.on('signal', () => { emit('stop'); Bare.exit(0) })
sigterm.start()
