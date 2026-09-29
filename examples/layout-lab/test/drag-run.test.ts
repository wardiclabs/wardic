// Issue #26's drag runs (`dragRunOf`, `dragChecksOf`, `formatDragPasses`) and the
// lab's drag-run log (`ctx.recordDragRun`, `Lab.dragRuns`, `Lab.subscribeDragRuns`),
// in the node test tier. No hand-driven drag has been saved yet, so the fixtures are
// synthetic, built on the scene of the #26 browser suite
// (`packages/solid/test/drag-measure-pass.browser.test.tsx`): a 160x80 item D with a
// `layout` child C1 at (10,10) and a plain child C2 at (60,10). The recorder's first
// rAF after the grab is frame 1, frames are 16 ms apart, and each pointer move is
// handled between one frame's paint and the next frame's rAF, as real input is.
import * as Effect from "effect/Effect"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  type Box,
  DRAG_CHECK_NAMES,
  type DragExpect,
  type DragFrame,
  type DragMove,
  type DragRun,
  type DragRunInput,
  dragChecksOf,
  dragRunOf,
  formatDragPasses,
  type Point,
} from "../src/lab/drag-run.ts"
import { makeLab } from "../src/lab/lab.ts"
import type { FrameTrace } from "../src/probe/frame-trace.ts"
import type { PaintSampler, PostPaintTicker } from "../src/probe/paint-sampler.ts"
import { makeTimeline, type SpanRecord } from "../src/probe/timeline.ts"
import type { ScenarioDef } from "../src/scenarios/types.ts"

/** A span record with the given name, times and attributes; `end` undefined is a span still in flight. */
const span = (
  name: string,
  start: number,
  end: number | undefined,
  attributes: Readonly<Record<string, unknown>>,
): SpanRecord =>
  end === undefined
    ? { id: `${name}@${start}`, name, start, attributes, scheduler: "default" }
    : { id: `${name}@${start}`, name, start, end, attributes, exitTag: "Success", scheduler: "default" }

const MEASURE = "wardic.projection.measure"
const COORDINATOR = "wardic.projection.coordinator"

const box = (x: number, y: number, width = 160, height = 80): Box => ({ x, y, width, height })
const moved = (b: Box, dx: number, dy: number): Box => ({ ...b, x: b.x + dx, y: b.y + dy })
/** `from` a fraction `f` of the way to `to`. */
const toward = (from: Box, to: Box, f: number): Box => box(from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f)

/** D's box at the grab, relative to the stage. */
const GRAB: Box = box(32, 88)
/** D's slot after the sibling grew (the pass at {@link PASS_AT}): 40px lower. */
const SLOT_B: Box = moved(GRAB, 0, 40)
const C1: Point = { x: 10, y: 10 }
const C2: Point = { x: 60, y: 10 }
/** Both children glued to `d`. */
const glued = (d: Box): Record<string, Box> => ({
  c1: box(d.x + C1.x, d.y + C1.y, 40, 40),
  c2: box(d.x + C2.x, d.y + C2.y, 40, 40),
})

const GRAB_AT = 1000
/** Frame k's rAF time. */
const frameAtOf = (k: number): number => GRAB_AT + 16 * k
/** Frame k's post-paint sample: D painted at `d`, its slot at `slot`, the children glued unless given. */
const frameOf = (k: number, d: Box, slot: Box, children: Record<string, Box> = glued(d)): DragFrame => ({
  frame: k,
  frameAt: frameAtOf(k),
  t: frameAtOf(k) + 4,
  d,
  slot,
  children,
})
/** Move k: handled after frame k's paint (and before frame k+1's rAF), the pointer at +(10 + 5k, 3 + k). */
const moveOf = (k: number): DragMove => ({ t: frameAtOf(k) + 8, frame: k, dx: 10 + 5 * k, dy: 3 + k })
/** The grab box moved by `m`. */
const at = (m: DragMove): Box => moved(GRAB, m.dx, m.dy)

