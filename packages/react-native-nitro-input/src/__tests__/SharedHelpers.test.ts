/**
 * `NitroInput.tsx` and the rolling number's `RollingNumber.tsx` carry the same
 * small helpers (font-weight mapping, color processing). The two packages
 * publish independently, so they cannot share a module without a third
 * package; this keeps the copies from drifting instead. Both blocks sit
 * between `// shared-helpers:start` and `// shared-helpers:end`, and the
 * sibling runs the mirror image of this test.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

function sharedBlock(path: string): string {
  const source = readFileSync(path, 'utf8')
  const start = source.indexOf('// shared-helpers:start')
  const end = source.indexOf('// shared-helpers:end')
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  // The lines after the marker name the other file; skip them so the two blocks compare.
  return source
    .slice(start, end)
    .split('\n')
    .filter((line) => !line.startsWith('// Kept byte-for-byte') && !line.startsWith('// (a test compares'))
    .join('\n')
}

const here = join(__dirname, '..', 'NitroInput.tsx')
const sibling = join(__dirname, '..', '..', '..', 'react-native-nitro-rolling-number', 'src', 'RollingNumber.tsx')

const describeIfMonorepo = existsSync(sibling) ? describe : describe.skip

describeIfMonorepo('shared helpers', () => {
  it('stay identical between NitroInput.tsx and RollingNumber.tsx', () => {
    expect(sharedBlock(here)).toBe(sharedBlock(sibling))
  })
})
