import * as Box from "@wardic/core/Box"
import * as Projection from "@wardic/core/Projection"
import { expect, it } from "@effect/vitest"

/** Build a Box from its edges (left/top/right/bottom). */
const box = (left: number, top: number, right: number, bottom: number): Box.Box => ({
  x: { min: left, max: right },
  y: { min: top, max: bottom },
})

// --- box.ts: representation + conversion ------------------------------------

it("boundsToBox / boxToBounds round-trip and calcLength", () => {
  const bounds = { x: 10, y: 20, left: 10, top: 20, right: 110, bottom: 70, width: 100, height: 50 }
  const b = Box.fromBounds(bounds)
  expect(b).toEqual({ x: { min: 10, max: 110 }, y: { min: 20, max: 70 } })
  expect(Box.length(b.x)).toBe(100)
  expect(Box.length(b.y)).toBe(50)
  expect(Box.toBounds(b)).toEqual(bounds)
})

// --- calcAxisDelta ----------------------------------------------------------

it("calcAxisDelta: a pure translation (equal lengths) -> scale 1, origin-independent translate", () => {
  // Same length, shifted +50. originPoint = mix(0,100,0.5) = 50; translate = mix(50,150,0.5) - 50 = 50.
  expect(Projection.calcAxisDelta({ min: 0, max: 100 }, { min: 50, max: 150 }, 0.5)).toEqual({
    translate: 50,
    scale: 1,
    origin: 0.5,
    originPoint: 50,
  })
  // Translation is origin-independent: same translate at origin 0 (originPoint 0).
  expect(Projection.calcAxisDelta({ min: 0, max: 100 }, { min: 50, max: 150 }, 0)).toEqual({
    translate: 50,
    scale: 1,
    origin: 0,
    originPoint: 0,
  })
})

it("calcAxisDelta: a centre-aligned scale -> scale ratio, zero translate", () => {
  // source centre 50; target {-50,150} also centre 50, length 200. scale 2, translate 0.
  expect(Projection.calcAxisDelta({ min: 0, max: 100 }, { min: -50, max: 150 }, 0.5)).toEqual({
    translate: 0,
    scale: 2,
    origin: 0.5,
    originPoint: 50,
  })
})

it("calcAxisDelta: snaps near-1 scale and near-0 translate to exactly 1 / 0", () => {
  // scale 1.0000005 (within SCALE_PRECISION 1e-4) -> 1; translate 0.005 (within TRANSLATE_PRECISION 1e-2) -> 0.
  const d = Projection.calcAxisDelta({ min: 0, max: 100 }, { min: 0.005, max: 100.00505 }, 0)
  expect(d.scale).toBe(1)
  expect(d.translate).toBe(0)
})

it("calcAxisDelta: zero-length source guards scale to 1 (no Infinity/NaN)", () => {
  const d = Projection.calcAxisDelta({ min: 50, max: 50 }, { min: 0, max: 100 }, 0.5)
  expect(d.scale).toBe(1)
  expect(Number.isFinite(d.translate)).toBe(true)
})

// --- calcBoxDelta + applyBoxDelta round-trip --------------------------------

it("applyBoxDelta(source, calcBoxDelta(source, target)) reproduces target", () => {
  const source = box(0, 0, 100, 100)
  const target = box(50, 20, 250, 120)
  expect(Projection.applyBoxDelta(source, Projection.calcBoxDelta(source, target))).toEqual(target)
})

// --- calcRelativeBox --------------------------------------------------------

it("calcRelativeBox: child relative to parent at top-left vs centre anchors", () => {
  const child = box(120, 40, 180, 80)
  const parent = box(100, 20, 300, 120)
  // anchor {0,0}: subtract parent top-left (100,20).
  expect(Projection.calcRelativeBox(child, parent, { x: 0, y: 0 })).toEqual(box(20, 20, 80, 60))
  // anchor {0.5,0.5}: subtract parent centre (200,70).
  expect(Projection.calcRelativeBox(child, parent, { x: 0.5, y: 0.5 })).toEqual(box(-80, -30, -20, 10))
  // default anchor is top-left.
  expect(Projection.calcRelativeBox(child, parent)).toEqual(Projection.calcRelativeBox(child, parent, { x: 0, y: 0 }))
})

it("placeRelativeBox: inverse of calcRelativeBox (round-trip) and tracks a moved parent", () => {
  const child = box(120, 40, 180, 80)
  const parent = box(100, 20, 300, 120)
  const rel = Projection.calcRelativeBox(child, parent) // child's offset within parent (top-left anchor)
  // round-trip into the SAME parent reproduces the child.
  expect(Projection.placeRelativeBox(rel, parent)).toEqual(child)
  // placed into a MOVED parent (shifted +50,+10), the child tracks by the same offset.
  const movedParent = box(150, 30, 350, 130)
  expect(Projection.placeRelativeBox(rel, movedParent)).toEqual(box(170, 50, 230, 90))
})

// --- Box.mix -----------------------------------------------------------------

it("Box.mix: progress 0 = from, 1 = to, 0.5 = per-edge midpoint", () => {
  const from = box(0, 0, 100, 100)
  const to = box(100, 50, 300, 150)
  expect(Box.mix(from, to, 0)).toEqual(from)
  expect(Box.mix(from, to, 1)).toEqual(to)
  expect(Box.mix(from, to, 0.5)).toEqual(box(50, 25, 200, 125))
})

