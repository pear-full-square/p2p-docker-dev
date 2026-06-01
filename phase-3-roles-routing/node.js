// Phase 3 — roles & routing.
//
// A node either SERVES a named service or CALLS one. The name is hashed to a
// 32-byte topic; a server announces (joins) its name's topic, a client resolves a
// target name to that topic and connects to whoever serves it — routing by name,
// with a no-peer fallback when nobody serves it. Logging is the thin pino-schema
// emitter (./log): leveled, with a correlation id (cid) bound onto every line of
// a call via .child(), so one operation stitches together across both peers.
//
//   bare node.js <name> <bootstrap host:port|public> <server|client> <service-name> [--debug]
const Hyperswarm = require('hyperswarm')
const DHT = require('hyperdht')
const sodium = require('sodium-native')
const Signal = require('bare-signals')
const { Service } = require('avsc-rpc')
const makeLog = require('./log')

const name = Bare.argv[2] || 'node-0'
const bootstrapArg = Bare.argv[3] || 'bootstrap:49737'
const role = Bare.argv[4] || 'server'
const serviceName = Bare.argv[5] || 'echo'

const log = makeLog({ node: name, phase: '3.0' })

// One generic RPC contract; routing is by topic (which peer you reach), not method.
const svc = Service.forProtocol({
  protocol: 'Call',
  namespace: 'spl6.poc',
  messages: {
    call: { request: [{ name: 'cid', type: 'string' }, { name: 'payload', type: 'string' }], response: 'string' }
  }
})

// A service name maps to a 32-byte swarm topic — this is the routing key.
function topicFor (n) {
  const t = Buffer.alloc(32)
  sodium.crypto_generichash(t, Buffer.from('p2p-docker-dev/svc/' + n))
  return t
}

const usePublic = bootstrapArg === 'public'
const bootstrap = usePublic ? undefined : bootstrapArg.split(',').map((s) => {
  const [host, port] = s.split(':'); return { host, port: Number(port) }
})
const swarm = usePublic
  ? new Hyperswarm({})
  : new Hyperswarm({ dht: new DHT({ bootstrap, firewalled: false, port: 49800 }) })

const topic = topicFor(serviceName)
const topicHex = topic.toString('hex').slice(0, 16)

if (role === 'server') {
  log.info({ event: 'serve', service: serviceName, topic: topicHex }, `serving '${serviceName}'`)
  const server = svc.createServer()
  server.onCall((cid, payload, cb) => {
    log.info({ event: 'rpc-serve', service: serviceName, cid }, `handled '${serviceName}' call`)
    cb(null, `${serviceName}: ${payload}`)
  })
  swarm.on('connection', (conn, info) => {
    log.info({ event: 'peer-connected', remote: info.publicKey.toString('hex').slice(0, 16) })
    conn.on('error', () => {})
    server.createChannel(conn)
  })
  swarm.join(topic, { server: true, client: false })
} else {
  const cid = name + '-0'
  const call = log.child({ target: serviceName, cid })   // correlation context for this call
  call.debug({ event: 'resolve', topic: topicHex }, `resolved '${serviceName}' to a topic`)
  call.info({ event: 'route', topic: topicHex }, `routing to '${serviceName}'`)
  let answered = false
  swarm.on('connection', (conn, info) => {
    if (answered) return
    call.info({ event: 'peer-connected', remote: info.publicKey.toString('hex').slice(0, 16) })
    conn.on('error', () => {})
    const client = svc.createClient({ buffering: true })
    client.createChannel(conn)
    call.info({ event: 'rpc-call' }, `calling '${serviceName}'`)
    client.call(cid, 'ping from ' + name, (err, res) => {
      answered = true
      if (err) call.error({ event: 'rpc-error', err: String(err.message || err).slice(0, 80) })
      else call.info({ event: 'rpc-response', res }, 'got response')
    })
  })
  swarm.join(topic, { server: false, client: true })
  const t = setTimeout(() => {
    if (!answered) call.warn({ event: 'no-peer' }, `no peer serving '${serviceName}' within timeout`)
  }, 8000)
  if (t.unref) t.unref()
}

const sigterm = new Signal('SIGTERM')
sigterm.on('signal', () => { log.info({ event: 'stop' }); Bare.exit(0) })
sigterm.start()
