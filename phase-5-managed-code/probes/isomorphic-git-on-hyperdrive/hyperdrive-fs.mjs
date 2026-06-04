/**
 * Hyperdrive fs adapter for isomorphic-git.
 *
 * Maps isomorphic-git's fs interface to Hyperdrive v11+ operations.
 * isomorphic-git expects 10 methods: readFile, writeFile, mkdir, rmdir,
 * unlink, stat, lstat, readdir, readlink, symlink. If the fs object has
 * an enumerable `promises` property, it uses the promise API.
 */

class Stats {
  constructor (entry) {
    this._entry = entry
    this._isFile = entry && entry.value && entry.value.blob != null
    this._isSymlink = entry && entry.value && entry.value.linkname != null
    this._isDir = entry != null && !this._isFile && !this._isSymlink
  }

  isFile () { return this._isFile }
  isDirectory () { return this._isDir }
  isSymbolicLink () { return this._isSymlink }

  get mode () {
    if (this._isSymlink) return 0o120000
    if (this._isDir) return 0o40755
    if (this._entry && this._entry.value && this._entry.value.executable) return 0o100755
    return 0o100644
  }

  get size () {
    if (this._isFile && this._entry.value.blob) {
      return this._entry.value.blob.byteLength
    }
    return 0
  }

  get uid () { return 1 }
  get gid () { return 1 }
  get ino () { return this._entry ? this._entry.seq : 0 }
  get dev () { return 0 }

  get mtimeMs () { return 0 }
  get ctimeMs () { return 0 }
}

function enoent (path) {
  const err = new Error(`ENOENT: no such file or directory, '${path}'`)
  err.code = 'ENOENT'
  err.errno = -2
  return err
}

export function createFs (drive) {
  const promises = {
    async readFile (path, opts) {
      const buf = await drive.get(path)
      if (buf === null) throw enoent(path)
      if (opts && (opts.encoding || opts === 'utf8')) {
        return buf.toString(typeof opts === 'string' ? opts : opts.encoding)
      }
      return buf
    },

    async writeFile (path, data) {
      if (typeof data === 'string') data = Buffer.from(data)
      await drive.put(path, data)
    },

    async mkdir (path, opts) {
      // Hyperdrive directories are implicit — no-op
    },

    async rmdir (path) {
      // Hyperdrive directories are implicit — no-op
    },

    async unlink (path) {
      await drive.del(path)
    },

    async stat (path) {
      const entry = await drive.entry(path, { follow: true })
      if (!entry) {
        const entries = []
        for await (const e of drive.readdir(path)) {
          entries.push(e)
          break
        }
        if (entries.length > 0) {
          return new Stats(null)
        }
        throw enoent(path)
      }
      return new Stats(entry)
    },

    async lstat (path) {
      const entry = await drive.entry(path, { follow: false })
      if (!entry) {
        const entries = []
        for await (const e of drive.readdir(path)) {
          entries.push(e)
          break
        }
        if (entries.length > 0) {
          return new Stats(null)
        }
        throw enoent(path)
      }
      return new Stats(entry)
    },

    async readdir (path) {
      const entries = []
      for await (const entry of drive.readdir(path)) {
        entries.push(entry)
      }
      return entries
    },

    async readlink (path) {
      const entry = await drive.entry(path, { follow: false })
      if (!entry || !entry.value || entry.value.linkname == null) {
        throw enoent(path)
      }
      return entry.value.linkname
    },

    async symlink (target, path) {
      await drive.symlink(path, target)
    }
  }

  // Return with promises as an enumerable own property — isomorphic-git
  // checks Object.getOwnPropertyDescriptor(fs, 'promises').enumerable
  return { promises }
}
