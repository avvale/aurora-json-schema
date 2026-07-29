#!/usr/bin/env node
'use strict'

/**
 * Publishes a new Aurora schema version to SchemaStore (github.com/SchemaStore/schemastore)
 * without the fork ever living inside this repo's git tree.
 *
 * Usage:
 *   node scripts/publish-to-schemastore.js --sync-catalog
 *   node scripts/publish-to-schemastore.js --version=2.1 [--make-default] [--open-pr]
 *
 * See CLAUDE.md ("Publishing to SchemaStore") for the two non-negotiable invariants
 * this script exists to enforce: the catalog merge always starts from upstream's
 * catalog.json (never this repo's stale fragment), and the fork is synced to
 * upstream/master before every branch.
 */

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')

const { mergeCatalogEntry } = require('./lib/catalog-merge')
const { addAjvNotStrictModeEntry } = require('./lib/schema-validation-merge')

const REPO_ROOT = path.resolve(__dirname, '..')
const SCHEMA_NAME = 'Aurora Agile Meta-Framework' // catalog.json "name" identifying our entry upstream
const UPSTREAM_REPO = 'SchemaStore/schemastore'
const CATALOG_REL_PATH = 'src/api/json/catalog.json'
const SCHEMA_VALIDATION_REL_PATH = 'src/schema-validation.jsonc'
const SCHEMA_DIR_REL_PATH = 'src/schemas/json'
const TEST_DIR_REL_PATH = 'src/test'
const NEGATIVE_TEST_DIR_REL_PATH = 'src/negative_test'

const HELP = `Publish an Aurora schema version to SchemaStore.

USAGE:
  node scripts/publish-to-schemastore.js --sync-catalog
  node scripts/publish-to-schemastore.js --version=X.Y [--make-default] [--open-pr]

MODES:
  --sync-catalog   Bring this repo's local catalog.json fragment up to date
                    from upstream. Run this first if you are not sure the local
                    fragment is current (it drifts silently otherwise).

  --version=X.Y     Publish aurora-X.Y.json (must already exist in this repo,
                    along with test/aurora-X.Y/). Copies schema + tests to a
                    fork of SchemaStore, merges the catalog entry, validates,
                    commits and pushes a branch. Opening the PR is a separate,
                    explicit step (see --open-pr).

FLAGS:
  --make-default    Also point catalog.json's default "url" at this version.
                    Never implied by publishing a version — promoting the
                    default is a decision, not a side effect.
  --open-pr         Actually run "gh pr create" at the end. Without this flag,
                    the script prints the exact command instead and stops.
  --fork-dir=PATH   Where to clone the fork (default: a fixed path under the
                    OS temp dir, always outside this repo's git tree).
  --upstream-remote=URL  Override the upstream git remote (testing only).
  --fork-remote=URL      Override the fork's git remote (testing only).
  --skip-fork-check      Skip the "gh repo fork" existence check (testing only,
                          for use against a local fake remote instead of GitHub).
  --skip-clean-check     Skip the "working tree is clean" precondition (testing only).
`

function parseArgs(argv) {
  const args = { makeDefault: false, openPr: false, syncCatalog: false, skipForkCheck: false, help: false }
  for (const raw of argv) {
    const eqIndex = raw.indexOf('=')
    const key = eqIndex === -1 ? raw : raw.slice(0, eqIndex)
    const value = eqIndex === -1 ? undefined : raw.slice(eqIndex + 1)
    switch (key) {
      case '--version':
        args.version = value
        break
      case '--make-default':
        args.makeDefault = true
        break
      case '--open-pr':
        args.openPr = true
        break
      case '--sync-catalog':
        args.syncCatalog = true
        break
      case '--fork-dir':
        args.forkDir = value
        break
      case '--upstream-remote':
        args.upstreamRemote = value
        break
      case '--fork-remote':
        args.forkRemote = value
        break
      case '--skip-fork-check':
        args.skipForkCheck = true
        break
      case '--skip-clean-check':
        args.skipCleanCheck = true
        break
      case '--help':
      case '-h':
        args.help = true
        break
      default:
        throw new Error(`Unknown flag: ${raw}\n\n${HELP}`)
    }
  }
  return args
}

function sh(cmd, cmdArgs, opts = {}) {
  console.log(`$ ${cmd} ${cmdArgs.join(' ')}`)
  return execFileSync(cmd, cmdArgs, { stdio: 'inherit', cwd: REPO_ROOT, ...opts })
}

function ghApiJson(apiArgs) {
  const out = execFileSync('gh', ['api', ...apiArgs], { encoding: 'utf8' })
  return JSON.parse(out)
}

function ghUsername() {
  return execFileSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' }).trim()
}

function assertGhAuthenticated() {
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' })
  } catch {
    throw new Error('gh is not authenticated. Run `gh auth login` first.')
  }
}

function assertCleanWorkingTree() {
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' })
  if (status.trim().length > 0) {
    throw new Error(
      `This repo (${REPO_ROOT}) has uncommitted changes. Commit or stash them first:\n${status}`,
    )
  }
}

