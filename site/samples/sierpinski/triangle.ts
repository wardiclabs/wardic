/**
 * The Sierpiński sample's triangle: 3^7 = 2,187 leaves, each placed for a depth from 0 to 7. A leaf's
 * number in base 3, seven digits long, is its address: at each level, a 0 takes the triangle's top half,
 * a 1 its bottom-left and a 2 its bottom-right. At depth `d` a leaf sits on its ancestor `d` levels down,
 * so the leaves sharing one cover it as one triangle, and at 7 each is its own.
 */
export const WIDTH = 288
export const HEIGHT = 249
export const DEPTH = 7
export const LEAVES = 3 ** DEPTH

/** Each half's top-left corner in its triangle, as a share of the triangle's width and height. */
const HALVES = [
  { x: 1 / 4, y: 0 },
  { x: 0, y: 1 / 2 },
  { x: 1 / 2, y: 1 / 2 },
]

/** Leaf `i` at `depth`: the top-left corner of its ancestor there, in px, and its scale. */
export const leafAt = (i: number, depth: number): { x: number; y: number; scale: number } => {
  let x = 0
  let y = 0
  let scale = 1
  let leavesUnder = LEAVES
  for (let level = 0; level < depth; level++) {
    leavesUnder /= 3
    const half = HALVES[Math.floor(i / leavesUnder) % 3]
    x += half.x * scale * WIDTH
    y += half.y * scale * HEIGHT
    scale /= 2
  }
  return { x, y, scale }
}

/** Leaf `i`'s colour, its hue by its address. */
export const colorOf = (i: number): string => `hsl(${190 + (i / LEAVES) * 150} 60% 62%)`
