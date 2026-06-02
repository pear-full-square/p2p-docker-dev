// The core phase-5 mechanic, proven in-process (the swarm transport is already
// proven in phases 1-4; this isolates the NEW thing — drive replication + read).
//
// A WRITER drive seeds role-code; a READER drive opened FROM THE WRITER'S KEY
// replicates it over a piped stream and reads the source back. The drive key IS
// the manager's signing public key, so trust is intrinsic: hypercore verifies
// every block against it — a reader can only ever materialize content the holder
// of that key authored. This is the "trust = a signed key" invariant, for free.
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const b4a = require('b4a')

async function main () {
  const wstore = new Corestore('/tmp/probe-w-store')
  const drive = new Hyperdrive(wstore)
  await drive.ready()
  const key = drive.key
  console.log(JSON.stringify({ step: 'writer-ready', driveKey: b4a.toString(key, 'hex') }))

  const code = "module.exports = { start: (ctx) => ctx.log('role echo started') }\n"
  await drive.put('/roles/echo.js', b4a.from(code))
  console.log(JSON.stringify({ step: 'seeded', path: '/roles/echo.js', bytes: code.length }))

  // READER: a fresh store, drive opened by the trusted key only.
  const rstore = new Corestore('/tmp/probe-r-store')
  const ro = new Hyperdrive(rstore, key)
  await ro.ready()

  // findingPeers() holds update() open until the live peer is found; without it
  // update() resolves immediately reporting "no peers, length 0" and the read misses.
  const done = ro.findingPeers()
  const s1 = wstore.replicate(true)
  const s2 = rstore.replicate(false)
  s1.pipe(s2).pipe(s1)            // stands in for the swarm connection
  await ro.update()
  done()

  const buf = await ro.get('/roles/echo.js', { wait: true })
  const pulled = buf && b4a.toString(buf)
  console.log(JSON.stringify({ step: 'reader-read', match: pulled === code, pulledBytes: pulled ? pulled.length : 0 }))
  Bare.exit(0)
}
main().catch((e) => { console.log(JSON.stringify({ step: 'error', err: String(e && e.message || e) })); Bare.exit(1) })
