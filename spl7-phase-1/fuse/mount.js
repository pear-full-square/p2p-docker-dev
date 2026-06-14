// FUSE mount for a Hyperdrive. Read-write projection onto the local filesystem.
// Reused from phase-7-swarm-app, proven under Docker with fuse-native.
var Fuse = require('fuse-native')
var fs = require('fs')

var CACHE_TTL = 5000

function createCache () {
  return { entries: null, time: 0 }
}

function invalidateCache (cache) {
  cache.entries = null
  cache.time = 0
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

function buildOps (drive) {
  var cache = createCache()
  var nextFd = 100
  var openFiles = new Map()

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

        cb(0, names)
      } catch (e) {
        cb(Fuse.ENOENT)
      }
    },

    getattr: async function (p, cb) {
      try {
        if (p === '/') { cb(0, stat(16877, 4096)); return }

        var entries = await refreshCache(cache, drive)

        if (entries.has(p)) {
          var entry = entries.get(p)
          var size = entry.value && entry.value.blob ? entry.value.blob.byteLength : 0
          cb(0, stat(33188, size))
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
      var fd = nextFd++
      openFiles.set(fd, { path: p, buf: null, dirty: false })
      cb(0, fd)
    },

    create: function (p, mode, cb) {
      var fd = nextFd++
      openFiles.set(fd, { path: p, buf: Buffer.alloc(0), dirty: true })
      invalidateCache(cache)
      cb(0, fd)
    },

    read: async function (p, fd, buf, len, pos, cb) {
      try {
        var f = openFiles.get(fd)
        var data = (f && f.buf) ? f.buf : await drive.get(p)
        if (!data) { cb(Fuse.ENOENT); return }
        if (pos >= data.length) { cb(0); return }
        var slice = data.slice(pos, pos + len)
        slice.copy(buf)
        cb(slice.length)
      } catch (e) {
        cb(Fuse.EIO)
      }
    },

    write: function (p, fd, buf, len, pos, cb) {
      try {
        var f = openFiles.get(fd)
        if (!f) { cb(Fuse.EIO); return }

        var data = buf.slice(0, len)
        if (!f.buf) f.buf = Buffer.alloc(0)

        if (pos + len > f.buf.length) {
          var newBuf = Buffer.alloc(pos + len)
          f.buf.copy(newBuf)
          f.buf = newBuf
        }
        data.copy(f.buf, pos)
        f.dirty = true
        cb(len)
      } catch (e) {
        cb(Fuse.EIO)
      }
    },

    truncate: function (p, size, cb) {
      cb(0)
    },

    ftruncate: function (p, fd, size, cb) {
      var f = openFiles.get(fd)
      if (f) {
        if (!f.buf) f.buf = Buffer.alloc(size)
        else if (size === 0) f.buf = Buffer.alloc(0)
        else f.buf = f.buf.slice(0, size)
        f.dirty = true
      }
      cb(0)
    },

    release: async function (p, fd, cb) {
      try {
        var f = openFiles.get(fd)
        if (f && f.dirty && f.buf) {
          await drive.put(f.path, f.buf)
          invalidateCache(cache)
        }
        openFiles.delete(fd)
        cb(0)
      } catch (e) {
        openFiles.delete(fd)
        cb(Fuse.EIO)
      }
    },

    unlink: async function (p, cb) {
      try {
        await drive.del(p)
        invalidateCache(cache)
        cb(0)
      } catch (e) {
        cb(Fuse.EIO)
      }
    },

    access: function (p, mode, cb) { cb(0) },
    utimens: function (p, atime, mtime, cb) { cb(0) },
    chmod: function (p, mode, cb) { cb(0) },
    chown: function (p, uid, gid, cb) { cb(0) },
    mknod: function (p, mode, dev, cb) { invalidateCache(cache); cb(0) },
    mkdir: function (p, mode, cb) { cb(0) },
    rmdir: function (p, cb) { cb(0) }
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
