// Does isomorphic-git run under Bare, unmodified, as a native git for a peer?
// (Today lib/git shells out to the system `git` binary — absent in a distroless/Pear
// peer. A pure-JS git that runs in-process would make git a base-layer citizen.)
//
// Run the local git core against bare-fs: init / add / commit (x2) / log, then prove
// the ".git reconstructs the working tree" property — delete the file, checkout HEAD,
// it comes back. No network, no native deps.
//
// GOTCHA pinned: import the ESM build (index.js) explicitly. isomorphic-git's CJS /
// "node" build hard-`require`s node 'crypto', and Bare resolves the "node" export
// condition by default → MODULE_NOT_FOUND. The ESM build references crypto.subtle
// inside a try/catch and falls back to pure-JS sha.js, which is what Bare needs.
import * as git from './node_modules/isomorphic-git/index.js'
import fs from 'bare-fs'

const dir = '/tmp/repo'
async function main () {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })

  await git.init({ fs, dir })
  fs.writeFileSync(dir + '/hello.txt', 'hello mycelium\n')
  await git.add({ fs, dir, filepath: 'hello.txt' })
  const sha1 = await git.commit({ fs, dir, message: 'first commit', author: { name: 'spl', email: 's@splectrum' } })

  fs.writeFileSync(dir + '/hello.txt', 'hello mycelium\nsecond line\n')
  await git.add({ fs, dir, filepath: 'hello.txt' })
  const sha2 = await git.commit({ fs, dir, message: 'second commit', author: { name: 'spl', email: 's@splectrum' } })

  const logs = await git.log({ fs, dir })

  // ".git reconstructs the working tree": delete the file, checkout HEAD to restore it.
  fs.unlinkSync(dir + '/hello.txt')
  const goneAfterDelete = !fs.existsSync(dir + '/hello.txt')
  await git.checkout({ fs, dir, ref: 'HEAD', force: true })
  const restored = fs.readFileSync(dir + '/hello.txt').toString()

  console.log(JSON.stringify({
    init: true,
    commit1: sha1.slice(0, 12),
    commit2: sha2.slice(0, 12),
    logCount: logs.length,
    logMsgs: logs.map((l) => l.commit.message.trim()),
    parentLink: logs[0].commit.parent[0] && logs[0].commit.parent[0].slice(0, 12),
    reconstructedFromGit: goneAfterDelete && restored === 'hello mycelium\nsecond line\n'
  }))
  Bare.exit(0)
}
main().catch((e) => { console.log('ERR ' + (e.stack || e.message || e)); Bare.exit(1) })
