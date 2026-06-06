// Peer node — joins the swarm, replicates the drive, serves a browser UI.
//
// Phase 1: join + replicate + verify contents.
// Phase 2: HTTP server with browser UI for drive browsing.
//
//   bare peer.js <bootstrapAddr> <driveKeyHex> [--http <port>] [--url <externalUrl>] [--seed-url <seedUrl>] [--name <peerName>]
const DHT = require('hyperdht')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const Signal = require('bare-signals')
const b4a = require('b4a')
const { startServer } = require('../ui/http')

const bootstrapArg = Bare.argv[2] || '172.28.0.10:49737'
const driveKeyHex = Bare.argv[3]

if (!driveKeyHex) {
  console.error('usage: bare peer.js <bootstrap host:port> <driveKeyHex> [--http <port>]')
  Bare.exit(1)
}

const httpIdx = Bare.argv.indexOf('--http')
const httpPort = httpIdx !== -1 ? Number(Bare.argv[httpIdx + 1]) : 0
const urlIdx = Bare.argv.indexOf('--url')
const externalUrl = urlIdx !== -1 ? Bare.argv[urlIdx + 1] : null
const seedUrlIdx = Bare.argv.indexOf('--seed-url')
const seedUrl = seedUrlIdx !== -1 ? Bare.argv[seedUrlIdx + 1] : null
const nameIdx = Bare.argv.indexOf('--name')
const peerName = nameIdx !== -1 ? Bare.argv[nameIdx + 1] : 'peer'

const bootstrap = bootstrapArg.split(',').map((s) => {
  const [host, port] = s.split(':')
  return { host, port: Number(port) }
})

function emit (event, extra = {}) {
  console.log(JSON.stringify({ node: peerName, event, time: Date.now(), ...extra }))
}

async function main () {
  const driveKey = b4a.from(driveKeyHex, 'hex')

  const store = new Corestore('/tmp/peer-store')
  const drive = new Hyperdrive(store, driveKey)
  await drive.ready()
  emit('drive-created', { key: driveKeyHex })

  const swarm = new Hyperswarm({
    dht: new DHT({ bootstrap, firewalled: false })
  })

  swarm.on('connection', (conn, info) => {
    const remote = b4a.toString(info.publicKey, 'hex').slice(0, 16)
    emit('peer-connected', { remote })
    conn.on('error', () => {})
    conn.on('close', () => emit('peer-disconnected', { remote }))
    store.replicate(conn)
  })

  const done = drive.findingPeers()
  swarm.join(drive.discoveryKey, { server: false, client: true })
  emit('joining-swarm', { discoveryKey: b4a.toString(drive.discoveryKey, 'hex').slice(0, 16) })

  await swarm.flush()
  await drive.update()
  done()
  emit('drive-synced', { version: drive.version })

  // List the drive contents to verify replication
  const entries = []
  for await (const entry of drive.list('/')) {
    entries.push(entry.key)
  }
  emit('drive-contents', { files: entries })

  // Read and print each file
  for (const path of entries) {
    const buf = await drive.get(path)
    if (buf) {
      emit('file-read', { path, bytes: buf.length, content: b4a.toString(buf).slice(0, 200) })
    }
  }

  if (httpPort) {
    startServer(drive, swarm, { port: httpPort, node: peerName, url: externalUrl })
  }

  if (seedUrl && externalUrl) {
    registerWithSeed(seedUrl, peerName, externalUrl)
  }

  emit('ready')

  const sigterm = new Signal('SIGTERM')
  sigterm.on('signal', async () => {
    emit('stopping')
    await swarm.destroy()
    await store.close()
    emit('stopped')
    Bare.exit(0)
  })
  sigterm.start()
}

function registerWithSeed (seedUrl, name, url) {
  const seedHttp = require('bare-http1')
  const parsed = seedUrl.replace('http://', '').split(':')
  const host = parsed[0]
  const port = Number(parsed[1]) || 8080
  const body = JSON.stringify({ name: name, url: url })

  const req = seedHttp.request({
    host: host,
    port: port,
    path: '/api/register',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, (res) => {
    emit('registered', { seedUrl: seedUrl })
  })
  req.on('error', (err) => {
    emit('register-failed', { seedUrl: seedUrl, err: String(err.message || err) })
  })
  req.end(body)
}

main().catch((e) => {
  emit('fatal', { err: String(e && e.message || e) })
  Bare.exit(1)
})
