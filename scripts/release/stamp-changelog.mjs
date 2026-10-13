#!/usr/bin/env node
// Turns the package's `## Unreleased` changelog heading into the version being
// released, so `bun run release` needs nothing but the version bump.
//
// release-it runs it twice (see the package's `release-it.hooks`):
// - `before:init`, with `--check`: stops the release before anything is
//   bumped, tagged or published when there is nothing under `## Unreleased`.
// - `after:bump`, with the new version: renames the heading. The release
//   commit stages the package directory, so the rename goes out with it, and
//   `changelog-section.mjs` then finds `## <version>` for the GitHub notes.
//
// Run from a package directory:
//   node ../../scripts/release/stamp-changelog.mjs --check
//   node ../../scripts/release/stamp-changelog.mjs 1.2.3

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const arg = process.argv[2]
if (!arg) {
  console.error('usage: stamp-changelog.mjs --check | <version>')
  process.exit(1)
}

const path = resolve(process.cwd(), 'CHANGELOG.md')
const lines = readFileSync(path, 'utf8').split('\n')
const unreleased = lines.findIndex((line) => /^##\s+unreleased\b/i.test(line))

if (unreleased === -1) {
  console.error(`No "## Unreleased" section in ${path}: write down what this release changes first.`)
  process.exit(1)
}
const next = lines.findIndex((line, index) => index > unreleased && /^##\s/.test(line))
const body = lines.slice(unreleased + 1, next === -1 ? undefined : next)
if (!body.some((line) => line.trim() !== '')) {
  console.error(`"## Unreleased" in ${path} is empty: write down what this release changes first.`)
  process.exit(1)
}

if (arg === '--check') process.exit(0)

lines[unreleased] = `## ${arg.replace(/^v/, '')}`
writeFileSync(path, lines.join('\n'))
console.log(`CHANGELOG.md: "## Unreleased" is now "${lines[unreleased]}".`)
