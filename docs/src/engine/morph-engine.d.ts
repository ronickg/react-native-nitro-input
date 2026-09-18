// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
interface WasmModule {
}

type EmbindString = ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string;
export interface ClassHandle {
  isAliasOf(other: ClassHandle): boolean;
  delete(): void;
  deleteLater(): this;
  isDeleted(): boolean;
  // @ts-ignore - If targeting lower than ESNext, this symbol might not exist.
  [Symbol.dispose](): void;
  clone(): this;
}
export type Glyph = {
  id: number,
  character: number,
  role: number,
  kind: number,
  width: number,
  placeholder: boolean,
  x: number,
  y: number,
  opacity: number,
  scale: number,
  exiting: boolean
};

export interface MorphEngine extends ClassHandle {
  setTiming(_0: number, _1: number, _2: number): void;
  setEffect(_0: number): void;
  setReduceMotion(_0: boolean): void;
  beginText(): void;
  addGlyph(_0: number, _1: number, _2: number, _3: number, _4: boolean): void;
  commitText(_0: number, _1: number): void;
  tick(_0: number): boolean;
  needsFrames(): boolean;
  isAnimating(): boolean;
  glyphCount(): number;
  glyphAt(_0: number): Glyph;
  contentWidth(): number;
  targetWidth(): number;
  bodyCount(): number;
  caretX(_0: number): number;
  hasText(): boolean;
  reset(): void;
}

export type Edit = {
  text: EmbindString,
  caret: number,
  accepted: boolean
};

export interface AmountFormatter extends ClassHandle {
  setFormat(_0: number, _1: number, _2: EmbindString, _3: EmbindString): void;
  applyEdit(_0: EmbindString, _1: number, _2: number, _3: EmbindString): Edit;
  normalize(_0: EmbindString): Edit;
  format(_0: number): string;
  value(_0: EmbindString): number;
  kindOf(_0: number): number;
}

interface EmbindModule {
  MorphEngine: {
    new(): MorphEngine;
  };
  AmountFormatter: {
    new(): AmountFormatter;
    codePointCount(_0: EmbindString): number;
  };
}

export type MainModule = WasmModule & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
