/**
 * The Batch guide's demo (demo.tsx) draws Wardic's mark, `brand/wardic-mark.svg`, with the Shuffle
 * sample's 1,000 tiles, two ways. Each gives every tile, by its id, a place and a colour:
 *
 * - `MOSAIC`: the mark on the grid's own 7 px lattice, a tile to a cell, its dark disc and halos too.
 *   At `SCALE` px to the mark's unit it's 1,000 cells exactly.
 * - `LINES`: the ring, the W's four lines and the stars' outlines, with no disc. The tiles shrink to
 *   `LINE_SCALE` and turn along their stroke, spread by its area, so the ring's heavier bottom takes more.
 *
 * Both list their places in reading order, as the grid's are, so the sorted grid's rows pour into the
 * mark's. The geometry is the mark's, in the SVG's 128-unit box before its inset: the disc, and the
 * ring's centre line, at radius 56; the ring 1.2 units thick at the top and 4.6 at the bottom.
 */

export const TILE_COUNT = 1000
const COLUMNS = 40
const STEP = 7
const TILE = 6

/** A tile's values in the Batch, `x`, `y`, `scale`, `rotate` and `opacity`. */
export interface TileValues {
  readonly x: number
  readonly y: number
  readonly scale: number
  readonly rotate: number
  readonly opacity: number
}

/** A tile's place in a drawing of the mark, and its colour there. */
export interface Place {
  readonly values: TileValues
  readonly color: string
}

// Colours.

type Rgb = readonly [number, number, number]
const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const css = (c: Rgb): string => `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])})`

/** A linear gradient's colour at `t`, from its stops: each a position from 0 to 1, and a colour. */
const gradient = (stops: ReadonlyArray<readonly [number, string]>): ((t: number) => Rgb) => {
  const parsed = stops.map(([at, color]) => [at, hex(color)] as const)
  return (t) => {
    if (t <= parsed[0][0]) return parsed[0][1]
    for (let k = 1; k < parsed.length; k++) {
      const [t1, c1] = parsed[k]
      if (t <= t1) {
        const [t0, c0] = parsed[k - 1]
        return mix(c0, c1, (t - t0) / (t1 - t0))
      }
    }
    return parsed[parsed.length - 1][1]
  }
}

// The mark.

const C = 64
const RADIUS = 56
const DISC = hex("#242933")
/** The ring's weight at height `v`: 1.2 units at the top, 4.6 at the bottom. */
const ringWeight = (v: number): number => 1.2 + 3.4 * Math.min(1, Math.max(0, (v - (C - RADIUS)) / (2 * RADIUS)))
const ringGradient = gradient([
  [0, "#8fbcbb"],
  [0.38, "#88c0d0"],
  [0.68, "#81a1c1"],
  [1, "#b48ead"],
])
/** The ring's colour, its gradient running left to right across it. */
const ringColor = (u: number): Rgb => ringGradient((u - 8) / 112)

/** One of Cassiopeia's stars: its centre, its diamond's half-diagonal (|du| + |dv| ≤ half) and colour. */
interface Star {
  readonly u: number
  readonly v: number
  readonly half: number
  readonly color: string
}
// Segin, Ruchbah, Navi, Schedar and Caph, along the W.
export const STARS: ReadonlyArray<Star> = [
  { u: 13.61, v: 39.57, half: 4.32, color: "#8fbcbb" },
  { u: 43.79, v: 84.96, half: 6.31, color: "#88c0d0" },
  { u: 68.57, v: 59.38, half: 7.88, color: "#ebcb8b" },
  { u: 95.41, v: 110.36, half: 7.61, color: "#81a1c1" },
  { u: 114.39, v: 39.57, half: 7.53, color: "#b48ead" },
]
/** A star's outline's width. */
const STROKE = 2.6
/** How far past a star's fill the ring and lines stop short of it. */
const CLEARING = 3
const LINE_WIDTH = 1.75

/** A line of the W, from one star to the next, its gradient from the one's colour to the other's. */
interface Line {
  readonly from: Star
  readonly to: Star
  readonly color: (t: number) => Rgb
}
const W: ReadonlyArray<Line> = STARS.slice(1).map((to, k) => {
  const from = STARS[k]
  return {
    from,
    to,
    color: gradient([
      [0.15, from.color],
      [0.85, to.color],
    ]),
  }
})

/** The three faint stars inside the W. */
const FAINT: ReadonlyArray<readonly [number, number]> = [
  [72.71, 83.25],
  [38.01, 105.22],
  [53.08, 114.04],
]
const FAINT_COLOR = hex("#d8dee9")

