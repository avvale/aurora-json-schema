# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aurora JSON Schema — a collection of JSON Schema (Draft-07) definitions for the Aurora Agile Meta-Framework. These schemas validate Aurora YAML module definition files (`*.aurora.yaml` / `*.aurora.yml`) that describe domain models: bounded contexts, aggregates, and entity properties with database type mappings.

Documentation: https://docs.aurorajs.dev/

## Repository Structure

- `aurora-{version}.json` — Versioned schema files (1.0 through 1.4, plus 2020-12)
- `catalog.json` — SchemaStore registry entry (json.schemastore.org) mapping file patterns to schema versions
- `test/aurora-{version}/` — Valid YAML examples per schema version (author, book, country, lang)
- `negative_test/aurora-{version}/` — Invalid YAML examples for constraint validation

## Commands

**Format JSON files:**
```bash
npx prettier --write "*.json"
```

Prettier is configured with `prettier-plugin-sort-json` to maintain consistent key ordering in schema files.

## Schema Architecture

Each schema defines these core definitions referenced via `$ref`:
- **propertyDefinition** (called `property` in <=1.1) — field specifications with database type, constraints, and metadata
- **frontDefinition** — UI/frontend presentation metadata
- **additionalApisDefinition** — custom API endpoint specifications
- **relationshipDefinition** — entity relationship configurations (many-to-one, many-to-many)

Property types include: `id`, `varchar`, `char`, `text`, `int`, `bigint`, `smallint`, `float`, `decimal`, `boolean`, `date`, `timestamp`, `blob`, `json`, `jsonb`, `enum`, `password`, `secret`, `array`, `relationship`, `manyToMany`.

`encrypted` was retired (see `negative_test/aurora-2.0/retired-encrypted-type.aurora.yaml`): it never had a runtime handler and was silently stored as plaintext. Use `varchar` (same storage) or `secret` (masked-on-read) instead.

## Schema Versioning

- Schemas evolve incrementally; each version file is self-contained
- `catalog.json` maps file globs to schema URLs and must be updated when adding new versions
- Test YAML files in `test/` should be added for each new schema version
- The `$id` field in each schema should match its filename

## Publishing to SchemaStore

This repo is a staging area: it never contains a SchemaStore fork or clone. `scripts/publish-to-schemastore.js`
automates getting a new version from here into `github.com/SchemaStore/schemastore`, always working through a
throwaway clone under the OS temp dir.

```bash
npm run sync-catalog                                # fix a stale local catalog.json (run this first if unsure)
npm run publish:schemastore -- --version=2.1         # stage a PR branch on the fork, no push yet is possible via flags
npm run publish:schemastore -- --version=2.1 --make-default --open-pr
npm test                                             # unit tests for the pure catalog/schema-validation merge logic
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

### Gotcha found while building this: `src/schema-validation.jsonc`

Every prior `aurora-*.json` version is opted out of upstream's default strict-AJV validation via the
`ajvNotStrictMode` list in `src/schema-validation.jsonc`. This isn't mentioned anywhere in SchemaStore's own
docs for contributors — it was only found by reading the file. The script appends the new version there too
(idempotently, keeping alphabetical order); skipping this step makes `node cli.js check` fail on an otherwise
correct new schema.

### What the script does NOT do automatically

- **Open the PR.** By default it prints the exact `gh pr create ...` command and stops; pass `--open-pr` to
  actually run it. Opening a PR against a third-party repo is a decision, not a side effect of preparing one.
- **Promote the default schema version.** Adding a version never moves `catalog.json`'s default `url`; pass
  `--make-default` explicitly when that is the intent.
- **Publish without negative tests.** The script warns (does not block) if `negative_test/aurora-{version}/` is
  missing — these are the fixtures that prove the schema *rejects* what it must reject. `aurora-2.0` shipped
  upstream without any (`src/negative_test/aurora-2.0` doesn't exist there, despite the fixtures existing in
  this repo); don't repeat that.
