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

Property types include: `id`, `varchar`, `char`, `text`, `int`, `bigint`, `smallint`, `float`, `decimal`, `boolean`, `date`, `timestamp`, `blob`, `json`, `jsonb`, `enum`, `encrypted`, `password`, `array`, `relationship`, `manyToMany`.

## Schema Versioning

- Schemas evolve incrementally; each version file is self-contained
- `catalog.json` maps file globs to schema URLs and must be updated when adding new versions
- Test YAML files in `test/` should be added for each new schema version
- The `$id` field in each schema should match its filename
