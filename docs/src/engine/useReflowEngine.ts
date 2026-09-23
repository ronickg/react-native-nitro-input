import {useEffect, useState} from 'react';
import type {AmountFormatter, Glyph, MainModule, ReflowEngine} from './reflow-engine';

/**
 * The shared C++ `ReflowEngine` and `AmountFormatter`
 * (packages/react-native-nitro-input/cpp), compiled to WebAssembly with
 * Emscripten (see docs/wasm/reflow-bindings.cpp). The live input demo runs the
 * same matching, curves and formatting that the native views do.
 */
let modulePromise: Promise<MainModule> | null = null;

export function loadReflowModule(): Promise<MainModule> {
  if (modulePromise === null) {
    modulePromise = import('./reflow-engine.js').then((factory) => factory.default());
  }
  return modulePromise;
}

/** Resolves to the WebAssembly module on the client; `null` during SSR and while loading. */
export function useReflowModule(): MainModule | null {
  const [module, setModule] = useState<MainModule | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadReflowModule().then((m) => {
      if (!cancelled) setModule(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return module;
}

export type {AmountFormatter, Glyph, MainModule, ReflowEngine};