function assertVersionFilesExist(version) {
  const schemaFile = path.join(REPO_ROOT, `aurora-${version}.json`)
  const testDir = path.join(REPO_ROOT, 'test', `aurora-${version}`)
  const negativeDir = path.join(REPO_ROOT, 'negative_test', `aurora-${version}`)

  if (!fs.existsSync(schemaFile)) {
    throw new Error(`Missing schema file: aurora-${version}.json`)
  }
  if (!fs.existsSync(testDir)) {
    throw new Error(`Missing test fixtures: test/aurora-${version}/`)
  }

  const hasNegativeTests = fs.existsSync(negativeDir)
  if (!hasNegativeTests) {
    console.warn(
      `\n  WARNING: negative_test/aurora-${version}/ does not exist.\n` +
        '  Negative tests prove the schema REJECTS what it must reject. Publishing without\n' +
        '  them is exactly how aurora-2.0 slipped through without any upstream — strongly\n' +
        '  recommended to add them before publishing.\n',
    )
  }

  return { schemaFile, testDir, negativeDir: hasNegativeTests ? negativeDir : null }
}

/**
 * This repo's local `catalog.json` is a single schema-entry fragment meant to
 * be pasted straight into upstream's array, so it has historically been
 * committed with a dangling trailing comma after the closing "}" — which
 * makes it invalid standalone JSON (confirmed: `prettier --write catalog.json`
 * fails on it as-is, see 2026-07-29 discovery). Read leniently, write clean.
 */
function readLocalCatalogFragment(localCatalogPath) {
  const raw = fs.readFileSync(localCatalogPath, 'utf8')
  return JSON.parse(raw.trim().replace(/,\s*$/, ''))
}

function assertLocalCatalogDeclaresVersion(version) {
  const localCatalogPath = path.join(REPO_ROOT, 'catalog.json')
  const localCatalog = readLocalCatalogFragment(localCatalogPath)
  if (!localCatalog.versions || !localCatalog.versions[version]) {
    throw new Error(
      `catalog.json (local fragment) does not declare version "${version}" yet.\n` +
        'Add it to the "versions" map before publishing. This fragment only declares INTENT —\n' +
        'the actual URL used upstream is always re-derived from upstream\'s own pattern, never\n' +
        'copied from here (see CLAUDE.md, "Publishing to SchemaStore").',
    )
  }
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDirSync(s, d)
    else fs.copyFileSync(s, d)
  }
}

function ensureForkExists(user) {
  try {
    execFileSync('gh', ['repo', 'view', `${user}/schemastore`], { stdio: 'ignore' })
    console.log(`Fork ${user}/schemastore already exists.`)
  } catch {
    console.log(`Forking ${UPSTREAM_REPO}...`)
    sh('gh', ['repo', 'fork', UPSTREAM_REPO, '--clone=false'])
  }
}

function ensureForkClone(forkDir, forkRemote) {
  if (fs.existsSync(path.join(forkDir, '.git'))) {
    sh('git', ['fetch', 'origin'], { cwd: forkDir })
  } else {
    fs.mkdirSync(path.dirname(forkDir), { recursive: true })
    sh('git', ['clone', forkRemote, forkDir], { cwd: os.tmpdir() })
  }
}

/**
 * Branches directly off `upstream/master`, deleting any stale local branch
 * from a previous run first. This IS the "sync fork with upstream before
 * branching" invariant, by construction — there is no path through this
 * function that produces a branch not rooted at upstream's current master.
 */
function syncAndBranch(forkDir, upstreamRemote, branchName) {
  const remotes = execFileSync('git', ['remote'], { cwd: forkDir, encoding: 'utf8' }).split('\n')
  if (!remotes.includes('upstream')) {
    sh('git', ['remote', 'add', 'upstream', upstreamRemote], { cwd: forkDir })
  }
  sh('git', ['fetch', 'upstream', 'master'], { cwd: forkDir })

  try {
    execFileSync('git', ['rev-parse', '--verify', branchName], { cwd: forkDir, stdio: 'ignore' })
    sh('git', ['checkout', 'upstream/master'], { cwd: forkDir })
    sh('git', ['branch', '-D', branchName], { cwd: forkDir })
  } catch {
    // Branch doesn't exist yet on this clone — nothing to clean up.
  }

  sh('git', ['checkout', '-b', branchName, 'upstream/master'], { cwd: forkDir })
}

function copyFiles(forkDir, { schemaFile, testDir, negativeDir, version }) {
  fs.copyFileSync(schemaFile, path.join(forkDir, SCHEMA_DIR_REL_PATH, `aurora-${version}.json`))
  copyDirSync(testDir, path.join(forkDir, TEST_DIR_REL_PATH, `aurora-${version}`))
  if (negativeDir) {
    copyDirSync(negativeDir, path.join(forkDir, NEGATIVE_TEST_DIR_REL_PATH, `aurora-${version}`))
  }
}

