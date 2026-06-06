// Runtime shim — makes seed/peer code work under both bare and node.js.
// Under node: FUSE mount is available. Under bare: swarm-only.
var isBare = typeof Bare !== 'undefined'

var argv = isBare ? Bare.argv : process.argv
var exit = isBare ? Bare.exit : process.exit

function onShutdown (fn) {
  if (isBare) {
    var Signal = require('bare-signals')
    var sigterm = new Signal('SIGTERM')
    sigterm.on('signal', fn)
    sigterm.start()
  } else {
    process.on('SIGTERM', fn)
    process.on('SIGINT', fn)
  }
}

function tryFuse () {
  if (isBare) return null
  var mountPoint = process.env.FUSE_MOUNT
  if (!mountPoint) return null
  try {
    return require('../fuse/mount')
  } catch (e) {
    return null
  }
}

module.exports = { isBare: isBare, argv: argv, exit: exit, onShutdown: onShutdown, tryFuse: tryFuse }
