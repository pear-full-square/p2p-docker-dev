// Do protomux + compact-encoding load + run under Bare, alongside the avsc-rpc
// forks and the storage stack? Reports versions.
const Protomux = require('protomux')
const c = require('compact-encoding')
const { Service } = require('avsc-rpc')
const v = (n) => { try { return require(n + '/package.json').version } catch (e) { return '?' } }
console.log(JSON.stringify({
  ok: true,
  loaded: { protomux: typeof Protomux.from, rawEncoding: typeof c.raw, service: typeof Service.forProtocol },
  versions: { protomux: v('protomux'), 'compact-encoding': v('compact-encoding'), corestore: v('corestore'), hyperdrive: v('hyperdrive') }
}))
