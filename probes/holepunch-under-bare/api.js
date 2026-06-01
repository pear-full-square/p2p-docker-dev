// Inspect the exact API surface Phase 1 builds on (bootstrapper, swarm methods,
// signal handler), so a future upstream change is traceable against run.log.
const Signal = require('bare-signals')
console.log(JSON.stringify({ mod: 'bare-signals', type: typeof Signal, proto: Object.getOwnPropertyNames(Signal.prototype || {}) }))

const DHT = require('hyperdht')
console.log(JSON.stringify({ mod: 'hyperdht', static: Object.getOwnPropertyNames(DHT).filter(k => typeof DHT[k] === 'function') }))

const Hyperswarm = require('hyperswarm')
console.log(JSON.stringify({ mod: 'hyperswarm', proto: Object.getOwnPropertyNames(Hyperswarm.prototype).slice(0, 30) }))
