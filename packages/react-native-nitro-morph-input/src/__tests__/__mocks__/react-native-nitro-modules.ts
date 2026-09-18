// Minimal stand-in for react-native-nitro-modules in Jest: the host component
// becomes a plain string element so react-test-renderer can inspect its props.
export function getHostComponent(name: string) {
  return name
}
export function callback<T>(func: T) {
  return typeof func === 'function' ? { f: func } : func
}
export const NitroModules = {
  box: (obj: unknown) => ({ unbox: () => obj }),
}
