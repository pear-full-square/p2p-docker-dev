// Does the Holepunch STORAGE stack (corestore + hyperdrive) load + run under Bare
// on the cluster's distroless base? Reports versions and that the constructors
// resolve. (Replication + execution are proven separately in replicate.js / exec.js.)
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const b4a = require('b4a')

const v = (n) => { try { return require(n + '/package.json').version } catch (e) { return '?' } }
console.log(JSON.stringify({
  ok: true,
  loaded: { corestore: typeof Corestore, hyperdrive: typeof Hyperdrive, b4a: typeof b4a.from },
  versions: { corestore: v('corestore'), hyperdrive: v('hyperdrive'), b4a: v('b4a') }
}))
