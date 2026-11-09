// A handover blends the twin's look into the new Lead's (#166, ADR-0010 *Amendment (#166)*, Motion's
// `mixValues`), checked against a fake ProjectionSink with every Refresh frame fired by hand
// (`projection-harness.ts`): border radius and rotation at every handover, and in a Switch, opacity.
// The Follower is drawn with its Lead's blended values.
//
// - XB1: a crossfade: radius (scale-corrected) and rotation start at the twin's and end at the Lead's
//   own; the Follower is drawn with them; at rest nothing of the blend is left in the projection.
// - XB2: a promotion with nothing left on screen blends opacity too, from the leaver's as drawn.
// - XB3: a Switch from a twin off the page, from its look as last drawn; XB3b, at an equal box it
//   animates only when the two look different.
// - XB4: interrupted, the next handover goes on from the look the twin is drawn with.
// - XB5: radii of different units don't mix (the Lead's own shows); 0 against a % blends in %.
// - XB6: a layout restart mid-blend (#146) goes on from the look drawn.
// - XB7: twins at different own scales (#8) blend radii as drawn, own scale included.
//
// Before #166 the Lead drew its own look from its first frame, and a Switch popped.
import { describe, expect, it } from "@effect/vitest"
import { afterEach, beforeEach } from "vitest"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { clearStages, el, endOfTask, fireFrame, makeEngine, makeSink, stage, stubFrames, unstubFrames, type Write } from "./projection-harness.ts"
import * as Option from "effect/Option"

beforeEach(stubFrames)

afterEach(() => {
  unstubFrames()
  clearStages()
})

type Sink = ReturnType<typeof makeSink>
type Engine = ReturnType<typeof makeEngine>

const register = (e: Engine, id: string, element: HTMLElement, opts: Partial<ProjectionSystem.RegisterNodeOptions> = {}): ProjectionSystem.NodeHandle =>
  e.system.register({ id, element, transition: () => Option.some({ type: "spring" }), ...opts })

const makeBox = (parent: HTMLElement, left: number, width: number, extra = ""): HTMLElement =>
  el(parent, `position:absolute;left:${left}px;top:40px;width:${width}px;height:${width / 2}px;${extra}`)

/** A write's top-left radius as drawn, on x: its corrected value times its x scale; `undefined` when it wrote none. */
const radiusOf = (w: Write | undefined): number | undefined => {
  const css = w?.partial["border-radius"]
  if (typeof css !== "string") return undefined
  return Number.parseFloat(css) * w!.sx
}
/** A write's top-left radius as written, its unit included. */
const radiusCss = (w: Write | undefined): string | undefined => {
  const css = w?.partial["border-radius"]
  if (typeof css !== "string") return undefined
  return css.split(" ")[0]
}
const rotateOf = (w: Write | undefined): number | undefined => w?.value.rotate as number | undefined
const blendOpacityOf = (w: Write | undefined): number | undefined => w?.value.blendOpacity as number | undefined

const frames = (sk: Sink, ids: ReadonlyArray<string>, n: number): Array<Record<string, Write | undefined>> =>
  Array.from({ length: n }, () => {
    fireFrame()
    return Object.fromEntries(ids.map((id) => [id, sk.of(id).at(-1)]))
  })

/** The start goes on from `before`: its first value no further from it than its next step. */
const expectGoesOnFrom = (before: number, [first, second]: ReadonlyArray<number>, what: string) => {
  expect(Math.abs(first! - before), `${what}: jump at the start (next step ${Math.abs(second! - first!).toFixed(2)})`).toBeLessThanOrEqual(
    Math.abs(second! - first!) + 0.05,
  )
}

