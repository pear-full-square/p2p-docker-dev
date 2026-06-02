// Pin the API surface phase-5 depends on, so an upstream change shows up as a
// diff against run.log. The writer-side methods (replicate/put) and the reader-side
// sync methods (update/findingPeers) are the ones the manager/worker lean on.
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const store = new Corestore('/tmp/probe-api-store')
const drive = new Hyperdrive(store)
const surf = (o, names) => names.filter((n) => typeof o[n] === 'function')
console.log(JSON.stringify({ corestore: surf(store, ['replicate', 'get', 'namespace', 'ready', 'close']) }))
console.log(JSON.stringify({ hyperdrive: surf(drive, ['ready', 'put', 'get', 'update', 'findingPeers', 'entry', 'list', 'close']) }))
drive.ready().then(() => {
  console.log(JSON.stringify({ props: { key: !!drive.key, discoveryKey: !!drive.discoveryKey } }))
  Bare.exit(0)
})
