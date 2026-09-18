import {useEffect, useState} from 'react';
import type {MainModule, RollingEngine} from './rolling-engine';

/**
 * The shared C++ `RollingEngine` (cpp/RollingEngine.hpp), compiled to
 * WebAssembly with Emscripten (see docs/wasm/bindings.cpp). Every live demo on
 * this site runs the same code that drives the native views on iOS and
 * Android, so the curves, the stagger, the odometer carry and the reveal are
 * exactly what you get in the app.
 */
let modulePromise: Promise<MainModule> | null = null;

export function loadEngineModule(): Promise<MainModule> {
  if (modulePromise === null) {
    modulePromise = import('./rolling-engine.js').then((factory) =>
      factory.default(),
    );
  }
  return modulePromise;
}

/** Resolves to the WebAssembly module on the client; `null` during SSR and while loading. */
export function useEngineModule(): MainModule | null {
  const [module, setModule] = useState<MainModule | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadEngineModule().then((m) => {
      if (!cancelled) setModule(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return module;
}

export type {RollingEngine, MainModule};
