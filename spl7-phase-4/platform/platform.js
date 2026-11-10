// Platform node — the swarm setup owner.
// Seeds the master data view, registers joining nodes under swarm/, and
// opens read-only replicas of each node's instance drive so the dashboard
// can browse any drive from one HTTP entry point.
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

  var rootEntries = await repo.select('/')
  emit('select-root', { entries: rootEntries.map(function (e) { return e.key }) })

  var log = await repo.log('main')
  emit('git-log', { commits: log.length, head: log[0].oid.slice(0, 12) })

  // --- Swarm ---
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

  // --- Drives map: name → { drive, repo, writable } ---
  var drives = {}
  drives['platform'] = { drive: drive, repo: repo, writable: true }

  // Open a read-only replica of a node's instance drive
  async function openNodeDrive (name, driveKeyHex) {
    try {
      var nodeKey = b4a.from(driveKeyHex, 'hex')
      var nodeDrive = new Hyperdrive(store, nodeKey)
      await nodeDrive.ready()

      var done = nodeDrive.findingPeers()
      swarm.join(nodeDrive.discoveryKey, { server: false, client: true })
      await swarm.flush()
      await nodeDrive.update()
      done()

      var nodeFs = createHyperdriveFs(nodeDrive)
      var nodeRepo = await open(git, nodeFs, '/')
      drives[name] = { drive: nodeDrive, repo: nodeRepo, writable: false }
      emit('node-drive-opened', { name: name, key: driveKeyHex, version: nodeDrive.version })
    } catch (e) {
      emit('node-drive-error', { name: name, error: String(e.message || e) })
    }
  }

  function onRegister (name, data) {
    var info = {
      name: name,
      role: data.role || 'node',
      url: data.url,
      driveKey: data.driveKey || null,
      registered: new Date().toISOString()
    }
    registerNode(repo, name, info, emit).catch(function (e) {
      emit('register-error', { name: name, error: String(e.message || e) })
    })

    if (data.driveKey) {
      openNodeDrive(name, data.driveKey)
    }
  }

  startServer(drive, swarm, repo, {
    port: httpPort, node: 'platform', seed: true, url: externalUrl,
    onRegister: onRegister, drives: drives
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
