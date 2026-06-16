// Platform node — the swarm setup owner.
// Seeds a populated master data view, registers joining nodes under swarm/,
// and commits each registration so the tree evolves through git.
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
var { seedTree, registerNode } = require('./tree')
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

  var hfs = createHyperdriveFs(drive)
  var repo = await open(git, hfs, '/', { init: true })
  emit('repo-ready')

  var needsSeed = false
  try { await repo.log('main', 1) }
  catch (e) { needsSeed = true }

  if (needsSeed) {
    var swarmConfig = {
      name: 'spl7-dev',
      description: 'spl7 development swarm',
      created: new Date().toISOString(),
      bootstrapHost: bootstrapHost,
      bootstrapPort: bootstrapPort
    }
    var platformIdentity = {
      node: 'platform',
      role: 'platform',
      driveKey: driveKey,
      created: new Date().toISOString()
    }
    await seedTree(repo, swarmConfig, platformIdentity, emit)
    emit('tree-seeded')
  } else {
    emit('tree-exists')
  }

  // Show the tree
  var rootEntries = await repo.select('/')
  emit('select-root', { entries: rootEntries.map(function (e) { return e.key }) })

  var pkgEntries = await repo.select('/packages')
  emit('select-packages', { entries: pkgEntries.map(function (e) { return e.key }) })

  var swarmEntries = await repo.select('/swarm')
  emit('select-swarm', { entries: swarmEntries.map(function (e) { return e.key }) })

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

  // The onRegister callback: when a node registers, write it into the tree
  function onRegister (name, data) {
    var info = {
      name: name,
      role: data.role || 'node',
      url: data.url,
      registered: new Date().toISOString()
    }
    registerNode(repo, name, info, emit).catch(function (e) {
      emit('register-error', { name: name, error: String(e.message || e) })
    })
  }

  startServer(drive, swarm, repo, {
    port: httpPort, node: 'platform', seed: true, url: externalUrl,
    onRegister: onRegister
  })

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