/** Six moves, one before each of frames 1-6. */
const MOVES: ReadonlyArray<DragMove> = [0, 1, 2, 3, 4, 5].map(moveOf)
/** The sibling's Measure pass, between frame 3 (1048) and frame 4 (1064). */
const PASS_AT = 1050
const slotOf = (k: number): Box => (frameAtOf(k) > PASS_AT ? SLOT_B : GRAB)
/** The pointerup: a task between frame 6's paint and frame 7's rAF. */
const RELEASE_AT = frameAtOf(6) + 8
const ENDED_AT = frameAtOf(11) + 10
/** The release's flight from the held box to the slot over frames 7-11, as fractions of the way. */
const FLIGHT = [0.1, 0.4, 0.8, 1, 1]

const input = (frames: ReadonlyArray<DragFrame>, over: Partial<DragRunInput> = {}): DragRunInput => ({
  scenarioId: "drag-slot-moves",
  mode: "resize",
  grabAt: GRAB_AT,
  grabBox: GRAB,
  moves: MOVES,
  frames,
  childOffsets: { c1: C1, c2: C2 },
  releaseAt: RELEASE_AT,
  endedAt: ENDED_AT,
  ...over,
})

/**
 * Since #26's fix: each frame paints the move handled before it (0 frames behind),
 * the sibling's pass moves D's slot without moving D, and the release moves on its
 * first frame from the held box to the new slot.
 */
const cleanHeld = [1, 2, 3, 4, 5, 6].map((k) => frameOf(k, at(MOVES[k - 1]), slotOf(k)))
const HELD_BOX = at(MOVES[5])
const cleanFrames: ReadonlyArray<DragFrame> = [
  ...cleanHeld,
  ...FLIGHT.map((f, i) => frameOf(7 + i, toward(HELD_BOX, SLOT_B, f), SLOT_B)),
]
/** The pass's span: the sibling seeded, D and C1 drag-blocked. */
const cleanSpans: ReadonlyArray<SpanRecord> = [
  span(MEASURE, PASS_AT, PASS_AT + 1, { nodes: 5, active: 1, seeded: 1, rounds: 1, dragBlocked: 2 }),
  span(COORDINATOR, PASS_AT + 1, 1300, { active: 1 }),
]

/**
 * Before #26's fix: D paints one frame behind the pointer (frame 1 still shows the
 * grab box), C1 is left at its slot while D is held and glued again from the
 * release, the pass seeds 3 (the sibling, D and C1) with no `dragBlocked`, and the
 * release holds one frame at the held box.
 */
const laggingAt = (k: number): Box => (k === 1 ? GRAB : at(MOVES[k - 2]))
const oldHeldBox = laggingAt(6)
const oldFrames: ReadonlyArray<DragFrame> = [
  ...[1, 2, 3, 4, 5, 6].map((k) => {
    const d = laggingAt(k)
    return frameOf(k, d, slotOf(k), { ...glued(d), c1: box(slotOf(k).x + C1.x, slotOf(k).y + C1.y, 40, 40) })
  }),
  frameOf(7, oldHeldBox, SLOT_B),
  ...[0.1, 0.5, 1, 1].map((f, i) => frameOf(8 + i, toward(oldHeldBox, SLOT_B, f), SLOT_B)),
]
const oldSpans: ReadonlyArray<SpanRecord> = [span(MEASURE, PASS_AT, PASS_AT + 1, { nodes: 5, active: 1, seeded: 3, rounds: 1 })]

/** Scenario 11's expectations (task.json `lab_s11`). */
const S11_EXPECT: DragExpect = {
  underPointerMaxPx: 1,
  framesBehindMax: 0,
  childGlueMaxPx: 1,
  maxSeededPerPass: 1,
  releaseHeld: 0,
  endsOnSlotMaxPx: 0.5,
}

