// Phase 0.1 — a Bare node emits one structured event line, then exits.
// Structured stdout is how the rig (and an agent) observes nodes.
const name = Bare.argv[2] || 'node-0'
console.log(JSON.stringify({ node: name, event: 'hello', phase: '0.1' }))
