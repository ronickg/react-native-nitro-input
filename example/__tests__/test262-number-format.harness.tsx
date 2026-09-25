/**
 * test262's `intl402/NumberFormat` conformance tests, run on the device
 * against Hermes' `Intl.NumberFormat` and against the library's
 * `NumberFormat` (standing in for `Intl.NumberFormat` inside each test).
 *
 * The tests are bundled by `node scripts/test262/number-format.mjs` into
 * `test262/number-format.generated.js` (not committed); without the bundle the
 * suite is skipped.
 */
import { Platform } from 'react-native'
import { describe, expect, it } from 'react-native-harness'
import { NumberFormat } from 'react-native-nitro-input'

type Test262 = { path: string; includes: string[]; flags: string[]; features: string[]; negative: { phase: string; type: string } | null; source: string }
type Suite = { commit: string; harness: Record<string, string>; tests: Test262[] }

let suite: Suite | null = null
try {
  suite = require('./test262/number-format.generated.js') as Suite
} catch {
  suite = null
}

/** `Intl`, with `NumberFormat` replaced by the library's; a fresh one per test, since tests may delete from it. */
const oursIntl = () => Object.create(Intl, { NumberFormat: { value: NumberFormat, writable: true, configurable: true } })

/**
 * Some tests taint the built-in prototypes (throwing setters on
 * Object.prototype, Array.prototype…) to prove the constructor does not read
 * through them. Those would leak into the next test and into Harness itself,
 * so every test runs between a snapshot and a restore of them.
 */
const PROTOTYPES: object[] = [
  Object.prototype, Array.prototype, Function.prototype, String.prototype, Number.prototype, Boolean.prototype, Symbol.prototype,
  BigInt.prototype, RegExp.prototype, Map.prototype, Set.prototype, Promise.prototype, Error.prototype,
  Object.getPrototypeOf([][Symbol.iterator]()), Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())),
  Object, Array, Number, String, Symbol, Reflect, Math, JSON, RegExp, Intl, globalThis,
  // The subjects: tests redefine methods on them.
  Intl.NumberFormat, Intl.NumberFormat.prototype, NumberFormat, NumberFormat.prototype,
]
function snapshot() {
  return PROTOTYPES.map((target) => {
    const keys = Reflect.ownKeys(target)
    return { target, keys: new Set(keys), descriptors: keys.map((k) => [k, Object.getOwnPropertyDescriptor(target, k)!] as const) }
  })
}
function restore(saved: ReturnType<typeof snapshot>) {
  for (const { target, keys, descriptors } of saved) {
    for (const k of Reflect.ownKeys(target)) if (!keys.has(k)) Reflect.deleteProperty(target, k)
    for (const [k, d] of descriptors) Object.defineProperty(target, k, d)
  }
}

/** Runs one test with `Intl` bound to `intl`; the failure message, or null when it passed. */
function run(s: Suite, test: Test262, intl: unknown): string | null {
  const saved = snapshot()
  try {
    return runIsolated(s, test, intl)
  } finally {
    restore(saved)
  }
}

function runIsolated(s: Suite, test: Test262, intl: unknown): string | null {
  const strict = test.flags.includes('onlyStrict') ? '"use strict";\n' : ''
  const source = strict + ['assert.js', 'sta.js', ...test.includes].map((name) => s.harness[name] ?? '').join('\n') + '\n' + test.source
  try {
    // eslint-disable-next-line no-new-func
    new Function('Intl', source)(intl)
    return test.negative ? `expected a ${test.negative.type}` : null
  } catch (e) {
    const error = e as { name?: string; message?: string; constructor?: { name?: string } }
    if (test.negative && (error?.constructor?.name === test.negative.type || error?.name === test.negative.type)) return null
    return `${error?.name ?? 'Error'}: ${String(error?.message ?? e).slice(0, 240)}`
  }
}

/**
 * Tests NumberFormat is known to fail, and why. Anything else failing fails
 * the suite.
 */
const EXPECTED_FAILURES: Record<string, string> = {
  // The runner, not NumberFormat: test262's cross-realm host hook, and
  // non-configurable properties a test leaves on the shared constructor or
  // prototype, which no restore can remove (each passes on its own).
  'intl402/NumberFormat/proto-from-ctor-realm.js': 'needs $262.createRealm',
  'intl402/NumberFormat/prototype/format/no-instanceof.js': 'leaves a non-configurable Symbol.hasInstance behind',
  'intl402/NumberFormat/prototype/resolvedOptions/no-instanceof.js': 'leaves a non-configurable Symbol.hasInstance behind',
  'intl402/NumberFormat/intl-legacy-constructed-symbol-property.js': 'an earlier legacy test leaves its fallback on the prototype',
  // Number.prototype.toLocaleString is Hermes' own.
  'intl402/NumberFormat/prototype/format/units.js': "tests Hermes' toLocaleString",
  ...(Platform.OS === 'ios'
    ? {
        // Foundation has no long compact form ("988 million"), only the short one.
        'intl402/NumberFormat/prototype/format/notation-compact-de-DE.js': 'no long compact notation on iOS',
        'intl402/NumberFormat/prototype/format/notation-compact-en-US.js': 'no long compact notation on iOS',
        'intl402/NumberFormat/prototype/formatToParts/notation-compact-de-DE.js': 'no long compact notation on iOS',
        'intl402/NumberFormat/prototype/formatToParts/notation-compact-en-US.js': 'no long compact notation on iOS',
      }
    : {
        // Android's ICU carries older CLDR data than test262 expects.
        'intl402/NumberFormat/prototype/format/numbering-systems.js': "Android's ICU lacks the newest numbering systems (gara)",
        'intl402/NumberFormat/prototype/format/useGrouping-extended-en-IN.js': "Android's CLDR abbreviates thousands as T in en-IN",
      }),
}

const results: { path: string; hermes: string | null; ours: string | null }[] = []
const CHUNKS = 10
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('test262 intl402/NumberFormat', () => {
  // In chunks that yield between tests: one synchronous run of every test
  // blocks the JS thread long enough for the Harness bridge to give up.
  for (let chunk = 0; chunk < CHUNKS; chunk++) {
    it(`runs chunk ${chunk + 1} of ${CHUNKS} against Hermes and against NumberFormat`, async () => {
      if (!suite) return
      const s = suite
      const size = Math.ceil(s.tests.length / CHUNKS)
      for (const test of s.tests.slice(chunk * size, (chunk + 1) * size)) {
        results.push({ path: test.path, hermes: run(s, test, Intl), ours: run(s, test, oursIntl()) })
        await tick()
      }
    })
  }

  it('passes every test but the known exceptions, and every test Hermes passes', () => {
    if (!suite) return
    const hermesPasses = results.filter((r) => r.hermes === null).length
    const ourPasses = results.filter((r) => r.ours === null).length
    const fixed = results.filter((r) => r.hermes !== null && r.ours === null).length
    const regressions = results.filter((r) => r.hermes === null && r.ours !== null)
    const failures = results.filter((r) => r.ours !== null && !(r.path in EXPECTED_FAILURES))
    const summary =
      `test262@${suite.commit.slice(0, 12)}, ${results.length} tests: Hermes passes ${hermesPasses}, NumberFormat passes ${ourPasses} ` +
      `(${fixed} that Hermes fails); ${regressions.length} pass on Hermes and fail on NumberFormat.\n` +
      failures.map((r) => `${r.hermes === null ? 'REGRESSION ' : ''}${r.path}: ${r.ours}`).join('\n')
    if (failures.length > 0) throw new Error(summary)
    expect(regressions).toEqual([])
  })
})
