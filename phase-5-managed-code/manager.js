// Phase 5 — the MANAGER. It owns the app's identity (a signing seed) and seeds
// role-code into a signed Hyperdrive, then serves that drive over the private DHT
// so workers can replicate it.
//
// Trust = a signed key: the drive's key is derived from CLUSTER_SEED (the app's
// signing secret). Workers are CONFIGURED with the resulting public DRIVE_KEY and
// replicate read-only — hypercore verifies every block against it, so a worker can
// only ever run code this manager authored. The DHT is a discovery rendezvous, not
// a code source.
//
//   bare manager.js <seedHex> <bootstrap host:port|public> [--debug]
const Hyperswarm = require('hyperswarm')
const DHT = require('hyperdht')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const Signal = require('bare-signals')
const sodium = require('sodium-native')
const b4a = require('b4a')
const fs = require('bare-fs')
const makeLog = require('./log')

const seedHex = Bare.argv[2] || '00'.repeat(32)
const bootstrapArg = Bare.argv[3] || 'bootstrap:49737'

const log = makeLog({ node: 'manager', phase: '5.3' })

// A worker's identity keypair is derived from the cluster seed + its name. The
// manager (holding the seed) computes every worker's PUBLIC key for the registry; a
// worker is handed only its own derived secret (the seed never leaves the manager,
// H being one-way). Same derivation as the worker — the keys match.
function workerKeyPair (seed, name) {
  const s = b4a.alloc(32)
  sodium.crypto_generichash(s, b4a.concat([seed, b4a.from(name)]))
  return DHT.keyPair(s)
}

const usePublic = bootstrapArg === 'public'
const bootstrap = usePublic ? undefined : bootstrapArg.split(',').map((s) => {
  const [host, port] = s.split(':'); return { host, port: Number(port) }
})

async function main () {
  const seed = b4a.from(seedHex, 'hex')
  const store = new Corestore('/tmp/manager-store', { primaryKey: seed, unsafe: true })
  const drive = new Hyperdrive(store)
  await drive.ready()
  const driveKey = b4a.toString(drive.key, 'hex')
  log.info({ event: 'drive-ready', driveKey, discoveryKey: b4a.toString(drive.discoveryKey, 'hex') }, 'signed drive ready')

  // Seed every role-file from the manager's own filesystem into the drive.
  const roleFiles = fs.readdirSync('./roles').filter((f) => f.endsWith('.js'))
  for (const f of roleFiles) {
    const src = fs.readFileSync('./roles/' + f)
    await drive.put('/roles/' + f, src)
    log.info({ event: 'seeded-role', path: '/roles/' + f, bytes: src.length }, `seeded role '${f.replace('.js', '')}'`)
  }

  // Build + seed the REGISTRY — the signed directory binding each worker's identity
  // (public key) to its assigned roles, derived from the hand-authored assignments.
  // Doubles as placement ("what runs where") AND directory ("how to reach a worker
  // by key"). Workers read their roles here; clients resolve a target worker's key.
  const assignments = JSON.parse(b4a.toString(fs.readFileSync('./assignments.json')))
  const registry = {}
  for (const name of Object.keys(assignments)) {
    if (name.startsWith('_')) continue
    const roles = Array.isArray(assignments[name]) ? assignments[name] : [assignments[name]]
    const kp = workerKeyPair(seed, name)
    registry[name] = { key: b4a.toString(kp.publicKey, 'hex'), roles }
    log.info({ event: 'registered', worker: name, key: registry[name].key, roles }, `registered '${name}'`)
  }
  await drive.put('/registry.json', b4a.from(JSON.stringify(registry)))
  log.info({ event: 'seeded-registry', path: '/registry.json', workers: Object.keys(registry).length }, 'seeded signed registry')

  const swarm = usePublic
    ? new Hyperswarm({})
    : new Hyperswarm({ dht: new DHT({ bootstrap, firewalled: false, port: 49800 }) })

  // Every connection on the drive topic is a worker replicating — serve the store.
  swarm.on('connection', (conn, info) => {
    log.info({ event: 'peer-replicating', remote: info.publicKey.toString('hex').slice(0, 16) })
    conn.on('error', () => {})
    store.replicate(conn)
  })

  swarm.join(drive.discoveryKey, { server: true, client: false })
  log.info({ event: 'serving-drive', driveKey }, 'serving signed drive on the DHT')

  const sigterm = new Signal('SIGTERM')
  sigterm.on('signal', async () => { log.info({ event: 'stop' }); await swarm.destroy(); Bare.exit(0) })
  sigterm.start()
}
main().catch((e) => { log.error({ event: 'fatal', err: String(e && e.message || e) }); Bare.exit(1) })
