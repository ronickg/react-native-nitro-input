/**
 * The README's props table is derived from `NitroInputProps`, not maintained
 * beside it: every prop the interface declares has to appear in the table, so
 * a prop added to the component fails here rather than going undocumented.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

/** Every prop name declared in an interface block of a `.tsx`. */
function propsOfInterface(source: string, name: string): string[] {
  const match = new RegExp(`^export interface ${name}[^{]*\\{(.*?)^\\}`, 'sm').exec(source)
  if (!match) return []
  return [...new Set([...match[1]!.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*)\??:/gm)].map((m) => m[1]!))]
}

const props = propsOfInterface(readFileSync(join(__dirname, '..', 'NitroInput.tsx'), 'utf8'), 'NitroInputProps')
const readme = readFileSync(join(__dirname, '..', '..', 'README.md'), 'utf8')

function propsTable(): string {
  const start = readme.indexOf('\n## Props')
  expect(start).toBeGreaterThanOrEqual(0)
  const end = readme.indexOf('\n## ', start + 1)
  return readme.slice(start, end === -1 ? undefined : end)
}

describe('README props table', () => {
  const table = propsTable()
  // Anything in backticks in the first cell of a table row.
  const documented = new Set(
    [...table.matchAll(/^\| ([^|]+) \|/gm)].flatMap((row) => [...row[1]!.matchAll(/`([a-zA-Z][a-zA-Z0-9-]*)`/g)].map((m) => m[1]!))
  )

  it('finds the interface and the table', () => {
    expect(props.length).toBeGreaterThan(60)
    expect(documented.size).toBeGreaterThan(60)
  })

  it('documents every prop the component declares', () => {
    const missing = props.filter((prop) => !documented.has(prop))
    expect(missing).toEqual([])
  })

  it('documents nothing the component does not declare', () => {
    // The view props the field takes through `ViewProps`, named in the table
    // because the wrapper resolves or forwards them itself.
    const fromViewProps = new Set(['style', 'testID', 'id', 'aria-label', 'nativeID', 'accessibilityLabel'])
    const declared = new Set(props)
    const stale = [...documented].filter((prop) => !declared.has(prop) && !fromViewProps.has(prop))
    expect(stale).toEqual([])
  })
})
