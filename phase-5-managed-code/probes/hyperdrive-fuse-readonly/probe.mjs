// Read-only FUSE mount over Hyperdrive v11.
//
// 1. Create a Hyperdrive, seed it with files
// 2. Mount it read-only via fuse-native
// 3. Read files through the mount, verify content matches
// 4. Verify writes are rejected
// 5. Unmount cleanly
//
// The drive is a window — pure visibility. No writes through the mount.

import Fuse from 'fuse-native'
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import fs from 'node:fs'
import { join } from 'node:path'

const STORE_PATH = '/tmp/corestore-fuse'
const MNT = '/tmp/fuse-mnt'

// Collect all readdir entries from a Hyperdrive stream
async function readdirAll (drive, path) {
  const entries = []
  for await (const entry of drive.readdir(path)) {
    entries.push(entry)
  }
  return entries
}

function createFuseHandlers (drive) {
  return {
    readdir (path, cb) {
      readdirAll(drive, path)
        .then(entries => cb(0, entries))
        .catch(() => cb(Fuse.ENOENT))
    },

    getattr (path, cb) {
      if (path === '/') {
        return cb(0, {
          mtime: new Date(),
          atime: new Date(),
          ctime: new Date(),
          nlink: 1,
          size: 4096,
          mode: 0o40555, // dr-xr-xr-x
          uid: process.getuid ? process.getuid() : 0,
          gid: process.getgid ? process.getgid() : 0
        })
      }

      drive.entry(path, { follow: true }).then(entry => {
        if (!entry) {
          // Check if it's an implicit directory
          readdirAll(drive, path).then(entries => {
            if (entries.length > 0) {
              cb(0, {
                mtime: new Date(),
                atime: new Date(),
                ctime: new Date(),
                nlink: 1,
                size: 4096,
                mode: 0o40555,
                uid: process.getuid ? process.getuid() : 0,
                gid: process.getgid ? process.getgid() : 0
              })
            } else {
              cb(Fuse.ENOENT)
            }
          }).catch(() => cb(Fuse.ENOENT))
          return
        }

        const isFile = entry.value && entry.value.blob != null
        const size = isFile && entry.value.blob ? entry.value.blob.byteLength : 0

        cb(0, {
          mtime: new Date(),
          atime: new Date(),
          ctime: new Date(),
          nlink: 1,
          size,
          mode: isFile ? 0o100444 : 0o40555, // r--r--r-- or dr-xr-xr-x
          uid: process.getuid ? process.getuid() : 0,
          gid: process.getgid ? process.getgid() : 0
        })
      }).catch(() => cb(Fuse.ENOENT))
    },

    open (path, flags, cb) {
      // Check if opening for write
      const O_WRONLY = 1
      const O_RDWR = 2
      if ((flags & O_WRONLY) || (flags & O_RDWR)) {
        return cb(Fuse.EACCES)
      }
      cb(0, 0)
    },

    release (path, fd, cb) {
      cb(0)
    },

    read (path, fd, buf, len, pos, cb) {
      drive.get(path).then(content => {
        if (!content) return cb(Fuse.ENOENT)
        const slice = content.slice(pos, pos + len)
        slice.copy(buf)
        cb(slice.length)
      }).catch(() => cb(Fuse.EIO))
    },

    // Reject all write operations
    write (path, fd, buf, len, pos, cb) { cb(Fuse.EROFS) },
    create (path, mode, cb) { cb(Fuse.EROFS) },
    unlink (path, cb) { cb(Fuse.EROFS) },
    mkdir (path, mode, cb) { cb(Fuse.EROFS) },
    rmdir (path, cb) { cb(Fuse.EROFS) },
    rename (src, dest, cb) { cb(Fuse.EROFS) },
    chmod (path, mode, cb) { cb(Fuse.EROFS) },
    chown (path, uid, gid, cb) { cb(Fuse.EROFS) },
    truncate (path, size, cb) { cb(Fuse.EROFS) },
    link (src, dest, cb) { cb(Fuse.EROFS) },
    symlink (src, dest, cb) { cb(Fuse.EROFS) }
  }
}

async function seedDrive (drive) {
  await drive.put('/hello.txt', Buffer.from('hello from the swarm\n'))
  await drive.put('/docs/readme.md', Buffer.from('# Mycelium\n\nThe data fabric.\n'))
  await drive.put('/docs/design.md', Buffer.from('# Design\n\nGit + Kafka hybrid.\n'))
  await drive.put('/bin/app.sh', Buffer.from('#!/bin/sh\necho "running on the swarm"\n'))
  console.log('seeded: 4 files in 3 directories')
}

async function testMount (mnt) {
  const fsp = fs.promises
  const results = {}

  // Test readdir on root
  const rootEntries = await fsp.readdir(mnt)
  results.rootEntries = rootEntries.sort()
  console.log('readdir /:', results.rootEntries)

  // Test readdir on subdirectory
  const docsEntries = await fsp.readdir(join(mnt, 'docs'))
  results.docsEntries = docsEntries.sort()
  console.log('readdir /docs:', results.docsEntries)

  // Test read file content
  const hello = await fsp.readFile(join(mnt, 'hello.txt'), 'utf8')
  results.helloContent = hello
  console.log('read /hello.txt:', JSON.stringify(hello))

  const readme = await fsp.readFile(join(mnt, 'docs/readme.md'), 'utf8')
  results.readmeContent = readme
  console.log('read /docs/readme.md:', JSON.stringify(readme))

  // Test stat
  const helloStat = await fsp.stat(join(mnt, 'hello.txt'))
  results.helloIsFile = helloStat.isFile()
  results.helloSize = helloStat.size
  console.log('stat /hello.txt: file=%s size=%d', helloStat.isFile(), helloStat.size)

  const docsStat = await fsp.stat(join(mnt, 'docs'))
  results.docsIsDir = docsStat.isDirectory()
  console.log('stat /docs: dir=%s', docsStat.isDirectory())

  // Test write rejection
  let writeRejected = false
  try {
    await fsp.writeFile(join(mnt, 'forbidden.txt'), 'should fail')
  } catch (e) {
    writeRejected = true
    console.log('write rejected:', e.code || e.message)
  }
  results.writeRejected = writeRejected

  return results
}

async function main () {
  // Clean up
  try { await fs.promises.rm(STORE_PATH, { recursive: true }) } catch (e) {}
  try { await fs.promises.mkdir(MNT, { recursive: true }) } catch (e) {}

  // Create and seed the drive
  const store = new Corestore(STORE_PATH)
  const drive = new Hyperdrive(store)
  await drive.ready()
  await seedDrive(drive)

  // Mount read-only
  const handlers = createFuseHandlers(drive)
  const fuse = new Fuse(MNT, handlers, { force: true })

  await new Promise((resolve, reject) => {
    fuse.mount(err => err ? reject(err) : resolve())
  })
  console.log('mounted at', MNT)

  // Run tests
  const results = await testMount(MNT)

  // Unmount
  await new Promise((resolve, reject) => {
    fuse.unmount(err => err ? reject(err) : resolve())
  })
  console.log('unmounted')

  // Summary
  const pass =
    results.rootEntries.length === 3 &&
    results.docsEntries.length === 2 &&
    results.helloContent === 'hello from the swarm\n' &&
    results.readmeContent === '# Mycelium\n\nThe data fabric.\n' &&
    results.helloIsFile === true &&
    results.helloSize === 21 &&
    results.docsIsDir === true &&
    results.writeRejected === true

  console.log(JSON.stringify({
    summary: { pass, ...results }
  }, null, 2))

  await store.close()
  process.exit(pass ? 0 : 1)
}

main().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1) })