function applyCatalogMerge(forkDir, { version, makeDefault }) {
  const catalogPath = path.join(forkDir, CATALOG_REL_PATH)
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  const merged = mergeCatalogEntry(catalog, { schemaName: SCHEMA_NAME, newVersion: version, makeDefault })
  fs.writeFileSync(catalogPath, JSON.stringify(merged, null, 2) + '\n')
}

function applySchemaValidationMerge(forkDir, version) {
  const svPath = path.join(forkDir, SCHEMA_VALIDATION_REL_PATH)
  const text = fs.readFileSync(svPath, 'utf8')
  fs.writeFileSync(svPath, addAjvNotStrictModeEntry(text, `aurora-${version}.json`))
}

function runValidation(forkDir) {
  sh('npm', ['install'], { cwd: forkDir })
  sh('npm', ['run', 'prettier:fix'], { cwd: forkDir })
  sh('node', ['cli.js', 'check'], { cwd: forkDir })
}

function commitAndPush(forkDir, version, branchName) {
  sh('git', ['add', '-A'], { cwd: forkDir })
  const message = `feat: add aurora-${version} schema

Adds the Aurora Agile Meta-Framework schema version ${version}, its
positive and negative test fixtures, and registers it in catalog.json.`
  sh('git', ['commit', '-m', message], { cwd: forkDir })
  sh('git', ['push', '--force-with-lease', '--set-upstream', 'origin', branchName], { cwd: forkDir })
}

function printOrOpenPr(forkDir, { version, openPr, user, branchName }) {
  const title = `Add aurora-${version} schema`
  const body = `Adds the Aurora Agile Meta-Framework schema version ${version}.`
  const prArgs = [
    'pr',
    'create',
    '--repo',
    UPSTREAM_REPO,
    '--head',
    `${user}:${branchName}`,
    '--base',
    'master',
    '--title',
    title,
    '--body',
    body,
  ]

  if (openPr) {
    sh('gh', prArgs, { cwd: forkDir })
    return
  }

  console.log('\nReady to open the PR. Nothing was opened automatically — run:\n')
  console.log(`  gh ${prArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}\n`)
}

function fetchUpstreamFile(relativePath) {
  const contentEntry = ghApiJson([`repos/${UPSTREAM_REPO}/contents/${relativePath}`])
  return Buffer.from(contentEntry.content, 'base64').toString('utf8')
}

function syncCatalog() {
  const upstreamCatalogText = fetchUpstreamFile(CATALOG_REL_PATH)
  const upstreamCatalog = JSON.parse(upstreamCatalogText)
  const entry = upstreamCatalog.schemas.find((s) => s.name === SCHEMA_NAME)
  if (!entry) {
    throw new Error(`Schema entry "${SCHEMA_NAME}" was not found in upstream catalog.json`)
  }

  // Writes VALID standalone JSON (no trailing comma) — fixes the pre-existing
  // quirk that made this file unparseable by `JSON.parse` and by prettier alike.
  const localCatalogPath = path.join(REPO_ROOT, 'catalog.json')
  fs.writeFileSync(localCatalogPath, JSON.stringify(entry, null, 2) + '\n')
  sh('npx', ['prettier', '--write', 'catalog.json'])
  console.log(`\ncatalog.json synced from upstream. Default is now: ${entry.url}`)
}

function publish(args) {
  assertGhAuthenticated()
  if (!args.skipCleanCheck) {
    assertCleanWorkingTree()
  }

  if (!args.version) {
    throw new Error(`--version=X.Y is required.\n\n${HELP}`)
  }

  const files = assertVersionFilesExist(args.version)
  assertLocalCatalogDeclaresVersion(args.version)

  const user = args.skipForkCheck ? null : ghUsername()
  const forkDir = args.forkDir || path.join(os.tmpdir(), 'aurora-schemastore-fork')
  const upstreamRemote = args.upstreamRemote || `https://github.com/${UPSTREAM_REPO}.git`
  const forkRemote = args.forkRemote || (user ? `https://github.com/${user}/schemastore.git` : undefined)
  const branchName = `feat/aurora-${args.version}-schema`

  if (!args.skipForkCheck) {
    ensureForkExists(user)
  }
  if (!forkRemote) {
    throw new Error('Could not determine the fork remote. Pass --fork-remote=URL explicitly.')
  }

  ensureForkClone(forkDir, forkRemote)
  syncAndBranch(forkDir, upstreamRemote, branchName)
  copyFiles(forkDir, { ...files, version: args.version })
  applyCatalogMerge(forkDir, { version: args.version, makeDefault: args.makeDefault })
  applySchemaValidationMerge(forkDir, args.version)
  runValidation(forkDir)
  commitAndPush(forkDir, args.version, branchName)
  printOrOpenPr(forkDir, { version: args.version, openPr: args.openPr, user, branchName })
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || (!args.syncCatalog && !args.version)) {
    console.log(HELP)
    process.exit(args.help ? 0 : 1)
  }

  if (args.syncCatalog) {
    syncCatalog()
    return
  }

  publish(args)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`\nError: ${error.message}`)
    process.exit(1)
  }
}

module.exports = { parseArgs }
