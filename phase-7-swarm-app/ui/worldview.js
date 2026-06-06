// World view — a node's personal Hyperdrive that captures what it knows
// and has done. The node publishes its state here; apps and users read it.
//
// Structure:
//   /status.json           — current node state (refreshed periodically)
//   /peers.json            — connected peers (refreshed periodically)
//   /runs/<timestamp>.json — app execution log entries
var b4a = require('b4a')

var UPDATE_INTERVAL = 5000

function createWorldView (drive, swarm, opts) {
  opts = opts || {}
  var nodeName = opts.node || 'unknown'
  var role = opts.role || 'peer'
  var startTime = Date.now()
  var timer = null

  function put (path, obj) {
    var buf = b4a.from(JSON.stringify(obj, null, 2) + '\n')
    return drive.put(path, buf)
  }

  async function updateStatus () {
    var peers = []
    for (var conn of swarm.connections) {
      peers.push(b4a.toString(conn.remotePublicKey, 'hex').slice(0, 16))
    }

    await put('/status.json', {
      node: nodeName,
      role: role,
      driveKey: b4a.toString(drive.key, 'hex'),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      updated: new Date().toISOString(),
      peerCount: peers.length
    })

    await put('/peers.json', {
      node: nodeName,
      updated: new Date().toISOString(),
      peers: peers
    })
  }

  async function logRun (appName, result, error) {
    var ts = new Date().toISOString().replace(/[:.]/g, '-')
    var entry = {
      node: nodeName,
      app: appName,
      time: new Date().toISOString(),
      success: !error
    }
    if (error) entry.error = String(error)
    else entry.result = result
    await put('/runs/' + ts + '.json', entry)
  }

  function start () {
    updateStatus().catch(function () {})
    timer = setInterval(function () {
      updateStatus().catch(function () {})
    }, UPDATE_INTERVAL)
  }

  function stop () {
    if (timer) clearInterval(timer)
  }

  return {
    drive: drive,
    start: start,
    stop: stop,
    logRun: logRun,
    updateStatus: updateStatus
  }
}

module.exports = { createWorldView: createWorldView }
