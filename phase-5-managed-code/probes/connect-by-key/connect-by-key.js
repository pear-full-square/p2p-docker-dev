// Two proofs for the worker-identity step, under Bare, self-contained (own bootstrap):
//
//  1) DERIVE — a worker's identity keypair is deterministic from the cluster seed +
//     its name: seed_w = H(clusterSeed || name); keyPair = DHT.keyPair(seed_w). So
//     the manager (holding the seed) can publish every worker's public key, while a
//     worker holds only its own derived secret — the seed itself never leaves the
//     manager (H is one-way).
//
//  2) CONNECT-BY-KEY — a client reaches a SPECIFIC worker by its public key
//     (swarm.joinPeer), sharing NO topic with it. This is the base "target a specific
//     node" op that all management rests on (HyperDHT's core primitive is connect-to-key;
//     topic discovery is the discover-many layer on top).
const Hyperswarm = require('hyperswarm')
const DHT = require('hyperdht')
const sodium = require('sodium-native')
const b4a = require('b4a')

function workerSeed (clusterSeedHex, name) {
  const out = b4a.alloc(32)
  sodium.crypto_generichash(out, b4a.concat([b4a.from(clusterSeedHex, 'hex'), b4a.from(name)]))
  return out
}

async function main () {
  // 1) DERIVE — deterministic, and the same name gives the same key every time.
  const SEED = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
  const kpA1 = DHT.keyPair(workerSeed(SEED, 'worker-a'))
  const kpA2 = DHT.keyPair(workerSeed(SEED, 'worker-a'))
  const kpB = DHT.keyPair(workerSeed(SEED, 'worker-b'))
  console.log(JSON.stringify({
    proof: 'derive',
    deterministic: b4a.equals(kpA1.publicKey, kpA2.publicKey),
    distinct: !b4a.equals(kpA1.publicKey, kpB.publicKey),
    workerA: b4a.toString(kpA1.publicKey, 'hex').slice(0, 16),
    workerB: b4a.toString(kpB.publicKey, 'hex').slice(0, 16)
  }))

  // 2) CONNECT-BY-KEY — keyed server, client reaches it by key with no shared topic.
  const boot = DHT.bootstrapper(49999, '127.0.0.1'); await boot.ready()
  const bootstrap = [{ host: '127.0.0.1', port: 49999 }]

  const server = new Hyperswarm({ keyPair: kpB, dht: new DHT({ bootstrap, firewalled: false, port: 50001 }) })
  server.on('connection', (conn) => { conn.on('error', () => {}) })
  server.join(b4a.alloc(32, 9), { server: true, client: false })   // an UNRELATED topic
  await server.flush()

  const client = new Hyperswarm({ dht: new DHT({ bootstrap, firewalled: false, port: 50002 }) })
  client.on('connection', (conn, info) => {
    conn.on('error', () => {})
    const match = b4a.equals(info.publicKey, kpB.publicKey)
    console.log(JSON.stringify({ proof: 'connect-by-key', reached: b4a.toString(info.publicKey, 'hex').slice(0, 16), matchesTarget: match, sharedTopic: false }))
    if (match) Bare.exit(0)
  })
  client.joinPeer(kpB.publicKey)   // target a specific node by key
  setTimeout(() => { console.log(JSON.stringify({ proof: 'connect-by-key', error: 'no connection within timeout' })); Bare.exit(1) }, 12000)
}
main().catch((e) => { console.log(JSON.stringify({ error: String(e && e.message || e) })); Bare.exit(1) })
