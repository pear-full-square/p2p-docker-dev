// Seed node — DHT bootstrapper + Hyperdrive host in one process.
//
// The always-on infrastructure: bootstraps a private DHT (the rendezvous point)
// and hosts a signed Hyperdrive on persistent storage (Corestore on a volume).
// Peers join the swarm, replicate the drive, and get the contents.
//
//   bare seed.js <seedHex> <bootstrapPort> <bootstrapHost> [--http <port>] [--url <externalUrl>]
const DHT = require('hyperdht')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const Signal = require('bare-signals')
const b4a = require('b4a')
const { startServer } = require('../ui/http')

const seedHex = Bare.argv[2] || '00'.repeat(32)
const bootstrapPort = Number(Bare.argv[3]) || 49737
const bootstrapHost = Bare.argv[4] || '127.0.0.1'
const httpIdx = Bare.argv.indexOf('--http')
const httpPort = httpIdx !== -1 ? Number(Bare.argv[httpIdx + 1]) : 0
const urlIdx = Bare.argv.indexOf('--url')
const externalUrl = urlIdx !== -1 ? Bare.argv[urlIdx + 1] : null

const STORE_PATH = '/data/corestore'

function emit (event, extra = {}) {
  console.log(JSON.stringify({ node: 'seed', event, time: Date.now(), ...extra }))
}

async function main () {
  // 1. Start the DHT bootstrapper — must be ready before the swarm can join
  const bootstrapper = DHT.bootstrapper(bootstrapPort, bootstrapHost)
  await bootstrapper.ready()
  emit('dht-ready', { port: bootstrapPort, host: bootstrapHost })

  // 2. Create the Hyperdrive from the signing seed (deterministic key)
  const seed = b4a.from(seedHex, 'hex')
  const store = new Corestore(STORE_PATH, { primaryKey: seed, unsafe: true })
  const drive = new Hyperdrive(store)
  await drive.ready()

  const driveKey = b4a.toString(drive.key, 'hex')
  const discoveryKey = b4a.toString(drive.discoveryKey, 'hex')
  emit('drive-ready', { driveKey, discoveryKey })

  // Seed initial content on first run (no README yet)
  const existing = await drive.get('/README.md')
  if (!existing) {
    const files = {
      '/README.md': 'SPLectrum swarm — the P2P software distribution drive.\n',
      '/registry.json': JSON.stringify({
        name: 'splectrum-swarm',
        version: '0.1.0',
        modules: {}
      }, null, 2) + '\n'
    }
    for (const [path, content] of Object.entries(files)) {
      await drive.put(path, b4a.from(content))
      emit('seeded', { path, bytes: content.length })
    }
  }

  // 3. Join the swarm as server — serve the drive to any peer that connects
  const swarm = new Hyperswarm({
    dht: new DHT({
      bootstrap: [{ host: bootstrapHost, port: bootstrapPort }],
      firewalled: false,
      port: bootstrapPort + 1
    })
  })

  swarm.on('connection', (conn, info) => {
    const remote = b4a.toString(info.publicKey, 'hex').slice(0, 16)
    emit('peer-connected', { remote })
    conn.on('error', () => {})
    conn.on('close', () => emit('peer-disconnected', { remote }))
    store.replicate(conn)
  })

  swarm.join(drive.discoveryKey, { server: true, client: false })
  await swarm.flush()
  emit('serving', { driveKey })

  if (httpPort) {
    startServer(drive, swarm, { port: httpPort, node: 'seed', url: externalUrl, seed: true })
  }

  // 4. Graceful shutdown
  const sigterm = new Signal('SIGTERM')
  sigterm.on('signal', async () => {
    emit('stopping')
    await swarm.destroy()
    await store.close()
    await bootstrapper.destroy()
    emit('stopped')
    Bare.exit(0)
  })
  sigterm.start()
}

main().catch((e) => {
  emit('fatal', { err: String(e && e.message || e) })
  Bare.exit(1)
})
