// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
interface WasmModule {
}

export interface ClassHandle {
  isAliasOf(other: ClassHandle): boolean;
  delete(): void;
  deleteLater(): this;
  isDeleted(): boolean;
  // @ts-ignore - If targeting lower than ESNext, this symbol might not exist.
  [Symbol.dispose](): void;
  clone(): this;
}
export type Wheel = {
  position: number,
  width: number,
  linear: boolean,
  blankZero: boolean,
  fromGlyph: number,
  toGlyph: number,
  blend: number,
  fromAbove: boolean
};

export interface RollingEngine extends ClassHandle {
  setFormat(_0: number, _1: number): void;
  setTiming(_0: number, _1: number, _2: number, _3: number, _4: number): void;
  setTransition(_0: number): void;
  setReduceMotion(_0: boolean): void;
  setValue(_0: number): void;
  animateTo(_0: number, _1: number): void;
  setLoading(_0: boolean, _1: number): void;
  tick(_0: number): boolean;
  reset(): void;
  setRevealTiming(_0: number, _1: number, _2: number, _3: number): void;
  setRevealGrow(_0: number): void;
  holdReveal(_0: number): void;
  reveal(_0: number, _1: number): void;
  isRevealing(): boolean;
  revealScale(): number;
  revealTotalSeconds(): number;
  clearRevealMilestones(): void;
  addRevealMilestone(_0: number): void;
  setRevealMilestoneHold(_0: number): void;
  revealMilestonesReached(): number;
  revealMilestoneValue(_0: number): number;
  wheelCount(): number;
  wheelAt(_0: number): Wheel;
  signFactor(): number;
  loadingProgress(): number;
  loading(): boolean;
  shimmerPhase(_0: number, _1: number): number;
  needsFrames(): boolean;
  isRolling(): boolean;
  targetValue(): number;
  hasShownValue(): boolean;
  settledPowerCount(): number;
  settledNegative(): boolean;
  targetDigit(_0: number): number;
  fractionDigits(): number;
  minimumIntegerDigits(): number;
}

interface EmbindModule {
  RollingEngine: {
    new(): RollingEngine;
  };
}

export type MainModule = WasmModule & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