// --- applyTreeDeltas --------------------------------------------------------

/** An AxisDelta literal (origin/originPoint default to a 0 pivot for clear math). */
const axisDelta = (translate: number, scale: number, originPoint = 0): Projection.AxisDelta => ({
  translate,
  scale,
  origin: 0.5,
  originPoint,
})
const delta = (tx: number, ty: number, sx: number, sy: number): Projection.Delta => ({
  x: axisDelta(tx, sx),
  y: axisDelta(ty, sy),
})

it("applyTreeDeltas: no ancestors -> box unchanged, treeScale identity", () => {
  const b = box(10, 20, 110, 70)
  expect(Projection.applyTreeDeltas(b, [])).toEqual({ box: b, treeScale: { x: 1, y: 1 } })
})

it("applyTreeDeltas: one scaling ancestor scales the box about its origin + accumulates treeScale", () => {
  // scale 2 about originPoint 0 (translate 0): each edge doubles.
  expect(Projection.applyTreeDeltas(box(10, 20, 110, 70), [delta(0, 0, 2, 2)])).toEqual({
    box: box(20, 40, 220, 140),
    treeScale: { x: 2, y: 2 },
  })
})

it("applyTreeDeltas: composes ancestors ROOT-FIRST and multiplies treeScale", () => {
  // root scales 2x (about 0), then parent translates +5. box(0,0,100,100):
  // after root -> {0,200}; after parent -> {5,205}. treeScale = 2*1 = 2.
  expect(Projection.applyTreeDeltas(box(0, 0, 100, 100), [delta(0, 0, 2, 2), delta(5, 5, 1, 1)])).toEqual({
    box: box(5, 5, 205, 205),
    treeScale: { x: 2, y: 2 },
  })
})

it("applyTreeDeltas: snaps float noise in treeScale to exactly 1, inside Motion's TREE_SCALE_SNAP range (#9)", () => {
  const r = Projection.applyTreeDeltas(box(0, 0, 100, 100), [delta(0, 0, 1 + 5e-14, 1 - 5e-14)])
  expect(r.treeScale).toEqual({ x: 1, y: 1 })
})

it("applyTreeDeltas: keeps ancestors' scales that nearly cancel, as Motion does (#9)", () => {
  // 1.5 then 0.6667: their product, 1.00005, is a real scale, not noise (it snapped before #9).
  const r = Projection.applyTreeDeltas(box(0, 0, 100, 100), [delta(0, 0, 1.5, 1.5), delta(0, 0, 0.6667, 0.6667)])
  expect(r.treeScale.x).toBeCloseTo(1.00005, 8)
  expect(r.treeScale.y).toBeCloseTo(1.00005, 8)
  // Just outside Motion's range, as just inside it snaps.
  expect(Projection.applyTreeDeltas(box(0, 0, 100, 100), [delta(0, 0, 1 + 2e-12, 1)]).treeScale.x).not.toBe(1)
})

// --- Layout modes (#42, ADR-0009 Amendment (#42)): Motion's snapshot shaping ---------

// From (40, 40) 100x50 to (140, 60) 200x50.
const FROM = box(40, 40, 140, 90)
const TO = box(140, 60, 340, 110)

it("LMC1: shapeOrigin true leaves the origin as it is", () => {
  expect(Projection.shapeOrigin(true, FROM, TO)).toBe(FROM)
})

it("LMC2: shapeOrigin position keeps the origin's top-left and takes the target's size", () => {
  expect(Projection.shapeOrigin("position", FROM, TO)).toEqual(box(40, 40, 240, 90))
})

it("LMC3: shapeOrigin size moves the origin to the target's top-left, its own size kept", () => {
  expect(Projection.shapeOrigin("size", FROM, TO)).toEqual(box(140, 60, 240, 110))
})

it("LMC4: shapeOrigin x / y take the other axis from the target", () => {
  expect(Projection.shapeOrigin("x", FROM, TO)).toEqual({ x: FROM.x, y: TO.y })
  expect(Projection.shapeOrigin("y", FROM, TO)).toEqual({ x: TO.x, y: FROM.y })
})

it("LMC5: preserve-aspect animates position only past a 0.2 ratio difference (Motion's isNear)", () => {
  // 100x50 (2.0) to 200x50 (4.0): position only.
  expect(Projection.shapeOrigin("preserve-aspect", FROM, TO)).toEqual(box(40, 40, 240, 90))
  // 100x50 (2.0) to 200x100 (2.0): both.
  expect(Projection.shapeOrigin("preserve-aspect", FROM, box(140, 60, 340, 160))).toBe(FROM)
  // 2.0 to 2.18 is near (within 0.2): both; to 2.25 isn't: position only.
  expect(Projection.animatesPositionOnly("preserve-aspect", FROM, box(0, 0, 109, 50))).toBe(false)
  expect(Projection.animatesPositionOnly("preserve-aspect", FROM, box(0, 0, 112.5, 50))).toBe(true)
  expect(Projection.animatesPositionOnly("position", FROM, FROM)).toBe(true)
  expect(Projection.animatesPositionOnly(true, FROM, TO)).toBe(false)
  expect(Projection.animatesPositionOnly("size", FROM, TO)).toBe(false)
})

it("LMC6: withSizeOf keeps a box's top-left and takes another's size", () => {
  expect(Projection.withSizeOf(TO, FROM)).toEqual(box(140, 60, 240, 110))
})
