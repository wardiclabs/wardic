// A Batch (#665, ADR-0069 decisions 10–18 and *Amendment (#665)*): many members' keys stepped as one
// run, written through a writer that records each write. Each member is checked against what core
// already gives one value: `Machine.springValues` and `Machine.tween`, and `Stagger.make`'s delays.
//
// - B1: a member's spring lands frame for frame as `springValues`' does.
// - B2: a new target mid-flight turns it at the speed it has: frame for frame as `springValues` started
//   from its value and velocity there.
// - B3: a tween lands frame for frame as `Machine.tween`'s does; a new target mid-tween starts a new
//   tween from where it is, and a spring that takes over starts at the speed its last frame moved.
// - B4: members on different transitions step at once, each as its own; a change can give one per key:
//   a spring on `x` beside a 0 s tween after a delay on `opacity`, reduced motion's Snap.
// - B5: a change's delay counts the members it moves, by rank (Q8, Q11): an unchanged member isn't
//   written, and one mid-flight carries on frame for frame as if the change never came.
// - B6: a member entering past the capacity grows the Batch, and every member carries on as it was.
// - B7: a member that leaves is never written again, and its slot goes to the next to enter, from
//   that one's own start.
// - B8: `Batch.run` on the Frame loop: one run while anything moves, `onFrame` once a tick, a second
//   `run` meanwhile a no-op; it ends at rest, a change after rest starts the next, and a change made
//   from `onFrame` keeps it going.
// - B9: what a Batch can't run throws an `OptionError` naming it: a key its writer can't draw, a
//   transition that's neither a spring nor a tween, a spring's or a tween's bad option.
// - B10: each `dual` operation's two forms give one type, and `pipe` runs the data-last form.
// - B11: a spring set by `duration` (#359) starts from rest and lands at its duration, as
//   `springValues`' does, a member moving or not.
// - B12: at rest a Batch forgets the transitions its changes gave, so a bag a call makes each time
//   doesn't pile up; a member that left takes no change.
// - B13: after a spring set by duration, a change to another key still rests, and so does a member
//   that takes the slot.
// - B14: a change that moves nothing keeps no transition, and a Batch that never rests holds only
//   the transitions its keys run now, however many bags its changes bring.
// - B15: `get` and `velocity` name a key the Batch doesn't have; a slot given twice in one change
//   moves once, and counts once for the delays.
// - B16: a Batch's own transition can be one per key, with a `default` for the rest; a key with neither
//   is named.
// - B17: a change can give each member's key its own transition, by a function of its slot and key:
//   each runs as `springValues` does on it, and the members it gives one bag share it.
// - B18: a change says how many members it sets off from rest, and `isMoving` whether any member moves.
// - B19: a member's Subject can be replaced mid-flight: the new one is written from the next step, and
//   the member carries on exactly as it would have, its value, speed and delay kept.
// - B20: a change can start a member's keys from given values at given speeds, onto targets they already
//   have too (a driver handing them back, #665's PR 4): each moves as `springValues` from there at that speed,
//   and `target` reads the targets they keep.
// - B21 (#712): a key on a tween that no change has turned since its member entered stays at its start when
//   another of its keys tweens, and so does one in a slot a member that left gave back.
// - B22 (#712): `draw` writes every member where it is now, with no step, and flushes: a change that started
//   its members from its targets, drawn before the page paints; a member that left isn't written.
// - B23 (#706): a change can start its members partway (`startAt`), read at each one's first step, which
//   draws it where a member stepped from the change's start is at that time, at that speed; it steps on as
//   that member does.
// - B24 (#706): a tween, a spring set by duration and a spring, each with a stagger's delays or one delay
//   for all, started partway as from the start.
// - B25 (#706): started past its rest, a spring is drawn where its closed form has it, unlanded, and lands at
//   its next step; a tween started past its end is at its target; `NaN` starts it from its start.
// - B26 (#706): a member's key another change moves steps on a frame at its first step; a later change's keys
//   start from their start; a member that leaves before its first step leaves its slot's next one alone.
// - B27 (#706): a step of 0 s moves no member, whether its keys run the Batch's own spring or each its
//   own transition (a Clock's tick can be 0 s: a repeated timestamp).
// - B28 (#706): a 0 s tween lands as its delay ends, at that very time: a step of 0 s after its change,
//   and a start partway at 0 s, draw its target (a skipped change's, and reduced motion's Snap, from the
//   first stop of an Appear rule, as an element's); held by a delay, not before it ends.
// - B29: a member a step doesn't move isn't written: one waiting out its delay, until it moves, but once at
//   its first step after it enters, so a writer's first draw of it stands.
// - B30: a change that starts a member from a given value (`from`) has it written at its next step, though
//   it waits out a delay, and not again until it moves.
// - B31: a change paused on its Playhead writes nothing while it holds; a seek while paused is written at
//   the next step, and so is a stop, which rests it where it is.
import * as Batch from "@wardic/core/Batch"
import * as Clock from "@wardic/core/Clock"
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as Machine from "@wardic/core/Machine"
import * as Playback from "@wardic/core/Playback"
import * as Stagger from "@wardic/core/Stagger"
import { it as effect } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Stream from "effect/Stream"
import { describe, expect, expectTypeOf, it } from "vitest"

const F = 1 / 60

/** A Clock whose ticks the test pushes, each handled inside the push, as `@wardic/test`'s `pushable` is. */
const pushable = Effect.fnUntraced(function* () {
  const pubsub = yield* PubSub.unbounded<number>()
  const clock = Layer.succeed(Clock.Clock, { ticks: Stream.fromPubSub(pubsub), tick: () => Effect.void, now: () => 0 })
  return { loop: FrameLoop.layer.pipe(Layer.provideMerge(clock)), advance: () => PubSub.publish(pubsub, F) }
})

/** A writer that draws nothing: what each frame wrote, per subject, as a copy of its values. */
const recording = <S,>() => {
  const writes: Array<{ readonly subject: S; readonly values: Record<string, number> }> = []
  const writer: Batch.Writer<S> = {
    writes: () => true,
    forKeys: (order) => (subject, positions, base) => {
      const values: Record<string, number> = {}
      order.forEach((key, k) => {
        values[key] = positions[base + k]
      })
      writes.push({ subject, values })
    },
  }
  return { writer, writes }
}

/** `batch`'s value for `key` at `slot` each step, until it rests: its frames. */
const stepped = <S,>(batch: Batch.Batch<S>, slot: number, key: string, limit = 600): Array<number> => {
  const out: Array<number> = []
  Array.from({ length: limit }).some(() => {
    const done = Batch.step(batch, F)
    out.push(Batch.get(batch, slot, key))
    return done
  })
  return out
}

