// A Batch's change driven by a Playhead (#665, ADR-0069 decision 15): what `createAnimate`'s Playback
// controls act on when they animate a Batch. Each member is held to `Machine.springValues` and
// `Machine.tween` on the same values, as `batch.test.ts`'s are.
//
// - BP1: played from the start, it lands frame for frame as the change would, its Playhead's time
//   keeping pace; it says so once.
// - BP2: paused, it holds, its time with it; played, it goes on frame for frame from there.
// - BP3: at speed 2 it lands in half the frames, each one where the change would be at twice the time.
// - BP4: a seek, then a play, lands it exactly where stepping to that time would have, and it goes on.
// - BP5: its duration is `Machine.durationOf`'s for its slowest member; a seek there lands it.
// - BP6: stopped, its keys stay where they are, and it never lands; cancelled, they're back at their
//   starts, after it landed too.
// - BP7: played backwards, it retraces its frames to its start, where it ends as if landed.
// - BP8: two stops: a member jumps to its first, from rest; a stagger counts the members it moves.
// - BP9: a later change takes one of its keys: that member goes the later change's way, the animation's
//   Playhead no longer reaches it, and it never lands (#433's latest-wins, as a ward's).
import * as Batch from "@wardic/core/Batch"
import * as Machine from "@wardic/core/Machine"
import * as Playback from "@wardic/core/Playback"
import * as Stagger from "@wardic/core/Stagger"
import { describe, expect, it } from "vitest"

const F = 1 / 60
const SPRING = { type: "spring", stiffness: 210, damping: 20 } as const

/** A writer that draws nothing. */
const writer: Batch.Writer<string> = { writes: () => true, forKeys: () => () => {} }

/** `springValues`' frames for one key from `from` to `to`, at `velocity`: the oracle. */
const springFrames = (from: number, to: number, options: Machine.SpringOptions = SPRING, velocity = 0): ReadonlyArray<number> => {
  const step = Machine.springValues({ x: to }, options, { from: { x: from }, velocity: { x: velocity } }).start()
  const out: Array<number> = []
  Array.from({ length: 600 }).some(() => {
    const frame = step(F)
    out.push(frame.value.x as number)
    return frame.done
  })
  return out
}

/** `batch`'s `x` at `slot` each step until it rests, or `limit` steps. */
const stepped = (batch: Batch.Batch<string>, slot: number, limit = 600): Array<number> => {
  const out: Array<number> = []
  Array.from({ length: limit }).some(() => {
    const done = Batch.step(batch, F)
    out.push(Batch.get(batch, slot, "x"))
    return done
  })
  return out
}

/** A Batch of one member at `x: from`, and an animation of it to `to` on `head`. */
const oneMember = (from: number, to: number, head: Playback.Playhead, onLanded = (): void => {}) => {
  const batch = Batch.make({ keys: ["x"], writer, transition: { type: "spring" } })
  const slot = Batch.enter(batch, "a", { x: from })
  const animation = Batch.animate(batch, [slot], () => to, { transition: SPRING, head, onLanded })
  return { batch, slot, animation }
}

