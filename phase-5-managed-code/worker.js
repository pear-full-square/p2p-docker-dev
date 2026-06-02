// Phase 5 — a generic WORKER. It ships no business logic. Configured with the
// public DRIVE_KEY it trusts, it replicates the manager's signed drive, reads the
// assignment manifest, self-assigns its role(s), pulls their source, and runs them.
//
// 5.2 — protomux connection substrate. Every connection carries, on ONE muxer:
//   • replication        — store.replicate(conn) (activates only with the manager,
//                          which shares the drive's cores)
//   • per-role RPC        — each assigned role serves on its OWN named channel,
//                          accepted by protocol name (Protomux.from(conn) shares the
//                          muxer corestore set up).
// No info.topics routing, no second swarm — a worker can run MANY roles at once,
// each a named channel, replication alongside. (Proven: probes/avsc-rpc-on-protomux.)
//
// Execution pathway (the design frame), chosen by <exec>:
//   memory   — new Function(src): code never touches the OS disk (Pear-native target)
//   checkout — bare-fs write + require(): the bridge into conventional execution.
//
//   bare worker.js <name> <bootstrap host:port|public> <driveKeyHex> <memory|checkout> [--debug]
const Hyperswarm = require('hyperswarm')
const DHT = require('hyperdht')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const Protomux = require('protomux')
const sodium = require('sodium-native')
const Signal = require('bare-signals')
const b4a = require('b4a')
const fs = require('bare-fs')
const { Service } = require('avsc-rpc')
const { channelStream } = require('./channel')
const makeLog = require('./log')

const name = Bare.argv[2] || 'worker-0'
const bootstrapArg = Bare.argv[3] || 'bootstrap:49737'
const driveKeyHex = Bare.argv[4]
const idSeedHex = Bare.argv[5]   // this worker's identity secret (= H(clusterSeed || name))
const execMode = Bare.argv[6] || 'memory'

const log = makeLog({ node: name, phase: '5.3' })

function topicFor (n) {
  const t = Buffer.alloc(32)
  sodium.crypto_generichash(t, Buffer.from('p2p-docker-dev/svc/' + n))
  return t
}

// The two execution pathways. Both run code pulled as a source string.
function runInMemory (src) {
  const module = { exports: {} }
  const fn = new Function('module', 'exports', 'require', src)
  fn(module, module.exports, require)   // host require: role's deps are the worker's (owned, build-time)
  return module.exports
}
function runFromCheckout (src, roleName) {
  const dir = '/tmp/checkout'
  fs.mkdirSync(dir, { recursive: true })
  const path = dir + '/' + roleName + '.js'
  fs.writeFileSync(path, src)
  return require(path)
}

async function main () {
  if (!driveKeyHex) { log.error({ event: 'fatal', err: 'no DRIVE_KEY configured' }); Bare.exit(1) }
  const driveKey = b4a.from(driveKeyHex, 'hex')

  // Identity: this worker's swarm uses its derived keypair, so it is reachable by
  // key (clients can joinPeer its public key — the "target a specific worker" op),
  // not only via service topics. The secret was derived by the manager as
  // H(clusterSeed || name) and handed to the worker; the public key is in the registry.
  if (!idSeedHex) { log.error({ event: 'fatal', err: 'no identity seed configured' }); Bare.exit(1) }
  const keyPair = DHT.keyPair(b4a.from(idSeedHex, 'hex'))
  log.info({ event: 'identity', publicKey: b4a.toString(keyPair.publicKey, 'hex') }, 'worker identity ready')

  const usePublic = bootstrapArg === 'public'
  const bootstrap = usePublic ? undefined : bootstrapArg.split(',').map((s) => {
    const [host, port] = s.split(':'); return { host, port: Number(port) }
  })
  const swarm = usePublic
    ? new Hyperswarm({ keyPair })
    : new Hyperswarm({ keyPair, dht: new DHT({ bootstrap, firewalled: false, port: 49800 }) })

  const store = new Corestore('/tmp/worker-store')
  const drive = new Hyperdrive(store, driveKey)
  await drive.ready()
  log.info({ event: 'trust-key', driveKey: driveKeyHex }, 'configured to trust drive key')

  // The connection substrate: one uniform handler, no routing. Replication self-sorts
  // (only the manager shares cores); each running role accepts its own named channel.
  const running = []   // [{ protocol, accept(mux) }]
  swarm.on('connection', (conn, info) => {
    conn.on('error', () => {})
    store.replicate(conn)
    const mux = Protomux.from(conn)
    for (const role of running) role.accept(mux)
    log.info({ event: 'peer', remote: info.publicKey.toString('hex').slice(0, 16), roles: running.length })
  })

  // Join the drive topic (as client) to find the manager and replicate.
  const done = drive.findingPeers()
  swarm.join(drive.discoveryKey, { server: false, client: true })
  await swarm.flush()
  await drive.update()
  done()

  // SELF-ASSIGN: read the signed registry, look up this worker's roles by name.
  const registryBuf = await drive.get('/registry.json', { wait: true })
  if (!registryBuf) { log.error({ event: 'fatal', err: 'no registry on drive' }); Bare.exit(1) }
  const registry = JSON.parse(b4a.toString(registryBuf))
  const roleNames = (registry[name] && registry[name].roles) || []
  if (roleNames.length === 0) {
    log.warn({ event: 'no-assignment', worker: name }, `no role assigned to '${name}' — idling`)
  } else {
    log.info({ event: 'assigned', worker: name, roles: roleNames }, `manifest assigns [${roleNames.join(', ')}] to '${name}'`)
  }

  // PULL + RUN each assigned role. Each returns a handle the connection handler uses.
  for (const roleName of roleNames) {
    const src = await drive.get('/roles/' + roleName + '.js', { wait: true })
    if (!src) { log.error({ event: 'fatal', err: 'assigned role not found on drive: ' + roleName }); Bare.exit(1) }
    log.info({ event: 'role-pulled', role: roleName, bytes: src.length, exec: execMode }, `pulled role '${roleName}'`)

    const roleModule = execMode === 'checkout' ? runFromCheckout(b4a.toString(src), roleName) : runInMemory(b4a.toString(src))
    log.info({ event: 'role-loaded', role: roleName, exec: execMode }, `loaded role via ${execMode}`)

    const handle = roleModule.start({ swarm, name, log, Service, topicFor, channelStream })
    running.push(handle)
  }

  const sigterm = new Signal('SIGTERM')
  sigterm.on('signal', async () => { log.info({ event: 'stop' }); await swarm.destroy(); Bare.exit(0) })
  sigterm.start()
}
main().catch((e) => { log.error({ event: 'fatal', err: String(e && e.message || e) }); Bare.exit(1) })
