/**
 * The docs' props reference (`docs/content/rolling-number-props.mdx`) and the README's
 * `RollingNumber props` table are derived from `RollingNumberProps` and
 * `RollingNumberHandle`, not
 * maintained beside them: every prop and method the component declares has to
 * appear in their tables, so one added to the component fails here rather
 * than going undocumented.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

/** Every member name declared in an interface block of a `.tsx`. */
function membersOfInterface(source: string, name: string): string[] {
  const match = new RegExp(`^export interface ${name}[^{]*\\{(.*?)^\\}`, 'sm').exec(source)
  if (!match) return []
  return [...new Set([...match[1]!.matchAll(/^ {2}(?:readonly )?([a-zA-Z][a-zA-Z0-9]*)\??[:(]/gm)].map((m) => m[1]!))]
}

/**
 * Every name a page documents: the `name="…"` of each `<Prop>` block (several
 * props may share one, comma-separated) and every backticked name in the first
 * cell of a markdown table row (the methods table, the README).
 */
function documentedIn(markdown: string): Set<string> {
  const fromBlocks = [...markdown.matchAll(/<Prop name="([^"]+)"/g)].flatMap((m) =>
    m[1]!.split(',').map((name) => name.trim())
  )
  const fromTables = [...markdown.matchAll(/^\| ([^|]+) \|/gm)].flatMap((row) =>
    [...row[1]!.matchAll(/`([a-zA-Z][a-zA-Z0-9-]*)/g)].map((m) => m[1]!)
  )
  return new Set([...fromBlocks, ...fromTables])
}

const source = readFileSync(join(__dirname, '..', 'RollingNumber.tsx'), 'utf8')
const props = membersOfInterface(source, 'RollingNumberProps')
const methods = membersOfInterface(source, 'RollingNumberHandle')
const fromViewProps = new Set(['style', 'testID', 'accessibilityLabel'])

/** The README documents both components; only its `RollingNumber props` section is this one's. */
function readmeSection(): string {
  const readme = readFileSync(join(__dirname, '..', '..', 'README.md'), 'utf8')
  const start = readme.indexOf('\n## RollingNumber props')
  expect(start).toBeGreaterThanOrEqual(0)
  const end = readme.indexOf('\n## ', start + 1)
  return readme.slice(start, end === -1 ? undefined : end)
}

describe.each([
  ['docs page', () => readFileSync(join(__dirname, '..', '..', '..', '..', 'docs', 'content', 'rolling-number-props.mdx'), 'utf8')],
  ['README', readmeSection],
])('%s RollingNumber props reference', (_name, read) => {
  const documented = documentedIn(read())

  it('finds the interfaces and the tables', () => {
    expect(props.length).toBeGreaterThan(30)
    expect(methods.length).toBeGreaterThan(3)
    expect(documented.size).toBeGreaterThan(30)
  })

  it('documents every prop the component declares', () => {
    expect(props.filter((prop) => !documented.has(prop))).toEqual([])
  })

  it('documents nothing the component does not declare', () => {
    const declared = new Set([...props, ...methods])
    expect([...documented].filter((name) => !declared.has(name) && !fromViewProps.has(name))).toEqual([])
  })
})

describe('docs page methods', () => {
  const documented = documentedIn(readFileSync(join(__dirname, '..', '..', '..', '..', 'docs', 'content', 'rolling-number-props.mdx'), 'utf8'))
  it('documents every method of the handle', () => {
    expect(methods.filter((method) => !documented.has(method))).toEqual([])
  })
})
