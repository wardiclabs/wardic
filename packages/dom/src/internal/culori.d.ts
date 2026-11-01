/**
 * Minimal ambient types for the subset of `culori` the color interpolator uses: `culori/fn` (#511),
 * which registers no colour space by itself, and the `culori` bundle the tests compare against.
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

declare module "culori/fn" {
  export type Color = Record<string, number | string | undefined>

  /** A colour space's definition, as `useMode` takes it. */
  export interface Mode {
    readonly mode: string
  }

  export function interpolate(
    colors: ReadonlyArray<string | Color>,
    mode?: string,
    overrides?: unknown,
  ): (t: number) => Color

  export function formatRgb(color: Color | string): string
  export function parse(color: string): Color | undefined
  export function converter(mode: string): (color: Color) => Color
  /** A registered colour space's definition, or `undefined` for one not registered. */
  export function getMode(mode: string): Mode | undefined
  /** Register a colour space (its parsers, its conversions): a converter to it. */
  export function useMode(mode: Mode): (color: Color) => Color

  export const modeA98: Mode
  export const modeHsl: Mode
  export const modeHwb: Mode
  export const modeLab: Mode
  export const modeLch: Mode
  export const modeLrgb: Mode
  export const modeOklab: Mode
  export const modeOklch: Mode
  export const modeP3: Mode
  export const modeProphoto: Mode
  export const modeRec2020: Mode
  export const modeRgb: Mode
  export const modeXyz50: Mode
  export const modeXyz65: Mode
}
