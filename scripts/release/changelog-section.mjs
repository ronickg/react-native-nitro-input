#!/usr/bin/env node
// The release notes for a version, taken from the package's own CHANGELOG.md.
//
// In a monorepo the default notes - `git log ${from}...${to}` - are wrong
// twice over: the range starts at whichever package was tagged last, and the
// commits it finds are the whole repository's, not this package's. The
// hand-written changelog is the only thing that knows what a release of *this*
// package contains, so that is what goes on the GitHub release.
//
// Run from a package directory: node ../../scripts/release/changelog-section.mjs 1.2.3

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const version = process.argv[2]
if (!version) {
  console.error('usage: changelog-section.mjs <version>')
  process.exit(1)
}

const path = resolve(process.cwd(), 'CHANGELOG.md')
let source
try {
  source = readFileSync(path, 'utf8')
} catch {
  console.error(`No CHANGELOG.md in ${process.cwd()}`)
  process.exit(1)
}

const lines = source.split('\n')
// `## 1.2.3`, and tolerate a trailing note like `## 1.2.3 (unreleased)` or a
// date, so the heading does not have to be tidied before release-it reads it.
const heading = new RegExp(`^##\\s+v?${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
const start = lines.findIndex((line) => heading.test(line))

if (start === -1) {
  // Failing here is the point: an empty release body is worse than a stopped
  // release, and it is only noticed once the release is public.
  console.error(`No "## ${version}" section in ${path}. Add one before releasing.`)
  process.exit(1)
}

const rest = lines.slice(start + 1)
const end = rest.findIndex((line) => /^##\s/.test(line))
const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()

if (!body) {
  console.error(`The "## ${version}" section in ${path} is empty.`)
  process.exit(1)
}

process.stdout.write(body + '\n')
