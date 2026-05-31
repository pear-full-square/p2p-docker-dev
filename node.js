// Phase 0.2 — a long-running Bare node.
//
// Announces itself, then emits a heartbeat on an interval until it's stopped.
// Structured stdout (one JSON object per line) is the monitoring substrate the
// whole cluster is watched through — no extra transport, just stdout.
//
//   bare node.js <name> <heartbeat-ms>
const name = Bare.argv[2] || 'node-0'
const intervalMs = Number(Bare.argv[3]) || 2000

function emit (event, extra = {}) {
  console.log(JSON.stringify({ node: name, event, phase: '0.2', ...extra }))
}

const startedAt = Date.now()
let seq = 0

emit('start', { interval_ms: intervalMs })
setInterval(() => {
  emit('heartbeat', { seq: seq++, uptime_ms: Date.now() - startedAt })
}, intervalMs)
