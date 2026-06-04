// Does isomorphic-git produce identical results on Hyperdrive as on bare-fs?
//
// Runs the same git flow (init, add, commit x2, log) on both backends.
// Compares: commit hashes, log entries, blob content. If the hashes match,
// the Hyperdrive adapter is correct — git's content-addressing guarantees
// identical objects produce identical hashes.
//
// Also tests the plumbing API path (writeBlob, writeTree, writeCommit) on
// Hyperdrive — the P2P native write path with no working tree.

import * as git from './node_modules/isomorphic-git/index.js'
import bareFs from 'bare-fs'
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import { createFs } from './hyperdrive-fs.mjs'

const BARE_DIR = '/tmp/git-bare-fs'
const DRIVE_DIR = '/'
const AUTHOR = { name: 'spl', email: 's@splectrum' }

async function runPorcelain (fs, dir, label) {
  await git.init({ fs, dir })

  const file1 = dir === '/' ? '/hello.txt' : dir + '/hello.txt'
  await fs.promises.writeFile(file1, 'hello mycelium\n')
  await git.add({ fs, dir, filepath: 'hello.txt' })
  const sha1 = await git.commit({ fs, dir, message: 'first commit', author: AUTHOR })

  await fs.promises.writeFile(file1, 'hello mycelium\nsecond line\n')
  await git.add({ fs, dir, filepath: 'hello.txt' })
  const sha2 = await git.commit({ fs, dir, message: 'second commit', author: AUTHOR })

  const logs = await git.log({ fs, dir })
  const { blob } = await git.readBlob({ fs, dir, oid: logs[0].commit.tree, filepath: 'hello.txt' })

  return {
    label,
    sha1: sha1.slice(0, 12),
    sha2: sha2.slice(0, 12),
    logCount: logs.length,
    msgs: logs.map(l => l.commit.message.trim()),
    parent: logs[0].commit.parent[0] && logs[0].commit.parent[0].slice(0, 12),
    blobContent: Buffer.from(blob).toString()
  }
}

async function runPlumbing (fs, dir, label) {
  await git.init({ fs, dir })

  // writeBlob/writeTree/writeCommit return OID strings directly
  const blobOid = await git.writeBlob({ fs, dir, blob: new Uint8Array(Buffer.from('plumbing test\n')) })
  const treeOid = await git.writeTree({
    fs, dir,
    tree: [{ mode: '100644', path: 'test.txt', oid: blobOid, type: 'blob' }]
  })
  const commitOid = await git.writeCommit({
    fs, dir,
    commit: {
      tree: treeOid,
      parent: [],
      author: { name: 'spl', email: 's@splectrum', timestamp: 1000000, timezoneOffset: 0 },
      committer: { name: 'spl', email: 's@splectrum', timestamp: 1000000, timezoneOffset: 0 },
      message: 'plumbing commit\n'
    }
  })

  await git.writeRef({ fs, dir, ref: 'refs/heads/main', value: commitOid })

  // Read it all back
  const { commit } = await git.readCommit({ fs, dir, oid: commitOid })
  const { tree: entries } = await git.readTree({ fs, dir, oid: commit.tree })
  const { blob } = await git.readBlob({ fs, dir, oid: entries[0].oid })

  return {
    label,
    commitOid: commitOid.slice(0, 12),
    treeOid: treeOid.slice(0, 12),
    blobOid: blobOid.slice(0, 12),
    treePath: entries[0].path,
    blobContent: Buffer.from(blob).toString(),
    message: commit.message.trim()
  }
}

async function main () {
  // --- Porcelain: bare-fs vs Hyperdrive ---
  bareFs.rmSync(BARE_DIR, { recursive: true, force: true })
  bareFs.mkdirSync(BARE_DIR, { recursive: true })
  const bareResult = await runPorcelain(bareFs, BARE_DIR, 'bare-fs')

  const store = new Corestore('/tmp/corestore-probe')
  const drive = new Hyperdrive(store)
  await drive.ready()
  const driveFs = createFs(drive)
  const driveResult = await runPorcelain(driveFs, DRIVE_DIR, 'hyperdrive')

  const porcelainMatch = bareResult.sha1 === driveResult.sha1
    && bareResult.sha2 === driveResult.sha2
    && bareResult.logCount === driveResult.logCount
    && bareResult.blobContent === driveResult.blobContent

  console.log(JSON.stringify({ test: 'porcelain', barefs: bareResult, hyperdrive: driveResult, hashesMatch: porcelainMatch }, null, 2))

  // --- Plumbing: Hyperdrive vs bare-fs (the P2P native write path) ---
  const store2 = new Corestore('/tmp/corestore-plumbing')
  const drive2 = new Hyperdrive(store2)
  await drive2.ready()
  const plumbingHd = await runPlumbing(createFs(drive2), '/', 'hyperdrive-plumbing')

  const plumbDir = '/tmp/git-plumbing'
  bareFs.rmSync(plumbDir, { recursive: true, force: true })
  bareFs.mkdirSync(plumbDir, { recursive: true })
  const plumbingBf = await runPlumbing(bareFs, plumbDir, 'bare-fs-plumbing')

  const plumbingMatch = plumbingHd.commitOid === plumbingBf.commitOid
    && plumbingHd.treeOid === plumbingBf.treeOid
    && plumbingHd.blobOid === plumbingBf.blobOid
    && plumbingHd.blobContent === plumbingBf.blobContent

  console.log(JSON.stringify({ test: 'plumbing', barefs: plumbingBf, hyperdrive: plumbingHd, hashesMatch: plumbingMatch }, null, 2))

  // --- Summary ---
  console.log(JSON.stringify({
    summary: {
      porcelainHashesMatch: porcelainMatch,
      plumbingHashesMatch: plumbingMatch,
      adapterWorks: porcelainMatch && plumbingMatch
    }
  }))

  await store.close()
  await store2.close()
  Bare.exit(porcelainMatch && plumbingMatch ? 0 : 1)
}

main().catch(e => { console.log('ERR ' + (e.stack || e.message || e)); Bare.exit(1) })
