// Seed node — DHT bootstrapper + Hyperdrive host in one process.
//
// The always-on infrastructure: bootstraps a private DHT (the rendezvous point)
// and hosts a signed Hyperdrive on persistent storage (Corestore on a volume).
// Peers join the swarm, replicate the drive, and get the contents.
//
// Two drives: the content drive (shared, replicated to peers) and the world
// view drive (personal, captures what this node knows and has done).
//
//   node seed.js <seedHex> <bootstrapPort> <bootstrapHost> [--http <port>] [--url <externalUrl>]
const DHT = require('hyperdht')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const b4a = require('b4a')
const { seedContent } = require('./content')
const { startServer } = require('../ui/http')
const { createWorldView } = require('../ui/worldview')
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

  // Content drive — shared, replicated to peers
  const drive = new Hyperdrive(store)
  await drive.ready()
  const driveKey = b4a.toString(drive.key, 'hex')
  const discoveryKey = b4a.toString(drive.discoveryKey, 'hex')
  emit('drive-ready', { driveKey, discoveryKey })

  const existing = await drive.get('/README.md')
  if (!existing) {
    await seedContent(drive, emit)
  }

  // World view drive — personal, node's own ledger (separate namespace)
  const worldDrive = new Hyperdrive(store.namespace('world'))
  await worldDrive.ready()
  emit('world-drive-ready', { key: b4a.toString(worldDrive.key, 'hex') })

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

  // Start world view — periodic status updates
  var worldView = createWorldView(worldDrive, swarm, { node: 'seed', role: 'seed' })
  worldView.start()
  emit('world-view-started')

  if (httpPort) {
    startServer(drive, swarm, {
      port: httpPort, node: 'seed', url: externalUrl, seed: true,
      worldView: worldView
    })
  }

  // FUSE mounts (node.js only)
  var fuseHandles = []
  var fuseMod = rt.tryFuse()
  if (fuseMod) {
    var fuseMountContent = process.env.FUSE_MOUNT
    var bareOverlay = { '/bin/bare': '/usr/local/lib/node_modules/bare/node_modules/bare-runtime-linux-x64/bin/bare' }
    if (fuseMountContent) {
      try {
        fuseHandles.push(await fuseMod.mountDrive(drive, fuseMountContent, { overlays: bareOverlay }))
        emit('fuse-mounted', { mountPoint: fuseMountContent, drive: 'content' })
      } catch (e) {
        emit('fuse-failed', { mountPoint: fuseMountContent, error: String(e.message || e) })
      }
    }
    var fuseMountWorld = process.env.FUSE_WORLD_MOUNT
    if (fuseMountWorld) {
      try {
        fuseHandles.push(await fuseMod.mountDrive(worldDrive, fuseMountWorld))
        emit('fuse-mounted', { mountPoint: fuseMountWorld, drive: 'world' })
      } catch (e) {
        emit('fuse-failed', { mountPoint: fuseMountWorld, error: String(e.message || e) })
      }
    }
  }

  rt.onShutdown(async () => {
    emit('stopping')
    worldView.stop()
    for (var i = 0; i < fuseHandles.length; i++) {
      await fuseMod.unmount(fuseHandles[i])
    }
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
