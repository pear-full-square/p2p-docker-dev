// Role: echo — a unit of MANAGED CODE. The manager seeds this into its signed
// drive; a worker pulls and runs it. The worker ships no business logic.
//
// 5.2 contract: start(ctx) joins the role's service topic (so clients discover it)
// and stands up its avsc-rpc server, then returns { protocol, accept(mux) }. The
// worker calls accept(mux) for every connection — the role serves on its OWN NAMED
// protomux channel, so many roles (and replication) coexist on one connection.
//   ctx = { swarm, name, log, Service, topicFor, channelStream }
module.exports = {
  name: 'echo',
  start (ctx) {
    const { swarm, name, log, Service, topicFor, channelStream } = ctx

    const svc = Service.forProtocol({
      protocol: 'Call', namespace: 'spl6.poc',
      messages: { call: { request: [{ name: 'cid', type: 'string' }, { name: 'payload', type: 'string' }], response: 'string' } }
    })

    const server = svc.createServer()
    server.onCall((cid, payload, cb) => {
      log.info({ event: 'rpc-serve', service: 'echo', cid }, `echo handled '${cid}'`)
      cb(null, `echo@${name}: ${payload}`)
    })

    const topic = topicFor('echo')
    swarm.join(topic, { server: true, client: false })
    log.info({ event: 'role-serving', role: 'echo', topic: topic.toString('hex').slice(0, 16) }, "role 'echo' serving")

    return {
      protocol: 'echo',
      // Accept the 'echo' channel whenever a peer opens it on this connection.
      accept (mux) { mux.pair({ protocol: 'echo' }, () => server.createChannel(channelStream(mux, 'echo'))) }
    }
  }
}