/**
 * Every member's value for `key` each step until the Batch rests, by slot: a member that lands first
 * holds its target to the end.
 */
const steppedAll = <S,>(batch: Batch.Batch<S>, slots: ReadonlyArray<number>, key: string): Array<Array<number>> => {
  const out = slots.map((): Array<number> => [])
  Array.from({ length: 600 }).some(() => {
    const done = Batch.step(batch, F)
    slots.forEach((slot, n) => out[n].push(Batch.get(batch, slot, key)))
    return done
  })
  return out
}

/** `frames`, held at its last value to `length`: a member that landed before the Batch rested. */
const heldTo = (frames: ReadonlyArray<number>, length: number): ReadonlyArray<number> =>
  Array.from({ length }, (_, i) => frames[Math.min(i, frames.length - 1)])

/** `Machine.tween`'s frames from `from` to `to`: a member's tween's oracle. */
const tweenFrames = (from: number, to: number, options: Machine.TweenOptions): ReadonlyArray<number> => {
  const step = Machine.tween(from, to, options).start()
  const out: Array<number> = []
  Array.from({ length: 600 }).some(() => {
    const frame = step(F)
    out.push(frame.value)
    return frame.done
  })
  return out
}

/** `springValues`' frames for one key, from `from` to `to`: the oracle a member's spring is held to. */
const springFrames = (key: string, from: number, to: number, options: Machine.SpringOptions, velocity = 0): ReadonlyArray<number> => {
  const step = Machine.springValues({ [key]: to }, options, { from: { [key]: from }, velocity: { [key]: velocity } }).start()
  const out: Array<number> = []
  Array.from({ length: 600 }).some(() => {
    const frame = step(F)
    out.push(frame.value[key] as number)
    return frame.done
  })
  return out
}