/** The halos round Navi, Schedar and Caph, each its star's colour fading out to its radius. */
const HALOS = [
  { star: STARS[2], radius: 29.8 },
  { star: STARS[3], radius: 28.9 },
  { star: STARS[4], radius: 28.63 },
]
/** A halo's opacity at `t` of its radius: .42 at its centre, .16 at .45, 0 at its edge. */
const haloAlpha = (t: number): number => {
  if (t >= 1) return 0
  if (t <= 0.45) return 0.42 - 0.26 * (t / 0.45)
  return 0.16 * (1 - (t - 0.45) / 0.55)
}

const cleared = (u: number, v: number, stars: ReadonlyArray<Star>): boolean =>
  stars.some((star) => Math.abs(u - star.u) + Math.abs(v - star.v) <= star.half + CLEARING)

/** The point's distance from a line, and how far along the line its nearest point is. */
const fromLine = (u: number, v: number, line: Line): { readonly distance: number; readonly t: number } => {
  const du = line.to.u - line.from.u
  const dv = line.to.v - line.from.v
  const t = Math.min(1, Math.max(0, ((u - line.from.u) * du + (v - line.from.v) * dv) / (du * du + dv * dv)))
  return { distance: Math.hypot(u - (line.from.u + t * du), v - (line.from.v + t * dv)), t }
}

// The board.

/** Px to the mark's unit: the scale at which the mosaic is 1,000 cells (from 2.1631 to 2.1646). */
export const SCALE = 2.1638
export const BOARD = { width: 280, height: Math.ceil(2 * (58.5 * SCALE + 4)) }
const CX = BOARD.width / 2
const CY = BOARD.height / 2
const GRID_X = (BOARD.width - ((COLUMNS - 1) * STEP + TILE)) / 2
const GRID_Y = (BOARD.height - ((Math.ceil(TILE_COUNT / COLUMNS) - 1) * STEP + TILE)) / 2

/** The `i`th place in the grid, centred on the board. */
export const gridAt = (i: number): { x: number; y: number } => ({ x: GRID_X + (i % COLUMNS) * STEP, y: GRID_Y + Math.floor(i / COLUMNS) * STEP })

/** A point of the mark on the board: a tile's top-left corner, centred on it. */
const atX = (u: number): number => CX + (u - C) * SCALE - TILE / 2
const atY = (v: number): number => CY + (v - C) * SCALE - TILE / 2

/** The smallest turn, in degrees, that lines a square up with a stroke at `radians`: it looks the same every 90°. */
const squareTo = (radians: number): number => {
  const degrees = ((((radians * 180) / Math.PI) % 90) + 90) % 90
  return degrees > 45 ? degrees - 90 : degrees
}

/** Whether a point is in the mark, the disc or its ring, at a lattice cell's half-width `halfCell`. */
const inMark = (u: number, v: number, halfCell: number): boolean => {
  const r = Math.hypot(u - C, v - C)
  return r <= RADIUS || Math.abs(r - RADIUS) <= Math.max(ringWeight(v) / 2, halfCell)
}

// The mosaic.

const mosaic = (): ReadonlyArray<Place> => {
  const unit = STEP / SCALE
  const halfCell = unit / 2
  // The stars and faint stars snap to their nearest cells, so each draws as a whole diamond.
  const snap = (w: number): number => C + Math.round((w - C) / unit) * unit
  const stars = STARS.map((star) => ({ ...star, u: snap(star.u), v: snap(star.v) }))
  const faint = FAINT.map(([u, v]) => [snap(u), snap(v)] as const)
  // A cell's colour, topmost first: a star's outline or its dark middle, a line, the ring, the disc.
  const colorAt = (u: number, v: number): Rgb => {
    for (const star of stars) {
      const d = Math.abs(u - star.u) + Math.abs(v - star.v)
      const outer = star.half + STROKE / 2
      if (d <= outer) {
        if (d > Math.min(star.half - STROKE / 2, outer - unit)) return hex(star.color)
        return DISC
      }
    }
    if (!cleared(u, v, stars)) {
      for (const line of W) {
        const { distance, t } = fromLine(u, v, line)
        if (distance <= Math.max(LINE_WIDTH / 2, halfCell)) return line.color(t)
      }
      if (Math.abs(Math.hypot(u - C, v - C) - RADIUS) <= Math.max(ringWeight(v) / 2, halfCell)) return ringColor(u)
    }
    let color = DISC
    for (const halo of HALOS) color = mix(color, hex(halo.star.color), haloAlpha(Math.hypot(u - halo.star.u, v - halo.star.v) / halo.radius))
    for (const [fu, fv] of faint) if (Math.abs(u - fu) <= halfCell && Math.abs(v - fv) <= halfCell) color = mix(color, FAINT_COLOR, 0.7)
    return color
  }
  const reach = Math.ceil((60 * SCALE) / STEP)
  const places: Array<Place> = []
  for (let j = -reach; j <= reach; j++) {
    for (let i = -reach; i <= reach; i++) {
      const u = C + i * unit
      const v = C + j * unit
      if (inMark(u, v, halfCell)) {
        places.push({ values: { x: CX + i * STEP - TILE / 2, y: CY + j * STEP - TILE / 2, scale: 1, rotate: 0, opacity: 1 }, color: css(colorAt(u, v)) })
      }
    }
  }
  // Were the mark short of 1,000 cells, the tiles left over would hide at its centre.
  while (places.length < TILE_COUNT) places.push({ values: { x: CX - TILE / 2, y: CY - TILE / 2, scale: 0, rotate: 0, opacity: 0 }, color: css(DISC) })
  return places
}

