/**
 * The studio's year, glaze by glaze (#915): how many pieces sold in each, their average price, and how
 * many came back. Made up, as the shop's pieces are, and the same on every run from a seed.
 */
import { type Glaze, GLAZES } from "./glazes.ts"

/** What the chart can show up its side. */
export const MEASURES = [
  { id: "sold", name: "Pieces sold", unit: "" },
  { id: "price", name: "Average price", unit: "$" },
  { id: "returns", name: "Returned", unit: "" },
] as const

export type MeasureId = (typeof MEASURES)[number]["id"]

/** A glaze's year: its measures. */
export interface GlazeYear {
  readonly glaze: Glaze
  readonly sold: number
  readonly price: number
  readonly returns: number
}

/** A seeded random: the same numbers on every run, from 0 up to 1. */
const seeded = (seed: number): (() => number) => {
  let state = seed
  return () => {
    state = (state * 16807) % 2147483647
    return (state - 1) / 2147483646
  }
}

const random = seeded(69621)

/** Each glaze's year: the paler glazes sell a little more, a gloss costs a little more, a matte comes back a little less. */
export const YEAR: ReadonlyArray<GlazeYear> = GLAZES.map((glaze) => {
  const sold = Math.round(6 + random() * 50 + glaze.lightness * 0.4)
  const price = Math.round(28 + random() * 90 + (glaze.finish === "gloss" ? 14 : 0))
  const returns = Math.round(random() * random() * 9 + (glaze.finish === "matte" ? 0 : 1))
  return { glaze, sold, price, returns }
})

/** The highest of a measure over the year: the top of its axis. */
export const highest = (measure: MeasureId): number => Math.max(...YEAR.map((one) => one[measure]))
