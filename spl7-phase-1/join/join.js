// Joining node — connects to the swarm, replicates the master data view
// drive sparsely, and verifies the tree structure arrived.
//
//   node join.js <bootstrap host:port> <driveKey> [name]
var DHT = require('hyperdht')
var Hyperswarm = require('hyperswarm')
var Corestore = require('corestore')
var Hyperdrive = require('hyperdrive')
var b4a = require('b4a')
var { startServer, registerWithPlatform } = require('../ui/http')

var bootstrapArg = process.argv[2] || '172.30.0.10:49737'
var driveKeyHex = process.argv[3]
var nodeName = process.argv[4] || 'node'

if (!driveKeyHex) {
  console.error('usage: join.js <bootstrap host:port> <driveKey> [name]')
  process.exit(1)
}

var STORE_PATH = process.env.STORE_PATH || '/tmp/node-store'
var httpPort = Number(process.env.HTTP_PORT) || 8080
var externalUrl = process.env.EXTERNAL_URL || null
var platformUrl = process.env.PLATFORM_URL || null

function emit (event, extra) {
  console.log(JSON.stringify({ node: nodeName, event: event, time: Date.now(), ...(extra || {}) }))
}

async function main () {
  var bootstrap = bootstrapArg.split(',').map(function (s) {
    var parts = s.split(':')
    return { host: parts[0], port: Number(parts[1]) }
  })

  var driveKey = b4a.from(driveKeyHex, 'hex')
  var store = new Corestore(STORE_PATH)

  var drive = new Hyperdrive(store, driveKey)
  await drive.ready()
  emit('drive-created', { key: driveKeyHex })

  var swarm = new Hyperswarm({
    dht: new DHT({ bootstrap: bootstrap, firewalled: false })
  })

  swarm.on('connection', function (conn, info) {
    var remote = b4a.toString(info.publicKey, 'hex').slice(0, 16)
    emit('peer-connected', { remote: remote })
    conn.on('error', function () {})
    conn.on('close', function () { emit('peer-disconnected', { remote: remote }) })
    store.replicate(conn)
  })

  var done = drive.findingPeers()
  swarm.join(drive.discoveryKey, { server: false, client: true })
  emit('joining', { discoveryKey: b4a.toString(drive.discoveryKey, 'hex').slice(0, 16) })

  await swarm.flush()
  await drive.update()
  done()
  emit('synced', { version: drive.version })

  var entries = []
  for await (var entry of drive.list('/')) {
    entries.push(entry.key)
  }
  emit('tree-contents', { files: entries })

  var folders = ['packages', 'modules', 'components', 'config', 'home', 'swarm']
  for (var i = 0; i < folders.length; i++) {
    var metaBuf = await drive.get('/' + folders[i] + '/_meta')
    if (metaBuf) {
      emit('folder-meta', { folder: folders[i], meta: JSON.parse(b4a.toString(metaBuf)) })
    } else {
      emit('folder-missing', { folder: folders[i] })
    }
  }

  var identityBuf = await drive.get('/config/identity')
  if (identityBuf) {
    emit('platform-identity', { identity: JSON.parse(b4a.toString(identityBuf)) })
  }

  startServer(drive, swarm, { port: httpPort, node: nodeName })

  if (platformUrl && externalUrl) {
    registerWithPlatform(platformUrl, nodeName, externalUrl)
  }

  emit('ready')

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
