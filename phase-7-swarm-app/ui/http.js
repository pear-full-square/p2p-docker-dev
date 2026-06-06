// HTTP server for the swarm UI. Shared by seed and peer.
//
// Seed serves: dashboard (top nav + node switcher + iframe) at /
//              node SPA at /node (for its own iframe view)
// Peer serves: node SPA at /
//
// API:
//   GET /api/ls?path=/        — list directory contents
//   GET /api/file?path=...    — read file contents
//   GET /api/status           — drive + swarm status
//   GET /api/nodes            — registered nodes (seed only)
//   POST /api/register        — peer self-registration (seed only)
//   GET /api/world/status     — world view status.json
//   GET /api/world/peers      — world view peers.json
//   GET /api/world/runs       — world view run history
//   GET /api/world/ls?path=/  — list world view drive
var http = typeof Bare !== 'undefined' ? require('bare-http1') : require('http')
var b4a = require('b4a')

var nodes = []

function startServer (drive, swarm, opts) {
  opts = opts || {}
  var port = opts.port || 8080
  var nodeName = opts.node || 'unknown'
  var externalUrl = opts.url || null
  var isSeed = opts.seed || false
  var worldView = opts.worldView || null

  function emit (event, extra) {
    console.log(JSON.stringify({ node: nodeName, event: event, time: Date.now(), ...(extra || {}) }))
  }

  if (isSeed && externalUrl) {
    nodes.length = 0
    nodes.push({ name: nodeName, url: externalUrl, role: 'seed', registered: Date.now() })
  }

  var server = http.createServer(function (req, res) {
    handleRequest(drive, swarm, nodeName, isSeed, worldView, req, res).catch(function (err) {
      try {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        var body = JSON.stringify({ error: String(err.message || err) })
        res.setHeader('Content-Length', Buffer.byteLength(body))
        res.end(body)
      } catch (_) {}
    })
  })

  server.listen(port, '0.0.0.0', function () {
    emit('http-ready', { port: port, url: externalUrl })
  })

  return server
}

