// The connection substrate's one adapter: bridge a protomux channel (by protocol
// name) to a duplex stream, so avsc-rpc (which wants a duplex) rides a named
// channel. Writes become protomux messages; incoming messages push to the
// readable. AVRO (avsc-rpc) on top, protomux multiplexing underneath — so
// replication and any number of per-role RPC channels coexist on one connection.
// Proven in probes/avsc-rpc-on-protomux.
const c = require('compact-encoding')
const { Duplex } = require('streamx')

function channelStream (mux, protocol) {
  let msg
  const stream = new Duplex({ write (d, cb) { msg.send(d); cb() } })
  const channel = mux.createChannel({ protocol, onclose () { stream.push(null) } })
  msg = channel.addMessage({ encoding: c.raw, onmessage (d) { stream.push(d) } })
  channel.open()
  return stream
}

module.exports = { channelStream }
