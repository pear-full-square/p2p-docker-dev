// Fork — copy a git tree from one mycelium repo to another.
// Walks the source tree recursively, copies all objects (blobs and subtrees)
// to the target repo's git layer. Git content-addressing means identical
// content produces identical OIDs — the fork is structurally equivalent.

async function forkTree (sourceRepo, targetRepo) {
  var sourceLog = await sourceRepo.log('main', 1)
  var rootTreeOid = sourceLog[0].commit.tree
  var targetGit = targetRepo.git

  async function copyTree (oid) {
    var entries = await sourceRepo.git.readTree(oid)
    var targetEntries = []

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i]

      if (entry.type === 'tree' || entry.mode === '040000') {
        var subtreeOid = await copyTree(entry.oid)
        targetEntries.push({ mode: '040000', path: entry.path, oid: subtreeOid, type: 'tree' })
      } else {
        var blob = await sourceRepo.git.readBlob(entry.oid)
        var blobOid = await targetGit.writeBlob(blob)
        targetEntries.push({ mode: entry.mode, path: entry.path, oid: blobOid, type: 'blob' })
      }
    }

    return targetGit.writeTree(targetEntries)
  }

  var newRootOid = await copyTree(rootTreeOid)
  return newRootOid
}

module.exports = { forkTree: forkTree }
