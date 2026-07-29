'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { mergeCatalogEntry } = require('./catalog-merge')

function sampleUpstreamCatalog() {
  return {
    $schema: 'https://www.schemastore.org/schema-catalog.json',
    version: 1,
    schemas: [
      { name: 'Atmos Manifests', fileMatch: [], url: 'https://atmos.tools/schemas/atmos/atmos-manifest/1.0/atmos-manifest.json' },
      {
        name: 'Aurora Agile Meta-Framework',
        description: 'Yaml for Aurora Agile Meta-Framework',
        fileMatch: ['*.aurora.yaml', '*.aurora.yml'],
        url: 'https://www.schemastore.org/aurora-2.0.json',
        versions: {
          '1.0': 'https://www.schemastore.org/aurora-1.0.json',
          '1.1': 'https://www.schemastore.org/aurora-1.1.json',
          '1.2': 'https://www.schemastore.org/aurora-1.2.json',
          '1.3': 'https://www.schemastore.org/aurora-1.3.json',
          '2.0': 'https://www.schemastore.org/aurora-2.0.json',
        },
      },
      { name: 'Avro Avsc', fileMatch: [], url: 'https://json.schemastore.org/avro-avsc.json' },
    ],
  }
}

test('adds the new version without touching the default url', () => {
  const merged = mergeCatalogEntry(sampleUpstreamCatalog(), {
    schemaName: 'Aurora Agile Meta-Framework',
    newVersion: '2.1',
  })

  const entry = merged.schemas.find((s) => s.name === 'Aurora Agile Meta-Framework')
  assert.equal(entry.versions['2.1'], 'https://www.schemastore.org/aurora-2.1.json')
  assert.equal(entry.url, 'https://www.schemastore.org/aurora-2.0.json', 'default must not move without makeDefault')
})

test('promotes the default only when makeDefault is explicit', () => {
  const merged = mergeCatalogEntry(sampleUpstreamCatalog(), {
    schemaName: 'Aurora Agile Meta-Framework',
    newVersion: '2.1',
    makeDefault: true,
  })

  const entry = merged.schemas.find((s) => s.name === 'Aurora Agile Meta-Framework')
  assert.equal(entry.url, 'https://www.schemastore.org/aurora-2.1.json')
})

test('derives the url from the existing pattern, never from a hardcoded domain', () => {
  const catalog = sampleUpstreamCatalog()
  // Simulate upstream having moved domains again — the merge must follow suit.
  catalog.schemas[1].url = 'https://cdn.example.org/schemas/aurora-2.0.json'
  catalog.schemas[1].versions['2.0'] = 'https://cdn.example.org/schemas/aurora-2.0.json'

  const merged = mergeCatalogEntry(catalog, { schemaName: 'Aurora Agile Meta-Framework', newVersion: '2.1' })
  const entry = merged.schemas.find((s) => s.name === 'Aurora Agile Meta-Framework')
  assert.equal(entry.versions['2.1'], 'https://cdn.example.org/schemas/aurora-2.1.json')
})

test('is idempotent: re-running with the same inputs changes nothing further', () => {
  const once = mergeCatalogEntry(sampleUpstreamCatalog(), {
    schemaName: 'Aurora Agile Meta-Framework',
    newVersion: '2.1',
    makeDefault: true,
  })
  const twice = mergeCatalogEntry(once, {
    schemaName: 'Aurora Agile Meta-Framework',
    newVersion: '2.1',
    makeDefault: true,
  })

  assert.deepEqual(once, twice)
  const entry = twice.schemas.find((s) => s.name === 'Aurora Agile Meta-Framework')
  assert.equal(Object.keys(entry.versions).length, 6, 'must not duplicate the 2.1 entry')
})

test('preserves every other schema entry untouched, in the same order', () => {
  const before = sampleUpstreamCatalog()
  const after = mergeCatalogEntry(before, { schemaName: 'Aurora Agile Meta-Framework', newVersion: '2.1' })

  assert.equal(after.schemas.length, before.schemas.length)
  assert.deepEqual(after.schemas[0], before.schemas[0])
  assert.deepEqual(after.schemas[2], before.schemas[2])
  assert.equal(after.schemas[0].name, 'Atmos Manifests')
  assert.equal(after.schemas[2].name, 'Avro Avsc')
})

test('does not mutate the input catalog', () => {
  const before = sampleUpstreamCatalog()
  const beforeSnapshot = JSON.parse(JSON.stringify(before))

  mergeCatalogEntry(before, { schemaName: 'Aurora Agile Meta-Framework', newVersion: '2.1', makeDefault: true })

  assert.deepEqual(before, beforeSnapshot)
})

test('throws a clear error when the schema entry is missing upstream', () => {
  const catalog = sampleUpstreamCatalog()
  catalog.schemas = catalog.schemas.filter((s) => s.name !== 'Aurora Agile Meta-Framework')

  assert.throws(
    () => mergeCatalogEntry(catalog, { schemaName: 'Aurora Agile Meta-Framework', newVersion: '2.1' }),
    /was not found in upstream/,
  )
})

test('adding a version that already exists does not duplicate anything', () => {
  const merged = mergeCatalogEntry(sampleUpstreamCatalog(), {
    schemaName: 'Aurora Agile Meta-Framework',
    newVersion: '2.0',
  })
  const entry = merged.schemas.find((s) => s.name === 'Aurora Agile Meta-Framework')
  assert.equal(Object.keys(entry.versions).length, 5)
})
