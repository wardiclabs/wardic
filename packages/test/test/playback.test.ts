// A machine driven through a Playhead (#433, Motion's playback controls), stepped by hand: core's
// `Playback.drive`, and `Machine.durationOf`.
//
// - PB1: at speed 1 it steps as the machine does, and keeps the head's time.
// - PB2: paused, it draws its last Frame again; played, it goes on from there.
// - PB3: speed 2 takes half the ticks; speed 0 holds.
// - PB4: a run started with the head at 0.5 s lands there at its first tick, whatever the dt (a seek).
// - PB5: below speed 0 it goes back, and settles at 0 where it started.
// - PB6: `durationOf`: a tween's duration and delay, a spring's settle, `forever`'s Infinity.
// - PB7: `durationOf` of a driven machine is its source's, and leaves its playhead where it is (#618).
import * as Machine from "@wardic/core/Machine"
import * as Playback from "@wardic/core/Playback"
import { describe, expect, it } from "vitest"

/** A linear tween from 0 to 100 over 1 s. */
const tween = (delay = 0) => Machine.tween(0, 100, { duration: 1, ease: "linear", delay })

describe("Playback.drive (#433)", () => {
  it("PB1: at speed 1 it steps as the machine does, and keeps the head's time", () => {
    const head = Playback.make()
    const step = Playback.drive(tween(), head).start()
    const plain = tween().start()
    expect(step(0.25).value).toBeCloseTo(plain(0.25).value, 9)
    expect(step(0.25).value).toBeCloseTo(plain(0.25).value, 9)
    expect(head.time).toBeCloseTo(0.5, 9)
  })

  it("PB2: paused, it draws its last Frame again; played, it goes on from there", () => {
    const head = Playback.make()
    const step = Playback.drive(tween(), head).start()
    expect(step(0.25).value).toBeCloseTo(25, 6)
    head.paused = true
    expect(step(0.25).value).toBeCloseTo(25, 6)
    expect(step(0.25).value).toBeCloseTo(25, 6)
    expect(head.time).toBeCloseTo(0.25, 9)
    head.paused = false
    expect(step(0.25).value).toBeCloseTo(50, 6)
  })

  it("PB3: speed 2 takes half the ticks; speed 0 holds", () => {
    const head = Playback.make()
    head.speed = 2
    const step = Playback.drive(tween(), head).start()
    expect(step(0.25).value).toBeCloseTo(50, 6)
    const end = step(0.25)
    expect(end.value).toBeCloseTo(100, 6)
    expect(end.done).toBe(true)
    const held = Playback.make()
    held.speed = 0
    const still = Playback.drive(tween(), held).start()
    expect(still(0.25).value).toBe(0)
    expect(still(0.25).value).toBe(0)
  })

  it("PB4: a run started with the head at 0.5 s lands there at its first tick, whatever the dt", () => {
    const head = Playback.make()
    Playback.seek(head, 0.5)
    const step = Playback.drive(tween(0.2), head).start()
    // 0.5 s in, 0.2 s of it the delay: 30% of the way.
    expect(step(0.016).value).toBeCloseTo(30, 6)
    expect(head.time).toBeCloseTo(0.5, 9)
    expect(step(0.1).value).toBeCloseTo(40, 6)
  })

  it("PB5: below speed 0 it goes back, and settles at 0 where it started", () => {
    const head = Playback.make()
    Playback.seek(head, 0.5)
    const step = Playback.drive(tween(), head).start()
    expect(step(0).value).toBeCloseTo(50, 6)
    head.speed = -1
    const back = step(0.25)
    expect(back.value).toBeCloseTo(25, 6)
    expect(back.done).toBe(false)
    const start = step(0.5)
    expect(start.value).toBeCloseTo(0, 6)
    expect(start.done).toBe(true)
    expect(head.time).toBe(0)
  })

  it("PB6: durationOf a tween with its delay, a spring to rest, and forever's Infinity", () => {
    expect(Machine.durationOf(tween(0.2))).toBeCloseTo(1.2, 1)
    const spring = Machine.durationOf(Machine.spring(100, { stiffness: 100, damping: 10 }))
    expect(spring).toBeGreaterThan(0.5)
    expect(spring).toBeLessThan(Machine.MAX_DURATION)
    expect(Machine.durationOf(Machine.forever(tween()))).toBe(Number.POSITIVE_INFINITY)
  })
})

describe("durationOf a driven machine (#618)", () => {
  it("PB7: is its source's, and leaves the playhead where it is", () => {
    const head = Playback.make()
    head.time = 0.3
    head.speed = 2
    const driven = Playback.drive(Playback.drive(tween(0.5), head), head)
    expect(Machine.durationOf(driven)).toBeCloseTo(Machine.durationOf(tween(0.5)), 9)
    expect(head.time, "the playhead untouched").toBe(0.3)
  })
})