describe("dragRunOf", () => {
  it("reads a drag since #26's fix: under the pointer, 0 frames behind, children glued, release held 0, on the slot", () => {
    const run = dragRunOf(input(cleanFrames), cleanSpans)
    expect(run).toMatchObject({
      heldFrameCount: 6,
      underPointerMaxPx: 0,
      framesBehindMax: 0,
      framesBehindMoves: 6,
      childGlueMaxPx: { c1: 0, c2: 0 },
      passes: { count: 1, seeding: 1, dragBlocked: 2, perPass: [{ start: PASS_AT, seeded: 1, dragBlocked: 2 }] },
      releaseHeld: 0,
      endsOnSlotPx: 0,
    })
    // The input is kept whole, with the spans the lab joined.
    expect(run.frames).toBe(cleanFrames)
    expect(run.spans).toBe(cleanSpans)
  })

  it("reads a drag before #26's fix: 1 frame behind, C1 left at its slot, the pass seeding D, release held 1", () => {
    const run = dragRunOf(input(oldFrames), oldSpans)
    expect(run).toMatchObject({
      heldFrameCount: 6,
      // Frame 1 still painted the grab box, 10px (x) short of move 0; later frames lag one 5px step.
      underPointerMaxPx: 10,
      framesBehindMax: 1,
      framesBehindMoves: 6,
      // Frame 4: D at +20,+5 while C1 sat at the slot that had just moved 40px down (35px in y).
      childGlueMaxPx: { c1: 35, c2: 0 },
      passes: { count: 1, seeding: 1, dragBlocked: 0 },
      releaseHeld: 1,
      endsOnSlotPx: 0,
    })
  })

  it("does not expect a late move in the frame whose rAF ran before it", () => {
    // Move 1 is handled after frame 1's rAF callback (1016) but before that frame's
    // post-paint read (1020), so frame 1 paints move 0 and frame 2 paints move 1.
    // Compared by time against the read, move 1 would look 5px ahead of frame 1.
    const late: DragMove = { t: frameAtOf(1) + 2, frame: 1, dx: 15, dy: 4 }
    const moves = [moveOf(0), late]
    const frames = [frameOf(1, at(moveOf(0)), GRAB), frameOf(2, at(late), GRAB), frameOf(3, at(late), GRAB)]
    const run = dragRunOf(input(frames, { moves, releaseAt: null, endedAt: frameAtOf(3) + 10 }), [])
    expect(frames[0].t).toBeGreaterThan(late.t)
    expect(run).toMatchObject({ heldFrameCount: 3, underPointerMaxPx: 0, framesBehindMax: 0, framesBehindMoves: 2 })
  })

  it("skips a move the next one replaced before any frame could show it", () => {
    const first: DragMove = { t: 1004, frame: 0, dx: 10, dy: 3 }
    const second: DragMove = { t: 1010, frame: 0, dx: 20, dy: 5 }
    const frames = [frameOf(1, at(second), GRAB), frameOf(2, at(second), GRAB)]
    const run = dragRunOf(input(frames, { moves: [first, second], releaseAt: null, endedAt: 1100 }), [])
    expect(run).toMatchObject({ underPointerMaxPx: 0, framesBehindMax: 0, framesBehindMoves: 1 })
  })

  it("leaves out moves within the drag threshold: the drag starts past 3px", () => {
    // Move 0 is 2px from the grab point, so the drag has not started and frame 1
    // still paints the grab box; move 1 starts it and frame 2 paints it.
    const moves: ReadonlyArray<DragMove> = [
      { t: 1008, frame: 0, dx: 2, dy: 1 },
      { t: 1024, frame: 1, dx: 12, dy: 1 },
    ]
    const frames = [frameOf(1, GRAB, GRAB), frameOf(2, at(moves[1]), GRAB), frameOf(3, at(moves[1]), GRAB)]
    const run = dragRunOf(input(frames, { moves, releaseAt: null, endedAt: 1100 }), [])
    expect(run).toMatchObject({ heldFrameCount: 2, underPointerMaxPx: 0, framesBehindMax: 0, framesBehindMoves: 1 })
  })

  it("compares centres, so a slot resize painted about the same centre reads 0", () => {
    // Frame 2: the slot grew 40px wide mid-drag, and D paints the new size about the pointer's centre.
    const grown = box(at(MOVES[0]).x - 20, at(MOVES[0]).y, 200, 80)
    const frames = [frameOf(1, at(MOVES[0]), GRAB), frameOf(2, grown, box(12, 88, 200, 80))]
    const run = dragRunOf(input(frames, { moves: [MOVES[0]], releaseAt: null, endedAt: 1100 }), [])
    expect(run.underPointerMaxPx).toBe(0)
  })

  it("reads release held 0 for a release with nowhere to go, and null (stuck) for one that never moved off the slot", () => {
    // Back at the grab point (the slot) and released: the last move is painted, so there is nothing to fly.
    const back: ReadonlyArray<DragMove> = [
      { t: 1008, frame: 0, dx: 20, dy: 0 },
      { t: 1024, frame: 1, dx: 10, dy: 0 },
      { t: 1040, frame: 2, dx: 0, dy: 0 },
    ]
    const releaseAt = frameAtOf(3) + 8
    const on = [
      frameOf(1, at(back[0]), GRAB),
      frameOf(2, at(back[1]), GRAB),
      frameOf(3, GRAB, GRAB),
      frameOf(4, GRAB, GRAB),
      frameOf(5, GRAB, GRAB),
    ]
    expect(dragRunOf(input(on, { moves: back, releaseAt }), [])).toMatchObject({ releaseHeld: 0, endsOnSlotPx: 0 })
    // The F2 bug: the release came before the last move was painted, and the
    // element kept the previous frame's offset for good.
    const stuck = [
      frameOf(1, at(back[0]), GRAB),
      frameOf(2, at(back[1]), GRAB),
      frameOf(3, at(back[1]), GRAB),
      frameOf(4, at(back[1]), GRAB),
    ]
    const stuckRun = dragRunOf(input(stuck, { moves: back, releaseAt: frameAtOf(2) + 8 }), [])
    expect(stuckRun).toMatchObject({ releaseHeld: null, endsOnSlotPx: 10 })
  })

  it("counts a frame in the release's own millisecond as after it (Firefox's coarse timer)", () => {
    const run = dragRunOf(input(cleanFrames, { releaseAt: frameAtOf(7) }), cleanSpans)
    // Frame 7 is the release's first frame, already moving: not a held frame, and release held 0.
    expect(run).toMatchObject({ heldFrameCount: 6, underPointerMaxPx: 0, releaseHeld: 0 })
    // A frame 7 that still shows the held box is the release's one held frame, not the held box itself.
    const holding = [
      ...cleanHeld,
      frameOf(7, HELD_BOX, SLOT_B),
      ...FLIGHT.map((f, i) => frameOf(8 + i, toward(HELD_BOX, SLOT_B, f), SLOT_B)),
    ]
    const held = dragRunOf(input(holding, { releaseAt: frameAtOf(7), endedAt: frameAtOf(12) + 10 }), cleanSpans)
    expect(held).toMatchObject({ heldFrameCount: 6, releaseHeld: 1, endsOnSlotPx: 0 })
  })

  it("reads null release and slot numbers for a press with no release, and no held frames for a press with no drag", () => {
    const held = dragRunOf(input(cleanHeld, { releaseAt: null }), cleanSpans)
    expect(held).toMatchObject({ heldFrameCount: 6, releaseHeld: null, endsOnSlotPx: null })
    const still = dragRunOf(input(cleanHeld.map((f) => ({ ...f, d: GRAB, children: glued(GRAB) })), { moves: [] }), [])
    expect(still).toMatchObject({ heldFrameCount: 0, underPointerMaxPx: 0, framesBehindMax: null, framesBehindMoves: 0 })
  })

  it("judges a child only in the frames that sampled it, and leaves out a child never sampled", () => {
    const frames = cleanFrames.map((f, i) => (i === 2 ? { ...f, children: { c2: f.children.c2 } } : f))
    const run = dragRunOf(input(frames, { childOffsets: { c1: C1, c2: C2, c3: { x: 0, y: 0 } } }), cleanSpans)
    expect(run.childGlueMaxPx).toEqual({ c1: 0, c2: 0 })
  })

  it("counts the passes in [grabAt, endedAt]: an in-flight span and one from before #26 count 0 for both", () => {
    const spans: ReadonlyArray<SpanRecord> = [
      span(MEASURE, GRAB_AT - 5, GRAB_AT - 4, { seeded: 1, dragBlocked: 0 }),
      // Firefox's whole-millisecond timer: a pass in the grab's own millisecond is the run's.
      span(MEASURE, GRAB_AT, GRAB_AT + 1, { nodes: 5, active: 0, seeded: 1, rounds: 1, dragBlocked: 0 }),
      span(MEASURE, PASS_AT, PASS_AT + 1, { nodes: 5, active: 1, seeded: 1, rounds: 1, dragBlocked: 2 }),
      // A log from before #26's fix: `seeded`, no `dragBlocked`.
      span(MEASURE, 1070, 1071, { nodes: 5, active: 1, seeded: 3, rounds: 1 }),
      // Still in flight when the lab joined it: `{}`.
      span(MEASURE, 1090, undefined, {}),
      span(COORDINATOR, 1091, 1300, { active: 1 }),
      span(MEASURE, ENDED_AT + 1, ENDED_AT + 2, { seeded: 1, dragBlocked: 1 }),
    ]
    const passes = dragRunOf(input(cleanFrames), spans).passes
    expect(passes).toEqual({
      count: 4,
      seeding: 3,
      dragBlocked: 2,
      perPass: [
        { start: GRAB_AT, seeded: 1, dragBlocked: 0 },
        { start: PASS_AT, seeded: 1, dragBlocked: 2 },
        { start: 1070, seeded: 3, dragBlocked: 0 },
        { start: 1090, seeded: 0, dragBlocked: 0 },
      ],
    })
  })

  it("reads `seeded` and `dragBlocked` as the timeline records them at the span's end", async () => {
    const timeline = makeTimeline()
    const grabAt = performance.now()
    await Effect.runPromise(
      Effect.annotateCurrentSpan({ nodes: 5, active: 1, seeded: 1, rounds: 1, dragBlocked: 2 }).pipe(
        Effect.withSpan(MEASURE),
        Effect.provide(timeline.layer),
      ),
    )
    const endedAt = performance.now()
    const spans = timeline.window(grabAt, endedAt).spans
    const run = dragRunOf(input([], { grabAt, endedAt, moves: [], releaseAt: null }), spans)
    expect(formatDragPasses(run.passes)).toBe("1 (1 seeding, 2 drag-blocked)")
  })

  it("survives a JSON round trip unchanged", () => {
    const frames = cleanFrames.map((f, i) => (i === 0 ? { ...f, opacity: { lead: 1, follower: 0 } } : f))
    const run = dragRunOf(input(frames), [...cleanSpans, span(MEASURE, 1090, undefined, {})])
    expect(JSON.parse(JSON.stringify(run))).toStrictEqual(run)
    const lagging = dragRunOf(input(oldFrames), oldSpans)
    expect(JSON.parse(JSON.stringify(lagging))).toStrictEqual(lagging)
    const still = dragRunOf(input(cleanHeld, { moves: [], releaseAt: null }), [])
    expect(JSON.parse(JSON.stringify(still))).toStrictEqual(still)
  })
})

