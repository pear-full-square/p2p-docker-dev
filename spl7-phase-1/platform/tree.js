// Master data view — the six-folder tree structure for a swarm node.
// Each folder gets a _meta file (underscore-prefixed = metadata dimension).
// The platform node seeds this on first run; joining nodes replicate it.
var b4a = require('b4a')

var FOLDERS = {
  packages: 'available software — catalog of packages that can be activated on a node',
  modules: 'installed software — active on this node, selected from packages',
  components: 'available SPLectrum components — catalog of data owners',
  config: 'runtime and execution configuration — node identity, role, wiring',
  home: 'own space — component instances, host exchange',
  swarm: 'full swarm data view — the swarm as seen from this node'
}

function encode (obj) {
  return b4a.from(JSON.stringify(obj, null, 2) + '\n')
}

async function seedTree (drive, identity, emit) {
  var names = Object.keys(FOLDERS)
  for (var i = 0; i < names.length; i++) {
    var name = names[i]
    var meta = { name: name, description: FOLDERS[name] }
    var path = '/' + name + '/_meta'
    await drive.put(path, encode(meta))
    emit('seeded', { path: path })
  }

  await drive.put('/config/identity', encode(identity))
  emit('seeded', { path: '/config/identity' })
}

module.exports = { seedTree: seedTree, FOLDERS: FOLDERS }
