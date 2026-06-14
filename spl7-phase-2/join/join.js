// Joining node — connects to the swarm, replicates the Hyperdrive, opens
// the git repo via mycelium, and navigates the tree with XPath.
//
//   node join.js <bootstrap host:port> <driveKey> [name]
var DHT = require('hyperdht')
var Hyperswarm = require('hyperswarm')
var Corestore = require('corestore')
var Hyperdrive = require('hyperdrive')
var b4a = require('b4a')
var git = require('isomorphic-git')
var { createHyperdriveFs } = require('../lib/hyperdrive-fs')
var { open } = require('../lib/mycelium')
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

  // Open mycelium repo on the replicated drive
  var hfs = createHyperdriveFs(drive)
  var repo = await open(git, hfs, '/')
  emit('repo-ready')

  // XPath select — browse the tree
  var entries = await repo.select('/')
  emit('select-root', { entries: entries.map(function (e) { return e.key }) })

  // Three visibility modes on /config
  var rawEntries = await repo.select('/config', { mode: 'raw' })
  emit('select-config-raw', { entries: rawEntries.map(function (e) { return e.key }) })

  var dataEntries = await repo.select('/config', { mode: 'data' })
  emit('select-config-data', { entries: dataEntries.map(function (e) { return e.key }) })

  var metaEntries = await repo.select('/config', { mode: 'metadata' })
  emit('select-config-metadata', { entries: metaEntries.map(function (e) { return e.key }) })

  // Read values via mycelium
  var identityBuf = await repo.get('/config/identity')
  emit('get-identity', { identity: JSON.parse(identityBuf.toString()) })

  var metaBuf = await repo.read('/packages/_meta')
  if (metaBuf) {
    emit('read-packages-meta', { meta: JSON.parse(metaBuf.toString()) })
  }

  // Git log — verify we see the commit history
  var log = await repo.log('main')
  emit('git-log', { commits: log.length, head: log[0].oid.slice(0, 12) })

  emit('ready')

  startServer(drive, swarm, repo, { port: httpPort, node: nodeName })

  if (platformUrl && externalUrl) {
    registerWithPlatform(platformUrl, nodeName, externalUrl)
  }

  var stopping = false
  async function shutdown () {
    if (stopping) return
    stopping = true
    emit('stopping')
    await swarm.destroy()
    await store.close()
    emit('stopped')
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch(function (e) {
  emit('fatal', { err: String(e && e.stack || e.message || e) })
  process.exit(1)
})
