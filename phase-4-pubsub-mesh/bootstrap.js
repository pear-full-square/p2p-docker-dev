// Phase 3 — a private DHT bootstrap node (the cluster's discovery rendezvous;
// not a code source). Uses the thin pino-schema emitter like the other nodes.
//
//   bare bootstrap.js <port> <host>
const DHT = require('hyperdht')
const Signal = require('bare-signals')
const makeLog = require('./log')

// host must be a concrete IPv4 the node advertises and binds (dht-rpc rejects
// 0.0.0.0/:: and non-IPv4) — on the cluster it's the bootstrap's static IP.
const port = Number(Bare.argv[2]) || 49737
const host = Bare.argv[3] || '127.0.0.1'

const log = makeLog({ node: 'bootstrap', phase: '4.0' })

const node = DHT.bootstrapper(port, host)
log.info({ event: 'start', port, host })
node.ready().then(() => log.info({ event: 'bootstrap-ready', port, host }))

const sigterm = new Signal('SIGTERM')
sigterm.on('signal', () => { log.info({ event: 'stop' }); Bare.exit(0) })
sigterm.start()
