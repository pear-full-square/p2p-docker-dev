// Role: echo — the unit of MANAGED CODE. The manager seeds this file into its
// signed Hyperdrive; a worker pulls it over the swarm and runs it. The worker
// ships NO business logic — this is the logic, distributed at runtime from the
// app's own signed drive.
//
// The role is handed a context by the worker (it does not require() infrastructure
// itself — the worker owns the deps, "application owns all runtime code"):
//   ctx = { swarm, name, log, Service, topicFor }
// It stands up the same avsc-rpc service shape phase-3 served, but as PULLED code.
module.exports = {
  name: 'echo',
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
      log.info({ event: 'rpc-serve', service: 'echo', cid }, `echo handled '${cid}'`)
      cb(null, `echo@${name}: ${payload}`)
    })

    // The worker routes service-peer connections here (see worker.js); the role just
    // attaches an RPC channel to each.
    ctx.onServicePeer((conn) => server.createChannel(conn))

    const topic = topicFor('echo')
    swarm.join(topic, { server: true, client: false })
    log.info({ event: 'role-serving', role: 'echo', topic: topic.toString('hex').slice(0, 16) }, "role 'echo' serving")
  }
}
