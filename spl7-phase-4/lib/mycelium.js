// CJS wrapper for the mycelium module.
// The upstream module uses ESM; this re-exports the core functions for CJS containers.
// Inlined from pear-full-square/mycelium — git.js, xpath.js, crud.js, mapper.js, record.js.

// --- record.js ---

function createRecord (key, value, headers) {
  return { key: key, value: value || null, headers: (headers || []).slice() }
}

function addHeader (record, key, value) {
  return {
    key: record.key,
    value: record.value,
    headers: record.headers.concat([{ key: key, value: value }])
  }
}

function getHeader (record, key) {
  for (var i = record.headers.length - 1; i >= 0; i--) {
    if (record.headers[i].key === key) return record.headers[i].value
  }
  return null
}

function withError (record, message) {
  return addHeader(addHeader(record, 'spl.status', 'error'), 'spl.error', message)
}

function withStatus (record, status) {
  return addHeader(record, 'spl.status', status)
}

// --- git.js ---

function createGitLayer (git, fs, dir) {
  var gitdir = dir === '/' ? '/.git' : dir + '/.git'

  return {
    init: function () { return git.init({ fs: fs, dir: dir }) },

    readTree: function (oid) {
      return git.readTree({ fs: fs, dir: dir, oid: oid }).then(function (r) { return r.tree })
    },

    readBlob: function (oid) {
      return git.readBlob({ fs: fs, dir: dir, oid: oid }).then(function (r) { return Buffer.from(r.blob) })
    },

    writeBlob: function (content) {
      if (typeof content === 'string') content = Buffer.from(content)
      return git.writeBlob({ fs: fs, dir: dir, blob: new Uint8Array(content) })
    },

    writeTree: function (entries) {
      return git.writeTree({ fs: fs, dir: dir, tree: entries })
    },

    commit: function (tree, parents, message, author) {
      var ts = Math.floor(Date.now() / 1000)
      return git.writeCommit({
        fs: fs, dir: dir,
        commit: {
          tree: tree,
          parent: parents,
          author: { name: author.name, email: author.email, timestamp: ts, timezoneOffset: 0 },
          committer: { name: author.name, email: author.email, timestamp: ts, timezoneOffset: 0 },
          message: message + '\n'
        }
      })
    },

    updateRef: function (ref, oid) {
      return git.writeRef({ fs: fs, dir: dir, ref: ref, value: oid, force: true })
    },

    resolveRef: function (ref) {
      return git.resolveRef({ fs: fs, dir: dir, ref: ref })
    },

    log: function (ref, depth) {
      return git.log({ fs: fs, dir: dir, ref: ref, depth: depth })
    },

    resolvePath: async function (rootTreeOid, path) {
      var segments = path.split('/').filter(Boolean)
      var currentOid = rootTreeOid

      for (var i = 0; i < segments.length; i++) {
        var entries = await this.readTree(currentOid)
        var match = null
        for (var j = 0; j < entries.length; j++) {
          if (entries[j].path === segments[i]) { match = entries[j]; break }
        }
        if (!match) return null

        if (i === segments.length - 1) {
          return { oid: match.oid, type: match.type, mode: match.mode }
        }

        if (match.type === 'tree' || match.mode === '040000') {
          currentOid = match.oid
        } else {
          return null
        }
      }

      return { oid: rootTreeOid, type: 'tree', mode: '040000' }
    }
  }
}

// --- xpath.js ---

var METADATA_PREFIX = '_'

function isMetadata (name) { return name.startsWith(METADATA_PREFIX) }

function filterByMode (entries, mode) {
  if (mode === 'raw') return entries
  if (mode === 'data') return entries.filter(function (e) { return !isMetadata(e.path) })
  if (mode === 'metadata') return entries.filter(function (e) { return isMetadata(e.path) })
  return entries
}

function createXPath (gitLayer) {
  async function getHeadTree (ref) {
    var log = await gitLayer.log(ref || 'main', 1)
    return log[0].commit.tree
  }

  return {
    select: async function (path, opts) {
      opts = opts || {}
      var ref = opts.ref
      var mode = opts.mode || 'raw'
      var rootTree = await getHeadTree(ref)

      if (path === '/' || path === '') {
        var entries = await gitLayer.readTree(rootTree)
        return filterByMode(entries, mode).map(function (e) {
          return { key: '/' + e.path, type: e.type || (e.mode === '040000' ? 'tree' : 'blob'), oid: e.oid, mode: e.mode }
        })
      }

      var resolved = await gitLayer.resolvePath(rootTree, path)
      if (!resolved) return []

      if (resolved.type === 'tree' || resolved.mode === '040000') {
        var entries2 = await gitLayer.readTree(resolved.oid)
        return filterByMode(entries2, mode).map(function (e) {
          return { key: path + '/' + e.path, type: e.type || (e.mode === '040000' ? 'tree' : 'blob'), oid: e.oid, mode: e.mode }
        })
      }

      return [{ key: path, type: 'blob', oid: resolved.oid, mode: resolved.mode }]
    },

    read: async function (path, opts) {
      opts = opts || {}
      var rootTree = await getHeadTree(opts.ref)
      var resolved = await gitLayer.resolvePath(rootTree, path)
      if (!resolved || resolved.type === 'tree' || resolved.mode === '040000') return null
      return gitLayer.readBlob(resolved.oid)
    }
  }
}

// --- crud.js ---

