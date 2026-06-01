// Ground-truth reachability: one container echoes UDX datagrams, another pings
// it by IP:port — the exact transport HyperDHT uses, but with NO DHT/holepunch.
// If the client logs 'pong', the Docker bridge passes container-to-container UDP,
// and the Phase 1 failure is HyperDHT coordination, not the network.
//
//   bare udx-echo.js server <port>
//   bare udx-echo.js client <host:port>
const UDX = require('udx-native')

const role = Bare.argv[2] || 'server'
const arg = Bare.argv[3] || ''

function emit (event, extra = {}) { console.log(JSON.stringify({ role, event, ...extra })) }

const udx = new UDX()
const socket = udx.createSocket()

socket.on('message', (buf, rinfo) => {
  emit('recv', { from: rinfo.host + ':' + rinfo.port, msg: buf.toString() })
  if (role === 'server') socket.send(Buffer.from('pong'), rinfo.port, rinfo.host)
})

if (role === 'server') {
  const port = Number(arg) || 9000
  socket.bind(port, '0.0.0.0')
  emit('listening', { port })
} else {
  const [host, port] = arg.split(':')
  socket.bind(0)
  emit('client-ready', { target: arg })
  let n = 0
  setInterval(() => {
    socket.send(Buffer.from('ping-' + n), Number(port), host)
    emit('sent', { to: arg, n: n++ })
  }, 1500)
}
