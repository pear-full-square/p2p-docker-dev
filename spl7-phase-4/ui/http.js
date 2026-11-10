// HTTP server + browser UI. Supports browsing multiple drives by name.
// The platform serves a dashboard with a node dropdown; API endpoints
// accept ?node=<name> to select which drive to query.
var http = require('http')
var b4a = require('b4a')

var nodeRegistry = []

function startServer (drive, swarm, repo, opts) {
  opts = opts || {}
  var port = opts.port || 8080
  var nodeName = opts.node || 'unknown'
  var isSeed = opts.seed || false
  var externalUrl = opts.url || null
  var onRegister = opts.onRegister || null
  var drives = opts.drives || {}

  // If no drives map, create one from the single drive/repo
  if (drive && repo && !drives[nodeName]) {
    drives[nodeName] = { drive: drive, repo: repo, writable: true }
  }

  function emit (event, extra) {
    console.log(JSON.stringify({ node: nodeName, event: event, time: Date.now(), ...(extra || {}) }))
  }

  if (isSeed && externalUrl) {
    nodeRegistry.length = 0
    nodeRegistry.push({ name: nodeName, url: externalUrl, role: 'platform', registered: Date.now() })
  }

  var server = http.createServer(function (req, res) {
    handleRequest(drives, swarm, nodeName, isSeed, onRegister, req, res).catch(function (err) {
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
    emit('http-ready', { port: port })
  })

  return server
}

function resolveDrive (drives, name) {
  if (name && drives[name]) return drives[name]
  var keys = Object.keys(drives)
  if (keys.length > 0) return drives[keys[0]]
  return null
}

async function handleRequest (drives, swarm, nodeName, isSeed, onRegister, req, res) {
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

  var selectedNode = getParam('node')

  if (pathname === '/') {
    respond(res, 200, 'text/html; charset=utf-8', isSeed ? dashboardHTML() : nodeHTML(nodeName))
  } else if (pathname === '/node') {
    respond(res, 200, 'text/html; charset=utf-8', nodeHTML(selectedNode || nodeName))
  } else if (pathname === '/api/drives') {
    var driveList = Object.keys(drives).map(function (name) {
      var d = drives[name]
      return {
        name: name,
        key: b4a.toString(d.drive.key, 'hex'),
        version: d.drive.version,
        writable: d.writable
      }
    })
    respondJSON(res, { drives: driveList })
  } else if (pathname === '/api/ls') {
    var entry = resolveDrive(drives, selectedNode)
    if (!entry) { respondJSON(res, { error: 'drive not found' }, 404); return }
    var dirPath = getParam('path') || '/'
    var entries = await listDir(entry.drive, dirPath)
    respondJSON(res, { node: selectedNode, path: dirPath, entries: entries })
  } else if (pathname === '/api/file') {
    var entry2 = resolveDrive(drives, selectedNode)
    if (!entry2) { respondJSON(res, { error: 'drive not found' }, 404); return }
    var filePath = getParam('path')
    if (!filePath) { respondJSON(res, { error: 'path required' }, 400); return }
    var buf = null
    if (entry2.repo) {
      buf = await entry2.repo.read(filePath)
    }
    if (!buf) {
      buf = await entry2.drive.get(filePath)
    }
    if (!buf) { respondJSON(res, { error: 'not found' }, 404); return }
    respondJSON(res, { path: filePath, content: b4a.toString(buf), size: buf.length })
  } else if (pathname === '/api/status') {
    var entry3 = resolveDrive(drives, selectedNode)
    if (!entry3) { respondJSON(res, { error: 'drive not found' }, 404); return }
    var peers = []
    if (swarm) {
      for (var conn of swarm.connections) {
        peers.push(b4a.toString(conn.remotePublicKey, 'hex').slice(0, 16))
      }
    }
    respondJSON(res, {
      node: selectedNode || nodeName,
      driveKey: b4a.toString(entry3.drive.key, 'hex'),
      version: entry3.drive.version,
      writable: entry3.writable,
      peers: peers
    })
  } else if (pathname === '/api/select') {
    var entry4 = resolveDrive(drives, selectedNode)
    if (!entry4 || !entry4.repo) { respondJSON(res, { error: 'repo not found' }, 404); return }
    var selPath = getParam('path') || '/'
    var selMode = getParam('mode') || 'raw'
    var selEntries = await entry4.repo.select(selPath, { mode: selMode })
    respondJSON(res, { node: selectedNode, path: selPath, mode: selMode, entries: selEntries })
  } else if (pathname === '/api/git/log') {
    var entry5 = resolveDrive(drives, selectedNode)
    if (!entry5 || !entry5.repo) { respondJSON(res, { error: 'repo not found' }, 404); return }
    var logEntries = await entry5.repo.log('main')
    respondJSON(res, { node: selectedNode, commits: logEntries.map(function (c) {
      return { oid: c.oid, message: c.commit.message.trim(), tree: c.commit.tree }
    })})
  } else if (pathname === '/api/nodes' && isSeed) {
    respondJSON(res, { nodes: nodeRegistry })
  } else if (pathname === '/api/register' && isSeed && req.method === 'POST') {
    var body = await readBody(req)
    var data = JSON.parse(body)
    var existing = nodeRegistry.findIndex(function (n) { return n.name === data.name })
    if (existing !== -1) nodeRegistry.splice(existing, 1)
    nodeRegistry.push({ name: data.name, url: data.url, role: data.role || 'node', driveKey: data.driveKey || null, registered: Date.now() })
    if (onRegister) onRegister(data.name, data)
    respondJSON(res, { ok: true, nodes: nodeRegistry.length })
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

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function dashboardHTML () {
  return [
    '<!DOCTYPE html><html><head>',
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>spl7 swarm setup</title>',
    '<style>',
    '* { box-sizing: border-box; margin: 0; padding: 0; }',
    'body { font-family: monospace; background: #0a0a0a; color: #d4d4d4; font-size: 16px; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }',
    '.topnav { background: #0f0f0f; border-bottom: 1px solid #222; padding: 10px 20px; display: flex; align-items: center; gap: 16px; flex-shrink: 0; }',
    '.topnav h1 { color: #7ec8e3; font-size: 1.2em; white-space: nowrap; }',
    '.topnav .sep { color: #333; }',
    '.topnav select { font-family: monospace; font-size: 0.95em; background: #1a1a1a; color: #d4d4d4; border: 1px solid #333; border-radius: 3px; padding: 5px 10px; cursor: pointer; }',
    '.topnav select:hover { border-color: #7ec8e3; }',
    '.topnav label { color: #888; font-size: 0.95em; }',
    '.topnav .drive-info { color: #555; font-size: 0.8em; margin-left: auto; }',
    '.node-frame { flex: 1; border: none; width: 100%; }',
    '</style></head><body>',
    '<div class="topnav">',
    '  <h1>spl7 swarm setup</h1>',
    '  <span class="sep">|</span>',
    '  <label>drive:</label>',
    '  <select id="ns" onchange="switchDrive(this.value)">',
    '    <option value="">loading...</option>',
    '  </select>',
    '  <span class="drive-info" id="dinfo"></span>',
    '</div>',
    '<iframe id="nf" class="node-frame" src="/node?node=platform"></iframe>',
    '<script>',
    'var $=function(id){return document.getElementById(id)};',
    'var cur="platform";',
    'function switchDrive(name){if(!name)return;cur=name;$("nf").src="/node?node="+encodeURIComponent(name);loadDrives();}',
    'function loadDrives(){',
    '  fetch("/api/drives").then(function(r){return r.json()}).then(function(d){',
    '    var s=$("ns"),h="";',
    '    for(var i=0;i<d.drives.length;i++){',
    '      var dr=d.drives[i];',
    '      var label=dr.name+(dr.writable?" (own)":" (replica)");',
    '      h+="<option value=\\""+dr.name+"\\""+(dr.name===cur?" selected":"")+">"+label+"</option>";',
    '    }',
    '    s.innerHTML=h||"<option>no drives</option>";',
    '    var sel=d.drives.find(function(x){return x.name===cur});',
    '    if(sel) $("dinfo").textContent="v"+sel.version+" | key: "+sel.key.slice(0,12)+"\\u2026";',
    '  }).catch(function(){});',
    '}',
    'loadDrives();setInterval(loadDrives,5000);',
    '</script></body></html>'
  ].join('\n')
}

function nodeHTML (nodeName) {
  return [
    '<!DOCTYPE html><html><head>',
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + esc(nodeName) + ' — spl7</title>',
    '<style>',
    '* { box-sizing: border-box; margin: 0; padding: 0; }',
    'body { font-family: monospace; background: #0a0a0a; color: #d4d4d4; font-size: 16px; height: 100vh; display: flex; flex-direction: column; }',
    '',
    '.node-header { background: #0f0f0f; border-bottom: 1px solid #222; padding: 10px 20px; display: flex; align-items: center; gap: 16px; flex-shrink: 0; }',
    '.node-header .node-name { color: #d4d4d4; font-weight: bold; font-size: 1.1em; }',
    '.node-header .role { font-size: 0.85em; }',
    '.node-header .role-w { color: #e8a84b; }',
    '.node-header .role-r { color: #5fb85f; }',
    '.node-header .info { color: #555; font-size: 0.8em; margin-left: auto; }',
    '',
    '.tabs { background: #0a0a0a; border-bottom: 1px solid #222; padding: 0 20px; display: flex; gap: 0; flex-shrink: 0; }',
    '.tabs a { color: #888; text-decoration: none; padding: 10px 16px; border-bottom: 2px solid transparent; font-size: 0.95em; cursor: pointer; }',
    '.tabs a:hover { color: #d4d4d4; }',
    '.tabs a.active { color: #7ec8e3; border-bottom-color: #7ec8e3; }',
    '',
    '.view { flex: 1; overflow: auto; padding: 20px; }',
    '.breadcrumb { margin-bottom: 12px; }',
    '.breadcrumb a { color: #7ec8e3; text-decoration: none; cursor: pointer; }',
    '.breadcrumb a:hover { text-decoration: underline; }',
    '.breadcrumb span { color: #666; }',
    '.listing { list-style: none; }',
    '.listing li { padding: 8px 10px; border-bottom: 1px solid #1a1a1a; display: flex; align-items: center; }',
    '.listing li:hover { background: #111; }',
    '.listing .icon { width: 20px; margin-right: 8px; color: #666; }',
    '.listing a { color: #d4d4d4; text-decoration: none; flex: 1; cursor: pointer; }',
    '.listing a:hover { color: #7ec8e3; }',
    '.listing .meta-entry a { color: #888; }',
    '.listing .size { color: #666; font-size: 0.9em; margin-left: 12px; }',
    '.file-view { background: #111; border: 1px solid #222; border-radius: 4px; padding: 16px; white-space: pre-wrap; word-break: break-word; font-size: 0.95em; max-height: 80vh; overflow: auto; }',
    '.back a { color: #7ec8e3; text-decoration: none; cursor: pointer; margin-bottom: 12px; display: inline-block; }',
    '.status dt { color: #888; margin-top: 12px; }',
    '.status dd { color: #d4d4d4; margin-top: 2px; }',
    '.status .key { color: #7ec8e3; word-break: break-all; }',
    '.peer-list { list-style: none; margin-top: 4px; }',
    '.peer-list li { color: #5fb85f; padding: 2px 0; }',
    '.commit-list { list-style: none; margin-top: 4px; }',
    '.commit-list li { padding: 4px 0; }',
    '.commit-list .oid { color: #e8a84b; }',
    '.commit-list .msg { color: #d4d4d4; }',
    '.empty { color: #666; }',
    '.error { color: #e85050; }',
    '</style></head><body>',
    '',
    '<div class="node-header">',
    '  <span class="node-name" id="hdr-name">' + esc(nodeName) + '</span>',
    '  <span id="hdr-role" class="role"></span>',
    '  <span class="info" id="hdr-info"></span>',
    '</div>',
    '<div class="tabs">',
    '  <a class="active" id="tab-browse" onclick="go(\'browse\')">Browse</a>',
    '  <a id="tab-status" onclick="go(\'status\')">Status</a>',
    '  <a id="tab-log" onclick="go(\'log\')">Git Log</a>',
    '</div>',
    '<div class="view" id="view"></div>',
    '',
    '<script>',
    nodeJS(nodeName),
    '</script></body></html>'
  ].join('\n')
}

function nodeJS (nodeName) {
  return [
    'var $=function(id){return document.getElementById(id)};',
    'var curPath="/";',
    'var curView="browse";',
    'var nodeParam="' + esc(nodeName) + '";',
    '',
    'function np(url){return url+(url.indexOf("?")>=0?"&":"?")+"node="+encodeURIComponent(nodeParam);}',
    '',
    'function go(view){',
    '  curView=view;',
    '  $("tab-browse").className=view==="browse"?"active":"";',
    '  $("tab-status").className=view==="status"?"active":"";',
    '  $("tab-log").className=view==="log"?"active":"";',
    '  if(view==="browse") browse(curPath);',
    '  else if(view==="status") showStatus();',
    '  else if(view==="log") showLog();',
    '}',
    '',
    'function api(path){return fetch(np(path)).then(function(r){return r.json()});}',
    'function esc(s){if(!s)return"";return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}',
    'function fmtSize(b){if(b<1024)return b+" B";if(b<1048576)return(b/1024).toFixed(1)+" KB";return(b/1048576).toFixed(1)+" MB";}',
    '',
    'function updateHeader(){',
    '  api("/api/status").then(function(s){',
    '    $("hdr-name").textContent=s.node||nodeParam;',
    '    var rl=s.writable?"role-w":"role-r";',
    '    var rt=s.writable?"own":"replica";',
    '    $("hdr-role").className="role "+rl;',
    '    $("hdr-role").textContent=rt;',
    '    $("hdr-info").textContent="v"+s.version+" | key: "+s.driveKey.slice(0,12)+"\\u2026";',
    '  }).catch(function(){});',
    '}',
    '',
    'function buildBC(path){',
    '  if(path==="/") return "<span>/</span>";',
    '  var parts=path.split("/").filter(Boolean),html=\'<a onclick="browse(\\x27/\\x27)">/</a>\',acc="";',
    '  for(var i=0;i<parts.length;i++){',
    '    acc+="/"+parts[i];',
    '    if(i<parts.length-1) html+=\' <span>/</span> <a onclick="browse(\\x27\'+acc+\'\\x27)">\'+esc(parts[i])+\'</a>\';',
    '    else html+=\' <span>/</span> <span>\'+esc(parts[i])+\'</span>\';',
    '  }',
    '  return html;',
    '}',
    '',
    'function browse(path){',
    '  curPath=path;',
    '  var v=$("view");',
    '  v.innerHTML=\'<div class="breadcrumb">\'+buildBC(path)+\'</div><div id="listing">loading...</div>\';',
    '  api("/api/ls?path="+encodeURIComponent(path)).then(function(d){',
    '    var el=$("listing");if(!el)return;',
    '    if(!d.entries.length){el.innerHTML=\'<p class="empty">empty directory</p>\';return;}',
    '    var h=\'<ul class="listing">\';',
    '    for(var i=0;i<d.entries.length;i++){',
    '      var e=d.entries[i];',
    '      var icon=e.type==="dir"?"&#128193;":"&#128196;";',
    '      var sz=e.size!=null?\'<span class="size">\'+fmtSize(e.size)+\'</span>\':"";',
    '      var meta=e.name.charAt(0)==="_"?" meta-entry":"";',
    '      if(e.type==="dir") h+=\'<li class="\'+meta+\'"><span class="icon">\'+icon+\'</span><a onclick="browse(\\x27\'+e.path+\'\\x27)">\'+esc(e.name)+\'/</a>\'+sz+\'</li>\';',
    '      else h+=\'<li class="\'+meta+\'"><span class="icon">\'+icon+\'</span><a onclick="viewFile(\\x27\'+e.path+\'\\x27)">\'+esc(e.name)+\'</a>\'+sz+\'</li>\';',
    '    }',
    '    h+="</ul>";',
    '    el.innerHTML=h;',
    '  }).catch(function(e){$("listing").innerHTML=\'<p class="error">\'+esc(e.message)+\'</p>\';});',
    '}',
    '',
    'function viewFile(path){',
    '  curPath=path;',
    '  var parent=path.substring(0,path.lastIndexOf("/"))||"/";',
    '  var v=$("view");',
    '  v.innerHTML=\'<div class="breadcrumb">\'+buildBC(path)+\'</div><div class="back"><a onclick="browse(\\x27\'+parent+\'\\x27)">\\u2190 back</a></div><div id="fcontent">loading...</div>\';',
    '  api("/api/file?path="+encodeURIComponent(path)).then(function(d){',
    '    var el=$("fcontent");if(!el)return;',
    '    el.innerHTML=\'<div class="file-view">\'+esc(d.content)+\'</div>\';',
    '  }).catch(function(e){$("fcontent").innerHTML=\'<p class="error">\'+esc(e.message)+\'</p>\';});',
    '}',
    '',
    'function showStatus(){',
    '  var v=$("view");',
    '  v.innerHTML=\'<dl class="status" id="sd">loading...</dl>\';',
    '  api("/api/status").then(function(s){',
    '    var h="";',
    '    h+=\'<dt>Node</dt><dd>\'+esc(s.node)+\'</dd>\';',
    '    h+=\'<dt>Drive key</dt><dd class="key">\'+s.driveKey+\'</dd>\';',
    '    h+=\'<dt>Version</dt><dd>\'+s.version+\'</dd>\';',
    '    h+=\'<dt>Writable</dt><dd>\'+s.writable+\'</dd>\';',
    '    h+=\'<dt>Connected peers</dt><dd>\';',
    '    if(s.peers.length){h+=\'<ul class="peer-list">\';for(var i=0;i<s.peers.length;i++)h+="<li>"+s.peers[i]+"\\u2026</li>";h+="</ul>";}',
    '    else h+="none";',
    '    h+="</dd>";',
    '    $("sd").innerHTML=h;',
    '  }).catch(function(e){$("sd").innerHTML=\'<p class="error">\'+esc(e.message)+\'</p>\';});',
    '}',
    '',
    'function showLog(){',
    '  var v=$("view");',
    '  v.innerHTML=\'<div id="gl">loading...</div>\';',
    '  api("/api/git/log").then(function(d){',
    '    var el=$("gl");if(!el)return;',
    '    if(!d.commits||!d.commits.length){el.innerHTML=\'<p class="empty">no commits</p>\';return;}',
    '    var h=\'<ul class="commit-list">\';',
    '    for(var i=0;i<d.commits.length;i++){',
    '      var c=d.commits[i];',
    '      h+=\'<li><span class="oid">\'+c.oid.slice(0,12)+\'</span> <span class="msg">\'+esc(c.message)+\'</span></li>\';',
    '    }',
    '    h+="</ul>";',
    '    el.innerHTML=h;',
    '  }).catch(function(e){$("gl").innerHTML=\'<p class="error">\'+esc(e.message)+\'</p>\';});',
    '}',
    '',
    'updateHeader();',
    'setInterval(updateHeader,5000);',
    'go("browse");'
  ].join('\n')
}

function esc (s) {
  if (!s) return ''
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function registerWithPlatform (platformUrl, name, url, driveKey) {
  var body = JSON.stringify({ name: name, url: url, role: 'node', driveKey: driveKey || null })
  var parsed = platformUrl.replace('http://', '').split(':')
  var host = parsed[0]
  var port = Number(parsed[1]) || 8080

  var req = http.request({
    host: host, port: port, path: '/api/register', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, function () {})
  req.on('error', function () {})
  req.end(body)
}

module.exports = { startServer: startServer, registerWithPlatform: registerWithPlatform }
