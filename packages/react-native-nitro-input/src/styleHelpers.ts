import { processColor, type ColorValue, type TextStyle } from 'react-native'

// Style resolution shared by `NitroNumber` and `NitroInput`.

const FONT_WEIGHTS: Record<string, number> = {
  normal: 400,
  regular: 400,
  bold: 700,
  ultralight: 100,
  thin: 200,
  light: 300,
  medium: 500,
  semibold: 600,
  condensedBold: 700,
  condensed: 400,
  heavy: 800,
  black: 900,
}

export function toNumericWeight(weight: TextStyle['fontWeight']): number | undefined {
  if (weight == null) return undefined
  if (typeof weight === 'number') return weight
  const parsed = Number(weight)
  if (!Number.isNaN(parsed)) return parsed
  return FONT_WEIGHTS[weight]
}

export function toProcessedColor(color: ColorValue | undefined): number | undefined {
  if (color == null) return undefined
  const processed = processColor(color)
  return typeof processed === 'number' ? processed : undefined
}
