// Phase 5 — the CLIENT. The end-to-end proof: it calls the 'echo' service and gets
// a reply — but nothing shipped that service. The worker pulled the role-code from
// the manager's signed drive and started it. A successful response is proof the
// managed code is live on the worker.
//
//   bare client.js <name> <bootstrap host:port|public> <service-name> [--debug]
const Hyperswarm = require('hyperswarm')
const DHT = require('hyperdht')
const sodium = require('sodium-native')
const Signal = require('bare-signals')
const { Service } = require('avsc-rpc')
const makeLog = require('./log')

const name = Bare.argv[2] || 'client-0'
const bootstrapArg = Bare.argv[3] || 'bootstrap:49737'
const serviceName = Bare.argv[4] || 'echo'

const log = makeLog({ node: name, phase: '5.0' })

const svc = Service.forProtocol({
  protocol: 'Call',
  namespace: 'spl6.poc',
  messages: {
    call: { request: [{ name: 'cid', type: 'string' }, { name: 'payload', type: 'string' }], response: 'string' }
  }
})

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
let client = null
let seq = 0

swarm.on('connection', (conn, info) => {
  log.info({ event: 'peer-connected', remote: info.publicKey.toString('hex').slice(0, 16) }, `connected to '${serviceName}' provider`)
  conn.on('error', () => {})
  client = svc.createClient({ buffering: true })
  client.createChannel(conn)
})

const discovery = swarm.join(topic, { server: false, client: true })
log.info({ event: 'route', service: serviceName, topic: topic.toString('hex').slice(0, 16) }, `routing to '${serviceName}'`)

const iv = setInterval(() => {
  // Re-query the DHT until a provider is found — the worker may announce the
  // service AFTER the client's first lookup (it replicates+starts the role first),
  // and an initial lookup that misses won't re-query on its own for a while.
  if (!client) { log.debug({ event: 'idle' }, 'no provider yet — refreshing lookup'); discovery.refresh().catch(() => {}); return }
  const cid = name + '-' + seq
  log.info({ event: 'rpc-call', cid }, `calling '${serviceName}'`)
  client.call(cid, 'ping #' + seq, (err, res) => {
    if (err) log.error({ event: 'rpc-error', cid, err: String(err.message || err).slice(0, 80) })
    else log.info({ event: 'rpc-response', cid, res }, 'got response from managed code')
  })
  seq++
}, 3000)

const sigterm = new Signal('SIGTERM')
sigterm.on('signal', async () => { clearInterval(iv); log.info({ event: 'stop' }); await swarm.destroy(); Bare.exit(0) })
sigterm.start()