// The lines.

/** The tiles' size in `LINES`, as a scale of the grid's 6 px. */
export const LINE_SCALE = 0.6

/** A point along one of the mark's strokes: its direction, its stroke's width there, its colour. */
interface Sample {
  readonly u: number
  readonly v: number
  readonly angle: number
  readonly width: number
  readonly color: Rgb
}

const lines = (): ReadonlyArray<Place> => {
  const step = 0.2
  const samples: Array<Sample> = []
  // The ring, less its clearings, from the bottom, where its weight hides the seam.
  const around = Math.ceil((2 * Math.PI * RADIUS) / step)
  for (let k = 0; k < around; k++) {
    const angle = (k / around) * 2 * Math.PI + Math.PI / 2
    const u = C + RADIUS * Math.cos(angle)
    const v = C + RADIUS * Math.sin(angle)
    if (!cleared(u, v, STARS)) samples.push({ u, v, angle: angle + Math.PI / 2, width: ringWeight(v), color: ringColor(u) })
  }
  // The W's lines, less their clearings.
  for (const line of W) {
    const length = Math.hypot(line.to.u - line.from.u, line.to.v - line.from.v)
    const angle = Math.atan2(line.to.v - line.from.v, line.to.u - line.from.u)
    for (let k = 0; k <= length / step; k++) {
      const t = (k * step) / length
      const u = line.from.u + t * (line.to.u - line.from.u)
      const v = line.from.v + t * (line.to.v - line.from.v)
      if (!cleared(u, v, STARS)) samples.push({ u, v, angle, width: LINE_WIDTH, color: line.color(t) })
    }
  }
  // Each star's outline, its diamond's four sides.
  for (const star of STARS) {
    const corners = [
      [star.u, star.v - star.half],
      [star.u + star.half, star.v],
      [star.u, star.v + star.half],
      [star.u - star.half, star.v],
    ] as const
    corners.forEach(([u0, v0], side) => {
      const [u1, v1] = corners[(side + 1) % 4]
      const length = Math.hypot(u1 - u0, v1 - v0)
      for (let k = 0; k < length / step; k++) {
        const t = (k * step) / length
        samples.push({ u: u0 + t * (u1 - u0), v: v0 + t * (v1 - v0), angle: Math.atan2(v1 - v0, u1 - u0), width: STROKE, color: hex(star.color) })
      }
    })
  }
  // A tile every `spacing` of the strokes' area, each set across its stroke by the golden ratio.
  const count = TILE_COUNT - FAINT.length
  const spacing = samples.reduce((area, sample) => area + sample.width * step, 0) / count
  const tile = (TILE * LINE_SCALE) / SCALE
  const places: Array<Place> = []
  let area = 0
  let next = spacing / 2
  for (const sample of samples) {
    area += sample.width * step
    while (area >= next && places.length < count) {
      const across = ((places.length * 0.6180339887) % 1 - 0.5) * Math.max(sample.width - tile, 0)
      const u = sample.u - Math.sin(sample.angle) * across
      const v = sample.v + Math.cos(sample.angle) * across
      places.push({ values: { x: atX(u), y: atY(v), scale: LINE_SCALE, rotate: squareTo(sample.angle), opacity: 1 }, color: css(sample.color) })
      next += spacing
    }
  }
  while (places.length < count) places.push(places[places.length - 1])
  for (const [u, v] of FAINT) places.push({ values: { x: atX(u), y: atY(v), scale: 0.5, rotate: 45, opacity: 0.7 }, color: css(FAINT_COLOR) })
  return places.sort((a, b) => a.values.y - b.values.y || a.values.x - b.values.x)
}

export const MOSAIC = mosaic()
export const LINES = lines()
