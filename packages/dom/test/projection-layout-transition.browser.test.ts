// A layout animation's transition (#171, ADR-0009 *Amendment (#171)*): Motion's default, a 0.45 s
// tween eased cubic-bezier(0.4, 0, 0.1, 1), or a tween or spring of its own. Checked against a fake
// ProjectionSink with every Refresh frame fired by hand, 1/60 s apart (`projection-harness.ts`).
//
// - LT1: with no transition, a FLIP lands on Motion's curve at 0.45 s, never stepping back. Before
//   #171 every layout animation was a 170/26 spring, its tail creeping for frames past that.
// - LT2: a tween's duration, `ease` and delay: held at its origin through the delay, then on its curve;
//   LT2b (#360): an `ease` named as Motion names it, or given as a bézier's four numbers.
// - LT3: an interrupt restarts a fresh full tween from where the node is drawn (Motion's).
// - LT4: reduced motion lands at once, its delay dropped (ADR-0029).
// - LT5: a release's Release offset runs on its drag transition, whatever its layout transition
//   (ADR-0016 *Amendment (#140)*), and on its own drag transition when it has one.
// - LT6: a spring's delay holds it too.
// - LT7 (#359): a spring set by time: a duration spring lands at its duration, passing its target on
//   the way with a bounce; a visual-duration spring lands at rest, later.
import { describe, expect, it } from "@effect/vitest"
import * as Easing from "@wardic/core/Easing"
import { afterEach, beforeEach } from "vitest"
import * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { clearStages, el, endOfTask, fireFrame, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"
import * as Option from "effect/Option"
import * as UndefinedOr from "effect/UndefinedOr"

beforeEach(stubFrames)

afterEach(() => {
  unstubFrames()
  clearStages()
})

type Sink = ReturnType<typeof makeSink>

const DT = 1 / 60
const MOTION = Easing.cubicBezier(0.4, 0, 0.1, 1)

/** `id`'s last written translate on x, 0 before any. */
const tx = (sk: Sink, id: string): number => sk.of(id).at(-1)?.tx ?? 0

/** A 50 × 50 box at `left` on a fresh stage, registered on `transition`, its first pass run. */
const mount = async (transition: ProjectionSystem.LayoutTransition | undefined, options?: ProjectionSystem.Options) => {
  const sk = makeSink()
  const e = makeEngine(sk.sink, options)
  const element = el(stage("position:relative;width:800px;height:100px"), "position:absolute;top:0;left:0px;width:50px;height:50px")
  const handle: ProjectionSystem.NodeHandle = e.system.register({ id: "a", element, transition: () => Option.fromUndefinedOr(transition) })
  await endOfTask()
  fireFrame()
  /** Move the box to `left`; the FLIP starts at the next frame. */
  const moveTo = async (left: number): Promise<void> => {
    element.style.left = `${left}px`
    handle.notify()
    await endOfTask()
  }
  /** The translate after each of the next `n` frames. */
  const run = (n: number): Array<number> =>
    Array.from({ length: n }, () => {
      fireFrame()
      return tx(sk, "a")
    })
  return { sk, e, element, handle, moveTo, run }
}

/** The first index whose translate is 0: where it lands. */
const landsAt = (xs: ReadonlyArray<number>): number => xs.findIndex((x) => x === 0)

describe("a layout animation's transition (#171)", () => {
  it("LT1: with no transition, a FLIP lands on Motion's curve at 0.45 s, never stepping back", async () => {
    const m = await mount(undefined)
    await m.moveTo(200)
    const xs = m.run(40)
    // Frame k has run k/60 s: 0.45 s is frame 27 (index 26).
    expect(landsAt(xs), "lands at 0.45 s").toBe(26)
    for (const [i, x] of xs.slice(0, 26).entries()) {
      expect(1 - Math.abs(x) / 200, `frame ${i + 1}: on Motion's curve`).toBeCloseTo(MOTION(((i + 1) * DT) / 0.45), 4)
    }
    for (let i = 1; i < xs.length; i++) expect(Math.abs(xs[i]!), `frame ${i}: never back`).toBeLessThanOrEqual(Math.abs(xs[i - 1]!))
    m.e.dispose()
  })

  it("LT2: a tween's duration, ease and delay: held through the delay, then on its curve", async () => {
    const m = await mount({ type: "tween", duration: 0.2, ease: Easing.linear, delay: 0.1 })
    await m.moveTo(200)
    const xs = m.run(30)
    for (const [i, x] of xs.slice(0, 6).entries()) expect(x, `frame ${i + 1}: held at its origin through 0.1 s`).toBeCloseTo(-200, 6)
    // Frame 12 has run 0.2 s: 0.1 s of its 0.2 s, half way.
    expect(1 - Math.abs(xs[11]!) / 200, "half way, linearly").toBeCloseTo(0.5, 4)
    expect(landsAt(xs), "lands at 0.3 s").toBe(17)
    m.e.dispose()
  })

  for (const ease of ["easeIn", [0.42, 0, 1, 1]] as const) it(`LT2b: an ease given as ${JSON.stringify(ease)}: on Motion's easeIn (#360)`, async () => {
    const m = await mount({ type: "tween", duration: 0.2, ease })
    await m.moveTo(200)
    const xs = m.run(20)
    // Frame 6 has run 0.1 s of its 0.2 s: half way in time, easeIn(0.5) of the way.
    expect(1 - Math.abs(xs[5]!) / 200).toBeCloseTo(Easing.easeIn(0.5), 4)
    m.e.dispose()
  })

  it("LT3: an interrupt restarts a fresh full tween from where the node is drawn", async () => {
    const m = await mount(undefined)
    await m.moveTo(200)
    const before = m.run(10)
    // Drawn at 200 + tx; moved again to 300.
    const drawn = 200 + before.at(-1)!
    await m.moveTo(300)
    const after = m.run(40)
    expect(Math.abs(300 + after[0]! - drawn), "starts where it was drawn, within its first step, px").toBeLessThan(1)
    expect(landsAt(after), "lands 0.45 s after the restart, not on the first schedule").toBe(26)
    m.e.dispose()
  })

  it("LT4: reduced motion lands at once, its delay dropped", async () => {
    const m = await mount({ type: "tween", duration: 0.45, delay: 0.3 }, { reducedMotion: () => true })
    await m.moveTo(200)
    // At its new box from the first frame, and kept there past where the delay would have ended.
    for (const [i, x] of m.run(30).entries()) expect(x, `frame ${i + 1}: at its new box`).toBe(0)
    m.e.dispose()
  })

  it("LT5: a release's Release offset runs on its drag transition, whatever its layout transition", async () => {
    // Nodes in one engine, dragged and released on the same frames, so each steps the same dts.
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage("position:relative;width:800px;height:400px")
    const stiff: ProjectionSystem.DragTransition = { ...ProjectionSystem.DEFAULT_DRAG_TRANSITION, bounceStiffness: 400, bounceDamping: 30 }
    const nodes: ReadonlyArray<{ readonly transition: ProjectionSystem.LayoutTransition | undefined; readonly dragTransition?: ProjectionSystem.DragTransition }> = [
      { transition: undefined },
      { transition: { type: "spring" } },
      { transition: { type: "spring", stiffness: 400, damping: 30 } },
      { transition: { type: "tween", duration: 0.2 } },
      { transition: undefined, dragTransition: stiff },
    ]
    const handles = nodes.map((node, i) =>
      e.system.register({
        id: `n${i}`,
        element: el(root, `position:absolute;top:${i * 80}px;left:0px;width:50px;height:50px`),
        transition: () => Option.fromUndefinedOr(node.transition),
        ...UndefinedOr.match(node.dragTransition, { onUndefined: () => ({}), onDefined: (dragTransition) => ({ dragTransition: () => Option.some(dragTransition) }) }),
      }),
    )
    await endOfTask()
    fireFrame()
    for (const h of handles) h.dragStart()
    for (const h of handles) h.dragMove({ x: 80, y: 0 })
    fireFrame()
    for (const h of handles) h.dragEnd()
    await endOfTask()
    const run = Array.from({ length: 90 }, () => {
      fireFrame()
      return nodes.map((_, i) => tx(sk, `n${i}`))
    })
    expect(run[0]![0], "it starts from the drag").toBeGreaterThan(40)
    run.forEach(([none, spring, ownSpring, tween], k) => {
      expect(spring, `frame ${k}: the default spring's release is the default tween's`).toBeCloseTo(none!, 9)
      expect(ownSpring, `frame ${k}: a spring of its own releases the same`).toBeCloseTo(none!, 9)
      expect(tween, `frame ${k}: a tween of its own too`).toBeCloseTo(none!, 9)
    })
    expect(run.some(([none, , , , own]) => Math.abs(own! - none!) > 1), "a drag transition of its own steps its release").toBe(true)
    e.dispose()
  })

  it("LT6: a spring's delay holds it too", async () => {
    const m = await mount({ type: "spring", delay: 0.1 })
    await m.moveTo(200)
    const xs = m.run(20)
    for (const [i, x] of xs.slice(0, 6).entries()) expect(x, `frame ${i + 1}: held at its origin through 0.1 s`).toBeCloseTo(-200, 6)
    expect(xs[8]!, "then on its way").toBeGreaterThan(-200)
    m.e.dispose()
  })

  it("LT7: a duration spring lands at its duration, bouncing; a visual-duration one at rest (#359)", async () => {
    const timed = await mount({ type: "spring", duration: 0.5, bounce: 0.25 })
    await timed.moveTo(200)
    const xs = timed.run(60)
    // Frame k has run k/60 s: 0.5 s is frame 30 (index 29).
    expect(landsAt(xs), "lands at 0.5 s").toBe(29)
    expect(xs[28], "still moving the frame before").not.toBe(0)
    expect(Math.max(...xs.slice(0, 29)), "past its new box on the way").toBeGreaterThan(1)
    timed.e.dispose()
    const visual = await mount({ type: "spring", visualDuration: 0.5, bounce: 0.25 })
    await visual.moveTo(200)
    const vs = visual.run(120)
    expect(landsAt(vs), "at rest, after its visual duration").toBeGreaterThan(30)
    expect(vs.slice(landsAt(vs)).every((x) => x === 0), "and stays").toBe(true)
    visual.e.dispose()
  })
})
