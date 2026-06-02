// Once a worker has pulled role-code as a SOURCE STRING (replicate.js), how does it
// RUN it under Bare? Two pathways — and the choice is the phase's design frame:
//
//   • in-memory (new Function)  — code never touches the OS disk. The P2P-native
//     leaning, toward the eventual Pear model (an app runs out of its drive).
//   • checkout (bare-fs + require) — materialize to a checkout dir, then require()
//     it conventionally. The deliberate BRIDGE into the non-P2P world: testing,
//     hybrid deployments, running pulled code in an ordinary runtime.
//
// Both are proven here. Note: in-memory passes the host's `require`, so a role's
// nested requires resolve against the WORKER's own bundled deps — fine under the
// "application owns all runtime code" invariant (deps are absorbed at build time).
// True drive-native nested resolution (the drive as the module root) is the deeper
// Pear-loader path, deferred.
const source = "module.exports = { start: (ctx) => ctx.log('role started via ' + ctx.via) }\n"

function logger (tag) { return (m) => console.log(JSON.stringify({ pathway: tag, run: m })) }

function runInMemory (src) {
  const module = { exports: {} }
  const fn = new Function('module', 'exports', 'require', src)
  fn(module, module.exports, require)
  return module.exports
}

function runFromCheckout (src) {
  const fs = require('bare-fs')
  const dir = '/tmp/probe-checkout'
  fs.mkdirSync(dir, { recursive: true })
  const path = dir + '/role.js'
  fs.writeFileSync(path, src)
  return require(path)
}

try {
  const a = runInMemory(source)
  console.log(JSON.stringify({ step: 'in-memory-loaded', hasStart: typeof a.start === 'function' }))
  a.start({ log: logger('in-memory'), via: 'new Function' })

  const b = runFromCheckout(source)
  console.log(JSON.stringify({ step: 'checkout-loaded', hasStart: typeof b.start === 'function' }))
  b.start({ log: logger('checkout'), via: 'require(file)' })
} catch (e) {
  console.log(JSON.stringify({ step: 'error', err: String(e && e.message || e) }))
}
