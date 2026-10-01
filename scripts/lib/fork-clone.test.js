'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const { ensureForkClone } = require('./fork-clone')

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })

const roots = []
test.after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })))

function makeRemote() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-clone-test-'))
  roots.push(root)
  const remote = path.join(root, 'remote')
  fs.mkdirSync(remote)
  git(remote, 'init', '-q', '-b', 'master')
  fs.writeFileSync(path.join(remote, 'README'), 'x\n')
  git(remote, 'add', '.')
  git(remote, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init')
  return { root, remote }
}

const quietSh = (cmd, args, opts) => execFileSync(cmd, args, { stdio: 'pipe', ...opts })

test('ensureForkClone clones when the directory does not exist', () => {
  const { root, remote } = makeRemote()
  const forkDir = path.join(root, 'fork')
  ensureForkClone(forkDir, remote, quietSh)
  assert.equal(git(forkDir, 'rev-parse', '--is-inside-work-tree').trim(), 'true')
})

test('ensureForkClone re-clones a directory the OS temp cleaner emptied', () => {
  // macOS purges old files under the temp dir but keeps the directories, so
  // `.git/` survives as an empty skeleton that git no longer recognises.
  const { root, remote } = makeRemote()
  const forkDir = path.join(root, 'fork')
  for (const dir of ['.git/objects', '.git/refs', 'src']) fs.mkdirSync(path.join(forkDir, dir), { recursive: true })

  ensureForkClone(forkDir, remote, quietSh)

  assert.equal(git(forkDir, 'rev-parse', '--is-inside-work-tree').trim(), 'true')
  assert.ok(fs.existsSync(path.join(forkDir, 'README')))
})

test('ensureForkClone reuses a usable clone instead of re-cloning it', () => {
  const { root, remote } = makeRemote()
  const forkDir = path.join(root, 'fork')
  ensureForkClone(forkDir, remote, quietSh)
  fs.writeFileSync(path.join(forkDir, 'marker'), 'kept\n')

  ensureForkClone(forkDir, remote, quietSh)

  assert.ok(fs.existsSync(path.join(forkDir, 'marker')), 'a usable clone must not be deleted')
})

test('ensureForkClone refuses to delete an existing directory that is not a clone', () => {
  const { root, remote } = makeRemote()
  const forkDir = path.join(root, 'not-a-clone')
  fs.mkdirSync(forkDir)
  fs.writeFileSync(path.join(forkDir, 'precious'), 'data\n')

  assert.throws(() => ensureForkClone(forkDir, remote, quietSh), /is not a git clone/)
  assert.ok(fs.existsSync(path.join(forkDir, 'precious')))
})

test('ensureForkClone does not mistake a broken clone inside another repository for a usable one', () => {
  const { root, remote } = makeRemote()
  const forkDir = path.join(remote, 'nested-fork')
  fs.mkdirSync(path.join(forkDir, '.git/objects'), { recursive: true })

  ensureForkClone(forkDir, remote, quietSh)

  assert.equal(fs.realpathSync(git(forkDir, 'rev-parse', '--show-toplevel').trim()), fs.realpathSync(forkDir))
})
