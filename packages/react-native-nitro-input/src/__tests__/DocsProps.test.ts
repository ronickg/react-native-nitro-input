/**
 * The docs' props reference (`docs/input/props.mdx`) is derived from
 * `NitroInputProps` and `NitroInputHandle`, not maintained beside them: every
 * prop and method the component declares has to appear in one of its tables,
 * so one added to the component fails here rather than going undocumented.
 * The README has the same check in `ReadmeProps.test.ts`.
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

const source = readFileSync(join(__dirname, '..', 'NitroInput.tsx'), 'utf8')
const props = membersOfInterface(source, 'NitroInputProps')
const methods = membersOfInterface(source, 'NitroInputHandle')
const page = readFileSync(join(__dirname, '..', '..', '..', '..', 'docs', 'input', 'props.mdx'), 'utf8')
const documented = documentedIn(page)

describe('docs props reference', () => {
  it('finds the interfaces and the page', () => {
    expect(props.length).toBeGreaterThan(60)
    expect(methods.length).toBeGreaterThan(5)
    expect(documented.size).toBeGreaterThan(60)
  })

  it('documents every prop the component declares', () => {
    expect(props.filter((prop) => !documented.has(prop))).toEqual([])
  })

  it('documents every method of the handle', () => {
    expect(methods.filter((method) => !documented.has(method))).toEqual([])
  })

  it('documents nothing the component does not declare', () => {
    // View props named on the page because the wrapper resolves or forwards
    // them itself, plus the ref's own members.
    const fromViewProps = new Set([
      'style', 'testID', 'id', 'nativeID', 'accessibilityLabel', 'aria-label', 'aria-labelledby',
      'aria-busy', 'aria-checked', 'aria-disabled', 'aria-expanded', 'aria-selected', 'aria-hidden',
    ])
    const declared = new Set([...props, ...methods])
    const stale = [...documented].filter((name) => !declared.has(name) && !fromViewProps.has(name))
    expect(stale).toEqual([])
  })
})
