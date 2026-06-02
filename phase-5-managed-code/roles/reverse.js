// Role: reverse — a second unit of managed code, distinct from echo, so a worker
// can be assigned BOTH and serve each on its own named protomux channel. Same 5.2
// contract as echo (see echo.js); reverses the payload.
module.exports = {
  name: 'reverse',
  start (ctx) {
    const { swarm, name, log, Service, topicFor, channelStream } = ctx

    const svc = Service.forProtocol({
      protocol: 'Call', namespace: 'spl6.poc',
      messages: { call: { request: [{ name: 'cid', type: 'string' }, { name: 'payload', type: 'string' }], response: 'string' } }
    })

    const server = svc.createServer()
    server.onCall((cid, payload, cb) => {
      const reversed = payload.split('').reverse().join('')
      log.info({ event: 'rpc-serve', service: 'reverse', cid }, `reverse handled '${cid}'`)
      cb(null, `reverse@${name}: ${reversed}`)
    })

    const topic = topicFor('reverse')
    swarm.join(topic, { server: true, client: false })
    log.info({ event: 'role-serving', role: 'reverse', topic: topic.toString('hex').slice(0, 16) }, "role 'reverse' serving")

    return {
      protocol: 'reverse',
      accept (mux) { mux.pair({ protocol: 'reverse' }, () => server.createChannel(channelStream(mux, 'reverse'))) }
    }
  }
}
