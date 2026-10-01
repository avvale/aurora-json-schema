# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aurora JSON Schema — a collection of JSON Schema (Draft-07) definitions for the Aurora Agile Meta-Framework. These schemas validate Aurora YAML module definition files (`*.aurora.yaml` / `*.aurora.yml`) that describe domain models: bounded contexts, aggregates, and entity properties with database type mappings.

Documentation: https://docs.aurorajs.dev/

## Repository Structure

- `aurora-{version}.json` — Versioned schema files (1.0 through 1.3, and 2.0)
- `catalog.json` — SchemaStore registry entry (json.schemastore.org) mapping file patterns to schema versions
- `test/aurora-{version}/` — Valid YAML examples per schema version (author, book, country, lang)
- `negative_test/aurora-{version}/` — Invalid YAML examples for constraint validation

Every fixture (`test/` and `negative_test/`) must start with the schema pragma line (`# yaml-language-server: $schema=../../schemas/json/aurora-{version}.json`) — SchemaStore's own `node cli.js check` fails a fixture without it.

## Commands

**Format the catalog:**
```bash
npx prettier --write catalog.json
```

Prettier is configured with `prettier-plugin-sort-json`, which sorts keys. Only `catalog.json` and `aurora-1.0.json`
follow it; the later schema files keep their authored key order, so never run Prettier over them — it rewrites the
whole file and buries the real change in the diff.

## Schema Architecture

Each schema defines these core definitions referenced via `$ref`:
- **propertyDefinition** (called `property` in <=1.1) — field specifications with database type, constraints, and metadata
- **frontDefinition** — UI/frontend presentation metadata
- **additionalApisDefinition** — custom API endpoint specifications
- **relationshipDefinition** — entity relationship configurations (many-to-one, many-to-many)

Property types include: `id`, `varchar`, `char`, `text`, `int`, `bigint`, `smallint`, `float`, `decimal`, `boolean`, `date`, `timestamp`, `blob`, `json`, `jsonb`, `enum`, `encrypted`, `password`, `secret`, `array`, `relationship`, `manyToMany`.

`encrypted` is stored encrypted at rest and decryptable server-side, masked on every API read; `maxLength` applies to the plaintext.

## Schema Versioning

- Schemas evolve incrementally; each version file is self-contained
- A new version number is earned only by a backward-incompatible change: one that makes a YAML valid under the
  current version invalid. A backward-compatible change (a new property, enum value or item form) goes into the
  latest version, published or not, and its next publication updates that file in place on SchemaStore —
  SchemaStore accepts in-place updates (`aurora-2.0.json` was updated that way in SchemaStore PR #6188). An
  incompatible change opens a new version, which accumulates every later change until it is published
- `catalog.json` maps file globs to schema URLs and must be updated when adding new versions
- Test YAML files in `test/` should be added for each new schema version
- The `$id` field in each schema should match its filename

## Publishing to SchemaStore

This repo is a staging area: it never contains a SchemaStore fork or clone. `scripts/publish-to-schemastore.js`
automates getting a new or updated version from here into `github.com/SchemaStore/schemastore`, always working through a
throwaway clone under the OS temp dir.

```bash
npm run sync-catalog                                # fix a stale local catalog.json (run this first if unsure)
npm run publish:schemastore -- --version=2.0         # new or updated version: stage the PR branch on the fork
npm run publish:schemastore -- --version=2.0 --open-pr
npm test                                             # unit tests for the catalog merge and the fork clone handling
```

### The two non-negotiable invariants

1. **The catalog merge always starts from upstream's `src/api/json/catalog.json`, never from this repo's local
   `catalog.json` fragment.** The fragment declares *intent* (which version to add — the script errors if it
   isn't listed there yet) but the URL that actually lands in the merged catalog is always re-derived from
   upstream's own existing URL pattern for the entry. Reason: the local fragment is a mirror that drifts
   silently — as of writing it was still stuck at `1.2` with a `json.schemastore.org` URL, three versions and one
   domain migration behind upstream's `www.schemastore.org`. Trusting it for the merge would have downgraded the
   live public catalog back to `1.2` and deleted the `1.3`/`2.0` entries.
2. **The fork is synced to upstream's `master` before every branch**, by construction: the script always deletes
   any stale local branch from a previous run and recreates it directly off a freshly-fetched `upstream/master`.
   There is no code path that produces a branch rooted anywhere else.

Both make the merge and the branch idempotent: re-running the script for the same version changes nothing
further, never duplicates a catalog entry, and never reorders the rest of the (huge) upstream catalog.

### `src/schema-validation.jsonc`: the script never touches it

Upstream's `ajvNotStrictMode` list opts a schema out of Ajv's strict mode. `aurora-2.0.json` is NOT on it — SchemaStore
PR #6188 made it pass strict mode and removed it — so every change to the schema must keep passing strict mode
(`node cli.js check --schema-name=aurora-2.0.json` in the fork clone). The script used to append the version to
that list on every run, which hid exactly that failure; if a version fails strict mode, fix the schema.

The catalog merge is text-level (`mergeCatalogText`): only the Aurora entry is rewritten. A `JSON.parse`/`stringify`
round trip of the whole catalog is not an option — `JSON.parse` sorts integer-like keys, so it reorders other
projects' `versions` maps (Renovate's `"43"`, `"42"`, ...) and puts that noise in the upstream PR.

### What the script does NOT do automatically

- **Open the PR.** By default it prints the exact `gh pr create ...` command and stops; pass `--open-pr` to
  actually run it. Opening a PR against a third-party repo is a decision, not a side effect of preparing one.
- **Promote the default schema version.** Adding a version never moves `catalog.json`'s default `url`; pass
  `--make-default` explicitly when that is the intent.
- **Publish without negative tests.** The script warns (does not block) if `negative_test/aurora-{version}/` is
  missing — these are the fixtures that prove the schema *rejects* what it must reject. `aurora-2.0` shipped
  upstream without any (`src/negative_test/aurora-2.0` doesn't exist there, despite the fixtures existing in
  this repo); don't repeat that.
