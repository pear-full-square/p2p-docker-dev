// Phase 5 — the CLIENT. 5.3 demonstrates the base management op: target a SPECIFIC
// worker by identity, not "any provider of a service".
//
// It replicates the signed drive, reads the REGISTRY (name -> {key, roles}), resolves
// the target worker's public key, and connects to it directly by key (swarm.joinPeer)
// — no service-topic discovery. Then it opens the service's named channel over that
// connection and calls. The reply names the worker (echo@worker-b), proving the call
// reached the targeted node and not some other provider of the same service.
//
//   bare client.js <name> <bootstrap host:port|public> <driveKeyHex> <targetWorker> <service> [--debug]
const Hyperswarm = require('hyperswarm')
const DHT = require('hyperdht')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const Protomux = require('protomux')
const Signal = require('bare-signals')
const b4a = require('b4a')
const { Service } = require('avsc-rpc')
const { channelStream } = require('./channel')
const makeLog = require('./log')

const name = Bare.argv[2] || 'client-0'
const bootstrapArg = Bare.argv[3] || 'bootstrap:49737'
const driveKeyHex = Bare.argv[4]
const targetWorker = Bare.argv[5] || 'worker-b'
const serviceName = Bare.argv[6] || 'echo'

const log = makeLog({ node: name, phase: '5.3' })

const svc = Service.forProtocol({
  protocol: 'Call', namespace: 'spl6.poc',
  messages: { call: { request: [{ name: 'cid', type: 'string' }, { name: 'payload', type: 'string' }], response: 'string' } }
})

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

  const store = new Corestore('/tmp/client-store')
  const drive = new Hyperdrive(store, driveKey)
  await drive.ready()

  let targetKey = null
  let serviceClient = null

  swarm.on('connection', (conn, info) => {
    conn.on('error', () => {})
    store.replicate(conn)                                  // replicate the registry from the manager
    const mux = Protomux.from(conn)
    if (targetKey && !serviceClient && b4a.equals(info.publicKey, targetKey)) {
      log.info({ event: 'reached-target', worker: targetWorker, key: b4a.toString(targetKey, 'hex') }, `connected to '${targetWorker}' by key`)
      serviceClient = svc.createClient({ buffering: true })
      serviceClient.createChannel(channelStream(mux, serviceName))
    }
  })

  // Replicate the drive (via the manager on the drive topic) to read the registry.
  const done = drive.findingPeers()
  swarm.join(drive.discoveryKey, { server: false, client: true })
  await swarm.flush()
  await drive.update()
  done()

  const registryBuf = await drive.get('/registry.json', { wait: true })
  if (!registryBuf) { log.error({ event: 'fatal', err: 'no registry on drive' }); Bare.exit(1) }
  const registry = JSON.parse(b4a.toString(registryBuf))
  const entry = registry[targetWorker]
  if (!entry) { log.error({ event: 'fatal', err: 'target not in registry: ' + targetWorker }); Bare.exit(1) }
  targetKey = b4a.from(entry.key, 'hex')
  log.info({ event: 'resolve', worker: targetWorker, key: entry.key, roles: entry.roles }, `resolved '${targetWorker}' from registry`)

  // CONNECT-BY-KEY: target the specific worker, independent of any service topic.
  swarm.joinPeer(targetKey)
  log.info({ event: 'target', worker: targetWorker, service: serviceName }, `targeting '${targetWorker}' by key for '${serviceName}'`)

  let seq = 0
  const iv = setInterval(() => {
    if (!serviceClient) { log.debug({ event: 'idle' }, 'not connected to target yet'); return }
    const cid = name + '-' + seq
    log.info({ event: 'rpc-call', service: serviceName, target: targetWorker, cid }, `calling '${serviceName}' on '${targetWorker}'`)
    serviceClient.call(cid, 'ping #' + seq, (err, res) => {
      if (err) log.error({ event: 'rpc-error', cid, err: String(err.message || err).slice(0, 80) })
      else log.info({ event: 'rpc-response', cid, res }, 'got response from targeted worker')
    })
    seq++
  }, 3000)

  const sigterm = new Signal('SIGTERM')
  sigterm.on('signal', async () => { clearInterval(iv); log.info({ event: 'stop' }); await swarm.destroy(); Bare.exit(0) })
  sigterm.start()
}
main().catch((e) => { log.error({ event: 'fatal', err: String(e && e.message || e) }); Bare.exit(1) })
