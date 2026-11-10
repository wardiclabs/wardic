// A Batch's change driven by a Playhead (#665, ADR-0069 decision 15): what `createAnimate`'s Playback
// controls act on when they animate a Batch. Each member is held to `Machine.springValues` and
// `Machine.tween` on the same values, as `batch.test.ts`'s are.
//
// - BP1: played from the start, it lands frame for frame as the change would, its Playhead's time
//   keeping pace; it says so once.
// - BP2: paused, it holds, its time with it; played, it goes on frame for frame from there.
// - BP3: at speed 2 it lands in half the frames, each one where the change would be at twice the time.
// - BP4: a seek, then a play, lands it exactly where stepping to that time would have; its first step
//   lands there, as `Playback.drive`'s does, and it goes on.
// - BP5: its duration is `Machine.durationOf`'s for its slowest member, a spring's or a tween's; a seek
//   there lands it.
// - BP6: stopped, its keys stay where they are, and it never lands; cancelled, they're back at their
//   starts, after it landed too.
// - BP7: played backwards, it retraces its frames to its start, where it ends as if landed.
// - BP8: two stops: a member jumps to its first, from rest; a stagger counts the members it moves.
// - BP9: a later change takes one of its keys: that member goes the later change's way, the animation's
//   Playhead no longer reaches it, and it never lands (#433's latest-wins, as a ward's).
// - BP10: a change running two transitions, a spring and a tween, moves its Playhead's time once a frame.
// - BP11: `animate`'s two forms give one type, `pipe` runs the data-last one, and an Animation is
//   Pipeable and says what it is.
// - BP12: stopped mid-tween, a key stays where it is, and rests there.
// - BP13: one that moves nothing lands at its play; a play says how many members it sets off from rest.
// - BP14: a later change takes some of its keys: once the keys it kept rest, it ends unheard, and at
//   rest the table holds the Batch's own again.
// - BP15: paused, its keys' velocities read 0, and a change that takes one then starts it from rest (#464).
// - BP16: played back to its start, its keys rest there: a later change of the member's other key leaves
//   them where they are.
import * as Batch from "@wardic/core/Batch"
import * as Machine from "@wardic/core/Machine"
import * as Playback from "@wardic/core/Playback"
import * as Stagger from "@wardic/core/Stagger"
import { describe, expect, expectTypeOf, it } from "vitest"

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
    expect(Batch.play(animation)).toBe(1)
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
    // Its first step lands there, as a driven machine's does (\`Playback.drive\`), then it goes on.
    const on = stepped(batch, slot)
    expect(on[0]).toBeCloseTo(oracle[14], 9)
    on.slice(1, -2).forEach((x, f) => expect(x, `frame ${f}`).toBeCloseTo(oracle[15 + f], 9))
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
    // A tween's: the frames its time takes to reach its end, as `Machine.tween`'s steps sum them (#665): 105
    // frames sum to just under 1.75 s.
    const tween = { type: "tween", duration: 1.6, delay: 0.15 } as const
    const slow = Batch.animate(batch, slots, () => 50, { transition: tween, head: Playback.make() })
    expect(Batch.durationOf(slow)).toBeCloseTo(Machine.durationOf(Machine.tween(0, 50, tween)), 9)
    // A spring set by its duration: the frames until it lands, as it steps, its delay held first.
    const timed = { type: "spring", duration: 1.6, bounce: 0, delay: 0.15 } as const
    const clock = Playback.make()
    const sprung = Batch.animate(batch, slots, () => 0, { transition: timed, head: clock })
    Batch.play(sprung)
    const frames = stepped(batch, slots[0]).length
    expect(Batch.durationOf(sprung)).toBeCloseTo(frames * F, 9)
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

  it("BP10: a change running two transitions, a spring and a tween, moves its Playhead's time once a frame", () => {
    const head = Playback.make()
    const batch = Batch.make({ keys: ["x", "opacity"], writer, transition: { type: "spring" } })
    const slot = Batch.enter(batch, "a", { x: 0, opacity: 0 })
    const transition = { x: SPRING, opacity: { type: "tween", duration: 0.2 } } as const
    const animation = Batch.animate(batch, [slot], (_, k) => [100, 1][k], { transition, head })
    Batch.play(animation)
    Array.from({ length: 6 }).forEach(() => Batch.step(batch, F))
    expect(head.time).toBeCloseTo(6 * F, 9)
    expect(Batch.get(batch, slot, "x")).toBeCloseTo(springFrames(0, 100)[5], 9)
  })

  it("BP11: animate's two forms give one type, pipe runs the data-last one, and an Animation is Pipeable", () => {
    const head = Playback.make()
    const batch = Batch.make({ keys: ["x"], writer, transition: { type: "spring" } })
    const slot = Batch.enter(batch, "a", { x: 0 })
    const first = Batch.animate(batch, [slot], () => 10, { head })
    const second = batch.pipe(Batch.animate([slot], () => 20, { head }))
    expectTypeOf(first).toEqualTypeOf(second)
    expect([Batch.isAnimation(first), Batch.isAnimation(second), Batch.isAnimation(batch)]).toEqual([true, true, false])
    expect(second.pipe((self) => self)).toBe(second)
    expect(second.toJSON()).toEqual({ _id: "Batch.Animation", keys: 0, playing: false })
    Batch.play(second)
    expect(second.toJSON()).toEqual({ _id: "Batch.Animation", keys: 1, playing: true })
    stepped(batch, slot)
    expect([Batch.get(batch, slot, "x"), second.toJSON()]).toEqual([20, { _id: "Batch.Animation", keys: 1, playing: false }])
  })

  it("BP12: stopped mid-tween, a key stays where it is, and rests there", () => {
    const head = Playback.make()
    const batch = Batch.make({ keys: ["opacity"], writer, transition: { type: "spring" } })
    const slot = Batch.enter(batch, "a", { opacity: 0 })
    const animation = Batch.animate(batch, [slot], () => 1, { transition: { type: "tween", duration: 0.5 }, head })
    Batch.play(animation)
    Array.from({ length: 12 }).forEach(() => Batch.step(batch, F))
    const at = Batch.get(batch, slot, "opacity")
    expect(at).toBeGreaterThan(0.2)
    Batch.stop(animation)
    const after: Array<number> = []
    Array.from({ length: 60 }).some(() => {
      const done = Batch.step(batch, F)
      after.push(Batch.get(batch, slot, "opacity"))
      return done
    })
    expect(after.every((value) => value === at)).toBe(true)
    expect(after.length).toBe(1)
  })

  it("BP13: one that moves nothing lands at its play; a play says how many members it sets off from rest", () => {
    const head = Playback.make()
    let landed = 0
    const batch = Batch.make({ keys: ["x"], writer, transition: { type: "spring" } })
    const slots = ["a", "b", "c"].map((name) => Batch.enter(batch, name, { x: 0 }))
    const still = Batch.animate(batch, slots, () => 0, { transition: SPRING, head, onLanded: () => landed++ })
    expect([Batch.play(still), landed]).toEqual([0, 1])
    Batch.retarget(batch, [slots[0]], () => 50)
    const moved = Batch.animate(batch, slots, (slot) => [0, 30, 0][slot], { transition: SPRING, head: Playback.make() })
    // Member 0 was moving already, member 2 stays: it sets one off.
    expect(Batch.play(moved)).toBe(1)
  })

  it("BP14: some of its keys taken, it ends unheard once the keys it kept rest; the table holds the Batch's own again", () => {
    const head = Playback.make()
    let landed = 0
    const batch = Batch.make({ keys: ["x"], writer, transition: { type: "spring" } })
    const slots = ["a", "b"].map((name) => Batch.enter(batch, name, { x: 0 }))
    const animation = Batch.animate(batch, slots, () => 100, { transition: SPRING, head, onLanded: () => landed++ })
    Batch.play(animation)
    Array.from({ length: 5 }).forEach(() => Batch.step(batch, F))
    Batch.retarget(batch, [slots[1]], () => -40)
    const kept = stepped(batch, slots[0])
    expect([kept.at(-1), Batch.get(batch, slots[1], "x"), landed]).toEqual([100, -40, 0])
    expect(animation.toJSON()).toMatchObject({ playing: false })
    expect(batch.toJSON()).toMatchObject({ transitions: 1, moving: 0 })
  })

  it("BP15: paused, its keys' velocities read 0, and a change that takes one starts it from rest", () => {
    const head = Playback.make()
    const { batch, slot, animation } = oneMember(0, 100, head)
    Batch.play(animation)
    Array.from({ length: 5 }).forEach(() => Batch.step(batch, F))
    expect(Batch.velocity(batch, slot, "x")).toBeGreaterThan(0)
    Playback.pause(head)
    Batch.step(batch, F)
    const at = Batch.get(batch, slot, "x")
    expect(Batch.velocity(batch, slot, "x")).toBe(0)
    Batch.retarget(batch, [slot], () => -40, { transition: SPRING })
    expect(stepped(batch, slot).slice(0, 20)).toEqual(springFrames(at, -40).slice(0, 20))
  })

  it("BP16: played back to its start, its keys rest there, whatever a later change of another key does", () => {
    const head = Playback.make()
    const batch = Batch.make({ keys: ["x", "y"], writer, transition: { type: "spring" } })
    const slot = Batch.enter(batch, "a", { x: 0, y: 0 })
    const animation = Batch.animate(batch, [slot], (_, k) => [100, Number.NaN][k], { transition: SPRING, head })
    Batch.play(animation)
    stepped(batch, slot, 12)
    Playback.setSpeed(head, -1)
    stepped(batch, slot)
    expect(Batch.get(batch, slot, "x")).toBe(0)
    Batch.retarget(batch, [slot], (_, k) => [Number.NaN, 50][k])
    stepped(batch, slot).forEach((x) => expect(x).toBe(0))
    expect(Batch.get(batch, slot, "y")).toBe(50)
  })
})
