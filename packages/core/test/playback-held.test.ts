// A held Frame moves nothing (#464): a machine driven through a paused Playhead draws its last Frame
// again, and a velocity that Frame gives reads 0, as a held MotionValue's frames read in Motion.
//
// - PH1: a spring paused mid-flight holds its value, at velocity 0, and plays on with its own once
//   the head plays again.
// - PH2: `springValues`' Frame holds each key at velocity 0.
// - PH3: a Frame with no velocity (a tween's) is held as it is.
import * as Machine from "@wardic/core/Machine"
import * as Playback from "@wardic/core/Playback"
import { describe, expect, it } from "vitest"

const DT = 1 / 60

describe("a held Frame (#464)", () => {
  it("PH1: a spring paused mid-flight holds at velocity 0, and plays on with its own", () => {
    const head = Playback.make()
    const step = Playback.drive(Machine.spring(100, { stiffness: 100, damping: 10 }), head).start()
    step(DT)
    const moving = step(DT)
    expect(moving.velocity).toBeGreaterThan(100)
    Playback.pause(head)
    const held = step(DT)
    expect(held.value).toBe(moving.value)
    expect(held.velocity).toBe(0)
    expect(step(DT), "one Frame per pause").toBe(held)
    Playback.play(head)
    const on = step(DT)
    expect(on.value).toBeGreaterThan(moving.value)
    expect(on.velocity).toBeGreaterThan(100)
  })

  it("PH2: springValues' Frame holds each key at velocity 0", () => {
    const head = Playback.make()
    const step = Playback.drive(Machine.springValues({ x: 100, y: -50 }, { stiffness: 100, damping: 10 }, { x: 0, y: 0 }), head).start()
    step(DT)
    const moving = step(DT)
    Playback.pause(head)
    const held = step(DT)
    expect(held.value).toEqual(moving.value)
    expect(held.velocity).toEqual({ x: 0, y: 0 })
  })

  it("PH3: a Frame with no velocity is held as it is", () => {
    const head = Playback.make()
    const step = Playback.drive(Machine.tween(0, 100, { duration: 1 }), head).start()
    step(DT)
    const moving = step(DT)
    Playback.pause(head)
    expect(step(DT)).toBe(moving)
  })
})