function createCrud (gitLayer) {
  async function getHeadTree (ref) {
    var log = await gitLayer.log(ref || 'main', 1)
    return log[0].commit.tree
  }

  async function modifyTree (rootTreeOid, path, action) {
    var segments = path.split('/').filter(Boolean)
    if (segments.length === 0) throw new Error('cannot modify root')

    async function walk (treeOid, depth) {
      var entries = treeOid ? await gitLayer.readTree(treeOid) : []
      var name = segments[depth]

      if (depth === segments.length - 1) {
        var existing = null
        var filtered = []
        for (var k = 0; k < entries.length; k++) {
          if (entries[k].path === name) existing = entries[k]
          else filtered.push(entries[k])
        }

        if (action.type === 'remove') {
          if (!existing) throw new Error('not found: ' + path)
          return gitLayer.writeTree(filtered.map(function (e) {
            return { mode: e.mode, path: e.path, oid: e.oid, type: e.type || 'blob' }
          }))
        }

        if (existing) {
          var existingIsTree = existing.type === 'tree' || existing.mode === '040000'
          var newIsTree = action.mode === '040000'
          if (existingIsTree !== newIsTree) {
            throw new Error('conflict: ' + path + ' is a ' + (existingIsTree ? 'folder' : 'file'))
          }
        }

        filtered.push({ mode: action.mode, path: name, oid: action.oid, type: action.mode === '040000' ? 'tree' : 'blob' })
        return gitLayer.writeTree(filtered.map(function (e) {
          return { mode: e.mode, path: e.path, oid: e.oid, type: e.type || 'blob' }
        }))
      }

      var found = null
      for (var m = 0; m < entries.length; m++) {
        if (entries[m].path === name) { found = entries[m]; break }
      }

      var subtreeOid
      if (found && (found.type === 'tree' || found.mode === '040000')) {
        subtreeOid = await walk(found.oid, depth + 1)
      } else if (!found) {
        subtreeOid = await walk(null, depth + 1)
      } else {
        throw new Error('conflict: ' + segments.slice(0, depth + 1).join('/') + ' is not a folder')
      }

      var filtered2 = entries.filter(function (e) { return e.path !== name })
      filtered2.push({ mode: '040000', path: name, oid: subtreeOid, type: 'tree' })
      return gitLayer.writeTree(filtered2.map(function (e) {
        return { mode: e.mode, path: e.path, oid: e.oid, type: e.type || 'blob' }
      }))
    }

    return walk(rootTreeOid, 0)
  }

  return {
    get: async function (path, ref) {
      var rootTree = await getHeadTree(ref)
      var resolved = await gitLayer.resolvePath(rootTree, path)
      if (!resolved) throw new Error('not found: ' + path)
      if (resolved.type === 'tree' || resolved.mode === '040000') throw new Error('is a directory: ' + path)
      return gitLayer.readBlob(resolved.oid)
    },

    put: async function (path, value, ref) {
      var rootTree
      try { rootTree = await getHeadTree(ref) }
      catch (e) { rootTree = null }
      var blobOid = await gitLayer.writeBlob(value)
      return modifyTree(rootTree, path, { type: 'put', oid: blobOid, mode: '100644' })
    },

    remove: async function (path, ref) {
      var rootTree = await getHeadTree(ref)
      return modifyTree(rootTree, path, { type: 'remove' })
    }
  }
}

// --- mapper.js ---

function createMapper (crud, xpath) {
  return {
    dispatch: async function (record) {
      var op = getHeader(record, 'spl.operation')
      var path = record.key
      try {
        switch (op) {
          case 'get': {
            var value = await crud.get(path)
            return withStatus({ key: record.key, value: value, headers: record.headers.slice() }, 'ok')
          }
          case 'put': {
            var treeOid = await crud.put(path, record.value)
            return withStatus(addHeader(record, 'spl.tree', treeOid), 'staged')
          }
          case 'remove': {
            var treeOid2 = await crud.remove(path)
            return withStatus(addHeader(record, 'spl.tree', treeOid2), 'staged')
          }
          case 'select': {
            var mode = getHeader(record, 'spl.mode') || 'raw'
            var nodes = await xpath.select(path, { mode: mode })
            return withStatus({ key: record.key, value: Buffer.from(JSON.stringify(nodes)), headers: record.headers.slice() }, 'ok')
          }
          case 'read': {
            var val = await xpath.read(path)
            if (val === null) return withError(record, 'not readable: ' + path)
            return withStatus({ key: record.key, value: val, headers: record.headers.slice() }, 'ok')
          }
          default:
            return withError(record, 'unknown operation: ' + op)
        }
      } catch (e) {
        return withError(record, e.message)
      }
    }
  }
}

// --- open ---

async function open (git, fs, dir, opts) {
  opts = opts || {}
  var gitLayer = createGitLayer(git, fs, dir)
  var xpath = createXPath(gitLayer)
  var crud = createCrud(gitLayer)
  var mapper = createMapper(crud, xpath)

  if (opts.init) {
    await gitLayer.init()
  }

  return {
    select: xpath.select,
    read: xpath.read,
    get: crud.get,
    put: crud.put,
    remove: crud.remove,

    commitTree: async function (treeOid, message, author) {
      var ref = 'main'
      var headOid
      try { headOid = await gitLayer.resolveRef('refs/heads/' + ref) }
      catch (e) { headOid = null }
      var parents = headOid ? [headOid] : []
      var commitOid = await gitLayer.commit(treeOid, parents, message, author)
      await gitLayer.updateRef('refs/heads/' + ref, commitOid)
      return commitOid
    },

    log: function (ref, depth) {
      return gitLayer.log(ref || 'main', depth)
    },

    git: gitLayer,
    dispatch: mapper.dispatch
  }
}

module.exports = {
  open: open,
  createRecord: createRecord,
  addHeader: addHeader,
  getHeader: getHeader,
  withError: withError,
  withStatus: withStatus
}
