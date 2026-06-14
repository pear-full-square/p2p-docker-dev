// Platform node — bootstraps a private DHT, creates a Hyperdrive, initialises
// a git repo on it via mycelium, seeds the master data view tree, and serves.
//
// The Hyperdrive IS the .git — git objects stored as drive entries, navigable
// by XPath through the mycelium module.
//
//   node platform.js <seedHex> <bootstrapPort> <bootstrapHost>
var DHT = require('hyperdht')
var Hyperswarm = require('hyperswarm')
var Corestore = require('corestore')
var Hyperdrive = require('hyperdrive')
var b4a = require('b4a')
var git = require('isomorphic-git')
var { createHyperdriveFs } = require('../lib/hyperdrive-fs')
var { open } = require('../lib/mycelium')
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

  // Create the Hyperdrive-fs adapter and open mycelium repo
  var hfs = createHyperdriveFs(drive)
  var repo = await open(git, hfs, '/', { init: true })
  emit('repo-ready')

  // Seed tree if no commits yet
  var needsSeed = false
  try {
    await repo.log('main', 1)
  } catch (e) {
    needsSeed = true
  }

  if (needsSeed) {
    var identity = {
      node: 'platform',
      role: 'platform',
      driveKey: driveKey,
      created: new Date().toISOString()
    }
    await seedTree(repo, identity, emit)
    emit('tree-seeded')
  } else {
    emit('tree-exists')
  }

  // Show tree via XPath select
  var entries = await repo.select('/')
  emit('select-root', { entries: entries.map(function (e) { return e.key }) })

  // Show metadata dimension
  var configEntries = await repo.select('/config')
  emit('select-config', { entries: configEntries.map(function (e) { return e.key }) })

  // Read identity via mycelium get
  var identityBuf = await repo.get('/config/identity')
  emit('get-identity', { identity: JSON.parse(identityBuf.toString()) })

  // Git log
  var log = await repo.log('main')
  emit('git-log', { commits: log.length, head: log[0].oid.slice(0, 12) })

  // Join swarm
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

  startServer(drive, swarm, repo, { port: httpPort, node: 'platform', seed: true, url: externalUrl })

  var stopping = false
  async function shutdown () {
    if (stopping) return
    stopping = true
    emit('stopping')
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
  emit('fatal', { err: String(e && e.stack || e.message || e) })
  process.exit(1)
})
