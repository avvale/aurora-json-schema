'use strict'

/**
 * Pure text-based insertion into upstream's `src/schema-validation.jsonc`.
 *
 * Gotcha this exists for: `node cli.js check` runs every schema in strict AJV
 * mode by default. Every prior aurora-*.json version is opted OUT of strict
 * mode via the `ajvNotStrictMode` list — without adding the new version there
 * too, `check` fails on the new schema even though it's byte-identical in
 * spirit to the ones already published. This was NOT mentioned in the
 * original task description; it surfaced while reading `src/schema-validation.jsonc`
 * from upstream before writing this script (2026-07-29).
 *
 * Text-based (not JSON.parse/stringify) on purpose: the file is JSONC and
 * carries inline comments the CLI's own `jsonc-parser` preserves as guidance
 * for maintainers — round-tripping through JSON.parse would silently drop them.
 *
 * Scope note: this only handles `ajvNotStrictMode`, which is a flat array of
 * quoted filenames with no nested arrays or embedded comments before its
 * closing bracket (verified against upstream's current file). Do not reuse
 * this for a section with a different shape without re-checking that assumption.
 *
 * @param {string} jsoncText contents of `src/schema-validation.jsonc`
 * @param {string} newFileName e.g. "aurora-2.1.json"
 * @returns {string} updated contents, or the original text unchanged if the
 *   entry is already present (idempotent)
 */
function addAjvNotStrictModeEntry(jsoncText, newFileName) {
  const marker = '"ajvNotStrictMode": ['
  const startIdx = jsoncText.indexOf(marker)
  if (startIdx === -1) {
    throw new Error('Could not find "ajvNotStrictMode" array in schema-validation.jsonc')
  }
  const bodyStart = startIdx + marker.length
  const bodyEnd = jsoncText.indexOf(']', bodyStart)
  if (bodyEnd === -1) {
    throw new Error('Could not find the closing bracket of "ajvNotStrictMode"')
  }

  const body = jsoncText.slice(bodyStart, bodyEnd)
  if (body.includes(`"${newFileName}"`)) {
    return jsoncText
  }

  const lines = body.split('\n')
  const sampleEntryLine = lines.find((line) => /^\s*"[^"]+"/.test(line))
  const indent = sampleEntryLine ? sampleEntryLine.match(/^(\s*)/)[1] : '  '

  // Keep the array's existing alphabetical order; append at the end of the
  // block (right before the closing bracket) if nothing sorts after it.
  let insertAt = lines.length
  for (let i = 0; i < lines.length; i++) {
    const entryMatch = lines[i].match(/^\s*"([^"]+)"/)
    if (entryMatch && entryMatch[1] > newFileName) {
      insertAt = i
      break
    }
  }

  lines.splice(insertAt, 0, `${indent}"${newFileName}",`)

  return jsoncText.slice(0, bodyStart) + lines.join('\n') + jsoncText.slice(bodyEnd)
}

module.exports = { addAjvNotStrictModeEntry }
