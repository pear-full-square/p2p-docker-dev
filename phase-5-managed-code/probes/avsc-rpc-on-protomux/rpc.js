// Proof 1 — two avsc-rpc services ride two NAMED protomux channels over ONE
// connection. The role is identified by the CHANNEL PROTOCOL NAME, not by topic:
// this is what kills phase-5.1's info.topics routing hack and unlocks
// multi-role-per-worker (N roles = N named channels on one connection).
//
// The bridge: avsc-rpc's createChannel takes a duplex; we adapt a protomux channel
// to one — writes become protomux messages, incoming messages push to the readable.
// AVRO encoding (avsc) on top, protomux muxing underneath.
const Protomux = require('protomux')
const c = require('compact-encoding')
const { Duplex } = require('streamx')
const { Service } = require('avsc-rpc')

const svc = Service.forProtocol({
  protocol: 'Call', namespace: 'spl6.poc',
  messages: { call: { request: [{ name: 'cid', type: 'string' }, { name: 'payload', type: 'string' }], response: 'string' } }
})

// In-process connected duplex pair (stands in for a Hyperswarm conn for proof 1).
function pair () {
  let a, b
  a = new Duplex({ write (d, cb) { b.push(d); cb() } })
  b = new Duplex({ write (d, cb) { a.push(d); cb() } })
  return [a, b]
}

// Adapt a protomux channel (by protocol name) to a duplex stream for avsc-rpc.
function channelStream (mux, protocol) {
  let msg
  const stream = new Duplex({ write (d, cb) { msg.send(d); cb() } })
  const channel = mux.createChannel({ protocol, onclose () { stream.push(null) } })
  msg = channel.addMessage({ encoding: c.raw, onmessage (d) { stream.push(d) } })
  channel.open()
  return stream
}

const [a, b] = pair()
const muxA = Protomux.from(a)
const muxB = Protomux.from(b)

// SERVER (b): accept echo + reverse channels by protocol name.
function serve (name, handler) {
  muxB.pair({ protocol: name }, () => {
    const server = svc.createServer()
    server.onCall((cid, payload, cb) => cb(null, handler(payload)))
    server.createChannel(channelStream(muxB, name))
  })
}
serve('echo', (p) => `echo: ${p}`)
serve('reverse', (p) => `reverse: ${p.split('').reverse().join('')}`)

// CLIENT (a): open both channels, call each.
function callOn (name, payload, done) {
  const client = svc.createClient({ buffering: true })
  client.createChannel(channelStream(muxA, name))
  client.call('cid-' + name, payload, (err, res) => done(name, err ? 'ERR ' + err.message : res))
}

let n = 0
function check (name, res) { console.log(JSON.stringify({ channel: name, res })); if (++n === 2) Bare.exit(0) }
callOn('echo', 'ping', check)
callOn('reverse', 'ping', check)
setTimeout(() => { console.log(JSON.stringify({ error: 'timeout — no responses' })); Bare.exit(1) }, 5000)
