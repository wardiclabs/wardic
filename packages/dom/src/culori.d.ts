/**
 * Minimal ambient types for the subset of `culori` the color interpolator uses.
 * `culori` v4 ships no TypeScript types and `@types/culori` lags its API, so we
 * declare exactly what we touch here. Widen this if we start using more of culori.
 */
declare module "culori" {
  export type Color = Record<string, number | string | undefined>

  export function interpolate(
    colors: ReadonlyArray<string | Color>,
    mode?: string,
    overrides?: unknown,
  ): (t: number) => Color

  export function formatRgb(color: Color | string): string
  export function formatHex(color: Color | string): string
  export function parse(color: string): Color | undefined
  export function converter(mode: string): (color: Color) => Color
}