async function handleRequest (drive, swarm, nodeName, isSeed, worldView, req, res) {
  var url = req.url || '/'
  var qIdx = url.indexOf('?')
  var pathname = qIdx === -1 ? url : url.slice(0, qIdx)
  var params = qIdx === -1 ? '' : url.slice(qIdx + 1)

  function getParam (name) {
    var prefix = name + '='
    var parts = params.split('&')
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(prefix)) return decodeURIComponent(parts[i].slice(prefix.length))
    }
    return null
  }

  if (pathname === '/') {
    respond(res, 200, 'text/html; charset=utf-8', isSeed ? dashboardHTML() : nodeHTML())
  } else if (pathname === '/node' && isSeed) {
    respond(res, 200, 'text/html; charset=utf-8', nodeHTML())
  } else if (pathname === '/api/ls') {
    var dirPath = getParam('path') || '/'
    var entries = await listDir(drive, dirPath)
    respondJSON(res, { path: dirPath, entries: entries })
  } else if (pathname === '/api/file') {
    var filePath = getParam('path')
    if (!filePath) { respondJSON(res, { error: 'path required' }, 400); return }
    var buf = await drive.get(filePath)
    if (!buf) { respondJSON(res, { error: 'not found' }, 404); return }
    respond(res, 200, guessContentType(filePath), buf)
  } else if (pathname === '/api/status') {
    var peers = []
    for (var conn of swarm.connections) {
      peers.push(b4a.toString(conn.remotePublicKey, 'hex').slice(0, 16))
    }
    respondJSON(res, {
      node: nodeName,
      driveKey: b4a.toString(drive.key, 'hex'),
      version: drive.version,
      writable: drive.writable,
      peers: peers
    })
  } else if (pathname === '/api/apps') {
    var regBuf = await drive.get('/registry.json')
    if (!regBuf) { respondJSON(res, { apps: {} }); return }
    var reg = JSON.parse(b4a.toString(regBuf))
    respondJSON(res, { apps: reg.apps || {} })
  } else if (pathname === '/api/run') {
    var appName = getParam('app')
    if (!appName) { respondJSON(res, { error: 'app name required' }, 400); return }
    var regBuf2 = await drive.get('/registry.json')
    if (!regBuf2) { respondJSON(res, { error: 'no registry' }, 404); return }
    var reg2 = JSON.parse(b4a.toString(regBuf2))
    var appEntry = reg2.apps && reg2.apps[appName]
    if (!appEntry) { respondJSON(res, { error: 'app not found: ' + appName }, 404); return }
    var srcBuf = await drive.get(appEntry.path)
    if (!srcBuf) { respondJSON(res, { error: 'app source not found: ' + appEntry.path }, 404); return }
    var src = b4a.toString(srcBuf)
    if (src.startsWith('#!')) src = src.slice(src.indexOf('\n') + 1)
    try {
      var mod = { exports: {} }
      var fn = new Function('module', 'exports', 'require', src)
      fn(mod, mod.exports, require)
      var ctx = {
        drive: drive,
        swarm: swarm,
        nodeName: nodeName,
        emit: function (evt, data) {
          console.log(JSON.stringify({ node: nodeName, event: 'app:' + evt, time: Date.now(), ...(data || {}) }))
        }
      }
      var result = await mod.exports.run(ctx)
      if (worldView) worldView.logRun(appName, result).catch(function () {})
      respondJSON(res, { app: appName, result: result })
    } catch (err) {
      if (worldView) worldView.logRun(appName, null, err).catch(function () {})
      respondJSON(res, { app: appName, error: String(err.message || err) }, 500)
    }
  } else if (pathname === '/api/download') {
    var dlPath = getParam('path')
    if (!dlPath) { respondJSON(res, { error: 'path required' }, 400); return }
    var dlBuf = await drive.get(dlPath)
    if (!dlBuf) { respondJSON(res, { error: 'not found' }, 404); return }
    var fileName = dlPath.split('/').pop()
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', 'attachment; filename="' + fileName + '"')
    res.setHeader('Content-Length', dlBuf.length)
    res.end(dlBuf)
  } else if (pathname === '/api/nodes' && isSeed) {
    respondJSON(res, { nodes: nodes })
  } else if (pathname === '/api/register' && isSeed && req.method === 'POST') {
    var body = await readBody(req)
    var data = JSON.parse(body)
    var existing = nodes.findIndex(function (n) { return n.name === data.name })
    if (existing !== -1) nodes.splice(existing, 1)
    nodes.push({ name: data.name, url: data.url, role: 'peer', registered: Date.now() })
    respondJSON(res, { ok: true, nodes: nodes.length })
  } else if (pathname === '/api/world/status' && worldView) {
    var wsBuf = await worldView.drive.get('/status.json')
    if (!wsBuf) { respondJSON(res, { error: 'no status yet' }, 404); return }
    respond(res, 200, 'application/json', wsBuf)
  } else if (pathname === '/api/world/peers' && worldView) {
    var wpBuf = await worldView.drive.get('/peers.json')
    if (!wpBuf) { respondJSON(res, { error: 'no peers yet' }, 404); return }
    respond(res, 200, 'application/json', wpBuf)
  } else if (pathname === '/api/world/runs' && worldView) {
    var runs = []
    try {
      for await (var runEntry of worldView.drive.list('/runs/')) {
        var runBuf = await worldView.drive.get(runEntry.key)
        if (runBuf) runs.push(JSON.parse(b4a.toString(runBuf)))
      }
    } catch (e) {}
    runs.sort(function (a, b) { return a.time > b.time ? -1 : 1 })
    respondJSON(res, { runs: runs })
  } else if (pathname === '/api/world/ls' && worldView) {
    var wPath = getParam('path') || '/'
    var wEntries = await listDir(worldView.drive, wPath)
    respondJSON(res, { path: wPath, entries: wEntries })
  } else if (pathname === '/api/world/file' && worldView) {
    var wfPath = getParam('path')
    if (!wfPath) { respondJSON(res, { error: 'path required' }, 400); return }
    var wfBuf = await worldView.drive.get(wfPath)
    if (!wfBuf) { respondJSON(res, { error: 'not found' }, 404); return }
    respond(res, 200, guessContentType(wfPath), wfBuf)
  } else {
    respondJSON(res, { error: 'not found' }, 404)
  }
}