describe("formatDragPasses", () => {
  it("reads `N (M seeding, K drag-blocked)`, K summed over the passes, and `0` for no pass", () => {
    const one = { start: 1, seeded: 1, dragBlocked: 2 }
    expect(formatDragPasses({ count: 1, seeding: 1, dragBlocked: 2, perPass: [one] })).toBe("1 (1 seeding, 2 drag-blocked)")
    const run = dragRunOf(input(cleanFrames), [
      ...cleanSpans,
      span(MEASURE, 1070, 1071, { seeded: 1, dragBlocked: 2 }),
      span(MEASURE, 1090, 1091, { seeded: 0, dragBlocked: 1 }),
    ])
    expect(formatDragPasses(run.passes)).toBe("3 (2 seeding, 5 drag-blocked)")
    expect(formatDragPasses({ count: 0, seeding: 0, dragBlocked: 0, perPass: [] })).toBe("0")
  })
})

describe("dragChecksOf", () => {
  const textsOf = (run: DragRun, want: DragExpect) => dragChecksOf(run, want).map((c) => [c.name, c.ok, c.text])

  it("passes every line of a drag since #26's fix against scenario 11's expectations", () => {
    const run = dragRunOf(input(cleanFrames), cleanSpans)
    expect(dragChecksOf(run, S11_EXPECT).map((c) => c.name)).toEqual([...DRAG_CHECK_NAMES])
    expect(textsOf(run, S11_EXPECT)).toEqual([
      ["under pointer", true, "0.00 px ✓"],
      ["frames behind", true, "0 · 6 moves ✓"],
      ["child glued", true, "c1 0.00 · c2 0.00 px ✓"],
      ["passes", true, "1 (1 seeding, 2 drag-blocked) ✓"],
      ["release held", true, "0 ✓"],
      ["ends on slot", true, "0.00 px ✓"],
    ])
  })

  it("fails the lines a drag before #26's fix misses, saying what was expected", () => {
    const run = dragRunOf(input(oldFrames), oldSpans)
    expect(textsOf(run, S11_EXPECT)).toEqual([
      ["under pointer", false, "10.00 px ✗ expected ≤ 1 px"],
      ["frames behind", false, "1 · 6 moves ✗ expected ≤ 0"],
      ["child glued", false, "c1 35.00 · c2 0.00 px ✗ expected ≤ 1 px"],
      ["passes", false, "1 (1 seeding, 0 drag-blocked) ✗ expected seeded ≤ 1, drag-blocked ≥ 1 per held pass"],
      ["release held", false, "1 ✗ expected 0"],
      ["ends on slot", true, "0.00 px ✓"],
    ])
  })

  it("fails what a run could not measure (`?`), and shows a line with no expectation unchecked", () => {
    const still = dragRunOf(input(cleanHeld, { moves: [], releaseAt: null, childOffsets: {} }), [])
    expect(textsOf(still, S11_EXPECT)).toEqual([
      ["under pointer", false, "? ✗ expected ≤ 1 px"],
      ["frames behind", false, "? ✗ expected ≤ 0"],
      ["child glued", false, "? ✗ expected ≤ 1 px"],
      ["passes", true, "0 ✓"],
      ["release held", false, "? ✗ expected 0"],
      ["ends on slot", false, "? ✗ expected ≤ 0.5 px"],
    ])
    expect(textsOf(dragRunOf(input(oldFrames), oldSpans), {})).toEqual([
      ["under pointer", true, "10.00 px"],
      ["frames behind", true, "1 · 6 moves"],
      ["child glued", true, "c1 35.00 · c2 0.00 px"],
      ["passes", true, "1 (1 seeding, 0 drag-blocked)"],
      ["release held", true, "1"],
      ["ends on slot", true, "0.00 px"],
    ])
  })

  it("checks only the held passes: one after the release may drag-block none, one while held may not", () => {
    const afterRelease = span(MEASURE, RELEASE_AT + 10, RELEASE_AT + 11, { seeded: 1, dragBlocked: 0 })
    const passesOf = (spans: ReadonlyArray<SpanRecord>) =>
      dragChecksOf(dragRunOf(input(cleanFrames), spans), S11_EXPECT).find((c) => c.name === "passes")
    expect(passesOf([...cleanSpans, afterRelease])).toEqual({
      name: "passes",
      ok: true,
      text: "2 (2 seeding, 2 drag-blocked) ✓",
    })
    const heldNoBlock = span(MEASURE, 1070, 1071, { seeded: 1, dragBlocked: 0 })
    expect(passesOf([...cleanSpans, heldNoBlock])?.ok).toBe(false)
    const heldTwoSeeded = span(MEASURE, 1070, 1071, { seeded: 2, dragBlocked: 2 })
    expect(passesOf([...cleanSpans, heldTwoSeeded])?.ok).toBe(false)
  })

  it("reads a stuck release as `?` and off the slot", () => {
    const moves: ReadonlyArray<DragMove> = [
      { t: 1008, frame: 0, dx: 20, dy: 0 },
      { t: 1024, frame: 1, dx: 10, dy: 0 },
      { t: 1040, frame: 2, dx: 0, dy: 0 },
    ]
    const frames = [1, 2, 3, 4].map((k) => frameOf(k, at(moves[Math.min(k - 1, 1)]), GRAB))
    const run = dragRunOf(input(frames, { moves, releaseAt: frameAtOf(2) + 8 }), [])
    const checks = dragChecksOf(run, S11_EXPECT)
    expect(checks.find((c) => c.name === "release held")).toEqual({ name: "release held", ok: false, text: "? ✗ expected 0" })
    expect(checks.find((c) => c.name === "ends on slot")).toEqual({
      name: "ends on slot",
      ok: false,
      text: "10.00 px ✗ expected ≤ 0.5 px",
    })
  })
})

