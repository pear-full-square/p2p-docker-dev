// Joining node — replicates the platform's swarm setup (read-only), creates
// its own instance Hyperdrive (writable), forks the platform tree into it,
// and registers with the platform including the instance drive key.
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

var bootstrapArg = process.argv[2] || '172.31.0.10:49737'
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

var AUTHOR = { name: 'spl', email: 'spl@splectrum' }

function emit (event, extra) {
  console.log(JSON.stringify({ node: nodeName, event: event, time: Date.now(), ...(extra || {}) }))
}

// Copy a git tree from one repo to another (same as phase 3 fork)
async function forkTree (sourceRepo, targetRepo) {
  var sourceLog = await sourceRepo.log('main', 1)
  var rootTreeOid = sourceLog[0].commit.tree

  async function copyTree (oid) {
    var entries = await sourceRepo.git.readTree(oid)
    var targetEntries = []
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i]
      if (entry.type === 'tree' || entry.mode === '040000') {
        var subtreeOid = await copyTree(entry.oid)
        targetEntries.push({ mode: '040000', path: entry.path, oid: subtreeOid, type: 'tree' })
      } else {
        var blob = await sourceRepo.git.readBlob(entry.oid)
        var blobOid = await targetRepo.git.writeBlob(blob)
        targetEntries.push({ mode: entry.mode, path: entry.path, oid: blobOid, type: 'blob' })
      }
    }
    return targetRepo.git.writeTree(targetEntries)
  }

  return copyTree(rootTreeOid)
}

async function main () {
  var bootstrap = bootstrapArg.split(',').map(function (s) {
    var parts = s.split(':')
    return { host: parts[0], port: Number(parts[1]) }
  })

  var driveKey = b4a.from(driveKeyHex, 'hex')
  var store = new Corestore(STORE_PATH)

  // --- Platform drive (read-only replica) ---
  var platformDrive = new Hyperdrive(store, driveKey)
  await platformDrive.ready()
  emit('platform-drive-created', { key: driveKeyHex })

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

  var done = platformDrive.findingPeers()
  swarm.join(platformDrive.discoveryKey, { server: false, client: true })
  emit('joining', { discoveryKey: b4a.toString(platformDrive.discoveryKey, 'hex').slice(0, 16) })

  await swarm.flush()
  await platformDrive.update()
  done()
  emit('platform-synced', { version: platformDrive.version })

  var platformFs = createHyperdriveFs(platformDrive)
  var platformRepo = await open(git, platformFs, '/')
  emit('platform-repo-ready')

  // --- Instance drive (own, writable) ---
  var instanceDrive = new Hyperdrive(store.namespace('instance'))
  await instanceDrive.ready()
  var instanceKey = b4a.toString(instanceDrive.key, 'hex')
  emit('instance-drive-ready', { key: instanceKey, writable: instanceDrive.writable })

  var instanceFs = createHyperdriveFs(instanceDrive)
  var instanceRepo = await open(git, instanceFs, '/', { init: true })

  var needsFork = false
  try { await instanceRepo.log('main', 1) }
  catch (e) { needsFork = true }

  if (needsFork) {
    var forkedTreeOid = await forkTree(platformRepo, instanceRepo)
    var forkCommit = await instanceRepo.commitTree(forkedTreeOid, 'fork from platform', AUTHOR)
    emit('forked', { commitOid: forkCommit })

    var identity = {
      node: nodeName,
      role: 'node',
      instanceKey: instanceKey,
      platformKey: driveKeyHex,
      created: new Date().toISOString()
    }
    var newTree = await instanceRepo.put('/config/identity', Buffer.from(JSON.stringify(identity, null, 2) + '\n'))
    await instanceRepo.commitTree(newTree, 'set node identity', AUTHOR)
    emit('identity-set')
  }

  var instanceEntries = await instanceRepo.select('/')
  emit('instance-tree', { entries: instanceEntries.map(function (e) { return e.key }) })

  emit('ready')

  // Serve the node's own instance drive in its HTTP UI
  var drives = {}
  drives[nodeName] = { drive: instanceDrive, repo: instanceRepo, writable: true }
  drives['platform'] = { drive: platformDrive, repo: platformRepo, writable: false }

  startServer(null, swarm, null, {
    port: httpPort, node: nodeName, drives: drives
  })

  // Register with platform — include instance drive key
  if (platformUrl && externalUrl) {
    registerWithPlatform(platformUrl, nodeName, externalUrl, instanceKey)
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
