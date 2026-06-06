// FUSE mount for a node's Hyperdrive. Read-only projection of the drive
// onto the local filesystem. Shares the drive object with the node process
// (same corestore, no lock conflicts).
//
//   mountDrive(drive, mountPoint) — returns a promise that resolves when mounted

var Fuse = require('fuse-native')

var entryCache = { entries: null, time: 0 }
var CACHE_TTL = 5000

async function refreshCache (drive) {
  var now = Date.now()
  if (entryCache.entries && now - entryCache.time < CACHE_TTL) {
    return entryCache.entries
  }
  var entries = new Map()
  for await (var entry of drive.list('/')) {
    entries.set(entry.key, entry)
  }
  entryCache.entries = entries
  entryCache.time = now
  return entries
}

function stat (mode, size) {
  var now = new Date()
  return { mtime: now, atime: now, ctime: now, size: size, mode: mode, uid: process.getuid(), gid: process.getgid() }
}

function buildOps (drive) {
  return {
    readdir: async function (p, cb) {
      try {
        var entries = await refreshCache(drive)
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
        cb(0, names)
      } catch (e) {
        cb(Fuse.ENOENT)
      }
    },

    getattr: async function (p, cb) {
      try {
        if (p === '/') { cb(0, stat(16877, 4096)); return }

        var entries = await refreshCache(drive)

        if (entries.has(p)) {
          var entry = entries.get(p)
          var size = entry.value && entry.value.blob ? entry.value.blob.byteLength : 0
          var mode = (p.startsWith('/bin/') || p.startsWith('/apps/')) ? 33261 : 33188
          cb(0, stat(mode, size))
          return
        }

        var prefix = p + '/'
        for (var [key] of entries) {
          if (key.startsWith(prefix)) {
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

function mountDrive (drive, mountPoint) {
  return new Promise(function (resolve, reject) {
    var ops = buildOps(drive)
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
