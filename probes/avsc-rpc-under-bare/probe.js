// Does avsc-rpc — git-installed from bare-for-pear, with its newly-declared deps
// (avsc fork + streamx + bare-*) — load and round-trip under Bare? Validates the
// module-level package.json fix and de-risks Phase 2 (avsc-rpc over Hyperswarm).
function ver (p) { try { return require(p + '/package.json').version } catch (e) { return '?' } }
function line (o) { console.log(JSON.stringify(o)) }

try {
  const { Service } = require('avsc-rpc')
  line({ probe: 'require', status: 'ok', 'avsc-rpc': ver('avsc-rpc'), avsc: ver('avsc'), streamx: ver('streamx') })

  const service = Service.forProtocol({
    protocol: 'Echo',
    namespace: 'spl6.poc',
    messages: { echo: { request: [{ name: 'message', type: 'string' }], response: 'string' } }
  })
  const server = service.createServer().onEcho((message, cb) => cb(null, 'echo:' + message))
  const client = service.createClient({ server, buffering: true })   // in-memory; buffer until channel ready
  client.echo('ping', (err, res) => {
    line({ probe: 'roundtrip', status: err ? 'FAIL' : 'ok', res, err: err ? String(err.message || err).slice(0, 120) : undefined })
  })
} catch (e) {
  line({ probe: 'avsc-rpc', status: 'FAIL', err: String(e.message || e).slice(0, 200) })
}