describe("a handover blends the twin's look (#166)", () => {
  it("XB1: a crossfade blends radius and rotation into the Lead's own; the Follower is drawn with them", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    register(e, "a", makeBox(root, 20, 80, "border-radius:20px"), { layoutId: "twin", ownRotate: () => 20 })
    await endOfTask()
    fireFrame()
    register(e, "b", makeBox(root, 300, 160), { layoutId: "twin" })
    await endOfTask()
    const seen = frames(sk, ["a", "b"], 120)
    expectGoesOnFrom(20, seen.map((f) => radiusOf(f.b)!), "B's radius")
    expectGoesOnFrom(20, seen.map((f) => rotateOf(f.b)!), "B's rotation")
    for (const [i, f] of seen.slice(0, 40).entries()) {
      expect(rotateOf(f.a), `frame ${i}: the Follower's rotation`).toBeCloseTo(rotateOf(f.b)!, 6)
      expect(radiusOf(f.a)!, `frame ${i}: the Follower's radius`).toBeCloseTo(radiusOf(f.b)!, 1)
    }
    // At rest: the Lead's own look, and nothing of the blend left in its projection.
    const last = sk.of("b").at(-1)
    expect(radiusOf(last), "B's own radius").toBeCloseTo(0, 3)
    expect(rotateOf(last), "no rotation override").toBeUndefined()
    expect(blendOpacityOf(last), "no blended opacity").toBeUndefined()
    e.dispose()
  })

  it("XB2: a promotion with nothing left on screen blends opacity from the leaver's as drawn, and radius and rotation", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = makeBox(root, 20, 80)
    register(e, "a", aEl, { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const bEl = makeBox(root, 300, 80, "border-radius:20px;opacity:0.4")
    const b = register(e, "b", bEl, { layoutId: "twin", ownRotate: () => 20 })
    await endOfTask()
    frames(sk, ["b"], 120)
    // The frame's microtasks run before any task: what follows is a task, after the Late window (#680).
    await endOfTask()
    b.dispose()
    await endOfTask()
    const seen = frames(sk, ["a"], 120)
    expectGoesOnFrom(0.4, seen.map((f) => blendOpacityOf(f.a)!), "A's opacity")
    expectGoesOnFrom(20, seen.map((f) => rotateOf(f.a)!), "A's rotation")
    expectGoesOnFrom(20, seen.map((f) => radiusOf(f.a)!), "A's radius")
    const last = sk.of("a").at(-1)
    expect(blendOpacityOf(last), "at rest, its own opacity").toBeUndefined()
    expect(rotateOf(last)).toBeUndefined()
    e.dispose()
  })

  it("XB3: a Switch from a twin off the page blends from its look as last drawn", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = makeBox(root, 20, 80, "border-radius:10px")
    const a = register(e, "a", aEl, { layoutId: "twin", ownRotate: () => 15, ownOpacity: () => 0.5 })
    await endOfTask()
    fireFrame()
    aEl.remove()
    a.dispose()
    register(e, "b", makeBox(root, 300, 80), { layoutId: "twin" })
    await endOfTask()
    const first = sk.of("b").at(-1)
    const seen = [first, ...frames(sk, ["b"], 1).map((f) => f.b)]
    expectGoesOnFrom(0.5, seen.map((w) => blendOpacityOf(w)!), "B's opacity")
    expectGoesOnFrom(15, seen.map((w) => rotateOf(w)!), "B's rotation")
    expectGoesOnFrom(10, seen.map((w) => radiusOf(w)!), "B's radius")
    e.dispose()
  })

  it("XB3b: a Switch at an equal box animates only when the twins look different", async () => {
    for (const [rotate, animates] of [[30, true], [0, false]] as const) {
      const sk = makeSink()
      const e = makeEngine(sk.sink)
      const root = stage()
      const aEl = makeBox(root, 20, 80)
      const a = register(e, "a", aEl, { layoutId: `twin-${rotate}`, ownRotate: () => rotate })
      await endOfTask()
      fireFrame()
      aEl.remove()
      a.dispose()
      register(e, "b", makeBox(root, 20, 80), { layoutId: `twin-${rotate}` })
      await endOfTask()
      const seen = frames(sk, ["b"], 3)
      expect(seen.some((f) => rotateOf(f.b) !== undefined), `rotate ${rotate}: a blend`).toBe(animates)
      e.dispose()
    }
  })

  it("XB4: interrupted, the next handover goes on from the look its twin is drawn with", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    register(e, "a", makeBox(root, 20, 80, "border-radius:20px"), { layoutId: "twin", ownRotate: () => 20 })
    await endOfTask()
    fireFrame()
    const b = register(e, "b", makeBox(root, 300, 80), { layoutId: "twin" })
    await endOfTask()
    const mid = frames(sk, ["b"], 8).at(-1)!.b
    const [seenRotate, seenRadius] = [rotateOf(mid)!, radiusOf(mid)!]
    expect(seenRotate, "B mid-blend").toBeGreaterThan(2)
    expect(seenRotate).toBeLessThan(18)
    b.dispose()
    await endOfTask()
    const seen = frames(sk, ["a"], 2)
    expectGoesOnFrom(seenRotate, seen.map((f) => rotateOf(f.a)!), "A's rotation")
    expectGoesOnFrom(seenRadius, seen.map((f) => radiusOf(f.a)!), "A's radius")
    e.dispose()
  })

  it("XB5: radii of different units don't mix, the Lead's own shows; 0 against a % blends in %", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    register(e, "a", makeBox(root, 20, 80, "border-radius:50%"), { layoutId: "px" })
    register(e, "c", makeBox(root, 20, 80, "border-radius:0px"), { layoutId: "pc" })
    await endOfTask()
    fireFrame()
    register(e, "b", makeBox(root, 300, 80, "border-radius:10px"), { layoutId: "px" })
    register(e, "d", makeBox(root, 300, 80, "border-radius:20%"), { layoutId: "pc" })
    await endOfTask()
    const seen = frames(sk, ["b", "d"], 6)
    for (const f of seen) expect(radiusCss(f.b), "50% against 10px: the Lead's own").toMatch(/px$/)
    expect(radiusCss(seen[0]!.d), "0 against 20%: in %").toMatch(/%$/)
    expect(Number.parseFloat(radiusCss(seen[0]!.d)!), "eased in from 0").toBeLessThan(10)
    e.dispose()
  })

  it("XB6: a layout restart mid-blend goes on from the look drawn", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    register(e, "a", makeBox(root, 20, 80, "border-radius:20px"), { layoutId: "twin", ownRotate: () => 20 })
    await endOfTask()
    fireFrame()
    const bEl = makeBox(root, 300, 80)
    const b = register(e, "b", bEl, { layoutId: "twin" })
    await endOfTask()
    const mid = frames(sk, ["b"], 8).at(-1)!.b
    const seen = rotateOf(mid)!
    expect(seen, "B mid-blend").toBeLessThan(18)
    bEl.style.left = "400px"
    b.notify()
    await endOfTask()
    expectGoesOnFrom(seen, [rotateOf(sk.of("b").at(-1))!, ...frames(sk, ["b"], 1).map((f) => rotateOf(f.b)!)], "B's rotation")
    e.dispose()
  })

  it("XB7: twins at different own scales blend radii as drawn, own scale included", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const big = { x: 1.5, y: 1.5 }
    register(e, "a", makeBox(root, 20, 80, "border-radius:20px"), { layoutId: "twin", ownScale: () => big })
    await endOfTask()
    fireFrame()
    register(e, "b", makeBox(root, 300, 80), { layoutId: "twin" })
    await endOfTask()
    const seen = frames(sk, ["a", "b"], 30)
    // A draws its 20px at 1.5x: 30px. B (own scale 1) starts there.
    expectGoesOnFrom(30, seen.map((f) => radiusOf(f.b)!), "B's radius")
    // The Follower, at its own 1.5x, is drawn with B's radius: its written radius times 1.5.
    for (const [i, f] of seen.entries()) expect(radiusOf(f.a)! * 1.5, `frame ${i}: the Follower's radius as drawn`).toBeCloseTo(radiusOf(f.b)!, 1)
    e.dispose()
  })
})
