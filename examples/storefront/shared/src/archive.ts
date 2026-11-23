/**
 * The studio's archive (#914): 600 pieces from forty-odd years of firings, each a form in one of the
 * glaze library's glazes, with its year. Made up, as the shop's pieces are, and the same on every run
 * from a seed, so the server's page and the browser's agree.
 */
import { familyName, type Glaze, GLAZES } from "./glazes.ts"

/** The forms the studio throws. */
const FORMS = ["bowl", "tea bowl", "cup", "beaker", "jug", "vase", "bottle", "jar", "plate", "dish", "teapot", "planter"] as const

/** A piece in the archive: its form, its glaze, the year it was fired, and its name and number. */
export interface ArchivePiece {
  readonly id: string
  readonly name: string
  readonly form: (typeof FORMS)[number]
  readonly glaze: Glaze
  readonly year: number
  /** What a search reads of it, in lower case: its name, form, glaze, family, finish and year. */
  readonly words: string
}

/** A seeded random: the same numbers on every run, from 0 up to 1. */
const seeded = (seed: number): (() => number) => {
  let state = seed
  return () => {
    state = (state * 16807) % 2147483647
    return (state - 1) / 2147483646
  }
}

const random = seeded(48271)

/** Every piece in the archive, oldest first. */
export const ARCHIVE: ReadonlyArray<ArchivePiece> = Array.from({ length: 600 }, () => {
  const glaze = GLAZES[Math.floor(random() * GLAZES.length)]!
  const form = FORMS[Math.floor(random() * FORMS.length)]!
  const year = 1984 + Math.floor(random() * 43)
  return { glaze, form, year }
})
  .sort((a, b) => a.year - b.year)
  .map(({ glaze, form, year }, i) => {
    const name = `${familyName(glaze.family)} ${form}`
    return { id: `piece-${i + 1}`, name, form, glaze, year, words: `${name} ${glaze.name} ${glaze.finish} ${year}`.toLowerCase() }
  })

/** The pieces whose words have every word of `query` in them; every piece for an empty query. */
export const search = (query: string): ReadonlyArray<ArchivePiece> => {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term !== "")
  return ARCHIVE.filter((piece) => terms.every((term) => piece.words.includes(term)))
}
