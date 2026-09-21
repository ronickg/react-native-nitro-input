/**
 * A tripwire for the Android view-props patch.
 *
 * On Android a Hybrid View only ever receives React Native's base `ViewProps`
 * - `backgroundColor`, every `border*`, `transform`, `opacity`, the
 * accessibility props - through `Props::rawProps`, a `folly::dynamic` that
 * gets serialized to Java and handed to `ViewManager.updateProperties`
 * (`SurfaceMountingManager.updateProps`).
 *
 * The only thing that ever writes that map is `initializeDynamicProps`, which
 * React Native calls at the end of `ConcreteComponentDescriptor::cloneProps`.
 * `react-native-nitro-modules` overrides `cloneProps` to use its own cached
 * copy constructor and, as shipped in 0.37.1, does not make that call - so the
 * map stays empty and every style prop silently disappears on Android while
 * working fine on iOS.
 *
 * `patches/react-native-nitro-modules@0.37.1.patch` adds it back. This test
 * fails if the patch stops being applied (a version bump, a fresh install
 * without patches), and separately if React Native moves the call somewhere
 * else - in which case the patch needs rewriting rather than reapplying.
 *
 * The symptom has no error message attached to it, which is exactly why it
 * needs a test: React Native never sees the prop, so it never warns.
 */
import { readFileSync } from 'fs'
import { dirname, join } from 'path'

function read(entry: string, ...rest: string[]): string {
  return readFileSync(join(dirname(require.resolve(entry)), ...rest), 'utf8')
}

describe('android view props', () => {
  it('nitro fills Props::rawProps when it overrides cloneProps', () => {
    const source = read('react-native-nitro-modules/package.json', 'cpp/views/ViewComponentDescriptor.hpp')

    // Guard on the guard: if the override is gone, nitro is using React
    // Native's own cloneProps again and this test has nothing to check.
    expect(source).toContain('cloneProps')

    const clone = source.slice(source.indexOf('cloneProps'))
    expect(clone).toContain('initializeDynamicProps')
  })

  it('react-native still fills it the same way', () => {
    // If this changes, the patch above is aimed at the wrong thing.
    const source = read(
      'react-native/package.json',
      'ReactCommon/react/renderer/core/ConcreteComponentDescriptor.h'
    )
    expect(source).toContain('initializeDynamicProps')
    expect(source).toContain('RN_SERIALIZABLE_STATE')
  })

  it('the props map is still what Android hands to the ViewManager', () => {
    // The other half of the chain: an empty `rawProps` only matters because
    // this is where it lands.
    const source = read(
      'react-native/package.json',
      'ReactAndroid/src/main/java/com/facebook/react/fabric/mounting/SurfaceMountingManager.kt'
    )
    expect(source).toContain('ReactStylesDiffMap')
    expect(source).toMatch(/updateProperties\(view, viewState\.currentProps\)/)
  })
})
