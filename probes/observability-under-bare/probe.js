// Do the candidate observability libs run under Bare, and — key question — do
// the Holepunch modules we bundle already use hypertrace internally (which would
// give us X-ray insight into the stack for free)? Re-run via ./run.sh.
function ver (p) { try { return require(p + '/package.json').version } catch (e) { return '?' } }
function line (o) { console.log(JSON.stringify(o)) }

// 1) pino-bare — per-node leveled structured logging + child loggers (bound context)
try {
  const pino = require('pino-bare')
  const log = pino()
  log.info({ hello: 'world' }, 'pino-bare info line')
  const child = log.child({ conn: 'abc123' })          // child = bound correlation context
  child.warn({ peer: 'node-b' }, 'child logger line')
  line({ probe: 'pino-bare', version: ver('pino-bare'), status: 'ok' })
} catch (e) { line({ probe: 'pino-bare', version: ver('pino-bare'), status: 'FAIL', err: String(e.message || e).slice(0, 160) }) }

// 2) hypertrace — within-process tracing of classes/modules
try {
  const { createTracer, setTraceFunction } = require('hypertrace')
  let traced = 0
  setTraceFunction((data) => { if (traced === 0) line({ traceFnKeys: Object.keys(data || {}) }); traced++ })
  class Demo {
    constructor () { this.tracer = createTracer(this, { props: { role: 'demo' } }) }
    work () { this.tracer.trace() }
  }
  const d = new Demo(); d.work(); d.work()
  line({ probe: 'hypertrace', version: ver('hypertrace'), status: 'ok', tracedCalls: traced })
} catch (e) { line({ probe: 'hypertrace', version: ver('hypertrace'), status: 'FAIL', err: String(e.message || e).slice(0, 160) }) }

// 3) Are the bundled Holepunch modules instrumented with hypertrace already?
for (const m of ['hyperswarm', 'hyperdht', 'hypercore', 'dht-rpc']) {
  let dep = false
  try { const pkg = require(m + '/package.json'); dep = !!(pkg.dependencies && pkg.dependencies.hypertrace) } catch (e) {}
  line({ holepunchModule: m, version: ver(m), dependsOnHypertrace: dep })
}
