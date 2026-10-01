'use strict'

/**
 * Pure logic for fusing a new schema version into an upstream SchemaStore
 * `catalog.json`. No filesystem or git access happens here — everything is
 * plain data in, plain data out, so it can be unit tested in isolation.
 *
 * Design constraint (see CLAUDE.md "Publishing to SchemaStore"): the URL for
 * the new version is always re-derived from the entry's OWN existing url
 * pattern, never copied verbatim from this repo's local `catalog.json`
 * fragment. That fragment can go stale (it currently points at an old
 * domain, `json.schemastore.org`, while upstream has since moved to
 * `www.schemastore.org`) — trusting it for the URL would silently leak that
 * staleness back into upstream's catalog.
 *
 * @param {{schemas: Array<Record<string, unknown>>}} upstreamCatalog parsed
 *   upstream `src/api/json/catalog.json`
 * @param {{schemaName: string, newVersion: string, makeDefault?: boolean}} options
 * @returns {{schemas: Array<Record<string, unknown>>}} a NEW catalog object;
 *   the input is never mutated
 */
function mergeCatalogEntry(upstreamCatalog, { schemaName, newVersion, makeDefault = false }) {
  if (!upstreamCatalog || !Array.isArray(upstreamCatalog.schemas)) {
    throw new Error('Upstream catalog.json has an unexpected shape: missing "schemas" array')
  }

  const index = upstreamCatalog.schemas.findIndex((schema) => schema.name === schemaName)
  if (index === -1) {
    throw new Error(
      `Schema entry "${schemaName}" was not found in upstream catalog.json. ` +
        'If it was renamed or removed upstream, the merge cannot proceed safely — investigate before retrying.',
    )
  }

  const entry = upstreamCatalog.schemas[index]
  const sampleUrl = entry.url || Object.values(entry.versions || {})[0]
  if (!sampleUrl) {
    throw new Error(`Schema entry "${schemaName}" has no "url" or "versions" to derive a URL pattern from`)
  }

  // "https://www.schemastore.org/aurora-2.0.json" -> prefix + stem + suffix,
  // so the new URL is built the same way regardless of domain/CDN changes upstream.
  const match = sampleUrl.match(/^(.*\/)([a-zA-Z][\w]*)-[\d.]+(\.json)$/)
  if (!match) {
    throw new Error(`Could not derive a URL pattern from "${sampleUrl}"`)
  }
  const [, prefix, stem, suffix] = match
  const newUrl = `${prefix}${stem}-${newVersion}${suffix}`

  // Upsert: re-running with the same version is idempotent because this always
  // recomputes the same key/value pair rather than appending.
  const versions = { ...(entry.versions || {}), [newVersion]: newUrl }

  const mergedEntry = {
    ...entry,
    versions,
    // Promoting the default is a decision, never a side effect of adding a version.
    url: makeDefault ? newUrl : entry.url,
  }

  const schemas = upstreamCatalog.schemas.slice()
  schemas[index] = mergedEntry

  return { ...upstreamCatalog, schemas }
}

/**
 * Finds the `[start, end)` text span of every object in the top-level
 * `schemas` array. String-aware, so braces inside descriptions do not count.
 */
function schemaEntrySpans(text) {
  const spans = []
  let depth = 0
  let inString = false
  let entryStart = -1
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (char === '\\') i++
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{' || char === '[') {
      depth++
      // root object = 1, "schemas" array = 2, each entry = 3
      if (depth === 3 && char === '{') entryStart = i
    } else if (char === '}' || char === ']') {
      if (depth === 3 && char === '}') spans.push([entryStart, i + 1])
      depth--
    }
  }
  return spans
}

/**
 * Text-level counterpart of `mergeCatalogEntry` for upstream's real
 * `catalog.json`: only the matching entry is rewritten, every other byte is
 * kept. A full JSON.parse/stringify round trip is not an option — JSON.parse
 * sorts integer-like keys, so it reorders other projects' `versions` maps
 * (Renovate's "43", "42", ...) and puts that noise in the upstream PR.
 *
 * @param {string} catalogText contents of upstream `src/api/json/catalog.json`
 * @param {{schemaName: string, newVersion: string, makeDefault?: boolean}} options
 * @returns {string} updated text, or the original text when nothing changes
 */
function mergeCatalogText(catalogText, options) {
  const span = schemaEntrySpans(catalogText).find(
    ([start, end]) => JSON.parse(catalogText.slice(start, end)).name === options.schemaName,
  )
  if (!span) {
    // Reuse mergeCatalogEntry's error for a missing entry.
    mergeCatalogEntry({ schemas: [] }, options)
  }

  const [start, end] = span
  const entry = JSON.parse(catalogText.slice(start, end))
  const merged = mergeCatalogEntry({ schemas: [entry] }, options).schemas[0]
  if (JSON.stringify(merged) === JSON.stringify(entry)) {
    return catalogText
  }

  const lineStart = catalogText.lastIndexOf('\n', start) + 1
  const indent = catalogText.slice(lineStart, start)
  const entryText = JSON.stringify(merged, null, 2).replace(/\n/g, `\n${indent}`)
  return catalogText.slice(0, start) + entryText + catalogText.slice(end)
}

module.exports = { mergeCatalogEntry, mergeCatalogText }
