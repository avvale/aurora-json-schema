'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { addAjvNotStrictModeEntry } = require('./schema-validation-merge')

function sampleJsonc() {
  return [
    '{',
    '  "ajvNotStrictMode": [',
    '    "asmdef.json",',
    '    "aurora-1.0.json",',
    '    "aurora-1.1.json",',
    '    "aurora-1.2.json",',
    '    "aurora-1.3.json",',
    '    "aurora-2.0.json",',
    '    "azure-deviceupdate-update-manifest-4.json"',
    '  ],',
    '  "fileMatchConflict": [',
    '    "plugin.yml"',
    '  ]',
    '}',
    '',
  ].join('\n')
}

test('inserts the new entry in alphabetical order', () => {
  const updated = addAjvNotStrictModeEntry(sampleJsonc(), 'aurora-2.1.json')
  const lines = updated.split('\n')
  const idx = lines.findIndex((l) => l.includes('"aurora-2.1.json"'))
  assert.ok(idx > -1, 'new entry must be present')
  assert.match(lines[idx - 1], /"aurora-2\.0\.json"/)
  assert.match(lines[idx + 1], /"azure-deviceupdate-update-manifest-4\.json"/)
})

test('is idempotent: re-running does not duplicate the entry', () => {
  const once = addAjvNotStrictModeEntry(sampleJsonc(), 'aurora-2.1.json')
  const twice = addAjvNotStrictModeEntry(once, 'aurora-2.1.json')
  assert.equal(once, twice)
  const occurrences = (twice.match(/"aurora-2\.1\.json"/g) || []).length
  assert.equal(occurrences, 1)
})

test('leaves unrelated sections untouched', () => {
  const updated = addAjvNotStrictModeEntry(sampleJsonc(), 'aurora-2.1.json')
  assert.match(updated, /"fileMatchConflict": \[\s*"plugin\.yml"\s*\]/)
})

test('preserves the trailing comma style of surrounding entries', () => {
  const updated = addAjvNotStrictModeEntry(sampleJsonc(), 'aurora-2.1.json')
  const inserted = updated.split('\n').find((l) => l.includes('"aurora-2.1.json"'))
  assert.match(inserted, /,$/)
})