describe("Lab.recordDragRun", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** A lab over a real timeline, with the per-frame probes stubbed (a drag run uses none of them). */
  const labWith = (def: ScenarioDef) => {
    const ticker: PostPaintTicker = { onPostPaint: () => () => {}, frame: () => 0, stop: () => {} }
    const sampler: PaintSampler = {
      begin: () => {},
      retarget: () => {},
      cancel: () => {},
      onRunEnd: () => () => {},
      activeScenarioId: () => undefined,
    }
    const frameTrace: FrameTrace = { window: () => ({ callbacks: [], observers: [], inputs: [] }) }
    const timeline = makeTimeline()
    return { lab: makeLab({ ticker, sampler, timeline, frameTrace, scenarios: [def] }), timeline }
  }
  const def: ScenarioDef = {
    id: "drag-test",
    index: 99,
    kind: "drag",
    title: "Drag test",
    mechanism: "A hand-driven drag.",
    prediction: "safe",
    rationale: "A test fixture.",
    dragExpect: S11_EXPECT,
    View: () => null,
  }

  it("joins the timeline's spans, attributes the run to the context, keeps it and notifies subscribers", async () => {
    const { lab, timeline } = labWith(def)
    const seen: Array<DragRun> = []
    const unsubscribe = lab.subscribeDragRuns((run) => seen.push(run))
    const grabAt = performance.now()
    await Effect.runPromise(
      Effect.annotateCurrentSpan({ nodes: 5, active: 1, seeded: 1, rounds: 1, dragBlocked: 2 }).pipe(
        Effect.withSpan(MEASURE),
        Effect.provide(timeline.layer),
      ),
    )
    const endedAt = performance.now()
    lab.context(def).recordDragRun(input(cleanFrames, { scenarioId: "someone-else", grabAt, endedAt }))
    expect(seen).toHaveLength(1)
    expect(seen[0].scenarioId).toBe("drag-test")
    expect(formatDragPasses(seen[0].passes)).toBe("1 (1 seeding, 2 drag-blocked)")
    expect(lab.dragRuns()).toEqual(seen)
    // `dragRuns()` is a copy, and the trigger-run log is untouched.
    expect(lab.dragRuns()).not.toBe(lab.dragRuns())
    expect(lab.runs()).toEqual([])
    unsubscribe()
    lab.context(def).recordDragRun(input(cleanFrames))
    expect(seen).toHaveLength(1)
    expect(lab.dragRuns()).toHaveLength(2)
  })

  it("keeps notifying after a listener throws, and keeps the newest 200 drag runs", () => {
    const { lab } = labWith(def)
    const report = vi.spyOn(console, "error").mockImplementation(() => {})
    const seen: Array<number> = []
    lab.subscribeDragRuns(() => {
      throw new Error("listener")
    })
    lab.subscribeDragRuns((run) => seen.push(run.endedAt))
    for (let i = 0; i < 201; i++) lab.context(def).recordDragRun(input(cleanFrames, { endedAt: ENDED_AT + i }))
    expect(seen).toHaveLength(201)
    expect(report).toHaveBeenCalledTimes(201)
    const kept = lab.dragRuns()
    expect(kept).toHaveLength(200)
    expect(kept[0].endedAt).toBe(ENDED_AT + 1)
    expect(kept[199].endedAt).toBe(ENDED_AT + 200)
  })
})
