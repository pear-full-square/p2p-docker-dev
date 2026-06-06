// Drive content — seeded on first run. Apps are self-contained scripts that
// run directly: ./apps/hello.js (shebang → ../bin/bare).
// When run via the API, they're loaded with require() and called with a ctx.
// The bare binary is NOT on the drive — it's in the container image and
// overlaid onto the FUSE mount by the mount layer.
var b4a = require('b4a')

var README = 'SPLectrum swarm — the P2P software distribution drive.\n'

var REGISTRY = {
  name: 'splectrum-swarm',
  version: '0.1.0',
  apps: {
    'hello': {
      path: '/apps/hello.js',
      description: 'Hello world — proves code mobility from the drive'
    },
    'drive-stats': {
      path: '/apps/drive-stats.js',
      description: 'List drive contents with sizes and version info'
    },
    'peer-ping': {
      path: '/apps/peer-ping.js',
      description: 'Show connected peers and swarm status'
    }
  }
}

// Apps are dual-mode: directly executable (shebang → bare) OR require()'d by
// the API runner. When run directly, module.parent is null (bare) or
// require.main === module (node); when require()'d, module.exports is used.

var APPS = {
  '/apps/hello.js': [
    '#!/usr/bin/env -S ../bin/bare',
    'var app = {',
    '  name: "hello",',
    '  description: "Hello world — proves code mobility from the drive",',
    '  run: function (ctx) {',
    '    var result = { message: "Hello from the swarm drive!", node: ctx.nodeName };',
    '    ctx.emit("hello", result);',
    '    return result;',
    '  }',
    '};',
    'module.exports = app;',
    'if (typeof __filename !== "undefined") {',
    '  var name = typeof Bare !== "undefined" ? "bare-host" : "node-host";',
    '  var exit = typeof Bare !== "undefined" ? Bare.exit : process.exit;',
    '  var r = app.run({ nodeName: name, emit: function (e, d) { console.log(JSON.stringify(d)); } });',
    '  if (r && typeof r.then === "function") r.then(function () { exit(0); });',
    '  else exit(0);',
    '}'
  ].join('\n'),

  '/apps/drive-stats.js': [
    '#!/usr/bin/env -S ../bin/bare',
    'var app = {',
    '  name: "drive-stats",',
    '  description: "List drive contents with sizes and version info",',
    '  run: async function (ctx) {',
    '    var files = [];',
    '    for await (var entry of ctx.drive.list("/")) {',
    '      var size = entry.value && entry.value.blob ? entry.value.blob.byteLength : 0;',
    '      files.push({ path: entry.key, size: size });',
    '    }',
    '    var result = {',
    '      version: ctx.drive.version,',
    '      writable: ctx.drive.writable,',
    '      files: files,',
    '      totalBytes: files.reduce(function (s, f) { return s + f.size; }, 0)',
    '    };',
    '    ctx.emit("drive-stats", result);',
    '    return result;',
    '  }',
    '};',
    'module.exports = app;'
  ].join('\n'),

  '/apps/peer-ping.js': [
    '#!/usr/bin/env -S ../bin/bare',
    'var app = {',
    '  name: "peer-ping",',
    '  description: "Show connected peers and swarm status",',
    '  run: function (ctx) {',
    '    var peers = [];',
    '    for (var conn of ctx.swarm.connections) {',
    '      peers.push(conn.remotePublicKey.toString("hex").slice(0, 16));',
    '    }',
    '    var result = { node: ctx.nodeName, peers: peers, count: peers.length };',
    '    ctx.emit("peer-ping", result);',
    '    return result;',
    '  }',
    '};',
    'module.exports = app;'
  ].join('\n')
}

async function seedContent (drive, emitFn) {
  function emit (event, extra) {
    if (emitFn) emitFn(event, extra)
  }

  await drive.put('/README.md', b4a.from(README))
  emit('seeded', { path: '/README.md', bytes: README.length })

  var reg = JSON.stringify(REGISTRY, null, 2) + '\n'
  await drive.put('/registry.json', b4a.from(reg))
  emit('seeded', { path: '/registry.json', bytes: reg.length })

  var paths = Object.keys(APPS)
  for (var i = 0; i < paths.length; i++) {
    var p = paths[i]
    await drive.put(p, b4a.from(APPS[p]))
    emit('seeded', { path: p, bytes: APPS[p].length })
  }

}

module.exports = { seedContent: seedContent }
