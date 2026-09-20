/**
 * Every prop a Nitro Hybrid View declares is read off the *same* raw props
 * object React Native reads. A view's props struct derives from
 * `react::ViewProps`, so a name we share with RN is not shadowed - both
 * parsers run, and RN applies its own meaning alongside ours.
 *
 * That is not hypothetical. RN 0.76 added the CSS outline properties
 * (`outlineColor`, `outlineWidth`, `outlineStyle`, `outlineOffset`) to every
 * view, and the field we had called `outlineColor` started drawing a second,
 * square outline that no prop of ours could turn off. The fix was to move to
 * a painter's vocabulary - `strokeColor`, `strokeWidth`, `cornerRadius`,
 * `fillColor` - which CSS and Yoga do not use.
 *
 * This test is the tripwire for the next time RN grows a name. It reads the
 * string literals out of RN's own view-prop parsers and asserts none of them
 * is a prop we declare, so an RN upgrade that would collide fails here rather
 * than on a device.
 */
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';

/** RN's C++ parsers for everything a plain `<View>` understands. */
const VIEW_PROP_SOURCES = [
  'ViewProps.cpp',
  'ViewProps.h',
  'BaseViewProps.cpp',
  'BaseViewProps.h',
  'YogaStylableProps.cpp',
  'YogaStylableProps.h',
  'AccessibilityProps.cpp',
];

function reactNativeViewDir(): string {
  const entry = require.resolve('react-native/package.json');
  return join(dirname(entry), 'ReactCommon/react/renderer/components/view');
}

function namesReactNativeParses(): Set<string> {
  const dir = reactNativeViewDir();
  const names = new Set<string>();
  for (const file of VIEW_PROP_SOURCES) {
    let source: string;
    try {
      source = readFileSync(join(dir, file), 'utf8');
    } catch {
      continue; // renamed between RN versions; the others still cover us
    }
    // Deliberately loose: every identifier-shaped string literal in the file.
    // Over-reporting is the safe direction for a collision check.
    for (const match of source.matchAll(/"([a-zA-Z][a-zA-Z0-9-]*)"/g)) {
      names.add(match[1]!);
    }
  }
  return names;
}

/** Top-level prop names declared in a `.nitro.ts` spec. */
function declaredProps(specSource: string): string[] {
  const names = new Set<string>();
  for (const match of specSource.matchAll(/^ {2}(?:readonly )?([a-zA-Z][a-zA-Z0-9]*)\??:/gm)) {
    names.add(match[1]!);
  }
  return [...names];
}

/**
 * Names we know clash and have decided to live with. Empty, and the intent is
 * to keep it that way: `direction` used to be here (Yoga's layout property,
 * which logged `Could not parse yoga::Direction: up` on every prop update) and
 * was retired by renaming the *native* prop to `rollDirection`. The public prop
 * is still `direction` - the wrapper forwards every prop explicitly, so the two
 * names never have to agree.
 */
const ACCEPTED = new Set<string>([]);

describe('prop names', () => {
  const reserved = namesReactNativeParses();

  it('finds the react-native sources to check against', () => {
    // A guard on the guard: an empty set would make every assertion below pass.
    expect(reserved.size).toBeGreaterThan(50);
    expect(reserved.has('outlineColor')).toBe(true);
    expect(reserved.has('borderRadius')).toBe(true);
  });

  it('would catch the collision we already shipped once', () => {
    // The spec we had before RN 0.76 forced the rename. If this stops being
    // detected, the check below is no longer checking anything.
    const before = [
      'export interface Props extends HybridViewProps {',
      '  outlineColor?: number',
      '  strokeColor?: number',
      '}',
    ].join('\n');
    const clashing = declaredProps(before).filter((name) => reserved.has(name));
    expect(clashing).toEqual(['outlineColor']);
  });

  const specDir = join(__dirname, '..', 'specs');
  const specs = readdirSync(specDir).filter((f) => f.endsWith('.nitro.ts'));

  it('still sees the clashes we accepted, so the list cannot go stale', () => {
    // If RN ever drops one of these, the entry should go too.
    for (const name of ACCEPTED) expect(reserved.has(name)).toBe(true);
  });

  it('no longer declares the Yoga name it used to', () => {
    const spec = readFileSync(join(__dirname, '..', 'specs', 'RollingNumber.nitro.ts'), 'utf8');
    expect(declaredProps(spec)).not.toContain('direction');
    expect(declaredProps(spec)).toContain('rollDirection');
  });

  it.each(specs)('%s declares nothing react-native also parses', (spec) => {
    const props = declaredProps(readFileSync(join(specDir, spec), 'utf8'));
    expect(props.length).toBeGreaterThan(0);
    const clashing = props.filter((name) => reserved.has(name) && !ACCEPTED.has(name));
    expect(clashing).toEqual([]);
  });
});
