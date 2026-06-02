// Phase 5 — the CLIENT. The end-to-end proof: it calls the services and gets
// replies — but nothing shipped them. A worker pulled the role-code from the
// manager's signed drive and ran it.
//
// 5.2 — the client can ask for SEVERAL services (comma-separated). When they live
// on the same worker, the client reaches it on ONE connection and opens ONE NAMED
// protomux channel per service over that single connection — the multi-role payoff:
// many logical services, one stream, no collision.
//
//   bare client.js <name> <bootstrap host:port|public> <svc[,svc...]> [--debug]
const Hyperswarm = require('hyperswarm')
const DHT = require('hyperdht')
const Protomux = require('protomux')
const sodium = require('sodium-native')
const Signal = require('bare-signals')
const { Service } = require('avsc-rpc')
const { channelStream } = require('./channel')
const makeLog = require('./log')

const name = Bare.argv[2] || 'client-0'
const bootstrapArg = Bare.argv[3] || 'bootstrap:49737'
const services = (Bare.argv[4] || 'echo').split(',')

const log = makeLog({ node: name, phase: '5.2' })

const svc = Service.forProtocol({
  protocol: 'Call', namespace: 'spl6.poc',
  messages: { call: { request: [{ name: 'cid', type: 'string' }, { name: 'payload', type: 'string' }], response: 'string' } }
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

const clients = {}   // service -> avsc client (one named channel each)

swarm.on('connection', (conn, info) => {
  log.info({ event: 'peer-connected', remote: info.publicKey.toString('hex').slice(0, 16) }, 'connected to a provider')
  conn.on('error', () => {})
  const mux = Protomux.from(conn)
  // Open one named channel per requested service over this single connection.
  for (const service of services) {
    if (clients[service]) continue
    const client = svc.createClient({ buffering: true })
    client.createChannel(channelStream(mux, service))
    clients[service] = client
    log.info({ event: 'channel-open', service }, `opened '${service}' channel`)
  }
})

const discoveries = services.map((service) => {
  log.info({ event: 'route', service, topic: topicFor(service).toString('hex').slice(0, 16) }, `routing to '${service}'`)
  return swarm.join(topicFor(service), { server: false, client: true })
})

let seq = 0
const iv = setInterval(() => {
  const ready = services.filter((s) => clients[s])
  if (ready.length === 0) { log.debug({ event: 'idle' }, 'no provider yet — refreshing'); discoveries.forEach((d) => d.refresh().catch(() => {})); return }
  for (const service of ready) {
    const cid = name + '-' + service + '-' + seq
    log.info({ event: 'rpc-call', service, cid }, `calling '${service}'`)
    clients[service].call(cid, 'ping #' + seq, (err, res) => {
      if (err) log.error({ event: 'rpc-error', service, cid, err: String(err.message || err).slice(0, 80) })
      else log.info({ event: 'rpc-response', service, cid, res }, 'got response from managed code')
    })
  }
  seq++
}, 3000)

const sigterm = new Signal('SIGTERM')
sigterm.on('signal', async () => { clearInterval(iv); log.info({ event: 'stop' }); await swarm.destroy(); Bare.exit(0) })
sigterm.start()
