// Role: reverse — a second unit of managed code, distinct from echo, so the
// assignment manifest has something to place differently. Same contract as echo
// (the worker hands it a context; it stands up an avsc-rpc service), but it
// reverses the payload instead of echoing it.
module.exports = {
  name: 'reverse',
  start (ctx) {
    const { swarm, name, log, Service, topicFor } = ctx

    const svc = Service.forProtocol({
      protocol: 'Call',
      namespace: 'spl6.poc',
      messages: {
        call: { request: [{ name: 'cid', type: 'string' }, { name: 'payload', type: 'string' }], response: 'string' }
      }
    })

    const server = svc.createServer()
    server.onCall((cid, payload, cb) => {
      const reversed = payload.split('').reverse().join('')
      log.info({ event: 'rpc-serve', service: 'reverse', cid }, `reverse handled '${cid}'`)
      cb(null, `reverse@${name}: ${reversed}`)
    })

    ctx.onServicePeer((conn) => server.createChannel(conn))

    const topic = topicFor('reverse')
    swarm.join(topic, { server: true, client: false })
    log.info({ event: 'role-serving', role: 'reverse', topic: topic.toString('hex').slice(0, 16) }, "role 'reverse' serving")
  }
}
