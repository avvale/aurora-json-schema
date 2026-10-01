'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

function isUsableClone(dir) {
  try {
    // --show-toplevel, not --is-inside-work-tree: a broken clone nested in
    // another repository would otherwise report that parent as usable.
    const topLevel = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return fs.realpathSync(topLevel) === fs.realpathSync(dir)
  } catch {
    return false
  }
}

/**
 * Leaves a usable clone of the fork at `forkDir`: fetches an existing one,
 * clones otherwise. The default `forkDir` lives under the OS temp dir, and
 * macOS purges old files there while keeping the directories — the `.git/`
 * skeleton survives but git no longer recognises it, so that case is
 * re-cloned instead of trusted.
 *
 * @param {string} forkDir
 * @param {string} forkRemote
 * @param {(cmd: string, args: string[], opts?: object) => unknown} sh command runner
 */
function ensureForkClone(forkDir, forkRemote, sh) {
  if (fs.existsSync(forkDir) && isUsableClone(forkDir)) {
    sh('git', ['fetch', 'origin'], { cwd: forkDir })
    return
  }
  if (fs.existsSync(forkDir)) {
    // Only a broken clone is deleted; any other existing directory (a wrong
    // --fork-dir) is the developer's data and stops the run.
    if (!fs.existsSync(path.join(forkDir, '.git'))) {
      throw new Error(`${forkDir} exists and is not a git clone. Pass another --fork-dir or remove it.`)
    }
    fs.rmSync(forkDir, { recursive: true, force: true })
  }
  fs.mkdirSync(path.dirname(forkDir), { recursive: true })
  sh('git', ['clone', forkRemote, forkDir], { cwd: os.tmpdir() })
}

module.exports = { ensureForkClone }
