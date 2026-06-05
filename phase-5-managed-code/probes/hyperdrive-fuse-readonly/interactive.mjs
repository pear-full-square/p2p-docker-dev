// Interactive mode: mount the Hyperdrive, print the mount path, keep running.
// Browse with: ls, cat, find etc. from another shell into the container.
// Or run with: docker exec -it <container> /bin/bash

import Fuse from 'fuse-native'
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import fs from 'node:fs'

const STORE_PATH = '/tmp/corestore-fuse'
const MNT = '/tmp/fuse-mnt'

async function readdirAll (drive, path) {
  const entries = []
  for await (const entry of drive.readdir(path)) entries.push(entry)
  return entries
}

function createFuseHandlers (drive) {
  const uid = process.getuid ? process.getuid() : 0
  const gid = process.getgid ? process.getgid() : 0
  const now = () => new Date()

  return {
    readdir (path, cb) {
      readdirAll(drive, path)
        .then(entries => cb(0, entries))
        .catch(() => cb(Fuse.ENOENT))
    },
    getattr (path, cb) {
      if (path === '/') return cb(0, { mtime: now(), atime: now(), ctime: now(), nlink: 1, size: 4096, mode: 0o40555, uid, gid })
      drive.entry(path, { follow: true }).then(entry => {
        if (!entry) {
          readdirAll(drive, path).then(entries => {
            if (entries.length > 0) cb(0, { mtime: now(), atime: now(), ctime: now(), nlink: 1, size: 4096, mode: 0o40555, uid, gid })
            else cb(Fuse.ENOENT)
          }).catch(() => cb(Fuse.ENOENT))
          return
        }
        const isFile = entry.value && entry.value.blob != null
        const size = isFile && entry.value.blob ? entry.value.blob.byteLength : 0
        cb(0, { mtime: now(), atime: now(), ctime: now(), nlink: 1, size, mode: isFile ? 0o100444 : 0o40555, uid, gid })
      }).catch(() => cb(Fuse.ENOENT))
    },
    open (path, flags, cb) {
      if ((flags & 1) || (flags & 2)) return cb(Fuse.EACCES)
      cb(0, 0)
    },
    release (path, fd, cb) { cb(0) },
    read (path, fd, buf, len, pos, cb) {
      drive.get(path).then(content => {
        if (!content) return cb(Fuse.ENOENT)
        const slice = content.slice(pos, pos + len)
        slice.copy(buf)
        cb(slice.length)
      }).catch(() => cb(Fuse.EIO))
    },
    write (path, fd, buf, len, pos, cb) { cb(Fuse.EROFS) },
    create (path, mode, cb) { cb(Fuse.EROFS) },
    unlink (path, cb) { cb(Fuse.EROFS) },
    mkdir (path, mode, cb) { cb(Fuse.EROFS) },
    rmdir (path, cb) { cb(Fuse.EROFS) },
    rename (src, dest, cb) { cb(Fuse.EROFS) },
  }
}

async function main () {
  try { await fs.promises.rm(STORE_PATH, { recursive: true }) } catch (e) {}
  try { await fs.promises.mkdir(MNT, { recursive: true }) } catch (e) {}

  const store = new Corestore(STORE_PATH)
  const drive = new Hyperdrive(store)
  await drive.ready()

  // Seed with sample content
  await drive.put('/hello.txt', Buffer.from('hello from the swarm\n'))
  await drive.put('/docs/readme.md', Buffer.from('# Mycelium\n\nThe data fabric.\n'))
  await drive.put('/docs/design.md', Buffer.from('# Design\n\nGit + Kafka hybrid.\n'))
  await drive.put('/bin/app.sh', Buffer.from('#!/bin/sh\necho "running on the swarm"\n'))

  const fuse = new Fuse(MNT, createFuseHandlers(drive), { force: true })
  await new Promise((resolve, reject) => {
    fuse.mount(err => err ? reject(err) : resolve())
  })

  console.log('')
  console.log('========================================')
  console.log('  Hyperdrive mounted at: ' + MNT)
  console.log('========================================')
  console.log('')
  console.log('Browse from another terminal:')
  console.log('  docker exec -it <container> bash')
  console.log('  ls ' + MNT)
  console.log('  cat ' + MNT + '/hello.txt')
  console.log('  find ' + MNT)
  console.log('')
  console.log('Press Ctrl+C to unmount and exit.')

  process.on('SIGINT', async () => {
    console.log('\nunmounting...')
    fuse.unmount(() => {
      store.close().then(() => process.exit(0))
    })
  })
}

main().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1) })