describe("a Batch's change driven by a Playhead (#665)", () => {
  it("BP1: played from the start, it lands frame for frame as the change would, its time keeping pace", () => {
    const head = Playback.make()
    let landed = 0
    const { batch, slot, animation } = oneMember(0, 100, head, () => landed++)
    Batch.play(animation)
    const frames = stepped(batch, slot)
    const oracle = springFrames(0, 100)
    expect(frames).toEqual(oracle)
    expect(head.time).toBeCloseTo(oracle.length * F, 9)
    expect(landed).toBe(1)
  })

  it("BP2: paused, it holds, its time with it; played, it goes on frame for frame from there", () => {
    const head = Playback.make()
    const { batch, slot, animation } = oneMember(0, 100, head)
    Batch.play(animation)
    const before = stepped(batch, slot, 10)
    Playback.pause(head)
    const time = head.time
    const held = stepped(batch, slot, 5)
    expect(held.every((x) => x === before[9])).toBe(true)
    expect(head.time).toBe(time)
    Playback.play(head)
    expect([...before, ...stepped(batch, slot)]).toEqual(springFrames(0, 100))
  })

  it("BP3: at speed 2 it lands in half the frames, each where the change would be at twice the time", () => {
    const head = Playback.make()
    Playback.setSpeed(head, 2)
    const { batch, slot, animation } = oneMember(0, 100, head)
    Batch.play(animation)
    const frames = stepped(batch, slot)
    const oracle = springFrames(0, 100)
    frames.slice(0, -1).forEach((x, f) => expect(x, `frame ${f}`).toBeCloseTo(oracle[f * 2 + 1], 9))
    expect(Math.abs(frames.length - oracle.length / 2)).toBeLessThanOrEqual(1)
    expect(frames.at(-1)).toBe(100)
  })

  it("BP4: a seek, then a play, lands it where stepping to that time would have; it goes on from there", () => {
    const head = Playback.make()
    const { batch, slot, animation } = oneMember(0, 100, head)
    Batch.play(animation)
    stepped(batch, slot, 3)
    Playback.seek(head, 15 * F)
    Batch.play(animation)
    const oracle = springFrames(0, 100)
    expect(Batch.get(batch, slot, "x")).toBeCloseTo(oracle[14], 9)
    const on = stepped(batch, slot)
    on.slice(0, -2).forEach((x, f) => expect(x, `frame ${f}`).toBeCloseTo(oracle[15 + f], 9))
    expect(on.at(-1)).toBe(100)
  })

  it("BP5: its duration is Machine.durationOf's for its slowest member; a seek there lands it", () => {
    const head = Playback.make()
    const batch = Batch.make({ keys: ["x"], writer, transition: { type: "spring" } })
    const slots = ["a", "b"].map((name) => Batch.enter(batch, name, { x: 0 }))
    let landed = 0
    const animation = Batch.animate(batch, slots, (slot) => [20, 300][slot], { transition: SPRING, head, onLanded: () => landed++ })
    const far = Machine.durationOf(Machine.springValues({ x: 300 }, SPRING, { from: { x: 0 } }))
    expect(Batch.durationOf(animation)).toBeCloseTo(far, 9)
    Playback.seek(head, Batch.durationOf(animation))
    Batch.play(animation)
    Batch.step(batch, F)
    expect([Batch.get(batch, slots[0], "x"), Batch.get(batch, slots[1], "x"), landed]).toEqual([20, 300, 1])
  })

  it("BP6: stopped, its keys stay where they are and it never lands; cancelled, they're back at their starts", () => {
    const head = Playback.make()
    let landed = 0
    const { batch, slot, animation } = oneMember(10, 100, head, () => landed++)
    Batch.play(animation)
    stepped(batch, slot, 6)
    const at = Batch.get(batch, slot, "x")
    Batch.stop(animation)
    expect(stepped(batch, slot).every((x) => x === at)).toBe(true)
    expect(landed).toBe(0)
    // Played again from its start, it lands; cancelled after, it's back where it started.
    Playback.seek(head, 0)
    Batch.play(animation)
    stepped(batch, slot)
    expect([Batch.get(batch, slot, "x"), landed]).toEqual([100, 1])
    Batch.cancel(animation)
    stepped(batch, slot)
    expect(Batch.get(batch, slot, "x")).toBe(10)
  })

  it("BP7: played backwards, it retraces its frames to its start, where it ends as if landed", () => {
    const head = Playback.make()
    let landed = 0
    const { batch, slot, animation } = oneMember(0, 100, head, () => landed++)
    Batch.play(animation)
    const there = stepped(batch, slot, 12)
    Playback.setSpeed(head, -1)
    const back = stepped(batch, slot)
    back.slice(0, 11).forEach((x, f) => expect(x, `frame ${f}`).toBeCloseTo(there[10 - f], 9))
    expect([back.at(-1), head.time, landed]).toEqual([0, 0, 1])
  })

  it("BP8: two stops: a member jumps to its first, from rest; a stagger counts the members it moves", () => {
    const head = Playback.make()
    const batch = Batch.make({ keys: ["x"], writer, transition: { type: "spring" } })
    const slots = ["a", "b", "c"].map((name) => Batch.enter(batch, name, { x: 50 }))
    Batch.retarget(batch, [slots[0]], () => 80)
    Batch.step(batch, F)
    const delay = Stagger.make(0.05)
    // Member 1 stays where it is: the stagger counts members 0 and 2.
    const animation = Batch.animate(batch, slots, (slot) => [100, 50, 100][slot], { transition: SPRING, head, delay, from: (slot) => [0, Number.NaN, 0][slot] })
    Batch.play(animation)
    const xs: Array<Array<number>> = [[], []]
    Array.from({ length: 600 }).some(() => {
      const done = Batch.step(batch, F)
      xs[0].push(Batch.get(batch, slots[0], "x"))
      xs[1].push(Batch.get(batch, slots[2], "x"))
      return done
    })
    const first = springFrames(0, 100)
    const second = springFrames(0, 100, { ...SPRING, delay: delay(1, 2) })
    expect(xs[0].slice(0, first.length)).toEqual(first)
    expect(xs[1]).toEqual(second)
    expect(Batch.get(batch, slots[1], "x")).toBe(50)
  })

  it("BP9: a later change takes one of its keys: it goes that change's way, the Playhead no longer reaches it, it never lands", () => {
    const head = Playback.make()
    let landed = 0
    const batch = Batch.make({ keys: ["x"], writer, transition: { type: "spring" } })
    const slots = ["a", "b"].map((name) => Batch.enter(batch, name, { x: 0 }))
    const animation = Batch.animate(batch, slots, () => 100, { transition: SPRING, head, onLanded: () => landed++ })
    Batch.play(animation)
    Array.from({ length: 5 }).forEach(() => Batch.step(batch, F))
    const at = Batch.get(batch, slots[1], "x")
    const speed = Batch.velocity(batch, slots[1], "x")
    Batch.retarget(batch, [slots[1]], () => -40, { transition: SPRING })
    Playback.pause(head)
    const xs: Array<number> = []
    Array.from({ length: 600 }).some(() => {
      const done = Batch.step(batch, F)
      xs.push(Batch.get(batch, slots[1], "x"))
      return done
    })
    expect(xs.slice(0, 20)).toEqual(springFrames(at, -40, SPRING, speed).slice(0, 20))
    expect(landed).toBe(0)
    // Every key it moved taken, or landed while it held it: at rest, the table holds the Batch's own again.
    Batch.retarget(batch, [slots[0]], () => 5, { transition: SPRING })
    Array.from({ length: 600 }).some(() => Batch.step(batch, F))
    expect(landed).toBe(0)
    expect(batch.toJSON()).toMatchObject({ transitions: 1, moving: 0 })
  })
})