describe("a Batch (#665)", () => {
  it("B1: a member's spring lands frame for frame as springValues' does", () => {
    const spring = { stiffness: 210, damping: 20 }
    const { writer, writes } = recording<string>()
    const batch = Batch.make({ keys: ["x"], writer, transition: { type: "spring", ...spring } })
    const slot = Batch.enter(batch, "a", { x: 0 })
    Batch.retarget(batch, [slot], () => 100)
    const steps = stepped(batch, slot, "x")
    const oracle = springFrames("x", 0, 100, spring)
    expect(steps).toEqual(oracle)
    expect(writes.map((write) => write.values.x)).toEqual(oracle)
    expect(writes.every((write) => write.subject === "a")).toBe(true)
  })

  it("B2: a new target mid-flight turns it at the speed it has", () => {
    const spring = { stiffness: 210, damping: 20 }
    const { writer } = recording<string>()
    const batch = Batch.make({ keys: ["x"], writer, transition: { type: "spring", ...spring } })
    const slot = Batch.enter(batch, "a", { x: 0 })
    Batch.retarget(batch, [slot], () => 100)
    stepped(batch, slot, "x", 12)
    const position = Batch.get(batch, slot, "x")
    const velocity = Batch.velocity(batch, slot, "x")
    expect(velocity).toBeGreaterThan(100)
    Batch.retarget(batch, [slot], () => 40)
    expect(stepped(batch, slot, "x")).toEqual(springFrames("x", position, 40, spring, velocity))
  })

  it("B3: a tween as Machine.tween's; a new target starts again from where it is, a spring at its speed", () => {
    const tween = { duration: 0.3, ease: "easeOut" } as const
    const { writer } = recording<string>()
    const batch = Batch.make({ keys: ["x"], writer, transition: { type: "tween", ...tween } })
    const slot = Batch.enter(batch, "a", { x: 10 })
    Batch.retarget(batch, [slot], () => 110)
    expect(stepped(batch, slot, "x")).toEqual(tweenFrames(10, 110, tween))

    Batch.retarget(batch, [slot], () => 0)
    const early = stepped(batch, slot, "x", 6)
    expect(early).toEqual(tweenFrames(110, 0, tween).slice(0, 6))
    Batch.retarget(batch, [slot], () => 50)
    const at = Batch.get(batch, slot, "x")
    expect(stepped(batch, slot, "x")).toEqual(tweenFrames(at, 50, tween))

    // A spring takes over from a tween at the speed of its last frame.
    const spring = { type: "spring", stiffness: 210, damping: 20 } as const
    Batch.retarget(batch, [slot], () => 0)
    const before = stepped(batch, slot, "x", 6)
    const speed = (before[5] - before[4]) / F
    Batch.retarget(batch, [slot], () => 80, { transition: spring })
    const handed = Batch.velocity(batch, slot, "x")
    expect(handed).toBeCloseTo(speed, 9)
    expect(stepped(batch, slot, "x")).toEqual(springFrames("x", before[5], 80, spring, handed))
  })

  it("B4: members on different transitions step at once; a change can give one per key", () => {
    const soft = { type: "spring", stiffness: 120, damping: 14 } as const
    const stiff = { type: "spring", stiffness: 400, damping: 30 } as const
    const { writer } = recording<string>()
    const batch = Batch.make({ keys: ["x", "opacity"], writer, transition: soft })
    const a = Batch.enter(batch, "a", { x: 0, opacity: 1 })
    const b = Batch.enter(batch, "b", { x: 0, opacity: 1 })
    Batch.retarget(batch, [a], (_, k) => [200, Number.NaN][k])
    Batch.retarget(batch, [b], (_, k) => [200, Number.NaN][k], { transition: stiff })
    const [xa, xb] = steppedAll(batch, [a, b], "x")
    expect(xa).toEqual(springFrames("x", 0, 200, soft))
    expect(xb).toEqual(heldTo(springFrames("x", 0, 200, stiff), xa.length))
    expect(springFrames("x", 0, 200, stiff).length).toBeLessThan(xa.length)

    // One per key: `x` springs back as ever, while `opacity` holds 0.1 s and lands.
    const snap = { type: "tween", duration: 0, delay: 0.1 } as const
    Batch.retarget(batch, [a], (_, k) => [0, 0][k], { transition: { opacity: snap } })
    const x: Array<number> = []
    const opacity: Array<number> = []
    Array.from({ length: 600 }).some(() => {
      const done = Batch.step(batch, F)
      x.push(Batch.get(batch, a, "x"))
      opacity.push(Batch.get(batch, a, "opacity"))
      return done
    })
    expect(x).toEqual(springFrames("x", 200, 0, soft))
    expect(opacity).toEqual(heldTo(tweenFrames(1, 0, snap), x.length))
    // Held for its 0.1 s, then at its target from one frame to the next.
    const landed = opacity.indexOf(0)
    expect(landed).toBeGreaterThanOrEqual(5)
    expect(opacity.slice(0, landed).every((value) => value === 1)).toBe(true)
    expect(opacity.slice(landed).every((value) => value === 0)).toBe(true)
  })

  it("B5: a change's delay counts the members it moves; an unchanged member carries on", () => {
    const spring = { type: "spring", stiffness: 210, damping: 20 } as const
    const { writer, writes } = recording<number>()
    const batch = Batch.make({ keys: ["x"], writer, transition: spring })
    const slots = [0, 1, 2, 3, 4].map((n) => Batch.enter(batch, n, { x: 0 }))
    // Member 0 sets off for 50 three frames before the change, which leaves its target as it is.
    Batch.retarget(batch, [slots[0]], () => 50)
    Array.from({ length: 3 }).forEach(() => Batch.step(batch, F))
    writes.length = 0
    const delay = Stagger.make(0.05)
    const targets = [50, 0, 100, 100, 100]
    Batch.retarget(batch, slots, (slot) => targets[slot], { delay })
    const frames = steppedAll(batch, slots, "x")
    const length = frames[0].length
    expect(frames[0]).toEqual(heldTo(springFrames("x", 0, 50, spring).slice(3), length))
    // The three that move wait 0, 0.05 and 0.1 s: ranks 0, 1 and 2 of 3, not their indices 2, 3 and 4 of 5.
    const movers = [2, 3, 4]
    movers.forEach((slot, rank) => {
      expect(frames[slot]).toEqual(heldTo(springFrames("x", 0, 100, { ...spring, delay: delay(rank, 3) }), length))
    })
    expect(delay(0, 3)).toBe(0)
    // Member 1 never moved, so it was never written.
    expect(writes.some((write) => write.subject === 1)).toBe(false)
  })

  it("B6: entering past the capacity grows it, and every member carries on", () => {
    const spring = { type: "spring", stiffness: 210, damping: 20 } as const
    const { writer } = recording<string>()
    const batch = Batch.make({ keys: ["x", "y"], writer, transition: spring, capacity: 2 })
    const a = Batch.enter(batch, "a", { x: 0, y: 0 })
    const b = Batch.enter(batch, "b", { x: 0, y: 10 })
    Batch.retarget(batch, [a, b], (slot, k) => [[100, 50], [-40, 90]][slot][k])
    Array.from({ length: 5 }).forEach(() => Batch.step(batch, F))
    const c = Batch.enter(batch, "c", { x: 7, y: 8 })
    const d = Batch.enter(batch, "d", { x: 1, y: 2 })
    expect([c, d]).toEqual([2, 3])
    expect([Batch.get(batch, c, "x"), Batch.get(batch, c, "y"), Batch.velocity(batch, c, "x")]).toEqual([7, 8, 0])
    const values = { ax: [] as Array<number>, ay: [] as Array<number>, bx: [] as Array<number>, by: [] as Array<number> }
    Array.from({ length: 600 }).some(() => {
      const done = Batch.step(batch, F)
      values.ax.push(Batch.get(batch, a, "x"))
      values.ay.push(Batch.get(batch, a, "y"))
      values.bx.push(Batch.get(batch, b, "x"))
      values.by.push(Batch.get(batch, b, "y"))
      return done
    })
    const length = values.ax.length
    expect(values.ax).toEqual(heldTo(springFrames("x", 0, 100, spring).slice(5), length))
    expect(values.ay).toEqual(heldTo(springFrames("y", 0, 50, spring).slice(5), length))
    expect(values.bx).toEqual(heldTo(springFrames("x", 0, -40, spring).slice(5), length))
    expect(values.by).toEqual(heldTo(springFrames("y", 10, 90, spring).slice(5), length))
  })

  it("B7: a member that leaves isn't written again, and its slot goes to the next, from its own start", () => {
    const spring = { type: "spring", stiffness: 210, damping: 20 } as const
    const { writer, writes } = recording<string>()
    const batch = Batch.make({ keys: ["x"], writer, transition: spring })
    const a = Batch.enter(batch, "a", { x: 0 })
    const b = Batch.enter(batch, "b", { x: 0 })
    Batch.retarget(batch, [a, b], () => 100)
    Array.from({ length: 5 }).forEach(() => Batch.step(batch, F))
    Batch.leave(batch, a)
    writes.length = 0
    const c = Batch.enter(batch, "c", { x: 30 })
    expect(c).toBe(a)
    expect([Batch.get(batch, c, "x"), Batch.velocity(batch, c, "x")]).toEqual([30, 0])
    const [bx, cx] = steppedAll(batch, [b, c], "x")
    expect(bx).toEqual(springFrames("x", 0, 100, spring).slice(5))
    expect(cx.every((x) => x === 30)).toBe(true)
    expect(writes.some((write) => write.subject === "a")).toBe(false)
    // The one that took the slot moves when it's given a target, from where it started.
    Batch.retarget(batch, [c], () => 60)
    expect(steppedAll(batch, [c], "x")[0]).toEqual(springFrames("x", 30, 60, spring))
  })

  effect.effect("B8: Batch.run: one run while anything moves, onFrame once a tick, ended at rest", () =>
    Effect.gen(function* () {
      const spring = { type: "spring", stiffness: 210, damping: 20 } as const
      const { loop, advance } = yield* pushable()
      const context = yield* Layer.build(loop)
      const { writer } = recording<string>()
      let frames = 0
      let onLanding = (): void => {}
      const batch = Batch.make({
        keys: ["x"], writer, transition: spring,
        onFrame: () => {
          frames++
          onLanding()
        },
      })
      const slot = Batch.enter(batch, "a", { x: 0 })
      const xs: Array<number> = []
      const advanceAll = (count: number) =>
        Effect.forEach(Array.from({ length: count }), () => advance().pipe(Effect.andThen(Effect.sync(() => xs.push(Batch.get(batch, slot, "x"))))))

      Batch.retarget(batch, [slot], () => 100)
      const first = yield* Effect.forkChild(Effect.provide(Batch.run(batch), context), { startImmediately: true })
      // A second run while one runs does nothing: the member would step twice a tick.
      yield* Effect.provide(Batch.run(batch), context)
      const there = springFrames("x", 0, 100, spring)
      yield* advanceAll(there.length)
      expect(xs).toEqual(there)
      expect(frames).toBe(there.length)
      // At rest, the run has ended: joined without another tick.
      yield* Fiber.join(first)

      // A change after rest starts the next run, which moves it on the next tick.
      xs.length = 0
      Batch.retarget(batch, [slot], () => 0)
      const second = yield* Effect.forkChild(Effect.provide(Batch.run(batch), context), { startImmediately: true })
      // As it lands, a change from `onFrame` turns it again, in the same run.
      onLanding = () => {
        if (Batch.get(batch, slot, "x") !== 0) return
        onLanding = () => {}
        Batch.retarget(batch, [slot], () => 30)
      }
      const back = springFrames("x", 100, 0, spring)
      const again = springFrames("x", 0, 30, spring)
      yield* advanceAll(back.length + again.length)
      expect(xs).toEqual([...back, ...again])
      yield* Fiber.join(second)
      expect(frames).toBe(there.length + back.length + again.length)
    }).pipe(Effect.scoped))

  it("B9: what a Batch can't run throws an OptionError naming it", () => {
    const spring = { type: "spring" } as const
    const { writer } = recording<string>()
    const drawsX: Batch.Writer<string> = { ...writer, writes: (key) => key === "x" }
    expect(() => Batch.make({ keys: ["x", "color"], writer: drawsX, transition: spring })).toThrow(Machine.OptionError)
    expect(() => Batch.make({ keys: ["x", "color"], writer: drawsX, transition: spring })).toThrow(/"color"/)
    const inertia = { type: "inertia" } as unknown as Batch.Transition
    expect(() => Batch.make({ keys: ["x"], writer, transition: inertia })).toThrow(Machine.OptionError)
    expect(() => Batch.make({ keys: ["x"], writer, transition: inertia })).toThrow(/"spring" \| "tween"/)
    expect(() => Batch.make({ keys: ["x"], writer, transition: { type: "spring", stiffness: -1 } })).toThrow(/stiffness/)
    const batch = Batch.make({ keys: ["x"], writer, transition: spring })
    const slot = Batch.enter(batch, "a", { x: 0 })
    expect(() => Batch.retarget(batch, [slot], () => 1, { transition: { type: "tween", duration: -1 } })).toThrow(/duration/)
  })

  it("B10: each dual operation's two forms give one type, and pipe runs the data-last form", () => {
    const { writer } = recording<string>()
    const batch = Batch.make({ keys: ["x"], writer, transition: { type: "spring" } })
    expectTypeOf(Batch.enter(batch, "a", { x: 0 })).toEqualTypeOf(batch.pipe(Batch.enter("b", { x: 0 })))
    expectTypeOf(Batch.retarget(batch, [0], () => 1)).toEqualTypeOf(batch.pipe(Batch.retarget([1], () => 1, { delay: 0.1 })))
    expectTypeOf(Batch.retarget(batch, [0], () => 1)).toEqualTypeOf<number>()
    expectTypeOf(Batch.leave(batch, 0)).toEqualTypeOf(batch.pipe(Batch.leave(1)))
    // Through pipe: "c" takes the slot "b" left, and its change reaches it.
    const slot = batch.pipe(Batch.enter("c", { x: 5 }))
    expect(slot).toBe(1)
    expect(Batch.get(batch, slot, "x")).toBe(5)
    expect(Batch.isBatch(batch)).toBe(true)
    expect(Batch.isBatch({ keys: ["x"] })).toBe(false)
  })

  it("B11: a spring set by duration starts from rest and lands at its duration, as springValues'", () => {
    const timed = { type: "spring", duration: 0.4, bounce: 0.2 } as const
    const { writer } = recording<string>()
    const batch = Batch.make({ keys: ["x"], writer, transition: { type: "spring", stiffness: 210, damping: 20 } })
    const slot = Batch.enter(batch, "a", { x: 0 })
    Batch.retarget(batch, [slot], () => 100)
    Array.from({ length: 5 }).forEach(() => Batch.step(batch, F))
    const at = Batch.get(batch, slot, "x")
    expect(Batch.velocity(batch, slot, "x")).toBeGreaterThan(0)
    Batch.retarget(batch, [slot], () => 300, { transition: timed })
    const xs = stepped(batch, slot, "x")
    expect(xs).toEqual(springFrames("x", at, 300, timed))
    // About 0.4 s at 60 Hz, landing exactly.
    expect(Math.abs(xs.length - 24)).toBeLessThanOrEqual(1)
    expect(xs[xs.length - 1]).toBe(300)
  })

  it("B12: at rest a Batch forgets the transitions its changes gave; a member that left takes no change", () => {
    const { writer, writes } = recording<string>()
    const batch = Batch.make({ keys: ["x"], writer, transition: { type: "spring" } })
    const slot = Batch.enter(batch, "a", { x: 0 })
    Array.from({ length: 3 }).forEach((_, n) => {
      Batch.retarget(batch, [slot], () => n + 1, { transition: { type: "tween", duration: 0 } })
    })
    // Each change's bag replaces the last on the key, which frees it: the Batch's own and the latest.
    expect(batch.toJSON()).toMatchObject({ transitions: 2, moving: 1 })
    stepped(batch, slot, "x")
    expect(Batch.get(batch, slot, "x")).toBe(3)
    expect(batch.toJSON()).toMatchObject({ transitions: 1, moving: 0 })
    // A spring after the reset is the Batch's own again, by its fast loop's frames.
    Batch.retarget(batch, [slot], () => 50)
    expect(stepped(batch, slot, "x")).toEqual(springFrames("x", 3, 50, {}))

    Batch.leave(batch, slot)
    writes.length = 0
    Batch.retarget(batch, [slot], () => 0)
    expect(batch.toJSON()).toMatchObject({ moving: 0 })
    expect(Batch.step(batch, F)).toBe(true)
    expect(writes.length).toBe(0)
  })

  it("B13: after a spring set by duration, a change to another key rests, and so does the slot's next member", () => {
    const timed = { type: "spring", duration: 0.3 } as const
    const { writer } = recording<string>()
    const batch = Batch.make({ keys: ["x", "y"], writer, transition: { type: "spring" } })
    const a = Batch.enter(batch, "a", { x: 0, y: 0 })
    Batch.retarget(batch, [a], () => 100, { transition: timed })
    stepped(batch, a, "x")
    Batch.retarget(batch, [a], (_, k) => [200, Number.NaN][k])
    expect(stepped(batch, a, "x")).toEqual(springFrames("x", 100, 200, {}))
    Batch.leave(batch, a)
    const b = Batch.enter(batch, "b", { x: 0, y: 0 })
    expect(b).toBe(a)
    Batch.retarget(batch, [b], (_, k) => [50, Number.NaN][k])
    expect(stepped(batch, b, "x")).toEqual(springFrames("x", 0, 50, {}))
  })

  it("B14: a change that moves nothing keeps no transition; a Batch that never rests holds only those its keys run", () => {
    const { writer } = recording<string>()
    const batch = Batch.make({ keys: ["x"], writer, transition: { type: "spring" } })
    const slot = Batch.enter(batch, "a", { x: 0 })
    Array.from({ length: 100 }).forEach(() => Batch.retarget(batch, [slot], () => 0, { transition: { type: "spring", stiffness: 300 } }))
    expect(batch.toJSON()).toMatchObject({ transitions: 1, moving: 0 })
    // A pointer's every move, each with a bag of its own, for 200 frames: it never rests.
    Array.from({ length: 200 }).forEach((_, n) => {
      Batch.retarget(batch, [slot], () => 100 + n, { transition: { type: "spring", stiffness: 300 } })
      Batch.step(batch, F)
    })
    expect(batch.toJSON()).toMatchObject({ transitions: 2, moving: 1 })
    stepped(batch, slot, "x")
    expect(Batch.get(batch, slot, "x")).toBe(299)
    expect(batch.toJSON()).toMatchObject({ transitions: 1, moving: 0 })
  })

  it("B15: get and velocity name a key the Batch lacks; a slot given twice moves once, counted once", () => {
    const { writer } = recording<string>()
    const batch = Batch.make({ keys: ["x"], writer, transition: { type: "spring" } })
    const a = Batch.enter(batch, "a", { x: 0 })
    const b = Batch.enter(batch, "b", { x: 0 })
    expect(() => Batch.get(batch, a, "y")).toThrow(/"y"/)
    expect(() => Batch.velocity(batch, a, "y")).toThrow(/"y"/)
    const delay = Stagger.make(0.1)
    Batch.retarget(batch, [a, a, b], () => 100, { delay })
    const [xa, xb] = steppedAll(batch, [a, b], "x")
    expect(xa).toEqual(heldTo(springFrames("x", 0, 100, {}), xa.length))
    expect(xb).toEqual(heldTo(springFrames("x", 0, 100, { delay: delay(1, 2) }), xa.length))
  })

  it("B16: a Batch's own transition can be one per key, with a default; a key with neither is named", () => {
    const soft = { type: "spring", stiffness: 120, damping: 14 } as const
    const fade = { type: "tween", duration: 0.2 } as const
    const { writer } = recording<string>()
    const batch = Batch.make({ keys: ["x", "opacity"], writer, transition: { default: soft, opacity: fade } })
    const slot = Batch.enter(batch, "a", { x: 0, opacity: 1 })
    Batch.retarget(batch, [slot], (_, k) => [80, 0][k])
    const x: Array<number> = []
    const opacity: Array<number> = []
    Array.from({ length: 600 }).some(() => {
      const done = Batch.step(batch, F)
      x.push(Batch.get(batch, slot, "x"))
      opacity.push(Batch.get(batch, slot, "opacity"))
      return done
    })
    expect(x).toEqual(springFrames("x", 0, 80, soft))
    expect(opacity).toEqual(heldTo(tweenFrames(1, 0, fade), x.length))
    // Its own transitions stay when it rests: they're not a change's.
    expect(batch.toJSON()).toMatchObject({ transitions: 2 })
    expect(() => Batch.make({ keys: ["x", "y"], writer, transition: { x: soft } })).toThrow(Machine.OptionError)
    expect(() => Batch.make({ keys: ["x", "y"], writer, transition: { x: soft } })).toThrow(/\["y"\]/)
  })

  it("B17: a change gives each member's key its own transition by a function; members on one bag share it", () => {
    const soft = { type: "spring", stiffness: 120, damping: 14 } as const
    const stiff = { type: "spring", stiffness: 550, damping: 30 } as const
    const { writer } = recording<string>()
    const batch = Batch.make({ keys: ["scale"], writer, transition: soft })
    const slots = ["a", "b", "c"].map((name) => Batch.enter(batch, name, { scale: 1 }))
    // As the DOM's Default transition does: a scale toward 0 on a spring of its own.
    const targets = [0, 2, 0]
    Batch.retarget(batch, slots, (slot) => targets[slot], { transition: (slot) => [stiff, soft, stiff][slot] })
    expect(batch.toJSON()).toMatchObject({ transitions: 2, moving: 3 })
    const frames = steppedAll(batch, slots, "scale")
    const length = frames[0].length
    expect(frames[0]).toEqual(heldTo(springFrames("scale", 1, 0, stiff), length))
    expect(frames[1]).toEqual(heldTo(springFrames("scale", 1, 2, soft), length))
    expect(frames[2]).toEqual(heldTo(springFrames("scale", 1, 0, stiff), length))
  })

  it("B18: a change says how many members it sets off from rest; isMoving whether any moves", () => {
    const { writer } = recording<string>()
    const batch = Batch.make({ keys: ["x"], writer, transition: { type: "spring" } })
    const slots = ["a", "b", "c"].map((name) => Batch.enter(batch, name, { x: 0 }))
    expect(Batch.isMoving(batch)).toBe(false)
    expect(Batch.retarget(batch, slots, (slot) => [0, 10, 20][slot])).toBe(2)
    expect(Batch.isMoving(batch)).toBe(true)
    Batch.step(batch, F)
    // Two already moving and one at rest: one sets off.
    expect(Batch.retarget(batch, slots, (slot) => [5, 15, 25][slot])).toBe(1)
    stepped(batch, slots[0], "x")
    expect(Batch.isMoving(batch)).toBe(false)
  })

  it("B19: a member's Subject replaced mid-flight carries on exactly as it would have", () => {
    const spring = { type: "spring", stiffness: 210, damping: 20 } as const
    const { writer, writes } = recording<string>()
    const batch = Batch.make({ keys: ["x"], writer, transition: spring })
    const slot = Batch.enter(batch, "a", { x: 0 })
    Batch.retarget(batch, [slot], () => 100, { delay: 0.05 })
    Array.from({ length: 6 }).forEach(() => Batch.step(batch, F))
    Batch.replace(batch, slot, "b")
    writes.length = 0
    const rest = stepped(batch, slot, "x")
    expect(rest).toEqual(springFrames("x", 0, 100, { ...spring, delay: 0.05 }).slice(6))
    expect(writes.every((write) => write.subject === "b")).toBe(true)
    expect(writes.length).toBe(rest.length)
  })

  it("B20: a change starts keys from given values and speeds, onto the same targets too", () => {
    const { writer } = recording<string>()
    const spring = { type: "spring", stiffness: 210, damping: 20 } as const
    const batch = Batch.make({ keys: ["x", "y"], writer, transition: spring })
    const a = Batch.enter(batch, "a", { x: 100, y: 0 })
    const b = Batch.enter(batch, "b", { x: 0, y: 0 })
    // a rests at 100, its target; b at 0. Handed back: a from 40 at 300 px/s toward its 100; b's y from 20 at -50.
    const from = (slot: number, k: number): number => [[40, Number.NaN], [Number.NaN, 20]][slot][k]
    const velocity = (slot: number, k: number): number => [[300, 0], [0, -50]][slot][k]
    expect(Batch.retarget(batch, [a, b], () => Number.NaN, { from, velocity })).toBe(2)
    // Their targets kept: what `target` reads.
    expect([Batch.target(batch, a, "x"), Batch.target(batch, b, "y")]).toEqual([100, 0])
    const [ax, bx] = steppedAll(batch, [a, b], "x")
    const oracle = springFrames("x", 40, 100, spring, 300)
    expect(ax.length).toBe(oracle.length)
    ax.forEach((x, f) => expect(x, `frame ${f}`).toBeCloseTo(oracle[f], 9))
    // b's x wasn't given: it stays.
    bx.forEach((x) => expect(x).toBe(0))
  })

  it("B21: a key no change has turned since its member entered stays at its start while another key tweens", () => {
    const { writer } = recording<string>()
    const tween = { type: "tween", duration: 0.3 } as const
    const grid = Batch.make({ keys: ["y", "opacity"], writer, transition: tween })
    const a = Batch.enter(grid, "a", { y: 60, opacity: 1 })
    // A slot given back and taken again: its start is the new member's, whatever its last one tweened.
    const gone = Batch.enter(grid, "gone", { y: 0, opacity: 0.2 })
    Batch.retarget(grid, [gone], (_, k) => [Number.NaN, 0.9][k])
    stepped(grid, gone, "opacity")
    Batch.leave(grid, gone)
    const b = Batch.enter(grid, "b", { y: 120, opacity: 1 })
    Batch.retarget(grid, [a, b], (_, k) => [0, Number.NaN][k])
    const frames = steppedAll(grid, [a, b], "opacity")
    frames.forEach((member, n) => member.forEach((opacity, f) => expect(opacity, `member ${n}, frame ${f}`).toBe(1)))
    expect(Batch.get(grid, a, "y"), "y tweened").toBe(0)
  })

  it("B22: draw writes every member where it is, with no step, and flushes; a member that left isn't written", () => {
    const writes: Array<string> = []
    let flushes = 0
    const writer: Batch.Writer<string> = {
      writes: () => true,
      forKeys: () => (subject, positions, base) => void writes.push(`${subject} ${positions[base]}`),
      flush: () => void flushes++,
    }
    const grid = Batch.make({ keys: ["x"], writer, transition: { type: "tween", duration: 0.3 } })
    const a = Batch.enter(grid, "a", { x: 0 })
    const b = Batch.enter(grid, "b", { x: 0 })
    const gone = Batch.enter(grid, "gone", { x: 0 })
    Batch.leave(grid, gone)
    // Started from its targets: there now, before any step.
    Batch.retarget(grid, [a, b], (slot) => [40, 80][slot], { from: (slot) => [40, 80][slot] })
    writes.length = 0
    Batch.draw(grid)
    expect(writes).toEqual(["a 40", "b 80"])
    expect(flushes, "flushed once").toBe(1)
  })

  it("B23: a change started partway draws each member at its first step where one stepped from its start is", () => {
    const spring = { type: "spring", stiffness: 210, damping: 20 } as const
    const { writer, writes } = recording<string>()
    const batch = Batch.make({ keys: ["x"], writer, transition: spring })
    const ahead = Batch.enter(batch, "ahead", { x: 0 })
    const late = Batch.enter(batch, "late", { x: 0 })
    // `ahead` runs from the change's start; `late` starts 18 frames in, read at its first step.
    Batch.retarget(batch, [ahead], () => 100)
    const before = stepped(batch, ahead, "x", 18)
    const speed = Batch.velocity(batch, ahead, "x")
    const reads: Array<number> = []
    Batch.retarget(batch, [late], () => 100, {
      startAt: (slot) => {
        reads.push(slot)
        return 18 * F
      },
    })
    expect(reads, "not read at the change").toEqual([])
    writes.length = 0
    Batch.step(batch, F)
    expect(reads, "read once, at its first step").toEqual([late])
    // Drawn there in that step, at that speed: the step doesn't also move it on by the frame.
    expect(Batch.get(batch, late, "x")).toBeCloseTo(before[17], 9)
    expect(Batch.velocity(batch, late, "x")).toBeCloseTo(speed, 6)
    const drawn = writes.filter((write) => write.subject === "late")
    expect(drawn, "written once in that step").toHaveLength(1)
    expect(drawn[0].values.x).toBeCloseTo(before[17], 9)
    // Then frame for frame as the member that ran from the start, one frame behind it.
    const rest = springFrames("x", 0, 100, spring).slice(18)
    const frames = stepped(batch, late, "x")
    frames.forEach((value, i) => expect(value, `frame ${i}`).toBeCloseTo(rest[i], 9))
    expect(frames.length).toBe(rest.length)
    expect(reads, "read only once").toEqual([late])
  })

  it("B24: a tween, a spring set by duration and a stagger's delays, each started partway as from the start", () => {
    const transitions = [
      { type: "tween", duration: 0.5, ease: "easeInOut" },
      { type: "spring", duration: 0.6, bounce: 0.3 },
      { type: "spring", stiffness: 300, damping: 18 },
    ] as const
    // A stagger's delays, 0.1 s apart: 9 frames in, the third still waits out its 0.2 s; or one for all.
    const delays = [Stagger.make(0.1), 0.05]
    transitions.flatMap((transition) => delays.map((delay) => [transition, delay] as const)).forEach(([transition, delay]) => {
      const frames = (startAt: number | undefined): Array<ReadonlyArray<number>> => {
        const { writer } = recording<number>()
        const batch = Batch.make({ keys: ["x", "opacity"], writer, transition })
        const slots = [0, 1, 2].map((n) => Batch.enter(batch, n, { x: 0, opacity: 0 }))
        const targetOf = (slot: number, k: number): number => [100 * (slot + 1), 1][k]
        if (startAt === undefined) Batch.retarget(batch, slots, targetOf, { delay })
        if (startAt !== undefined) Batch.retarget(batch, slots, targetOf, { delay, startAt: () => startAt })
        const out: Array<ReadonlyArray<number>> = []
        Array.from({ length: 600 }).some(() => {
          const done = Batch.step(batch, F)
          out.push(slots.flatMap((slot) => [Batch.get(batch, slot, "x"), Batch.get(batch, slot, "opacity"), Batch.velocity(batch, slot, "x")]))
          return done
        })
        return out
      }
      const fromStart = frames(undefined)
      const late = frames(9 * F)
      // Its first step draws the 9th frame, then frame for frame on, to the same landing.
      const oracle = fromStart.slice(8)
      expect(late.length, `${transition.type}: lands as from the start`).toBe(oracle.length)
      late.forEach((frame, i) => frame.forEach((value, j) => expect(value, `${JSON.stringify(transition)}, ${String(delay)}: frame ${i}, ${j}`).toBeCloseTo(oracle[i][j], 6)))
      expect(late[0][3]).toBeGreaterThan(0)
    })
    // The stagger's third member hasn't moved at 9 frames: its 0.2 s holds it.
    const { writer } = recording<number>()
    const held = Batch.make({ keys: ["x"], writer, transition: transitions[2] })
    const slots = [0, 1, 2].map((n) => Batch.enter(held, n, { x: 0 }))
    Batch.retarget(held, slots, (slot) => 100 * (slot + 1), { delay: Stagger.make(0.1), startAt: () => 9 * F })
    Batch.step(held, F)
    expect(Batch.get(held, slots[2], "x")).toBe(0)
    expect(Batch.get(held, slots[1], "x")).toBeGreaterThan(0)
  })

  it("B25: started past its rest a spring is drawn unlanded and lands at its next step; a tween at its end; NaN from its start", () => {
    const spring = { type: "spring", stiffness: 210, damping: 20 } as const
    const oracle = springFrames("x", 0, 100, spring)
    // The frame it lands at, from the start: just before, it's within its thresholds but not there.
    const lands = oracle.indexOf(100)
    expect(oracle[lands - 1]).not.toBe(100)
    const { writer } = recording<string>()
    const batch = Batch.make({ keys: ["x"], writer, transition: spring })
    const slot = Batch.enter(batch, "a", { x: 0 })
    Batch.retarget(batch, [slot], () => 100, { startAt: () => (lands + 1) * F })
    expect(Batch.step(batch, F), "still moving after its first step").toBe(false)
    const drawn = Batch.get(batch, slot, "x")
    expect(drawn).not.toBe(100)
    expect(Math.abs(drawn - 100)).toBeLessThan(0.5)
    expect(Batch.step(batch, F), "at rest after its next").toBe(true)
    expect(Batch.get(batch, slot, "x")).toBe(100)

    // A tween started past its end is there at its first step, at rest at its next.
    const tweened = Batch.make({ keys: ["x"], writer, transition: { type: "tween", duration: 0.3 } })
    const t = Batch.enter(tweened, "t", { x: 10 })
    Batch.retarget(tweened, [t], () => 60, { startAt: () => 2 })
    Batch.step(tweened, F)
    expect(Batch.get(tweened, t, "x")).toBe(60)
    expect(Batch.velocity(tweened, t, "x")).toBe(0)
    expect(Batch.step(tweened, F)).toBe(true)

    // `NaN`: from its start, frame for frame as a change with no `startAt`.
    const fromStart = Batch.make({ keys: ["x"], writer, transition: spring })
    const n = Batch.enter(fromStart, "n", { x: 0 })
    Batch.retarget(fromStart, [n], () => 100, { startAt: () => Number.NaN })
    expect(stepped(fromStart, n, "x")).toEqual(oracle)
  })

  it("B26: a key another change moves steps on a frame; a later change's keys start from their start; a leaver's start isn't its slot's next", () => {
    const spring = { type: "spring", stiffness: 210, damping: 20 } as const
    const { writer } = recording<string>()
    const batch = Batch.make({ keys: ["x", "y"], writer, transition: spring })
    const a = Batch.enter(batch, "a", { x: 0, y: 0 })
    // `y` sets off from the start; 5 frames on, a change starts `x` 12 frames in, `y` left moving.
    Batch.retarget(batch, [a], (_, k) => [Number.NaN, 50][k])
    Array.from({ length: 5 }).forEach(() => Batch.step(batch, F))
    Batch.retarget(batch, [a], (_, k) => [100, Number.NaN][k], { startAt: () => 12 * F })
    Batch.step(batch, F)
    expect(Batch.get(batch, a, "x")).toBeCloseTo(springFrames("x", 0, 100, spring)[11], 9)
    expect(Batch.get(batch, a, "y")).toBeCloseTo(springFrames("y", 0, 50, spring)[5], 9)

    // A change that turns `y` before the member's first step: `x` still starts 12 frames in, `y` from its start.
    const b = Batch.enter(batch, "b", { x: 0, y: 0 })
    Batch.retarget(batch, [b], (_, k) => [100, 50][k], { startAt: () => 12 * F })
    Batch.retarget(batch, [b], (_, k) => [Number.NaN, 80][k])
    Batch.step(batch, F)
    expect(Batch.get(batch, b, "x")).toBeCloseTo(springFrames("x", 0, 100, spring)[11], 9)
    expect(Batch.get(batch, b, "y")).toBeCloseTo(springFrames("y", 0, 80, spring)[0], 9)

    // A member that leaves before its first step: the next in its slot moves from its own start.
    const reads: Array<number> = []
    const gone = Batch.enter(batch, "gone", { x: 0, y: 0 })
    Batch.retarget(batch, [gone], (_, k) => [100, 50][k], {
      startAt: (slot) => {
        reads.push(slot)
        return 12 * F
      },
    })
    Batch.leave(batch, gone)
    const next = Batch.enter(batch, "next", { x: 0, y: 0 })
    expect(next).toBe(gone)
    Batch.retarget(batch, [next], (_, k) => [100, Number.NaN][k])
    const frames = stepped(batch, next, "x")
    expect(frames).toEqual(heldTo(springFrames("x", 0, 100, spring), frames.length))
    expect(reads, "the leaver's start, never read").toEqual([])
  })

  it("B27: a step of 0 s moves no member, on the Batch's own spring or on a transition a key", () => {
    const spring = { type: "spring", stiffness: 210, damping: 20 } as const
    const transitions = [spring, { default: spring, opacity: { type: "tween", duration: 0.3 } }] as const
    transitions.forEach((transition) => {
      const { writer } = recording<string>()
      const batch = Batch.make({ keys: ["x", "opacity"], writer, transition })
      const slot = Batch.enter(batch, "a", { x: 0, opacity: 0 })
      Batch.retarget(batch, [slot], (_, k) => [400, 1][k])
      expect(Batch.step(batch, 0), "still moving").toBe(false)
      expect(Batch.get(batch, slot, "x"), `${JSON.stringify(transition)}: x where it was`).toBe(0)
      expect(Batch.get(batch, slot, "opacity")).toBe(0)
      // Then frame for frame as if the 0 s step had never come.
      expect(stepped(batch, slot, "x")).toEqual(springFrames("x", 0, 400, spring))
    })
  })

  it("B28: a 0 s tween lands as its delay ends, at that very time", () => {
    const { writer } = recording<string>()
    const snap = { type: "tween", duration: 0 } as const
    const transition = { x: snap, opacity: { type: "tween", duration: 0.3 } } as const
    const batch = Batch.make({ keys: ["x", "opacity"], writer, transition })
    const slot = Batch.enter(batch, "a", { x: 0, opacity: 0 })
    Batch.retarget(batch, [slot], (_, k) => [100, 1][k])
    Batch.step(batch, 0)
    expect(Batch.get(batch, slot, "x"), "at its target at 0 s").toBe(100)
    // Started partway at 0 s: there too.
    const late = Batch.make({ keys: ["x", "opacity"], writer, transition })
    const member = Batch.enter(late, "b", { x: 0, opacity: 0 })
    Batch.retarget(late, [member], (_, k) => [100, 1][k], { startAt: () => 0 })
    Batch.step(late, F)
    expect(Batch.get(late, member, "x")).toBe(100)
    // Held by a delay, it lands as the delay ends, not before.
    const held = Batch.make({ keys: ["x", "opacity"], writer, transition: { x: { ...snap, delay: 0.1 }, opacity: snap } })
    const waits = Batch.enter(held, "c", { x: 0, opacity: 0 })
    Batch.retarget(held, [waits], (_, k) => [100, 1][k], { startAt: () => 0.05 })
    Batch.step(held, F)
    expect(Batch.get(held, waits, "x")).toBe(0)
  })
  const STEADY = { type: "spring", stiffness: 210, damping: 20 } as const

  /** Each step's written subjects, in order: `count` steps of `batch` by a frame. */
  const writtenEach = <S,>(batch: Batch.Batch<S>, writes: ReadonlyArray<{ readonly subject: S }>, count: number): Array<Array<S>> =>
    Array.from({ length: count }, () => {
      const from = writes.length
      Batch.step(batch, F)
      return writes.slice(from).map((w) => w.subject)
    })

  it("B29: a member a step doesn't move isn't written; one that just entered is, once, though it waits", () => {
    const { writer, writes } = recording<number>()
    const batch = Batch.make({ keys: ["x"], writer, transition: STEADY })
    const slots = [0, 1, 2].map((n) => Batch.enter(batch, n, { x: 0 }))
    // Member 0 sets off now, member 1 after 5 frames, member 2 after 10.
    Batch.retarget(batch, slots, () => 50, { delay: (rank) => rank * 5 * F })
    const each = writtenEach(batch, writes, 14)
    // Its first step writes every member it entered, at its start: a writer's first draw of it stands.
    expect(each[0]).toEqual([0, 1, 2])
    // Then a member waiting out its delay isn't written, until it moves.
    each.slice(1, 4).forEach((subjects, f) => expect(subjects, `step ${f + 2}`).toEqual([0]))
    each.slice(6, 9).forEach((subjects, f) => expect(subjects, `step ${f + 7}`).toEqual([0, 1]))
    each.slice(11).forEach((subjects, f) => expect(subjects, `step ${f + 12}`).toEqual([0, 1, 2]))
  })

  it("B30: a change from a given value is written at its next step though it waits, then not until it moves", () => {
    const { writer, writes } = recording<string>()
    const batch = Batch.make({ keys: ["x"], writer, transition: STEADY })
    const slot = Batch.enter(batch, "a", { x: 0 })
    Batch.retarget(batch, [slot], () => 10)
    Array.from({ length: 200 }).some(() => Batch.step(batch, F))
    expect(Batch.get(batch, slot, "x")).toBe(10)
    // Taken back from 30, toward 40, after 4 frames: drawn at 30 at once, then held there unwritten.
    Batch.retarget(batch, [slot], () => 40, { from: () => 30, delay: 4 * F })
    const from = writes.length
    const each = writtenEach(batch, writes, 6)
    expect(each[0]).toEqual(["a"])
    expect(writes[from].values.x).toBe(30)
    each.slice(1, 3).forEach((subjects, f) => expect(subjects, `step ${f + 2}`).toEqual([]))
    expect(each[5]).toEqual(["a"])
  })

  it("B31: paused on its Playhead, a change writes nothing; a seek is written at the next step, and so is a stop", () => {
    const { writer, writes } = recording<string>()
    const batch = Batch.make({ keys: ["x"], writer, transition: STEADY })
    const slot = Batch.enter(batch, "a", { x: 0 })
    const head = Playback.make()
    const animation = Batch.animate(batch, [slot], () => 100, { transition: STEADY, head })
    Batch.play(animation)
    writtenEach(batch, writes, 4)
    Playback.pause(head)
    const at = Batch.get(batch, slot, "x")
    // Paused: every member still, nothing written.
    expect(writtenEach(batch, writes, 5)).toEqual([[], [], [], [], []])
    // A seek while paused, played from there as a binding's track plays it: written once, where it has it.
    Playback.seek(head, 12 * F)
    Batch.play(animation)
    expect(writtenEach(batch, writes, 3)).toEqual([["a"], [], []])
    expect(Batch.get(batch, slot, "x")).not.toBe(at)
    // A stop: written once more, where it is, and at rest.
    const stopped = Batch.get(batch, slot, "x")
    Batch.stop(animation)
    expect(writtenEach(batch, writes, 2)).toEqual([["a"], []])
    expect(writes.at(-1)?.values.x).toBe(stopped)
    expect(Batch.isMoving(batch)).toBe(false)
  })
})