function readBody (req) {
  return new Promise(function (resolve, reject) {
    var chunks = []
    req.on('data', function (c) { chunks.push(c) })
    req.on('end', function () { resolve(Buffer.concat(chunks).toString()) })
    req.on('error', reject)
  })
}

function respond (res, status, contentType, body) {
  var buf = typeof body === 'string' ? Buffer.from(body) : body
  res.statusCode = status
  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Length', buf.length)
  res.end(buf)
}

function respondJSON (res, obj, status) {
  respond(res, status || 200, 'application/json', JSON.stringify(obj))
}

async function listDir (drive, dirPath) {
  var entries = []
  var seen = new Set()
  for await (var entry of drive.list(dirPath)) {
    var rel = entry.key
    var prefix = dirPath === '/' ? '/' : dirPath + '/'
    if (!rel.startsWith(prefix) && rel !== dirPath) continue
    var rest = rel.slice(prefix.length)
    var seg = rest.split('/')[0]
    if (!seg || seen.has(seg)) continue
    seen.add(seg)
    var isDir = rest.includes('/')
    entries.push({
      name: seg,
      path: prefix + seg,
      type: isDir ? 'dir' : 'file',
      size: isDir ? null : (entry.value && entry.value.blob ? entry.value.blob.byteLength : 0)
    })
  }
  entries.sort(function (a, b) {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return entries
}

function guessContentType (path) {
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.js')) return 'text/javascript'
  if (path.endsWith('.md')) return 'text/plain; charset=utf-8'
  if (path.endsWith('.txt')) return 'text/plain; charset=utf-8'
  if (path.endsWith('.html')) return 'text/html; charset=utf-8'
  return 'application/octet-stream'
}

// ---------------------------------------------------------------------------
// HTML generators — functions returning strings, no template literals
// ---------------------------------------------------------------------------

function dashboardHTML () {
  return [
    '<!DOCTYPE html><html><head>',
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>SPLectrum Swarm</title>',
    '<style>',
    '* { box-sizing: border-box; margin: 0; padding: 0; }',
    'body { font-family: monospace; background: #0a0a0a; color: #d4d4d4; font-size: 16px; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }',
    '.topnav { background: #0f0f0f; border-bottom: 1px solid #222; padding: 10px 20px; display: flex; align-items: center; gap: 16px; flex-shrink: 0; }',
    '.topnav h1 { color: #7ec8e3; font-size: 1.2em; white-space: nowrap; }',
    '.topnav .sep { color: #333; }',
    '.topnav select { font-family: monospace; font-size: 0.95em; background: #1a1a1a; color: #d4d4d4; border: 1px solid #333; border-radius: 3px; padding: 5px 10px; cursor: pointer; }',
    '.topnav select:hover { border-color: #7ec8e3; }',
    '.topnav label { color: #888; font-size: 0.95em; }',
    '.node-frame { flex: 1; border: none; width: 100%; }',
    '</style></head><body>',
    '<div class="topnav">',
    '  <h1>SPLectrum Swarm</h1>',
    '  <span class="sep">|</span>',
    '  <label>node:</label>',
    '  <select id="ns" onchange="switchNode(this.value)">',
    '    <option value="">loading...</option>',
    '  </select>',
    '</div>',
    '<iframe id="nf" class="node-frame" src="/node"></iframe>',
    '<script>',
    'var $=function(id){return document.getElementById(id)};',
    'var cur="/node";',
    'function switchNode(u){if(!u)return;cur=u;$("nf").src=u;}',
    'function loadN(){',
    '  fetch("/api/nodes").then(function(r){return r.json()}).then(function(d){',
    '    var s=$("ns"),h="";',
    '    for(var i=0;i<d.nodes.length;i++){',
    '      var n=d.nodes[i],u=n.role==="seed"?"/node":n.url;',
    '      h+="<option value=\\""+u+"\\""+(u===cur?" selected":"")+">"+n.name+" ("+n.role+")</option>";',
    '    }',
    '    s.innerHTML=h||"<option>no nodes</option>";',
    '  }).catch(function(){});',
    '}',
    'loadN();setInterval(loadN,5000);',
    '</script></body></html>'
  ].join('\n')
}

function nodeHTML () {
  return [
    '<!DOCTYPE html><html><head>',
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>SPLectrum Swarm</title>',
    '<style>',
    '* { box-sizing: border-box; margin: 0; padding: 0; }',
    'body { font-family: monospace; background: #0a0a0a; color: #d4d4d4; font-size: 16px; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }',
    '',
    '/* --- node header --- */',
    '.node-header { background: #0f0f0f; border-bottom: 1px solid #222; padding: 10px 20px; display: flex; align-items: center; gap: 16px; flex-shrink: 0; }',
    '.node-header .node-id { display: flex; align-items: center; gap: 8px; }',
    '.node-header .node-name { color: #d4d4d4; font-weight: bold; font-size: 1.1em; }',
    '.node-header .role-seed { color: #e8a84b; font-size: 0.85em; }',
    '.node-header .role-peer { color: #5fb85f; font-size: 0.85em; }',
    '.node-header .node-url { color: #555; font-size: 0.8em; margin-left: auto; }',
    '',
    '/* --- tabs --- */',
    '.tabs { background: #0a0a0a; border-bottom: 1px solid #222; padding: 0 20px; display: flex; gap: 0; flex-shrink: 0; }',
    '.tabs a { color: #888; text-decoration: none; padding: 10px 16px; border-bottom: 2px solid transparent; font-size: 0.95em; }',
    '.tabs a:hover { color: #d4d4d4; }',
    '.tabs a.active { color: #7ec8e3; border-bottom-color: #7ec8e3; }',
    '',
    '/* --- main content --- */',
    '.view { flex: 1; overflow: auto; padding: 20px; }',
    '',
    '/* --- drive browser styles --- */',
    '.status-bar { background: #111; border: 1px solid #222; border-radius: 4px; padding: 10px 12px; margin-bottom: 16px; font-size: 0.9em; }',
    '.status-bar .label { color: #888; }',
    '.status-bar .value { color: #7ec8e3; }',
    '.status-bar .peer-count { color: #5fb85f; }',
    '.breadcrumb { margin-bottom: 12px; font-size: 1em; }',
    '.breadcrumb a { color: #7ec8e3; text-decoration: none; }',
    '.breadcrumb a:hover { text-decoration: underline; }',
    '.breadcrumb span { color: #666; }',
    '.listing { list-style: none; }',
    '.listing li { padding: 8px 10px; border-bottom: 1px solid #1a1a1a; display: flex; align-items: center; }',
    '.listing li:hover { background: #111; }',
    '.listing .icon { width: 20px; margin-right: 8px; color: #666; }',
    '.listing a { color: #d4d4d4; text-decoration: none; flex: 1; }',
    '.listing a:hover { color: #7ec8e3; }',
    '.listing .size { color: #666; font-size: 0.9em; margin-left: 12px; }',
    '.file-view { background: #111; border: 1px solid #222; border-radius: 4px; padding: 16px; white-space: pre-wrap; word-break: break-word; font-size: 0.95em; max-height: 80vh; overflow: auto; }',
    '.back { margin-bottom: 12px; }',
    '.back a { color: #7ec8e3; text-decoration: none; }',
    '.error { color: #e85050; }',
    '',
    '/* --- status view --- */',
    '.status-detail { font-size: 0.95em; }',
    '.status-detail dt { color: #888; margin-top: 12px; }',
    '.status-detail dd { color: #d4d4d4; margin-top: 2px; }',
    '.status-detail .key { color: #7ec8e3; word-break: break-all; }',
    '.peer-list { list-style: none; margin-top: 4px; }',
    '.peer-list li { color: #5fb85f; padding: 2px 0; }',
    '',
    '/* --- apps view --- */',
    '.app-list { list-style: none; }',
    '.app-card { background: #111; border: 1px solid #222; border-radius: 4px; padding: 14px; margin-bottom: 10px; }',
    '.app-card:hover { border-color: #333; }',
    '.app-card .app-name { color: #7ec8e3; font-weight: bold; font-size: 1.05em; }',
    '.app-card .app-desc { color: #888; font-size: 0.9em; margin-top: 4px; }',
    '.app-card .app-path { color: #555; font-size: 0.8em; margin-top: 2px; }',
    '.app-card .app-actions { margin-top: 10px; display: flex; gap: 8px; }',
    '.btn { font-family: monospace; font-size: 0.9em; padding: 5px 14px; border: 1px solid #333; border-radius: 3px; cursor: pointer; background: #1a1a1a; color: #d4d4d4; }',
    '.btn:hover { border-color: #7ec8e3; color: #7ec8e3; }',
    '.btn-run { border-color: #5fb85f; color: #5fb85f; }',
    '.btn-run:hover { background: #5fb85f; color: #0a0a0a; }',
    '.app-output { background: #0a0a0a; border: 1px solid #222; border-radius: 4px; padding: 12px; margin-top: 10px; font-size: 0.9em; white-space: pre-wrap; word-break: break-word; max-height: 300px; overflow: auto; }',
    '.app-output .out-label { color: #888; font-size: 0.8em; margin-bottom: 4px; }',
    '',
    '/* --- world view --- */',
    '.world-section { margin-bottom: 20px; }',
    '.world-section h3 { color: #7ec8e3; margin-bottom: 10px; font-size: 1em; }',
    '.world-card { background: #111; border: 1px solid #222; border-radius: 4px; padding: 12px; margin-bottom: 8px; font-size: 0.9em; }',
    '.world-card .wc-time { color: #666; font-size: 0.8em; }',
    '.world-card .wc-app { color: #7ec8e3; font-weight: bold; }',
    '.world-card .wc-result { color: #5fb85f; white-space: pre-wrap; margin-top: 4px; }',
    '.world-card .wc-error { color: #e85050; margin-top: 4px; }',
    '.world-kv { display: flex; gap: 12px; flex-wrap: wrap; }',
    '.world-kv dt { color: #888; }',
    '.world-kv dd { color: #d4d4d4; margin-right: 16px; }',
    '</style></head><body>',
    '',
    '<div class="node-header">',
    '  <div class="node-id">',
    '    <span class="node-name" id="hdr-name">...</span>',
    '    <span id="hdr-role"></span>',
    '  </div>',
    '  <span class="node-url" id="hdr-url"></span>',
    '</div>',
    '',
    '<div class="tabs" id="tabs">',
    "  <a href=\"#browse\" class=\"active\" onclick=\"go('browse');return false\">Browse</a>",
    "  <a href=\"#apps\" onclick=\"go('apps');return false\">Apps</a>",
    "  <a href=\"#world\" onclick=\"go('world');return false\">World View</a>",
    "  <a href=\"#status\" onclick=\"go('status');return false\">Status</a>",
    '</div>',
    '',
    '<div class="view" id="view"></div>',
    '',
    '<script>',
    nodeJS(),
    '</script></body></html>'
  ].join('\n')
}

function nodeJS () {
  return [
    'var $=function(id){return document.getElementById(id)};',
    'var state={node:null,view:"browse",browsePath:"/"};',
    '',
    '// --- routing ---',
    'function go(view,arg){',
    '  state.view=view;',
    '  var tabs=$("tabs").getElementsByTagName("a");',
    '  for(var i=0;i<tabs.length;i++) tabs[i].className=tabs[i].getAttribute("href")==="#"+view?"active":"";',
    '  if(view==="browse") renderBrowse(arg||state.browsePath);',
    '  else if(view==="apps") renderApps();',
    '  else if(view==="world") renderWorld();',
    '  else if(view==="status") renderStatus();',
    '}',
    '',
    '// --- header ---',
    'function updateHeader(s){',
    '  $("hdr-name").textContent=s.node;',
    '  var cls=s.writable?"role-seed":"role-peer";',
    '  var role=s.writable?"seed":"peer";',
    '  $("hdr-role").className=cls;',
    '  $("hdr-role").textContent=role;',
    '  $("hdr-url").textContent=location.origin;',
    '}',
    '',
    '// --- api helpers ---',
    'function api(path){return fetch(path).then(function(r){return r.json()});}',
    '',
    '// --- browse view ---',
    'function renderBrowse(path){',
    '  state.browsePath=path||"/";',
    '  var v=$("view");',
    '  v.innerHTML=\'<div class="status-bar" id="sbar">loading...</div><div class="breadcrumb" id="bc"></div><div id="listing"></div>\';',
    '  loadStatusBar();',
    '  buildBC(state.browsePath);',
    '  loadDir(state.browsePath);',
    '}',
    '',
    'function loadStatusBar(){',
    '  api("/api/status").then(function(s){',
    '    state.node=s;',
    '    updateHeader(s);',
    '    $("sbar").innerHTML=',
    '      \'<span class="label">drive:</span> <span class="value">\'+s.driveKey.slice(0,16)+\'\\u2026</span>\'+',
    '      \' \\u00a0 <span class="label">v:</span> <span class="value">\'+s.version+\'</span>\'+',
    '      \' \\u00a0 <span class="label">writable:</span> <span class="value">\'+s.writable+\'</span>\'+',
    '      \' \\u00a0 <span class="label">peers:</span> <span class="peer-count">\'+s.peers.length+\'</span>\';',
    '  }).catch(function(){$("sbar").innerHTML=\'<span class="error">unavailable</span>\';});',
    '}',
    '',
    'function buildBC(path){',
    '  var el=$("bc");if(!el)return;',
    '  if(path==="/"){el.innerHTML="<span>/</span>";return;}',
    '  var parts=path.split("/").filter(Boolean),html=\'<a href="#" onclick="renderBrowse(\\x27/\\x27);return false">/</a>\',acc="";',
    '  for(var i=0;i<parts.length;i++){',
    '    acc+="/"+parts[i];',
    '    if(i<parts.length-1) html+=\' <span>/</span> <a href="#" onclick="renderBrowse(\\x27\'+acc+\'\\x27);return false">\'+parts[i]+\'</a>\';',
    '    else html+=\' <span>/</span> <span>\'+parts[i]+\'</span>\';',
    '  }',
    '  el.innerHTML=html;',
    '}',
    '',
    'function loadDir(path){',
    '  api("/api/ls?path="+encodeURIComponent(path)).then(function(d){',
    '    var el=$("listing");if(!el)return;',
    '    var h=\'<ul class="listing">\';',
    '    for(var i=0;i<d.entries.length;i++){',
    '      var e=d.entries[i],icon=e.type==="dir"?"&#128193;":"&#128196;";',
    '      var sz=e.size!=null?\'<span class="size">\'+fmtSize(e.size)+\'</span>\':"";',
    '      if(e.type==="dir") h+=\'<li><span class="icon">\'+icon+\'</span><a href="#" onclick="renderBrowse(\\x27\'+e.path+\'\\x27);return false">\'+e.name+\'/</a>\'+sz+\'</li>\';',
    '      else h+=\'<li><span class="icon">\'+icon+\'</span><a href="#" onclick="viewFile(\\x27\'+e.path+\'\\x27);return false">\'+e.name+\'</a>\'+sz+\'</li>\';',
    '    }',
    '    h+="</ul>";',
    '    if(!d.entries.length) h=\'<p style="color:#666">empty directory</p>\';',
    '    el.innerHTML=h;',
    '  }).catch(function(e){var el=$("listing");if(el)el.innerHTML=\'<p class="error">\'+e.message+\'</p>\';});',
    '}',
    '',
    'function viewFile(path){',
    '  state.browsePath=path;',
    '  buildBC(path);',
    '  var el=$("listing");if(!el)return;',
    '  fetch("/api/file?path="+encodeURIComponent(path)).then(function(r){return r.text()}).then(function(text){',
    '    var parent=path.substring(0,path.lastIndexOf("/"))||"/";',
    '    el.innerHTML=\'<div class="back"><a href="#" onclick="renderBrowse(\\x27\'+parent+\'\\x27);return false">\\u2190 back</a></div><div class="file-view">\'+esc(text)+\'</div>\';',
    '  }).catch(function(e){el.innerHTML=\'<p class="error">\'+e.message+\'</p>\';});',
    '}',
    '',
    '// --- status view ---',
    'function renderStatus(){',
    '  var v=$("view");',
    '  v.innerHTML=\'<div class="status-detail" id="sd">loading...</div>\';',
    '  api("/api/status").then(function(s){',
    '    updateHeader(s);',
    '    var h="<dl>";',
    '    h+=\'<dt>Node</dt><dd>\'+esc(s.node)+\'</dd>\';',
    '    h+=\'<dt>Drive key</dt><dd class="key">\'+s.driveKey+\'</dd>\';',
    '    h+=\'<dt>Version</dt><dd>\'+s.version+\'</dd>\';',
    '    h+=\'<dt>Writable</dt><dd>\'+s.writable+\'</dd>\';',
    '    h+=\'<dt>Connected peers</dt><dd>\';',
    '    if(s.peers.length){h+=\'<ul class="peer-list">\';for(var i=0;i<s.peers.length;i++)h+="<li>"+s.peers[i]+"\\u2026</li>";h+="</ul>";}',
    '    else h+="none";',
    '    h+="</dd></dl>";',
    '    $("sd").innerHTML=h;',
    '  }).catch(function(e){$("sd").innerHTML=\'<p class="error">\'+e.message+\'</p>\';});',
    '}',
    '',
    '// --- apps view ---',
    'function renderApps(){',
    '  var v=$("view");',
    '  v.innerHTML=\'<h2 style="color:#7ec8e3;margin-bottom:16px">Apps on the drive</h2><div id="app-list">loading...</div>\';',
    '  api("/api/apps").then(function(d){',
    '    var el=$("app-list");if(!el)return;',
    '    var keys=Object.keys(d.apps||{});',
    '    if(!keys.length){el.innerHTML=\'<p style="color:#666">no apps registered</p>\';return;}',
    '    var h="";',
    '    for(var i=0;i<keys.length;i++){',
    '      var k=keys[i],a=d.apps[k];',
    '      h+=\'<div class="app-card" id="app-\'+k+\'">\';',
    '      h+=\'<div class="app-name">\'+esc(k)+\'</div>\';',
    '      h+=\'<div class="app-desc">\'+esc(a.description)+\'</div>\';',
    '      h+=\'<div class="app-path">\'+esc(a.path)+\'</div>\';',
    '      h+=\'<div class="app-actions">\';',
    '      h+=\'<button class="btn btn-run" onclick="runApp(\\x27\'+k+\'\\x27)">Run</button>\';',
    '      h+=\'<button class="btn" onclick="viewFile(\\x27\'+a.path+\'\\x27);go(\\x27browse\\x27,\\x27\'+a.path+\'\\x27)">Source</button>\';',
    '      h+=\'<a class="btn" href="/api/download?path=\'+encodeURIComponent(a.path)+\'" style="text-decoration:none">Download</a>\';',
    '      h+=\'</div>\';',
    '      h+=\'<div id="out-\'+k+\'" style="display:none"></div>\';',
    '      h+=\'</div>\';',
    '    }',
    '    el.innerHTML=h;',
    '  }).catch(function(e){var el=$("app-list");if(el)el.innerHTML=\'<p class="error">\'+e.message+\'</p>\';});',
    '}',
    '',
    'function runApp(name){',
    '  var out=$("out-"+name);',
    '  if(!out)return;',
    '  out.style.display="block";',
    '  out.innerHTML=\'<div class="app-output"><div class="out-label">running...</div></div>\';',
    '  api("/api/run?app="+encodeURIComponent(name)).then(function(d){',
    '    var content=d.error?\'<span class="error">\'+esc(d.error)+\'</span>\':esc(JSON.stringify(d.result,null,2));',
    '    out.innerHTML=\'<div class="app-output"><div class="out-label">output:</div>\'+content+\'</div>\';',
    '  }).catch(function(e){',
    '    out.innerHTML=\'<div class="app-output"><span class="error">\'+esc(e.message)+\'</span></div>\';',
    '  });',
    '}',
    '',
    '// --- world view ---',
    'function renderWorld(){',
    '  var v=$("view");',
    '  v.innerHTML=\'<h2 style="color:#7ec8e3;margin-bottom:16px">World View</h2>\'+',
    '    \'<div class="world-section"><h3>Node Status</h3><div id="wv-status">loading...</div></div>\'+',
    '    \'<div class="world-section"><h3>Peers</h3><div id="wv-peers">loading...</div></div>\'+',
    '    \'<div class="world-section"><h3>Run History</h3><div id="wv-runs">loading...</div></div>\'+',
    '    \'<div class="world-section"><h3>Drive Contents</h3><div id="wv-files">loading...</div></div>\';',
    '  loadWorldStatus();',
    '  loadWorldPeers();',
    '  loadWorldRuns();',
    '  loadWorldFiles();',
    '}',
    '',
    'function loadWorldStatus(){',
    '  api("/api/world/status").then(function(s){',
    '    var el=$("wv-status");if(!el)return;',
    '    var h=\'<div class="world-card"><dl class="world-kv">\';',
    '    h+=\'<dt>node</dt><dd>\'+esc(s.node)+\'</dd>\';',
    '    h+=\'<dt>role</dt><dd>\'+esc(s.role)+\'</dd>\';',
    '    h+=\'<dt>uptime</dt><dd>\'+s.uptime+\'s</dd>\';',
    '    h+=\'<dt>peers</dt><dd>\'+s.peerCount+\'</dd>\';',
    '    h+=\'<dt>updated</dt><dd>\'+esc(s.updated)+\'</dd>\';',
    '    h+=\'</dl></div>\';',
    '    el.innerHTML=h;',
    '  }).catch(function(){var el=$("wv-status");if(el)el.innerHTML=\'<p style="color:#666">not available yet</p>\';});',
    '}',
    '',
    'function loadWorldPeers(){',
    '  api("/api/world/peers").then(function(d){',
    '    var el=$("wv-peers");if(!el)return;',
    '    if(!d.peers||!d.peers.length){el.innerHTML=\'<p style="color:#666">no peers connected</p>\';return;}',
    '    var h=\'<ul class="peer-list">\';',
    '    for(var i=0;i<d.peers.length;i++) h+=\'<li>\'+d.peers[i]+\'\\u2026</li>\';',
    '    h+="</ul>";',
    '    el.innerHTML=h;',
    '  }).catch(function(){var el=$("wv-peers");if(el)el.innerHTML=\'<p style="color:#666">not available yet</p>\';});',
    '}',
    '',
    'function loadWorldRuns(){',
    '  api("/api/world/runs").then(function(d){',
    '    var el=$("wv-runs");if(!el)return;',
    '    if(!d.runs||!d.runs.length){el.innerHTML=\'<p style="color:#666">no runs yet</p>\';return;}',
    '    var h="";',
    '    for(var i=0;i<d.runs.length;i++){',
    '      var r=d.runs[i];',
    '      h+=\'<div class="world-card">\';',
    '      h+=\'<span class="wc-app">\'+esc(r.app)+\'</span> \';',
    '      h+=\'<span class="wc-time">\'+esc(r.time)+\'</span>\';',
    '      if(r.success) h+=\'<div class="wc-result">\'+esc(JSON.stringify(r.result,null,2))+\'</div>\';',
    '      else h+=\'<div class="wc-error">\'+esc(r.error)+\'</div>\';',
    '      h+=\'</div>\';',
    '    }',
    '    el.innerHTML=h;',
    '  }).catch(function(){var el=$("wv-runs");if(el)el.innerHTML=\'<p style="color:#666">not available yet</p>\';});',
    '}',
    '',
    'function loadWorldFiles(){',
    '  api("/api/world/ls?path=/").then(function(d){',
    '    var el=$("wv-files");if(!el)return;',
    '    if(!d.entries||!d.entries.length){el.innerHTML=\'<p style="color:#666">empty</p>\';return;}',
    '    var h=\'<ul class="listing">\';',
    '    for(var i=0;i<d.entries.length;i++){',
    '      var e=d.entries[i],icon=e.type==="dir"?"&#128193;":"&#128196;";',
    '      h+=\'<li><span class="icon">\'+icon+\'</span><span>\'+esc(e.name)+(e.type==="dir"?"/":"")+\'</span></li>\';',
    '    }',
    '    h+="</ul>";',
    '    el.innerHTML=h;',
    '  }).catch(function(){var el=$("wv-files");if(el)el.innerHTML=\'<p style="color:#666">not available yet</p>\';});',
    '}',
    '',
    '// --- utils ---',
    'function esc(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}',
    'function fmtSize(b){if(b<1024)return b+" B";if(b<1048576)return(b/1024).toFixed(1)+" KB";return(b/1048576).toFixed(1)+" MB";}',
    '',
    '// --- init ---',
    'var h=location.hash.slice(1)||"browse";',
    'go(h);',
    'setInterval(function(){if(state.view==="browse")loadStatusBar();if(state.view==="world")renderWorld();},5000);'
  ].join('\n')
}

module.exports = { startServer: startServer }
