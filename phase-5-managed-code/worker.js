// Phase 5 — a generic WORKER. It ships no business logic. Configured with the
// public DRIVE_KEY it trusts, it replicates the manager's signed drive over the
// private DHT, pulls a role's source, and RUNS it — picking up its responsibility
// from code distributed at runtime.
//
// Execution pathway (the phase's design frame), chosen by <exec>:
//   memory   — new Function(src): code never touches the OS disk. The P2P-native
//              leaning, toward the eventual Pear model (an app runs out of its drive).
//   checkout — bare-fs write + require(): materialize to a checkout dir, then run it
//              conventionally. The deliberate BRIDGE into the non-P2P world
//              (testing, hybrid deployments). Same pulled bytes, ordinary runtime.
//
// One swarm, two connection purposes, routed by topic: a peer found on the drive
// topic is the manager (replicate the store); any other peer is a service client
// (hand to the role's RPC server). The worker dials the manager, so that
// connection's PeerInfo carries the drive topic; client connections fall to 'else'.
//
//   bare worker.js <name> <bootstrap host:port|public> <driveKeyHex> <memory|checkout> [--debug]
//
// The worker is NOT told its role on the command line — it reads the signed
// assignment manifest (/assignments.json) off the replicated drive and looks up
// its own name to learn what to run. "What runs where" is data, distributed in the
// drive, not configuration baked into the launch.
const Hyperswarm = require('hyperswarm')
const DHT = require('hyperdht')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const sodium = require('sodium-native')
const Signal = require('bare-signals')
const b4a = require('b4a')
const fs = require('bare-fs')
const { Service } = require('avsc-rpc')
const makeLog = require('./log')

const name = Bare.argv[2] || 'worker-0'
const bootstrapArg = Bare.argv[3] || 'bootstrap:49737'
const driveKeyHex = Bare.argv[4]
const execMode = Bare.argv[5] || 'memory'

const log = makeLog({ node: name, phase: '5.1' })

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

  const usePublic = bootstrapArg === 'public'
  const bootstrap = usePublic ? undefined : bootstrapArg.split(',').map((s) => {
    const [host, port] = s.split(':'); return { host, port: Number(port) }
  })
  const swarm = usePublic
    ? new Hyperswarm({})
    : new Hyperswarm({ dht: new DHT({ bootstrap, firewalled: false, port: 49800 }) })

  // Read-only replica of the manager's signed drive — trust is the key itself.
  const store = new Corestore('/tmp/worker-store')
  const drive = new Hyperdrive(store, driveKey)
  await drive.ready()
  log.info({ event: 'trust-key', driveKey: driveKeyHex }, 'configured to trust drive key')

  let onServicePeer = null   // the role registers its connection handler here

  swarm.on('connection', (conn, info) => {
    conn.on('error', () => {})
    const forDrive = (info.topics || []).some((t) => b4a.equals(t, drive.discoveryKey))
    if (forDrive) {
      log.info({ event: 'replicating-from', remote: info.publicKey.toString('hex').slice(0, 16) })
      store.replicate(conn)
    } else if (onServicePeer) {
      log.info({ event: 'service-peer', remote: info.publicKey.toString('hex').slice(0, 16) })
      onServicePeer(conn)
    }
  })

  // Join the drive topic (as client) to find the manager and replicate.
  const done = drive.findingPeers()
  swarm.join(drive.discoveryKey, { server: false, client: true })
  await swarm.flush()
  await drive.update()
  done()

  // SELF-ASSIGN: read the signed manifest and look up this worker's role.
  const manifestBuf = await drive.get('/assignments.json', { wait: true })
  if (!manifestBuf) { log.error({ event: 'fatal', err: 'no assignment manifest on drive' }); Bare.exit(1) }
  const manifest = JSON.parse(b4a.toString(manifestBuf))
  const roleName = manifest[name]
  if (!roleName) {
    // No-role fallback — the manifest doesn't place anything here. Stay up, idle.
    log.warn({ event: 'no-assignment', worker: name }, `no role assigned to '${name}' — idling`)
  } else {
    log.info({ event: 'assigned', worker: name, role: roleName }, `manifest assigns '${roleName}' to '${name}'`)

    // PULL the assigned role source over the replicated drive.
    const src = await drive.get('/roles/' + roleName + '.js', { wait: true })
    if (!src) { log.error({ event: 'fatal', err: 'assigned role not found on drive: ' + roleName }); Bare.exit(1) }
    log.info({ event: 'role-pulled', role: roleName, bytes: src.length, exec: execMode }, `pulled role '${roleName}'`)

    // RUN it via the configured pathway.
    const roleModule = execMode === 'checkout' ? runFromCheckout(b4a.toString(src), roleName) : runInMemory(b4a.toString(src))
    log.info({ event: 'role-loaded', role: roleName, exec: execMode }, `loaded role via ${execMode}`)

    roleModule.start({
      swarm,
      name,
      log,
      Service,
      topicFor,
      onServicePeer: (handler) => { onServicePeer = handler }
    })
  }

  const sigterm = new Signal('SIGTERM')
  sigterm.on('signal', async () => { log.info({ event: 'stop' }); await swarm.destroy(); Bare.exit(0) })
  sigterm.start()
}
main().catch((e) => { log.error({ event: 'fatal', err: String(e && e.message || e) }); Bare.exit(1) })
