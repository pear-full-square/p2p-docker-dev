// Seed node — DHT bootstrapper + Hyperdrive host in one process.
//
// The always-on infrastructure: bootstraps a private DHT (the rendezvous point)
// and hosts a signed Hyperdrive on persistent storage (Corestore on a volume).
// Peers join the swarm, replicate the drive, and get the contents.
//
// Runs under bare or node.js. Under node: also mounts FUSE if FUSE_MOUNT is set.
//
//   bare seed.js <seedHex> <bootstrapPort> <bootstrapHost> [--http <port>] [--url <externalUrl>]
//   node seed.js <seedHex> <bootstrapPort> <bootstrapHost> [--http <port>] [--url <externalUrl>]
const DHT = require('hyperdht')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const b4a = require('b4a')
const { seedContent } = require('./content')
const { startServer } = require('../ui/http')
const rt = require('../ui/runtime')

const seedHex = rt.argv[2] || '00'.repeat(32)
const bootstrapPort = Number(rt.argv[3]) || 49737
const bootstrapHost = rt.argv[4] || '127.0.0.1'
const httpIdx = rt.argv.indexOf('--http')
const httpPort = httpIdx !== -1 ? Number(rt.argv[httpIdx + 1]) : 0
const urlIdx = rt.argv.indexOf('--url')
const externalUrl = urlIdx !== -1 ? rt.argv[urlIdx + 1] : null

const STORE_PATH = process.env.STORE_PATH || '/data/corestore'

function emit (event, extra) {
  console.log(JSON.stringify({ node: 'seed', event, time: Date.now(), ...(extra || {}) }))
}

async function main () {
  const bootstrapper = DHT.bootstrapper(bootstrapPort, bootstrapHost)
  await bootstrapper.ready()
  emit('dht-ready', { port: bootstrapPort, host: bootstrapHost })

  const seed = b4a.from(seedHex, 'hex')
  const store = new Corestore(STORE_PATH, { primaryKey: seed, unsafe: true })
  const drive = new Hyperdrive(store)
  await drive.ready()

  const driveKey = b4a.toString(drive.key, 'hex')
  const discoveryKey = b4a.toString(drive.discoveryKey, 'hex')
  emit('drive-ready', { driveKey, discoveryKey })

  const existing = await drive.get('/README.md')
  if (!existing) {
    await seedContent(drive, emit)
  }

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

  // FUSE mount (node.js only)
  var fuseHandle = null
  var fuseMod = rt.tryFuse()
  if (fuseMod) {
    try {
      var mountPoint = process.env.FUSE_MOUNT
      fuseHandle = await fuseMod.mountDrive(drive, mountPoint)
      emit('fuse-mounted', { mountPoint })
    } catch (e) {
      emit('fuse-failed', { error: String(e.message || e) })
    }
  }

  rt.onShutdown(async () => {
    emit('stopping')
    if (fuseHandle) await fuseMod.unmount(fuseHandle)
    await swarm.destroy()
    await store.close()
    await bootstrapper.destroy()
    emit('stopped')
    rt.exit(0)
  })
}

main().catch((e) => {
  emit('fatal', { err: String(e && e.message || e) })
  rt.exit(1)
})
