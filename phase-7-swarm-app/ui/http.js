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
var http = require('bare-http1')
var b4a = require('b4a')

var nodes = []

function startServer (drive, swarm, opts) {
  opts = opts || {}
  var port = opts.port || 8080
  var nodeName = opts.node || 'unknown'
  var externalUrl = opts.url || null
  var isSeed = opts.seed || false

  function emit (event, extra) {
    console.log(JSON.stringify({ node: nodeName, event: event, time: Date.now(), ...(extra || {}) }))
  }

  if (isSeed && externalUrl) {
    nodes.length = 0
    nodes.push({ name: nodeName, url: externalUrl, role: 'seed', registered: Date.now() })
  }

  var server = http.createServer(function (req, res) {
    handleRequest(drive, swarm, nodeName, isSeed, req, res).catch(function (err) {
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

async function handleRequest (drive, swarm, nodeName, isSeed, req, res) {
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
  } else if (pathname === '/api/nodes' && isSeed) {
    respondJSON(res, { nodes: nodes })
  } else if (pathname === '/api/register' && isSeed && req.method === 'POST') {
    var body = await readBody(req)
    var data = JSON.parse(body)
    var existing = nodes.findIndex(function (n) { return n.name === data.name })
    if (existing !== -1) nodes.splice(existing, 1)
    nodes.push({ name: data.name, url: data.url, role: 'peer', registered: Date.now() })
    respondJSON(res, { ok: true, nodes: nodes.length })
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
    '// --- utils ---',
    'function esc(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}',
    'function fmtSize(b){if(b<1024)return b+" B";if(b<1048576)return(b/1024).toFixed(1)+" KB";return(b/1048576).toFixed(1)+" MB";}',
    '',
    '// --- init ---',
    'var h=location.hash.slice(1)||"browse";',
    'go(h);',
    'setInterval(function(){if(state.view==="browse")loadStatusBar();},5000);'
  ].join('\n')
}

module.exports = { startServer: startServer }
