// Platform node — bootstraps a private DHT, creates a Hyperdrive, seeds the
// master data view tree, and serves it to joining nodes.
//
//   node platform.js <seedHex> <bootstrapPort> <bootstrapHost>
var DHT = require('hyperdht')
var Hyperswarm = require('hyperswarm')
var Corestore = require('corestore')
var Hyperdrive = require('hyperdrive')
var b4a = require('b4a')
var { seedTree } = require('./tree')
var { startServer } = require('../ui/http')

var seedHex = process.argv[2] || '00'.repeat(32)
var bootstrapPort = Number(process.argv[3]) || 49737
var bootstrapHost = process.argv[4] || '127.0.0.1'
var httpPort = Number(process.env.HTTP_PORT) || 8080
var externalUrl = process.env.EXTERNAL_URL || null

var STORE_PATH = process.env.STORE_PATH || '/data/corestore'

function emit (event, extra) {
  console.log(JSON.stringify({ node: 'platform', event: event, time: Date.now(), ...(extra || {}) }))
}

async function main () {
  var bootstrapper = DHT.bootstrapper(bootstrapPort, bootstrapHost)
  await bootstrapper.ready()
  emit('dht-ready', { port: bootstrapPort, host: bootstrapHost })

  var seed = b4a.from(seedHex, 'hex')
  var store = new Corestore(STORE_PATH, { primaryKey: seed, unsafe: true })

  var drive = new Hyperdrive(store)
  await drive.ready()
  var driveKey = b4a.toString(drive.key, 'hex')
  emit('drive-ready', { driveKey: driveKey })

  var existing = await drive.get('/config/_meta')
  if (!existing) {
    var identity = {
      node: 'platform',
      role: 'platform',
      driveKey: driveKey,
      created: new Date().toISOString()
    }
    await seedTree(drive, identity, emit)
    emit('tree-seeded')
  } else {
    emit('tree-exists')
  }

  var entries = []
  for await (var entry of drive.list('/')) {
    entries.push(entry.key)
  }
  emit('tree-contents', { files: entries })

  var swarm = new Hyperswarm({
    dht: new DHT({
      bootstrap: [{ host: bootstrapHost, port: bootstrapPort }],
      firewalled: false,
      port: bootstrapPort + 1
    })
  })

  swarm.on('connection', function (conn, info) {
    var remote = b4a.toString(info.publicKey, 'hex').slice(0, 16)
    emit('peer-connected', { remote: remote })
    conn.on('error', function () {})
    conn.on('close', function () { emit('peer-disconnected', { remote: remote }) })
    store.replicate(conn)
  })

  swarm.join(drive.discoveryKey, { server: true, client: false })
  await swarm.flush()
  emit('serving', { driveKey: driveKey })

  startServer(drive, swarm, { port: httpPort, node: 'platform', seed: true, url: externalUrl })

  var fuseHandle = null
  var fuseMountPoint = process.env.FUSE_MOUNT
  if (fuseMountPoint) {
    try {
      var fuse = require('../fuse/mount')
      fuseHandle = await fuse.mountDrive(drive, fuseMountPoint)
      emit('fuse-mounted', { mountPoint: fuseMountPoint })
    } catch (e) {
      emit('fuse-failed', { mountPoint: fuseMountPoint, error: String(e.message || e) })
    }
  }

  var stopping = false
  async function shutdown () {
    if (stopping) return
    stopping = true
    emit('stopping')
    if (fuseHandle) {
      try { await require('../fuse/mount').unmount(fuseHandle) } catch (e) {}
    }
    await swarm.destroy()
    await store.close()
    await bootstrapper.destroy()
    emit('stopped')
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch(function (e) {
  emit('fatal', { err: String(e && e.message || e) })
  process.exit(1)
})
