// Joining node — replicates the platform's drive, forks the tree into its
// own writable Hyperdrive (the instance), updates its identity, and commits.
//
// Two drives:
//   - Platform drive (replicated, read-only) — the install
//   - Instance drive (own Hyperdrive, writable) — the node's git repo
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
var { forkTree } = require('../lib/fork')
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

  // Open mycelium on the platform drive (read-only)
  var platformFs = createHyperdriveFs(platformDrive)
  var platformRepo = await open(git, platformFs, '/')
  emit('platform-repo-ready')

  // Verify platform tree
  var platformEntries = await platformRepo.select('/')
  emit('platform-tree', { entries: platformEntries.map(function (e) { return e.key }) })

  // --- Instance drive (own, writable) ---
  var instanceDrive = new Hyperdrive(store.namespace('instance'))
  await instanceDrive.ready()
  var instanceKey = b4a.toString(instanceDrive.key, 'hex')
  emit('instance-drive-ready', { key: instanceKey, writable: instanceDrive.writable })

  var instanceFs = createHyperdriveFs(instanceDrive)
  var instanceRepo = await open(git, instanceFs, '/', { init: true })
  emit('instance-repo-ready')

  // Fork if no commits yet
  var needsFork = false
  try {
    await instanceRepo.log('main', 1)
  } catch (e) {
    needsFork = true
  }

  if (needsFork) {
    // Copy the platform's tree to the instance
    var forkedTreeOid = await forkTree(platformRepo, instanceRepo)
    var forkCommit = await instanceRepo.commitTree(forkedTreeOid, 'fork from platform', AUTHOR)
    emit('forked', { treeOid: forkedTreeOid, commitOid: forkCommit })

    // Update identity — the node puts its own identity
    var identity = {
      node: nodeName,
      role: 'node',
      instanceKey: instanceKey,
      platformKey: driveKeyHex,
      created: new Date().toISOString()
    }
    var newTree = await instanceRepo.put('/config/identity', Buffer.from(JSON.stringify(identity, null, 2) + '\n'))
    var identityCommit = await instanceRepo.commitTree(newTree, 'set node identity', AUTHOR)
    emit('identity-set', { commitOid: identityCommit })
  } else {
    emit('instance-exists')
  }

  // Show the instance tree via XPath
  var instanceEntries = await instanceRepo.select('/')
  emit('instance-tree', { entries: instanceEntries.map(function (e) { return e.key }) })

  // Read own identity
  var myIdentity = await instanceRepo.get('/config/identity')
  emit('my-identity', { identity: JSON.parse(myIdentity.toString()) })

  // Git log — should have 2 commits (fork + identity)
  var log = await instanceRepo.log('main')
  emit('instance-log', {
    commits: log.length,
    history: log.map(function (c) { return { oid: c.oid.slice(0, 12), message: c.commit.message.trim() } })
  })

  emit('ready')

  // Serve the instance repo in the UI (the node's own view)
  startServer(instanceDrive, swarm, instanceRepo, { port: httpPort, node: nodeName })

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
