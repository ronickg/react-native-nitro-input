import {useEffect, useState} from 'react';
import type {AmountFormatter, Glyph, MainModule, MorphEngine} from './morph-engine';

/**
 * The shared C++ `MorphEngine` and `AmountFormatter`
 * (packages/react-native-nitro-morph-input/cpp), compiled to WebAssembly with
 * Emscripten (see docs/wasm/morph-bindings.cpp). The live input demo runs the
 * same matching, curves and formatting that the native views do.
 */
let modulePromise: Promise<MainModule> | null = null;

export function loadMorphModule(): Promise<MainModule> {
  if (modulePromise === null) {
    modulePromise = import('./morph-engine.js').then((factory) => factory.default());
  }
  return modulePromise;
}

/** Resolves to the WebAssembly module on the client; `null` during SSR and while loading. */
export function useMorphModule(): MainModule | null {
  const [module, setModule] = useState<MainModule | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadMorphModule().then((m) => {
      if (!cancelled) setModule(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return module;
}

export type {AmountFormatter, Glyph, MainModule, MorphEngine};
