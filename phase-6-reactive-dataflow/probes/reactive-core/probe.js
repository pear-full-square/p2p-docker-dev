// The reactive core — the heart of the Mycelium execution model.
//
// A repo reacts to a data-change event = a new append on a log it subscribes to.
// This proves that mechanism AND the cascade: each stage live-tails its upstream,
// reacts, and EMITS to its own log — whose append wakes the next stage. Data flows
// through logs; computation is triggered by arrival. Push, not poll. Cursors track
// position (contiguousLength), so it's resumable/replayable.
//
//   source --(replicate)--> [transform tails it] --emit--> --(replicate)--> [sink tails it]
//
// Two real replication hops (piped streams stand in for swarm connections — swarm
// replication of cores is already proven in phase-5). Everything else is the new bit.
const Hypercore = require('hypercore')
const b4a = require('b4a')

function pipe (a, b) { const s1 = a.replicate(true); const s2 = b.replicate(false); s1.pipe(s2).pipe(s1) }

async function main () {
  // Stage 1 — SOURCE: a writer log.
  const source = new Hypercore('/tmp/rc/source')
  await source.ready()
  const sourceReplica = new Hypercore('/tmp/rc/source-r', source.key)
  await sourceReplica.ready()
  pipe(source, sourceReplica)

  // Stage 2 — TRANSFORM: its own writer log, fed by reacting to SOURCE.
  const transform = new Hypercore('/tmp/rc/transform')
  await transform.ready()
  const transformReplica = new Hypercore('/tmp/rc/transform-r', transform.key)
  await transformReplica.ready()
  pipe(transform, transformReplica)

  // TRANSFORM reacts to each source append (live) and emits a derived record.
  ;(async () => {
    for await (const block of sourceReplica.createReadStream({ live: true })) {
      const n = Number(b4a.toString(block).split('-')[1])
      await transform.append(b4a.from('squared-' + (n * n)))
      console.log(JSON.stringify({ stage: 'transform', reactedTo: b4a.toString(block), emitted: 'squared-' + (n * n), cursor: sourceReplica.contiguousLength }))
    }
  })()

  // Stage 3 — SINK reacts to each transform append (live). End of the cascade.
  let sunk = 0
  ;(async () => {
    for await (const block of transformReplica.createReadStream({ live: true })) {
      sunk++
      console.log(JSON.stringify({ stage: 'sink', reacted: b4a.toString(block), cursor: transformReplica.contiguousLength }))
      if (sunk >= 4) { console.log(JSON.stringify({ done: true, cascaded: sunk })); Bare.exit(0) }
    }
  })()

  // SOURCE appends events on an interval — AFTER everyone is already tailing.
  let seq = 0
  const iv = setInterval(async () => { await source.append(b4a.from('event-' + seq)); console.log(JSON.stringify({ stage: 'source', appended: 'event-' + seq, head: source.length })); seq++ }, 600)
  if (iv.unref) iv.unref()
  setTimeout(() => { console.log(JSON.stringify({ timeout: true, cascaded: sunk })); Bare.exit(sunk > 0 ? 0 : 1) }, 12000)
}
main().catch((e) => { console.log('ERR ' + (e.stack || e.message || e)); Bare.exit(1) })
