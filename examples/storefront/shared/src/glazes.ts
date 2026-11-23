/**
 * The studio's glaze library (#909): 288 glazes in six families, each a name, a finish and a colour.
 * Made up, as the shop's pieces are, and made the same way each time from a seed, so the server's page
 * and the browser's agree.
 */

/** A family of glazes, with the colours its glazes come in: a hue range, and its saturation and lightness. */
export const FAMILIES = [
  { id: "celadon", name: "Celadon", hue: [140, 175], saturation: [22, 40], lightness: [55, 76] },
  { id: "tenmoku", name: "Tenmoku", hue: [14, 34], saturation: [30, 60], lightness: [12, 34] },
  { id: "shino", name: "Shino", hue: [20, 40], saturation: [28, 58], lightness: [70, 88] },
  { id: "ash", name: "Ash", hue: [30, 60], saturation: [5, 16], lightness: [44, 76] },
  { id: "copper", name: "Copper red", hue: [345, 370], saturation: [45, 70], lightness: [30, 52] },
  { id: "cobalt", name: "Cobalt", hue: [208, 232], saturation: [45, 72], lightness: [30, 62] },
] as const

export type FamilyId = (typeof FAMILIES)[number]["id"]

export type Finish = "gloss" | "satin" | "matte"

/** A glaze: its id, its name in its family, its finish, and its colour as a hue (0–360), saturation and lightness. */
export interface Glaze {
  readonly id: string
  readonly name: string
  readonly family: FamilyId
  readonly finish: Finish
  readonly hue: number
  readonly saturation: number
  readonly lightness: number
}

/** How many glazes each family has. */
const PER_FAMILY = 48

const FINISHES: ReadonlyArray<Finish> = ["gloss", "satin", "matte"]

/** A seeded random: the same numbers on every run, from 0 up to 1. */
const seeded = (seed: number): (() => number) => {
  let state = seed
  return () => {
    state = (state * 16807) % 2147483647
    return (state - 1) / 2147483646
  }
}

/** A number in `[from, to]` from a random `t`, rounded. */
const within = (range: readonly [number, number], t: number): number => Math.round(range[0] + (range[1] - range[0]) * t)

/** Every glaze, family by family, each family's from light to dark. */
export const GLAZES: ReadonlyArray<Glaze> = FAMILIES.flatMap((family, f) => {
  const random = seeded(7919 * (f + 1))
  return Array.from({ length: PER_FAMILY }, (_, n) => ({
    id: `${family.id}-${n + 1}`,
    name: `${family.name} ${n + 1}`,
    family: family.id,
    finish: FINISHES[n % FINISHES.length]!,
    hue: within(family.hue, random()) % 360,
    saturation: within(family.saturation, random()),
    lightness: within(family.lightness, random()),
  })).sort((a, b) => b.lightness - a.lightness)
}).map((glaze, i) => ({ ...glaze, id: `glaze-${i + 1}`, name: `${FAMILIES.find((family) => family.id === glaze.family)!.name} ${(i % PER_FAMILY) + 1}` }))

/** A glaze's colour, as CSS. */
export const colourOf = (glaze: Glaze): string => `hsl(${glaze.hue} ${glaze.saturation}% ${glaze.lightness}%)`

/** A family's name. */
export const familyName = (id: FamilyId): string => FAMILIES.find((family) => family.id === id)!.name
