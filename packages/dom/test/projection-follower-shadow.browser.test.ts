// A Follower keeps its own box-shadow, corrected for its own scale (#6, ADR-0011 *Amendment (#6)*),
// checked against a fake ProjectionSink with every Refresh frame fired by hand (`projection-harness.ts`).
// Motion corrects a Follower with its Lead's values and geometry (`correct(valuesToRender[key], lead)`),
// so it draws the Lead's shadow, unblended, from the handover's first frame: twins with different
// shadows pop there. Wardic keeps each twin's own, dissolving into each other over the crossfade.
//
// - FS1: twins of different sizes and shadows crossfade: each frame the Follower writes its own
//   shadow corrected for its own scale, and the Lead its own for its.
import { describe, expect, it } from "@effect/vitest"
import { afterEach, beforeEach } from "vitest"
import type { ProjectionNodeHandle, RegisterNodeOptions } from "../src/index.ts"
import { boxShadowCorrector } from "../src/scale-correction.ts"
import { clearStages, el, endOfTask, fireFrame, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"

beforeEach(stubFrames)

afterEach(() => {
  unstubFrames()
  clearStages()
})

type Engine = ReturnType<typeof makeEngine>

const register = (e: Engine, id: string, element: HTMLElement, opts: Partial<RegisterNodeOptions> = {}): ProjectionNodeHandle =>
  e.system.register({ id, element, transition: () => ({ type: "spring" }), ...opts })

describe("a Follower keeps its own shadow (#6)", () => {
  it("FS1: twins of different sizes and shadows: each writes its own shadow, corrected for its own scale", async () => {
    const sk = makeSink()
    const e = makeEngine(sk.sink)
    const root = stage()
    const aEl = el(root, "position:absolute;left:20px;top:40px;width:80px;height:40px;box-shadow:0px 4px 8px rgba(0, 0, 0, 0.5)")
    register(e, "a", aEl, { layoutId: "twin" })
    await endOfTask()
    fireFrame()
    const bEl = el(root, "position:absolute;left:300px;top:40px;width:160px;height:80px;box-shadow:0px 16px 32px rgba(0, 0, 0, 0.5)")
    register(e, "b", bEl, { layoutId: "twin" })
    await endOfTask()
    const aBase = boxShadowCorrector.read(aEl)
    const bBase = boxShadowCorrector.read(bEl)
    let checked = 0
    for (let i = 0; i < 30; i++) {
      fireFrame()
      const a = sk.of("a").at(-1)!
      const b = sk.of("b").at(-1)!
      // Mid-handover both are scaled: A onto B's growing box, B from A's.
      if (Math.abs(a.sx - 1) < 1e-3 || Math.abs(b.sx - 1) < 1e-3) continue
      expect(a.partial["box-shadow"], `frame ${i}: the Follower's own shadow, for its scale`).toBe(boxShadowCorrector.correct(aBase, a.sx, a.sy))
      expect(b.partial["box-shadow"], `frame ${i}: the Lead's own, for its scale`).toBe(boxShadowCorrector.correct(bBase, b.sx, b.sy))
      checked++
    }
    expect(checked, "frames with both twins scaled").toBeGreaterThan(5)
    e.dispose()
  })
})
