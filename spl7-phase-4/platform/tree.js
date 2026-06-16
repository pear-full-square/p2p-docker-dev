// Master data view — the swarm setup tree.
// Seeds a richer structure than earlier phases: swarm config, package
// catalog entries, and the platform's own node entry under swarm/.
var b4a = require('b4a')

var FOLDERS = {
  packages: 'available software — catalog of packages that can be activated on a node',
  modules: 'installed software — active on this node, selected from packages',
  components: 'available SPLectrum components — catalog of data owners',
  config: 'runtime and execution configuration — node identity, role, wiring',
  home: 'own space — component instances, host exchange',
  swarm: 'full swarm data view — the swarm as seen from this node'
}

var PACKAGES = {
  mycelium: {
    name: 'mycelium',
    description: 'data fabric base layer — git + XPath + URI on Hyperdrive',
    version: '0.1.0'
  },
  hyperdrivefs: {
    name: 'hyperdrivefs',
    description: 'fs adapter — maps isomorphic-git onto Hyperdrive v11',
    version: '0.1.0'
  }
}

var AUTHOR = { name: 'spl', email: 'spl@splectrum' }

function encode (obj) {
  return Buffer.from(JSON.stringify(obj, null, 2) + '\n')
}

async function seedTree (repo, swarmConfig, platformIdentity, emit) {
  var gitLayer = repo.git
  var rootEntries = []
  var names = Object.keys(FOLDERS)

  for (var i = 0; i < names.length; i++) {
    var name = names[i]
    var meta = { name: name, description: FOLDERS[name] }
    var subtreeEntries = []

    // _meta for every folder
    var metaBlobOid = await gitLayer.writeBlob(encode(meta))
    subtreeEntries.push({ mode: '100644', path: '_meta', oid: metaBlobOid, type: 'blob' })

    if (name === 'config') {
      var identityOid = await gitLayer.writeBlob(encode(platformIdentity))
      subtreeEntries.push({ mode: '100644', path: 'identity', oid: identityOid, type: 'blob' })

      var swarmConfigOid = await gitLayer.writeBlob(encode(swarmConfig))
      subtreeEntries.push({ mode: '100644', path: 'swarm', oid: swarmConfigOid, type: 'blob' })
    }

    if (name === 'packages') {
      var pkgNames = Object.keys(PACKAGES)
      for (var j = 0; j < pkgNames.length; j++) {
        var pkg = PACKAGES[pkgNames[j]]
        var pkgMetaOid = await gitLayer.writeBlob(encode(pkg))
        var pkgSubtreeOid = await gitLayer.writeTree([
          { mode: '100644', path: '_meta', oid: pkgMetaOid, type: 'blob' }
        ])
        subtreeEntries.push({ mode: '040000', path: pkgNames[j], oid: pkgSubtreeOid, type: 'tree' })
      }
    }

    if (name === 'swarm') {
      // Platform registers itself under swarm/
      var platformNodeMeta = {
        name: 'platform',
        role: 'platform',
        driveKey: platformIdentity.driveKey,
        registered: new Date().toISOString()
      }
      var pnMetaOid = await gitLayer.writeBlob(encode(platformNodeMeta))
      var pnSubtreeOid = await gitLayer.writeTree([
        { mode: '100644', path: '_meta', oid: pnMetaOid, type: 'blob' }
      ])
      subtreeEntries.push({ mode: '040000', path: 'platform', oid: pnSubtreeOid, type: 'tree' })
    }

    var subtreeOid = await gitLayer.writeTree(subtreeEntries)
    rootEntries.push({ mode: '040000', path: name, oid: subtreeOid, type: 'tree' })

    emit('seeded', { path: '/' + name })
  }

  var rootTreeOid = await gitLayer.writeTree(rootEntries)
  var commitOid = await repo.commitTree(rootTreeOid, 'seed swarm setup', AUTHOR)
  emit('committed', { oid: commitOid })

  return commitOid
}

// Register a node in the swarm/ folder — put + commit on the live repo.
async function registerNode (repo, name, info, emit) {
  var path = '/swarm/' + name + '/_meta'
  var treeOid = await repo.put(path, encode(info))
  var commitOid = await repo.commitTree(treeOid, 'register node: ' + name, AUTHOR)
  emit('node-registered', { name: name, commitOid: commitOid })
  return commitOid
}

module.exports = { seedTree: seedTree, registerNode: registerNode, FOLDERS: FOLDERS, AUTHOR: AUTHOR }
