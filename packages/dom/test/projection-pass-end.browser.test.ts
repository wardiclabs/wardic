// The engine's internal pass-end listener (ADR-0020's Reorder controller reads the axis
// from it), checked against a fake ProjectionSink with Refresh frames fired by hand.
//
// `onPassEnd(system, listener)` runs `listener` once per Measure pass, after every
// round's boxes are stored: a blocked pass (after a
// window width change) and a pass whose flush triggered more rounds included. It isn't
// exported from `@wardic/dom`: a binding reaches it only through the controller.
import { describe, expect, it } from "@effect/vitest"
import { afterEach, beforeEach } from "vitest"
import { page } from "vitest/browser"
import { onPassEnd } from "../src/internal/projection.ts"
import * as Dom from "../src/index.ts"
import { clearStages, el, endOfTask, fireFrame, makeEngine, makeSink, stage, stubFrames, unstubFrames, wait } from "./projection-harness.ts"
import * as Option from "effect/Option"

let width = 0
let height = 0
beforeEach(() => {
  stubFrames()
  width = window.innerWidth
  height = window.innerHeight
})
afterEach(async () => {
  unstubFrames()
  clearStages()
  await page.viewport(width, height)
  await wait(50)
})

describe("the pass-end listener (internal, for the Reorder controller)", () => {
  it("PE1: runs once per Measure pass, after every node's box is stored", async () => {
    const e = makeEngine(makeSink().sink)
    const s = stage()
    const a = el(s, "position:absolute;left:0;top:0;width:100px;height:50px")
    const b = el(s, "position:absolute;left:0;top:60px;width:100px;height:50px")
    const ha = e.system.register({ id: "a", element: a, transition: () => Option.some({ type: "spring" }) })
    const hb = e.system.register({ id: "b", element: b, transition: () => Option.some({ type: "spring" }) })
    const seen: Array<{ va: number; vb: number; top: number | undefined }> = []
    onPassEnd(e.system, () => seen.push({ va: ha.layoutVersion(), vb: hb.layoutVersion(), top: Option.getOrUndefined(hb.layoutBox())?.y.min }))
    await endOfTask()
    fireFrame()
    expect(seen.map(({ va, vb }) => [va, vb])).toEqual([[1, 1]])
    // Two triggers in one task: one pass, one call, with the moved box already stored.
    b.style.top = "120px"
    ha.notify()
    hb.notify()
    await endOfTask()
    expect(seen.map(({ va, vb }) => [va, vb])).toEqual([
      [1, 1],
      [2, 2],
    ])
    expect(seen[1]!.top! - seen[0]!.top!).toBe(60)
    e.dispose()
  })

  it("PE2: a pass whose flush triggers another round still calls it once, after the last round", async () => {
    const sk = makeSink()
    let retrigger: (() => void) | undefined
    const sink = {
      ...sk.sink,
      flushPass: (pass: () => void): void => {
        pass()
        const again = retrigger
        retrigger = undefined
        again?.()
      },
    }
    const e = makeEngine(sink)
    const a = el(stage(), "position:absolute;left:0;top:0;width:100px;height:50px")
    const h = e.system.register({ id: "a", element: a, transition: () => Option.some({ type: "spring" }) })
    await endOfTask()
    fireFrame()
    const versions: Array<number> = []
    onPassEnd(e.system, () => versions.push(h.layoutVersion()))
    retrigger = () => h.notify()
    h.notify()
    await endOfTask()
    // Two rounds (versions 2 and 3), one call.
    expect(versions).toEqual([3])
    e.dispose()
  })

  it("PE3: the blocked pass after a window width change calls it (the engine's own, at 250 ms)", async () => {
    const e = makeEngine(makeSink().sink)
    const col = el(stage(), "position:relative;margin:0 auto;width:200px")
    const a = el(col, "width:200px;height:50px")
    e.system.register({ id: "a", element: a, transition: () => Option.some({ type: "spring" }) })
    await endOfTask()
    fireFrame()
    let calls = 0
    onPassEnd(e.system, () => calls++)
    await page.viewport(width - 200, height)
    await wait(350)
    expect(e.spans.at(-1)?.blocked).toBe(true)
    expect(calls).toBe(1)
    e.dispose()
  })

  it("PE4: unsubscribing stops it; a listener that throws doesn't stop the pass or the others", async () => {
    const e = makeEngine(makeSink().sink)
    const a = el(stage(), "position:absolute;left:0;top:0;width:100px;height:50px")
    const h = e.system.register({ id: "a", element: a, transition: () => Option.some({ type: "spring" }) })
    await endOfTask()
    fireFrame()
    let calls = 0
    const stop = onPassEnd(e.system, () => calls++)
    onPassEnd(e.system, () => {
      throw new Error("listener failed")
    })
    let after = 0
    onPassEnd(e.system, () => after++)
    h.notify()
    await endOfTask()
    expect([calls, after]).toEqual([1, 1])
    stop()
    h.notify()
    await endOfTask()
    expect([calls, after]).toEqual([1, 2])
    expect(e.logs.some((l) => l.message.includes("pass-end listener failed"))).toBe(true)
    e.dispose()
  })

  it("PE5 (guard): it isn't part of @wardic/dom's exports", () => {
    expect("onPassEnd" in Dom).toBe(false)
  })
})
