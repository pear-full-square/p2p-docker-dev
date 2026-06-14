// Master data view — seeds the six-folder tree as a git repo on the Hyperdrive.
// Builds the full tree in one pass via the git layer, then commits once.
var b4a = require('b4a')

var FOLDERS = {
  packages: 'available software — catalog of packages that can be activated on a node',
  modules: 'installed software — active on this node, selected from packages',
  components: 'available SPLectrum components — catalog of data owners',
  config: 'runtime and execution configuration — node identity, role, wiring',
  home: 'own space — component instances, host exchange',
  swarm: 'full swarm data view — the swarm as seen from this node'
}

var AUTHOR = { name: 'spl', email: 'spl@splectrum' }

function encode (obj) {
  return Buffer.from(JSON.stringify(obj, null, 2) + '\n')
}

async function seedTree (repo, identity, emit) {
  var gitLayer = repo.git
  var rootEntries = []
  var names = Object.keys(FOLDERS)

  for (var i = 0; i < names.length; i++) {
    var name = names[i]
    var meta = { name: name, description: FOLDERS[name] }
    var metaBlobOid = await gitLayer.writeBlob(encode(meta))

    var subtreeEntries = [
      { mode: '100644', path: '_meta', oid: metaBlobOid, type: 'blob' }
    ]

    // config gets an identity file too
    if (name === 'config') {
      var identityBlobOid = await gitLayer.writeBlob(encode(identity))
      subtreeEntries.push({ mode: '100644', path: 'identity', oid: identityBlobOid, type: 'blob' })
    }

    var subtreeOid = await gitLayer.writeTree(subtreeEntries)
    rootEntries.push({ mode: '040000', path: name, oid: subtreeOid, type: 'tree' })

    emit('seeded', { path: '/' + name + '/_meta' })
    if (name === 'config') emit('seeded', { path: '/config/identity' })
  }

  var rootTreeOid = await gitLayer.writeTree(rootEntries)
  var commitOid = await repo.commitTree(rootTreeOid, 'seed master data view', AUTHOR)
  emit('committed', { oid: commitOid })

  return commitOid
}

module.exports = { seedTree: seedTree, FOLDERS: FOLDERS, AUTHOR: AUTHOR }
