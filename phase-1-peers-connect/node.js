// Phase 1 — a node joins the cluster topic on the private DHT, connects to
// peers it discovers there, and exchanges a hello over the encrypted (Noise)
// stream Hyperswarm sets up. Structured stdout is the monitoring substrate.
//
//   bare node.js <name> <bootstrap host:port[,host:port]> <topic-name>
const Hyperswarm = require('hyperswarm')
const DHT = require('hyperdht')
const sodium = require('sodium-native')
const Signal = require('bare-signals')

const name = Bare.argv[2] || 'node-0'
const bootstrapArg = Bare.argv[3] || 'bootstrap:49737'
const topicName = Bare.argv[4] || 'spl6-phase1'
const role = Bare.argv[5] || 'both'   // server | client | both (diagnostic)

// 'public' => use the public Holepunch DHT (Hyperswarm defaults); otherwise a
// private DHT reached via the given bootstrap(s).
const usePublic = bootstrapArg === 'public'
const bootstrap = usePublic ? undefined : bootstrapArg.split(',').map((s) => {
  const [host, port] = s.split(':')
  return { host, port: Number(port) }
})

function emit (event, extra = {}) {
  console.log(JSON.stringify({ node: name, event, phase: '1.1', ...extra }))
}

// A topic is a 32-byte id; both nodes hash the same name to the same topic.
const topic = Buffer.alloc(32)
sodium.crypto_generichash(topic, Buffer.from('p2p-docker-dev/' + topicName))
const topicHex = topic.toString('hex').slice(0, 16)

let swarm
if (usePublic) {
  swarm = new Hyperswarm({})
} else {
  // Flat bridge: no NAT between nodes (raw UDX reaches directly), so advertise
  // as directly reachable (firewalled:false) on a fixed port and skip holepunch
  // — peers connect straight to the announced bridge address.
  const dht = new DHT({ bootstrap, firewalled: false, port: 49800 })
  swarm = new Hyperswarm({ dht })
}
emit('start', { topic: topicHex, bootstrap: usePublic ? 'public-dht' : bootstrapArg, direct: !usePublic })

swarm.on('connection', (conn, info) => {
  const remote = info.publicKey.toString('hex').slice(0, 16)
  emit('peer-connected', { remote, client: info.client })
  conn.on('open', () => emit('peer-open', { remote }))
  conn.on('error', (e) => emit('peer-error', { remote, err: String(e.message || e).slice(0, 60) }))
  conn.on('close', () => emit('peer-closed', { remote }))
  conn.on('data', (data) => {
    let msg
    try { msg = JSON.parse(data.toString()) } catch (e) { msg = {} }
    emit('hello-received', { remote, from: msg.hello })
  })
  conn.write(JSON.stringify({ hello: name }))
  emit('hello-sent', { remote })
})

const joinOpts = { server: role !== 'client', client: role !== 'server' }
const discovery = swarm.join(topic, joinOpts)
discovery.flushed().then(() => emit('joined', { topic: topicHex, role }))
emit('swarm-ready', { key: swarm.keyPair.publicKey.toString('hex').slice(0, 16), role })

const sigterm = new Signal('SIGTERM')
sigterm.on('signal', () => { emit('stop'); Bare.exit(0) })
sigterm.start()
