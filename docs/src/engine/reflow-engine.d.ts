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

export interface ReflowEngine extends ClassHandle {
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

export type Segment = {
  verb: number,
  x: number,
  y: number,
  radius: number,
  startAngle: number,
  sweepAngle: number
};

export interface SegmentList extends ClassHandle, Iterable<Segment> {
  push_back(_0: Segment): void;
  resize(_0: number, _1: Segment): void;
  size(): number;
  get(_0: number): Segment | undefined;
  set(_0: number, _1: Segment): boolean;
}

export type Rect = {
  x: number,
  y: number,
  width: number,
  height: number
};

interface EmbindModule {
  ReflowEngine: {
    new(): ReflowEngine;
  };
  AmountFormatter: {
    new(): AmountFormatter;
    codePointCount(_0: EmbindString): number;
  };
  SegmentList: {
    new(): SegmentList;
  };
  outlinePath(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number): SegmentList;
  lerpRect(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number): Rect;
}

export type MainModule = WasmModule & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
