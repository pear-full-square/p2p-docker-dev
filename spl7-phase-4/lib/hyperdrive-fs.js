// Hyperdrive-fs adapter — maps isomorphic-git's fs interface onto Hyperdrive v11.
//
// isomorphic-git needs these on fs.promises:
//   readFile, writeFile, mkdir, rmdir, unlink, stat, lstat, readdir, readlink, symlink
//
// Hyperdrive v11 API:
//   get(path) → Buffer|null        put(path, buf)          del(path)
//   entry(path) → {value}|null     readdir(path) → stream  list(path) → stream
//
// Hyperdrive directories are implicit (exist because files exist under them).
// Git stores loose objects at .git/objects/ab/cdef... and refs at .git/refs/...
var b4a = require('b4a')

function createHyperdriveFs (drive) {
  async function readFile (path, opts) {
    var buf = await drive.get(path)
    if (!buf) {
      var err = new Error('ENOENT: no such file or directory, open \'' + path + '\'')
      err.code = 'ENOENT'
      throw err
    }
    if (opts === 'utf8' || (opts && opts.encoding === 'utf8')) {
      return b4a.toString(buf)
    }
    return Buffer.from(buf)
  }

  async function writeFile (path, data, opts) {
    var buf
    if (typeof data === 'string') buf = b4a.from(data)
    else if (data instanceof Uint8Array) buf = Buffer.from(data)
    else buf = data
    await drive.put(path, buf)
  }

  async function mkdir (path, opts) {
    // Hyperdrive directories are implicit — nothing to create.
    // mkdir with recursive:true must not throw.
  }

  async function rmdir (path, opts) {
    // Hyperdrive directories are implicit — nothing to remove.
    // If recursive, delete all entries under the path.
    if (opts && opts.recursive) {
      var entries = []
      for await (var entry of drive.list(path)) {
        entries.push(entry.key)
      }
      for (var i = 0; i < entries.length; i++) {
        await drive.del(entries[i])
      }
    }
  }

  async function rm (path, opts) {
    if (opts && opts.recursive) {
      return rmdir(path, opts)
    }
    return unlink(path)
  }

  async function unlink (path) {
    await drive.del(path)
  }

  async function stat (path) {
    return lstat(path)
  }

  async function lstat (path) {
    // Check if it's a file
    var entry = await drive.entry(path)
    if (entry) {
      var size = entry.value && entry.value.blob
        ? entry.value.blob.byteLength
        : 0
      return makeStat(false, size)
    }

    // Check if it's an implicit directory (any entries under path/)
    var prefix = path.endsWith('/') ? path : path + '/'
    for await (var child of drive.list(path)) {
      if (child.key === path || child.key.startsWith(prefix)) {
        return makeStat(true, 0)
      }
    }

    var err = new Error('ENOENT: no such file or directory, stat \'' + path + '\'')
    err.code = 'ENOENT'
    throw err
  }

  async function readdir (path) {
    var seen = new Set()
    var names = []
    var prefix = path === '/' ? '/' : path + '/'

    for await (var entry of drive.list(path)) {
      var key = entry.key
      if (!key.startsWith(prefix)) continue
      var rest = key.slice(prefix.length)
      var seg = rest.split('/')[0]
      if (seg && !seen.has(seg)) {
        seen.add(seg)
        names.push(seg)
      }
    }

    return names
  }

  async function readlink (path) {
    var err = new Error('ENOENT: readlink not supported')
    err.code = 'ENOENT'
    throw err
  }

  async function symlink (target, path) {
    // Git doesn't need symlinks for loose object storage.
  }

  return {
    promises: {
      readFile: readFile,
      writeFile: writeFile,
      mkdir: mkdir,
      rmdir: rmdir,
      rm: rm,
      unlink: unlink,
      stat: stat,
      lstat: lstat,
      readdir: readdir,
      readlink: readlink,
      symlink: symlink
    }
  }
}

function makeStat (isDir, size) {
  return {
    isFile: function () { return !isDir },
    isDirectory: function () { return isDir },
    isSymbolicLink: function () { return false },
    size: size,
    mode: isDir ? 16877 : 33188,
    mtimeMs: Date.now(),
    uid: 0,
    gid: 0
  }
}

module.exports = { createHyperdriveFs: createHyperdriveFs }
