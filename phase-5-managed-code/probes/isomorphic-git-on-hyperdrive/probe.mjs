// Round-trip test: bare-fs → Hyperdrive → bare-fs
//
// 1. Create a git repo on bare-fs (porcelain: init, add, commit x2)
// 2. Copy all git objects + refs into Hyperdrive via the adapter
// 3. Copy everything back from Hyperdrive to a second bare-fs repo
// 4. Compare: logs, hashes, blob content must be identical
//
// Also tests the plumbing API (writeBlob → writeTree → writeCommit)
// on both backends for the P2P native write path.

import * as git from './node_modules/isomorphic-git/index.js'
import bareFs from 'bare-fs'
import path from 'bare-path'
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import { createFs } from './hyperdrive-fs.mjs'

const AUTHOR = { name: 'spl', email: 's@splectrum' }

// Recursively walk a directory and return all file paths (relative)
async function walkDir (fs, base, dir) {
  const files = []
  const entries = await fs.promises.readdir(dir)
  for (const entry of entries) {
    const full = dir + '/' + entry
    const rel = full.slice(base.length)
    try {
      const stat = await fs.promises.lstat(full)
      if (stat.isDirectory()) {
        const sub = await walkDir(fs, base, full)
        files.push(...sub)
      } else {
        files.push(rel)
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
  }
  return files
}

// Copy all files from one fs/dir to another
async function copyGitDir (srcFs, srcDir, dstFs, dstDir) {
  const gitDir = srcDir + '/.git'
  const files = await walkDir(srcFs, gitDir, gitDir)
  let copied = 0
  for (const rel of files) {
    const src = gitDir + rel
    const dst = dstDir + '/.git' + rel
    const content = await srcFs.promises.readFile(src)
    // Ensure parent directory exists
    const parent = dst.split('/').slice(0, -1).join('/')
    await dstFs.promises.mkdir(parent, { recursive: true })
    await dstFs.promises.writeFile(dst, content)
    copied++
  }
  return { files: copied, paths: files.slice(0, 5) }
}

async function createTestRepo (fs, dir) {
  await git.init({ fs, dir })

  const file1 = dir + '/hello.txt'
  await fs.promises.writeFile(file1, 'hello mycelium\n')
  await git.add({ fs, dir, filepath: 'hello.txt' })
  const sha1 = await git.commit({ fs, dir, message: 'first commit', author: AUTHOR })

  await fs.promises.writeFile(file1, 'hello mycelium\nsecond line\n')
  await git.add({ fs, dir, filepath: 'hello.txt' })
  const sha2 = await git.commit({ fs, dir, message: 'second commit', author: AUTHOR })

  // Add a subdirectory to test tree nesting
  const dir2 = dir + '/sub'
  await fs.promises.mkdir(dir2, { recursive: true })
  await fs.promises.writeFile(dir2 + '/nested.txt', 'nested content\n')
  await git.add({ fs, dir, filepath: 'sub/nested.txt' })
  const sha3 = await git.commit({ fs, dir, message: 'add nested file', author: AUTHOR })

  return { sha1, sha2, sha3 }
}

async function readRepoState (fs, dir, label) {
  const logs = await git.log({ fs, dir })
  const headCommit = logs[0]

  // Read a blob via the tree
  const { blob } = await git.readBlob({
    fs, dir, oid: headCommit.commit.tree, filepath: 'hello.txt'
  })
  const { blob: nestedBlob } = await git.readBlob({
    fs, dir, oid: headCommit.commit.tree, filepath: 'sub/nested.txt'
  })

  return {
    label,
    logCount: logs.length,
    hashes: logs.map(l => l.oid.slice(0, 12)),
    msgs: logs.map(l => l.commit.message.trim()),
    helloContent: Buffer.from(blob).toString(),
    nestedContent: Buffer.from(nestedBlob).toString()
  }
}

async function runPlumbing (fs, dir, label) {
  await git.init({ fs, dir })

  const blobOid = await git.writeBlob({
    fs, dir, blob: new Uint8Array(Buffer.from('plumbing test\n'))
  })
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

  const { commit } = await git.readCommit({ fs, dir, oid: commitOid })
  const { tree: entries } = await git.readTree({ fs, dir, oid: commit.tree })
  const { blob } = await git.readBlob({ fs, dir, oid: entries[0].oid })

  return {
    label,
    commitOid: commitOid.slice(0, 12),
    treeOid: treeOid.slice(0, 12),
    blobOid: blobOid.slice(0, 12),
    blobContent: Buffer.from(blob).toString()
  }
}

async function main () {
  // ============================================================
  // Test 1: Round-trip — bare-fs → Hyperdrive → bare-fs
  // ============================================================

  // Step 1: Create repo on bare-fs
  const srcDir = '/tmp/git-source'
  bareFs.rmSync(srcDir, { recursive: true, force: true })
  bareFs.mkdirSync(srcDir, { recursive: true })
  const created = await createTestRepo(bareFs, srcDir)
  const srcState = await readRepoState(bareFs, srcDir, 'source (bare-fs)')

  // Step 2: Copy to Hyperdrive
  const store1 = new Corestore('/tmp/corestore-roundtrip')
  const drive1 = new Hyperdrive(store1)
  await drive1.ready()
  const driveFs = createFs(drive1)
  const toHd = await copyGitDir(bareFs, srcDir, driveFs, '')
  const hdState = await readRepoState(driveFs, '/', 'hyperdrive')

  // Step 3: Copy back to bare-fs
  const dstDir = '/tmp/git-restored'
  bareFs.rmSync(dstDir, { recursive: true, force: true })
  bareFs.mkdirSync(dstDir, { recursive: true })
  const fromHd = await copyGitDir(driveFs, '', bareFs, dstDir)
  const dstState = await readRepoState(bareFs, dstDir, 'restored (bare-fs)')

  const roundTripMatch =
    JSON.stringify(srcState.hashes) === JSON.stringify(dstState.hashes) &&
    JSON.stringify(srcState.msgs) === JSON.stringify(dstState.msgs) &&
    srcState.helloContent === dstState.helloContent &&
    srcState.nestedContent === dstState.nestedContent &&
    srcState.logCount === dstState.logCount

  console.log(JSON.stringify({
    test: 'round-trip (bare-fs → hyperdrive → bare-fs)',
    source: srcState,
    hyperdrive: hdState,
    restored: dstState,
    copied: { toHyperdrive: toHd.files, fromHyperdrive: fromHd.files },
    roundTripMatch
  }, null, 2))

  // ============================================================
  // Test 2: Plumbing — Hyperdrive vs bare-fs
  // ============================================================

  const store2 = new Corestore('/tmp/corestore-plumbing')
  const drive2 = new Hyperdrive(store2)
  await drive2.ready()
  const plumbingHd = await runPlumbing(createFs(drive2), '/', 'hyperdrive-plumbing')

  const plumbDir = '/tmp/git-plumbing'
  bareFs.rmSync(plumbDir, { recursive: true, force: true })
  bareFs.mkdirSync(plumbDir, { recursive: true })
  const plumbingBf = await runPlumbing(bareFs, plumbDir, 'bare-fs-plumbing')

  const plumbingMatch = plumbingHd.commitOid === plumbingBf.commitOid &&
    plumbingHd.treeOid === plumbingBf.treeOid &&
    plumbingHd.blobOid === plumbingBf.blobOid

  console.log(JSON.stringify({
    test: 'plumbing',
    barefs: plumbingBf,
    hyperdrive: plumbingHd,
    hashesMatch: plumbingMatch
  }, null, 2))

  // ============================================================
  // Summary
  // ============================================================

  console.log(JSON.stringify({
    summary: {
      roundTripMatch,
      plumbingHashesMatch: plumbingMatch,
      adapterWorks: roundTripMatch && plumbingMatch
    }
  }))

  await store1.close()
  await store2.close()
  Bare.exit(roundTripMatch && plumbingMatch ? 0 : 1)
}

main().catch(e => { console.log('ERR ' + (e.stack || e.message || e)); Bare.exit(1) })
