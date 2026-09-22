/**
 * What `require('react-native-worklets')` reaches in the suites: a module that
 * fails to load, as a missing package would, so `worklets.ts` takes its
 * degraded path. `Worklets.test.tsx` replaces it with `jest.mock` and a fake.
 *
 * It is mapped here rather than mocked virtually because the real package is
 * hoisted into the monorepo's node_modules by the example. Jest caches a
 * module's id per requiring file and name, ignoring mock state, and the
 * resolver is shared by every suite a worker runs: a virtual mock registered
 * after another suite had resolved the real package got a different id, so the
 * fake was skipped and the suite failed on and off. This stub gives the name
 * one id everywhere.
 */
export {}

throw new Error('react-native-worklets is not installed in this test run')
