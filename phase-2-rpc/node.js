// Phase 2 — avsc-rpc over the Hyperswarm stream.
//
// A node joins the cluster topic on the private DHT (Phase 1), then rides the
// encrypted connection with an AVRO RPC channel — the same `createChannel(conn)`
// spl uses over TCP, now over a P2P duplex. The request carries a correlation id
// (cid): the SAME cid appears in both peers' event streams — the first
// cross-peer trace (Tier-1 of the observability design).
//
//   bare node.js <name> <bootstrap host:port|public> <topic-name> <server|client>
const Hyperswarm = require('hyperswarm')
const DHT = require('hyperdht')
const sodium = require('sodium-native')
const Signal = require('bare-signals')
const { Service } = require('avsc-rpc')

const name = Bare.argv[2] || 'node-0'
const bootstrapArg = Bare.argv[3] || 'bootstrap:49737'
const topicName = Bare.argv[4] || 'spl6-phase2'
const role = Bare.argv[5] || 'server'

function emit (event, extra = {}) {
  console.log(JSON.stringify({ node: name, event, phase: '2.0', ...extra }))
}

// The RPC contract: echo(cid, message) -> string. cid is the correlation id
// threaded through the call so the two peers' streams can be stitched together.
const service = Service.forProtocol({
  protocol: 'Echo',
  namespace: 'spl6.poc',
  messages: {
    echo: {
      request: [{ name: 'cid', type: 'string' }, { name: 'message', type: 'string' }],
      response: 'string'
    }
  }
})

// Flat bridge: no NAT between nodes, so advertise directly reachable and skip
// holepunch (Phase 1 finding).
const usePublic = bootstrapArg === 'public'
const bootstrap = usePublic ? undefined : bootstrapArg.split(',').map((s) => {
  const [host, port] = s.split(':'); return { host, port: Number(port) }
})
const swarm = usePublic
  ? new Hyperswarm({})
  : new Hyperswarm({ dht: new DHT({ bootstrap, firewalled: false, port: 49800 }) })

const topic = Buffer.alloc(32)
sodium.crypto_generichash(topic, Buffer.from('p2p-docker-dev/' + topicName))
emit('start', { topic: topic.toString('hex').slice(0, 16), role })

if (role === 'client') {
  let n = 0
  swarm.on('connection', (conn, info) => {
    const remote = info.publicKey.toString('hex').slice(0, 16)
    emit('peer-connected', { remote })
    conn.on('error', () => {})
    const client = service.createClient({ buffering: true })
    client.createChannel(conn)
    const cid = name + '-' + (n++)
    emit('rpc-call', { remote, cid, message: 'ping' })
    client.echo(cid, 'ping from ' + name, (err, res) => {
      if (err) return emit('rpc-error', { cid, err: String(err.message || err).slice(0, 80) })
      emit('rpc-response', { remote, cid, res })
    })
  })
  swarm.join(topic, { server: false, client: true })
} else {
  const server = service.createServer()
  server.onEcho((cid, message, cb) => {
    emit('rpc-serve', { cid, message })
    cb(null, 'echo:' + message)
  })
  swarm.on('connection', (conn, info) => {
    const remote = info.publicKey.toString('hex').slice(0, 16)
    emit('peer-connected', { remote })
    conn.on('error', () => {})
    server.createChannel(conn)
    emit('rpc-channel', { remote })
  })
  swarm.join(topic, { server: true, client: false })
}

const sigterm = new Signal('SIGTERM')
sigterm.on('signal', () => { emit('stop'); Bare.exit(0) })
sigterm.start()
