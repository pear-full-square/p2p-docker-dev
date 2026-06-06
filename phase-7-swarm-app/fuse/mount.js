// FUSE mount for a node's Hyperdrive. Read-only projection of the drive
// onto the local filesystem. Shares the drive object with the node process
// (same corestore, no lock conflicts).
//
// Local overlays: files from the container's filesystem can be overlaid onto
// the drive (e.g. /bin/bare from the container image, not from the Hyperdrive).
//
//   mountDrive(drive, mountPoint, opts) — returns a promise that resolves when mounted
//   opts.overlays: { '/bin/bare': '/path/to/local/bare' }

var Fuse = require('fuse-native')
var fs = require('fs')

var CACHE_TTL = 5000

function createCache () {
  return { entries: null, time: 0 }
}

async function refreshCache (cache, drive) {
  var now = Date.now()
  if (cache.entries && now - cache.time < CACHE_TTL) {
    return cache.entries
  }
  var entries = new Map()
  for await (var entry of drive.list('/')) {
    entries.set(entry.key, entry)
  }
  cache.entries = entries
  cache.time = now
  return entries
}

function stat (mode, size) {
  var now = new Date()
  return { mtime: now, atime: now, ctime: now, size: size, mode: mode, uid: process.getuid(), gid: process.getgid() }
}

function buildOps (drive, overlays) {
  var cache = createCache()
  var overlayPaths = Object.keys(overlays || {})
  var overlayDirs = new Set()

  // Pre-compute overlay parent directories
  for (var i = 0; i < overlayPaths.length; i++) {
    var parts = overlayPaths[i].split('/')
    var acc = ''
    for (var j = 1; j < parts.length - 1; j++) {
      acc += '/' + parts[j]
      overlayDirs.add(acc)
    }
  }

  function overlayNamesIn (dirPath) {
    var prefix = dirPath === '/' ? '/' : dirPath + '/'
    var names = []
    for (var k = 0; k < overlayPaths.length; k++) {
      var op = overlayPaths[k]
      if (!op.startsWith(prefix)) continue
      var rest = op.slice(prefix.length)
      var seg = rest.split('/')[0]
      if (seg && names.indexOf(seg) === -1) names.push(seg)
    }
    return names
  }

  return {
    readdir: async function (p, cb) {
      try {
        var entries = await refreshCache(cache, drive)
        var seen = new Set()
        var names = []
        var prefix = p === '/' ? '/' : p + '/'

        for (var [key] of entries) {
          if (!key.startsWith(prefix) && key !== p) continue
          var rest = key.slice(prefix.length)
          var seg = rest.split('/')[0]
          if (!seg || seen.has(seg)) continue
          seen.add(seg)
          names.push(seg)
        }

        // Add overlay entries
        var oNames = overlayNamesIn(p)
        for (var oi = 0; oi < oNames.length; oi++) {
          if (!seen.has(oNames[oi])) {
            seen.add(oNames[oi])
            names.push(oNames[oi])
          }
        }

        cb(0, names)
      } catch (e) {
        cb(Fuse.ENOENT)
      }
    },

    getattr: async function (p, cb) {
      try {
        if (p === '/') { cb(0, stat(16877, 4096)); return }

        // Check overlays first
        if (overlays && overlays[p]) {
          try {
            var oStat = fs.statSync(overlays[p])
            cb(0, stat(33261, oStat.size))
            return
          } catch (e) {}
        }
        if (overlayDirs.has(p)) {
          cb(0, stat(16877, 4096))
          return
        }

        var entries = await refreshCache(cache, drive)

        if (entries.has(p)) {
          var entry = entries.get(p)
          var size = entry.value && entry.value.blob ? entry.value.blob.byteLength : 0
          var mode = (p.startsWith('/bin/') || p.startsWith('/apps/')) ? 33261 : 33188
          cb(0, stat(mode, size))
          return
        }

        var dirPrefix = p + '/'
        for (var [key] of entries) {
          if (key.startsWith(dirPrefix)) {
            cb(0, stat(16877, 4096))
            return
          }
        }

        cb(Fuse.ENOENT)
      } catch (e) {
        cb(Fuse.ENOENT)
      }
    },

    open: function (p, flags, cb) {
      cb(0, 42)
    },

    read: async function (p, fd, buf, len, pos, cb) {
      try {
        // Check overlays first
        if (overlays && overlays[p]) {
          var oFd = fs.openSync(overlays[p], 'r')
          var bytesRead = fs.readSync(oFd, buf, 0, len, pos)
          fs.closeSync(oFd)
          cb(bytesRead)
          return
        }

        var data = await drive.get(p)
        if (!data) { cb(Fuse.ENOENT); return }
        var slice = data.slice(pos, pos + len)
        slice.copy(buf)
        cb(slice.length)
      } catch (e) {
        cb(Fuse.EIO)
      }
    }
  }
}

function mountDrive (drive, mountPoint, opts) {
  opts = opts || {}
  return new Promise(function (resolve, reject) {
    var ops = buildOps(drive, opts.overlays)
    var fuse = new Fuse(mountPoint, ops, { force: true, allowOther: true })

    fuse.mount(function (err) {
      if (err) { reject(err); return }
      resolve(fuse)
    })
  })
}

function unmount (fuse) {
  return new Promise(function (resolve) {
    fuse.unmount(function () { resolve() })
  })
}

module.exports = { mountDrive: mountDrive, unmount: unmount }
