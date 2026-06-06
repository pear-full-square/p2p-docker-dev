// Peer node — joins the swarm, replicates the drive, serves a browser UI.
//
// Two drives: the content drive (replicated from seed, read-only) and the
// world view drive (personal, writable, captures what this node knows).
//
//   node peer.js <bootstrapAddr> <driveKeyHex> [--http <port>] [--url <externalUrl>] [--seed-url <seedUrl>] [--name <peerName>]
const DHT = require('hyperdht')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const b4a = require('b4a')
const { startServer } = require('../ui/http')
const { createWorldView } = require('../ui/worldview')
const rt = require('../ui/runtime')

const bootstrapArg = rt.argv[2] || '172.28.0.10:49737'
const driveKeyHex = rt.argv[3]

if (!driveKeyHex) {
  console.error('usage: peer.js <bootstrap host:port> <driveKeyHex> [--http <port>]')
  rt.exit(1)
}

const httpIdx = rt.argv.indexOf('--http')
const httpPort = httpIdx !== -1 ? Number(rt.argv[httpIdx + 1]) : 0
const urlIdx = rt.argv.indexOf('--url')
const externalUrl = urlIdx !== -1 ? rt.argv[urlIdx + 1] : null
const seedUrlIdx = rt.argv.indexOf('--seed-url')
const seedUrl = seedUrlIdx !== -1 ? rt.argv[seedUrlIdx + 1] : null
const nameIdx = rt.argv.indexOf('--name')
const peerName = nameIdx !== -1 ? rt.argv[nameIdx + 1] : 'peer'

const STORE_PATH = process.env.STORE_PATH || '/tmp/peer-store'

const bootstrap = bootstrapArg.split(',').map((s) => {
  const [host, port] = s.split(':')
  return { host, port: Number(port) }
})

function emit (event, extra) {
  console.log(JSON.stringify({ node: peerName, event, time: Date.now(), ...(extra || {}) }))
}

async function main () {
  const driveKey = b4a.from(driveKeyHex, 'hex')

  const store = new Corestore(STORE_PATH)

  // Content drive — replicated from seed, read-only
  const drive = new Hyperdrive(store, driveKey)
  await drive.ready()
  emit('drive-created', { key: driveKeyHex })

  // World view drive — personal, writable (separate namespace)
  const worldDrive = new Hyperdrive(store.namespace('world'))
  await worldDrive.ready()
  emit('world-drive-ready', { key: b4a.toString(worldDrive.key, 'hex') })

  const swarm = new Hyperswarm({
    dht: new DHT({ bootstrap, firewalled: false })
  })

  swarm.on('connection', (conn, info) => {
    const remote = b4a.toString(info.publicKey, 'hex').slice(0, 16)
    emit('peer-connected', { remote })
    conn.on('error', () => {})
    conn.on('close', () => emit('peer-disconnected', { remote }))
    store.replicate(conn)
  })

  const done = drive.findingPeers()
  swarm.join(drive.discoveryKey, { server: false, client: true })
  emit('joining-swarm', { discoveryKey: b4a.toString(drive.discoveryKey, 'hex').slice(0, 16) })

  await swarm.flush()
  await drive.update()
  done()
  emit('drive-synced', { version: drive.version })

  const entries = []
  for await (const entry of drive.list('/')) {
    entries.push(entry.key)
  }
  emit('drive-contents', { files: entries })

  // Start world view — periodic status updates
  var worldView = createWorldView(worldDrive, swarm, { node: peerName, role: 'peer' })
  worldView.start()
  emit('world-view-started')

  if (httpPort) {
    startServer(drive, swarm, {
      port: httpPort, node: peerName, url: externalUrl,
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

  if (seedUrl && externalUrl) {
    registerWithSeed(seedUrl, peerName, externalUrl)
  }

  emit('ready')

  rt.onShutdown(async () => {
    emit('stopping')
    worldView.stop()
    for (var i = 0; i < fuseHandles.length; i++) {
      await fuseMod.unmount(fuseHandles[i])
    }
    await swarm.destroy()
    await store.close()
    emit('stopped')
    rt.exit(0)
  })
}

function registerWithSeed (seedUrl, name, url) {
  var http = rt.isBare ? require('bare-http1') : require('http')
  var parsed = seedUrl.replace('http://', '').split(':')
  var host = parsed[0]
  var port = Number(parsed[1]) || 8080
  var body = JSON.stringify({ name: name, url: url })

  var req = http.request({
    host: host,
    port: port,
    path: '/api/register',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, () => {
    emit('registered', { seedUrl: seedUrl })
  })
  req.on('error', (err) => {
    emit('register-failed', { seedUrl: seedUrl, err: String(err.message || err) })
  })
  req.end(body)
}

main().catch((e) => {
  emit('fatal', { err: String(e && e.message || e) })
  rt.exit(1)
})
