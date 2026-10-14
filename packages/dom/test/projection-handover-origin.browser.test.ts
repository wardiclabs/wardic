// A layoutId handover starts from where its twin paints (#170, ADR-0010 *Amendment (#170)*), checked
// against a fake ProjectionSink with every Refresh frame fired by hand (`projection-harness.ts`).
// Interrupted mid-flight, each of a handover's four origins goes on from where the twin was seen:
//
// - XO1: a promotion, the Lead unmounting with no presence;
// - XO2: a crossfade beside a live twin still moving;
// - XO3: a Switch seed, the twin disposed mid-flight with a new one mounting in the same task;
// - XO4: a promotion under presence, the leaver re-introduced as a leaving Follower: both twins.
//
// "Goes on from where it was": the jump from where the twin painted the frame before to the new
// Lead's first frame is no bigger than the Lead's own next step. A start from rest accelerates, so
// its first step is smaller than its second; a start from the twin's resting box jumps the rest of
// the twin's flight. Before #170 every one started there. Twins are the same size, so a top-level
// node paints at its layout position plus its last translate.
import { describe, expect, it } from "@effect/vitest"
import { afterEach, beforeEach } from "vitest"
import type { ProjectionNodeHandle, RegisterNodeOptions } from "../src/index.ts"
import { clearStages, el, endOfTask, fireFrame, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"

beforeEach(stubFrames)

afterEach(() => {
  unstubFrames()
  clearStages()
})

type Sink = ReturnType<typeof makeSink>
type Engine = ReturnType<typeof makeEngine>

/** An absolutely positioned box in `parent`. */
const makeBox = (parent: HTMLElement, left: number, top: number, width: number, height: number): HTMLElement =>
  el(parent, `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px`)

/** Where a top-level node paints on x, through the fake sink: its layout position plus its last translate. */
const paintedX = (box: HTMLElement, sk: Sink, id: string): number => box.offsetLeft + (sk.of(id).at(-1)?.tx ?? 0)

/** Where an element paints on x, committed to the page itself (a leaving Follower is). */
const pageX = (box: HTMLElement): number => box.getBoundingClientRect().left - box.parentElement!.getBoundingClientRect().left

const register = (e: Engine, id: string, element: HTMLElement, opts: Partial<RegisterNodeOptions> = {}): ProjectionNodeHandle =>
  e.system.register({ id, element, transition: () => ({ type: "spring" }), ...opts })

/** `n` frames, each followed by `read`, collected. */
const frames = <A>(n: number, read: () => A): Array<A> =>
  Array.from({ length: n }, () => {
    fireFrame()
    return read()
  })

/** The start goes on from `before`: its first frame no further from it than its next step. */
const expectContinuous = (before: number, [first, second]: ReadonlyArray<number>, what: string) => {
  expect(Math.abs(first! - before), `${what}: jump at the start (next step ${Math.abs(second! - first!).toFixed(2)}px)`).toBeLessThanOrEqual(
    Math.abs(second! - first!) + 0.5,
  )
}

describe("a handover starts from where its twin paints (#170)", () => {
  it("XO1: a promotion: the Lead unmounted mid-flight, its twin goes on from where the Lead was seen", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = makeBox(root, 40, 60, 100, 80)
    register(e, "a", aEl, { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const bEl = makeBox(root, 240, 60, 100, 80)
    const b = register(e, "b", bEl, { layoutId: "twin" })
    await endOfTask()
    frames(8, () => undefined)
    const seen = paintedX(bEl, sk, "b")
    expect(seen, "B mid-flight").toBeLessThan(230)
    b.dispose()
    await endOfTask()
    expectContinuous(seen, frames(2, () => paintedX(aEl, sk, "a")), "A")
    e.dispose()
  })

  it("XO2: a crossfade beside a live twin still moving starts from where that twin paints", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    register(e, "a", makeBox(root, 40, 60, 100, 80), { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const bEl = makeBox(root, 240, 60, 100, 80)
    register(e, "b", bEl, { layoutId: "twin" })
    await endOfTask()
    frames(8, () => undefined)
    const seen = paintedX(bEl, sk, "b")
    expect(seen, "B mid-flight").toBeLessThan(230)
    const cEl = makeBox(root, 440, 60, 100, 80)
    register(e, "c", cEl, { layoutId: "twin" })
    await endOfTask()
    // The pass seeds C's first frame, its origin itself; the next frames are its first steps.
    expectContinuous(seen, [paintedX(cEl, sk, "c"), ...frames(1, () => paintedX(cEl, sk, "c"))], "C")
    e.dispose()
  })

  it("XO3: a Switch seed: the twin disposed mid-flight seeds the one mounting from where it was seen", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = makeBox(root, 40, 60, 100, 80)
    const a = register(e, "a", aEl, { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    // A moves for a layout change, 40 → 240.
    aEl.style.left = "240px"
    a.notify()
    await endOfTask()
    frames(8, () => undefined)
    const seen = paintedX(aEl, sk, "a")
    expect(seen, "A mid-flight").toBeLessThan(230)
    // In one task: A's element leaves the page and its node is disposed; B mounts at 440.
    aEl.remove()
    a.dispose()
    const bEl = makeBox(root, 440, 60, 100, 80)
    register(e, "b", bEl, { layoutId: "twin" })
    await endOfTask()
    expectContinuous(seen, [paintedX(bEl, sk, "b"), ...frames(1, () => paintedX(bEl, sk, "b"))], "B")
    e.dispose()
  })

  it("XO4: under presence, the promoted twin and the re-introduced leaver both go on from where the leaver was seen", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = makeBox(root, 40, 60, 100, 80)
    register(e, "a", aEl, { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const bEl = makeBox(root, 240, 60, 100, 80)
    const b = register(e, "b", bEl, { layoutId: "twin" })
    await endOfTask()
    frames(8, () => undefined)
    const seen = paintedX(bEl, sk, "b")
    expect(seen, "B mid-flight").toBeLessThan(230)
    // Presence closes B: Solid disposes its node, then presence hands it back.
    let left = false
    queueMicrotask(() => {
      left = e.system.handleLeave(bEl, () => undefined)
    })
    b.dispose()
    await endOfTask()
    expect(left).toBe(true)
    const after = frames(2, () => ({ a: paintedX(aEl, sk, "a"), b: pageX(bEl) }))
    expectContinuous(seen, after.map((f) => f.a), "A, promoted")
    expectContinuous(seen, after.map((f) => f.b), "B, leaving")
    e.dispose()
  })
})
