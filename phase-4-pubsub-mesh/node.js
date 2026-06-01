// Phase 4 — publish/subscribe over a mesh.
//
// Contrast with phase-3 (request/response RPC, 1:1 through a service). Here every
// node joins the topic as BOTH server+client, so Hyperswarm meshes them all
// together — no hub, no relay. "Publish" = write a line to every live connection;
// every other member receives it. One emits, the others receive — directly.
//
// A message carries a correlation id (cid); it appears on the publisher's
// `published` line and on each receiver's `received` line — fan-out correlation
// (one cid → many receivers), vs phase-3's 1:1.
//
//   bare node.js <name> <bootstrap host:port|public> <topic-name> [--debug]
const Hyperswarm = require('hyperswarm')
const DHT = require('hyperdht')
const sodium = require('sodium-native')
const Signal = require('bare-signals')
const makeLog = require('./log')

const name = Bare.argv[2] || 'node-0'
const bootstrapArg = Bare.argv[3] || 'bootstrap:49737'
const topicName = Bare.argv[4] || 'events'

const log = makeLog({ node: name, phase: '4.0' })

function topicFor (n) {
  const t = Buffer.alloc(32)
  sodium.crypto_generichash(t, Buffer.from('p2p-docker-dev/pubsub/' + n))
  return t
}

const usePublic = bootstrapArg === 'public'
const bootstrap = usePublic ? undefined : bootstrapArg.split(',').map((s) => {
  const [host, port] = s.split(':'); return { host, port: Number(port) }
})
const swarm = usePublic
  ? new Hyperswarm({})
  : new Hyperswarm({ dht: new DHT({ bootstrap, firewalled: false, port: 49800 }) })

const topic = topicFor(topicName)
const topicHex = topic.toString('hex').slice(0, 16)

const peers = new Set()   // live connections — the subscriber set, held locally

function publish (obj) {
  const line = JSON.stringify(obj) + '\n'
  for (const conn of peers) conn.write(line)
}

swarm.on('connection', (conn, info) => {
  const remote = info.publicKey.toString('hex').slice(0, 16)
  peers.add(conn)
  log.info({ event: 'peer-up', remote, peers: peers.size })
  conn.on('error', () => {})
  conn.on('close', () => { peers.delete(conn); log.info({ event: 'peer-down', remote, peers: peers.size }) })
  let buf = ''
  conn.on('data', (data) => {
    buf += data.toString()
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch (e) { continue }
      log.info({ event: 'received', from: msg.from, cid: msg.cid, text: msg.text }, `received from ${msg.from}`)
    }
  })
})

// MESH: announce AND look up — every member connects to every other.
swarm.join(topic, { server: true, client: true })
log.info({ event: 'joined', topic: topicHex }, `mesh on '${topicName}'`)

// Publish to all current peers on an interval.
let seq = 0
const iv = setInterval(() => {
  if (peers.size === 0) { log.debug({ event: 'idle' }, 'no peers yet'); return }
  const cid = name + '-' + seq
  publish({ from: name, cid, text: 'hello #' + seq })
  log.info({ event: 'published', cid, to: peers.size }, `published to ${peers.size} peer(s)`)
  seq++
}, 3000)

const sigterm = new Signal('SIGTERM')
sigterm.on('signal', () => { clearInterval(iv); log.info({ event: 'stop' }); Bare.exit(0) })
sigterm.start()
