# probe: isomorphic-git-under-bare

**Question:** the Mycelium design leans on **git as a base-layer citizen** — the
version layer, commit-broadcast, the checkout model. But `lib/git` shells out to the
system `git` binary, which a distroless/Pear peer doesn't have. Can a **pure-JS git**
(isomorphic-git) run **in-process under Bare, unmodified**, so a peer does real git
with no binary and no fork?

The probe runs the local git core against `bare-fs`: `init` / `add` / `commit` (×2) /
`log`, then proves the **".git reconstructs the working tree"** property central to the
storage model — delete the working file, `checkout HEAD`, it comes back. No network,
no native deps.

## Run

```
./run.sh        # builds the probe image, runs the flow, writes run.log
```

## Conclusion

isomorphic-git runs under Bare **unmodified** — so it's a plain **npm dependency, not
a bare-for-pear fork.** Its deps are all pure JS (`pako` zlib, `sha.js` hashing,
`diff3` merge); `Buffer` is a Bare global; with no WebCrypto present, its SHA path
falls back to pure-JS `sha.js`. `run.log` shows two linked commits (the parent DAG),
and the working tree rebuilt from `.git` after deletion.

**Gotcha pinned — use the ESM build.** isomorphic-git's CJS / `"node"` export build
hard-`require`s node `crypto` (a fast-path), and **Bare resolves the `"node"`
condition by default** → `MODULE_NOT_FOUND: crypto`. Import the **ESM build**
(`index.js`) explicitly — it references `crypto.subtle` inside a try/catch and falls
back to `sha.js`. In real use this is a thin wrapper *we own* (select the ESM entry +
pass `bare-fs`), not a patch to isomorphic-git.

**What this de-risks (and what remains).** "Can git live in a Bare peer?" → **yes,
proven.** The integration surface is now just **adapters we own**, zero upstream
changes: the `fs` plugin (here `bare-fs`; later a **Hyperdrive-fs** adapter puts the
object store on a replicated drive — git-on-Hyperdrive via the *same* ~10-method fs
surface, not a storage rewrite), and the ~50-line `GitHttp` transport interface (a
**protomux** channel → git-over-P2P / commit-broadcast). Commit-broadcast itself is an
add-on *around* git (wrap commit → append the id to a Hypercore). Residual unknowns
are now performance of the Hyperdrive-fs checkout (hydrate/harvest) and working-tree
fidelity (symlinks/modes) — **not git feasibility**.
