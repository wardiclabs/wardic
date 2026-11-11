// The Batch guide's grid demo draws Wardic's mark with the Shuffle sample's 1,000 tiles
// (samples/batch/logo.ts): as a mosaic, a tile to each cell of the grid's lattice, or in lines, the
// tiles shrunk along its strokes. Each drawing has a place for every tile, on the board.
import { describe, expect, it } from "vitest"
import { BOARD, LINE_SCALE, LINES, MOSAIC, type Place, STARS, TILE_COUNT } from "../samples/batch/logo.ts"

/** Whether a 6 px tile at `place`, at its scale about its centre, is wholly on the board. */
const onBoard = ({ values: { x, y, scale } }: Place): boolean => {
  const inset = (6 * (1 - scale)) / 2
  return x + inset >= 0 && y + inset >= 0 && x + 6 - inset <= BOARD.width && y + 6 - inset <= BOARD.height
}

/** Whether every star's colour is among the places' colours. */
const hasEveryStar = (places: ReadonlyArray<Place>): boolean => {
  const rgb = (hex: string): string => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(" ")})`
  const colors = new Set(places.map((place) => place.color))
  return STARS.every((star) => colors.has(rgb(star.color)))
}

describe("the grid demo's drawings of Wardic's mark", () => {
  it("LG1: the mosaic is 1,000 cells exactly, none hidden, each its own cell of the 7 px lattice", () => {
    expect(MOSAIC).toHaveLength(TILE_COUNT)
    expect(MOSAIC.every((place) => place.values.scale === 1 && place.values.opacity === 1)).toBe(true)
    // Every cell is 7 px from its neighbours, and none holds two tiles.
    const x0 = MOSAIC[0].values.x
    const y0 = MOSAIC[0].values.y
    expect(MOSAIC.every(({ values: { x, y } }) => Number.isInteger((x - x0) / 7) && Number.isInteger((y - y0) / 7))).toBe(true)
    expect(new Set(MOSAIC.map(({ values: { x, y } }) => `${x},${y}`)).size).toBe(TILE_COUNT)
  })

  it("LG2: the lines place every tile, shrunk, but for the three faint stars", () => {
    expect(LINES).toHaveLength(TILE_COUNT)
    expect(LINES.filter((place) => place.values.scale === LINE_SCALE)).toHaveLength(TILE_COUNT - 3)
    expect(LINES.every((place) => Math.abs(place.values.rotate) <= 45)).toBe(true)
  })

  it("LG3: both drawings are on the board, in reading order", () => {
    for (const places of [MOSAIC, LINES]) {
      expect(places.every(onBoard)).toBe(true)
      expect(places.every((place, i) => i === 0 || place.values.y >= places[i - 1].values.y)).toBe(true)
    }
  })

  it("LG4: both draw all five stars, each in its colour", () => {
    expect(hasEveryStar(MOSAIC)).toBe(true)
    expect(hasEveryStar(LINES)).toBe(true)
  })
})
