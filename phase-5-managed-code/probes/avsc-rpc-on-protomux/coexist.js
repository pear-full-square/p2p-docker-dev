// Proof 2 — corestore REPLICATION and avsc-rpc both ride ONE connection. On a real
// NoiseSecretStream (what a Hyperswarm conn is), store.replicate(conn) sets up the
// muxer on conn and opens its replication channels; Protomux.from(conn) returns the
// SAME muxer (idempotent), so an RPC channel opened on it coexists with replication.
//
// So a worker can replicate the manager's drive AND serve RPC over one connection —
// no topic-routing, no second swarm. This is the phase-5.2 connection substrate.
const Protomux = require('protomux')
const c = require('compact-encoding')
const { Duplex } = require('streamx')
const SecretStream = require('@hyperswarm/secret-stream')
const { Service } = require('avsc-rpc')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const b4a = require('b4a')

const svc = Service.forProtocol({ protocol: 'Call', namespace: 'spl6.poc',
  messages: { call: { request: [{ name: 'cid', type: 'string' }, { name: 'payload', type: 'string' }], response: 'string' } } })

function rawpair () {
  let a, b
  a = new Duplex({ write (d, cb) { b.push(d); cb() } })
  b = new Duplex({ write (d, cb) { a.push(d); cb() } })
  return [a, b]
}
function channelStream (mux, protocol) {
  let msg
  const s = new Duplex({ write (d, cb) { msg.send(d); cb() } })
  const ch = mux.createChannel({ protocol, onclose () { s.push(null) } })
  msg = ch.addMessage({ encoding: c.raw, onmessage (d) { s.push(d) } })
  ch.open()
  return s
}

async function main () {
  const wstore = new Corestore('/tmp/probe-w'); const drive = new Hyperdrive(wstore); await drive.ready()
  await drive.put('/roles/echo.js', b4a.from('module.exports={}\n')); const key = drive.key
  const rstore = new Corestore('/tmp/probe-r'); const ro = new Hyperdrive(rstore, key); await ro.ready()

  // A real secret-stream pair over an in-memory raw transport (models a swarm conn).
  const [ra, rb] = rawpair()
  const connB = new SecretStream(true, ra)
  const connA = new SecretStream(false, rb)

  // SERVER (connB): replication + accept the echo RPC channel — one connection.
  wstore.replicate(connB)
  const muxB = Protomux.from(connB)
  muxB.pair({ protocol: 'echo' }, () => {
    const srv = svc.createServer(); srv.onCall((cid, p, cb) => cb(null, 'echo: ' + p))
    srv.createChannel(channelStream(muxB, 'echo'))
  })

  // CLIENT (connA): replication + open the echo RPC channel — one connection.
  const done = ro.findingPeers(); rstore.replicate(connA); const muxA = Protomux.from(connA)
  await ro.update(); done()

  const buf = await ro.get('/roles/echo.js', { wait: true })
  console.log(JSON.stringify({ proof: 'replication', pulled: !!buf, bytes: buf ? buf.length : 0 }))

  const client = svc.createClient({ buffering: true }); client.createChannel(channelStream(muxA, 'echo'))
  client.call('cid-1', 'ping', (err, res) => { console.log(JSON.stringify({ proof: 'rpc-same-conn', res: err ? 'ERR ' + err.message : res })); Bare.exit(0) })
  setTimeout(() => { console.log(JSON.stringify({ error: 'timeout' })); Bare.exit(1) }, 6000)
}
main().catch((e) => { console.log(JSON.stringify({ error: String(e && e.message || e) })); Bare.exit(1) })
