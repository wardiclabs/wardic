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
import * as Batch from "@wardic/core/Batch"
import * as Clock from "@wardic/core/Clock"
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as Machine from "@wardic/core/Machine"
import * as Stagger from "@wardic/core/Stagger"
import { it as effect } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Stream from "effect/Stream"
import { describe, expect, it } from "vitest"

const F = 1 / 60

/** A Clock whose ticks the test pushes, each handled inside the push, as `@wardic/test`'s `pushable` is. */
const pushable = Effect.fnUntraced(function* () {
  const pubsub = yield* PubSub.unbounded<number>()
  const clock = Layer.succeed(Clock.Clock, { ticks: Stream.fromPubSub(pubsub), tick: () => Effect.void, now: () => 0 })
  return { loop: FrameLoop.layer.pipe(Layer.provideMerge(clock)), advance: () => PubSub.publish(pubsub, F) }
})

/** A writer that draws nothing: what each frame wrote, per subject, as a copy of its values. */
const recording = <S,>(keys: ReadonlyArray<string>) => {
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
  return { writer, writes, keys }
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
    const { writer, writes } = recording<string>(["x"])
    const batch = Batch.make({ keys: ["x"], writer, transition: { type: "spring", ...spring } })
    const slot = Batch.enter(batch, "a", { x: 0 })
    Batch.retarget(batch, [slot], () => 100)
    const steps: Array<number> = []
    Array.from({ length: 600 }).some(() => {
      const done = Batch.step(batch, F)
      steps.push(Batch.get(batch, slot, "x"))
      return done
    })
    const oracle = springFrames("x", 0, 100, spring)
    expect(steps).toEqual(oracle)
    expect(writes.map((write) => write.values.x)).toEqual(oracle)
    expect(writes.every((write) => write.subject === "a")).toBe(true)
  })

  it("B2: a new target mid-flight turns it at the speed it has", () => {
    const spring = { stiffness: 210, damping: 20 }
    const { writer } = recording<string>(["x"])
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
    const { writer } = recording<string>(["x"])
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
    const { writer } = recording<string>(["x", "opacity"])
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
    const { writer, writes } = recording<number>(["x"])
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
    const { writer } = recording<string>(["x", "y"])
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
    const { writer, writes } = recording<string>(["x"])
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
      const { writer } = recording<string>(["x"])
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
    const { writer } = recording<string>(["x"])
    const drawsX: Batch.Writer<string> = { ...writer, writes: (key) => key === "x" }
    expect(() => Batch.make({ keys: ["x", "color"], writer: drawsX, transition: spring })).toThrow(Machine.OptionError)
    expect(() => Batch.make({ keys: ["x", "color"], writer: drawsX, transition: spring })).toThrow(/"color"/)
    const inertia = { type: "inertia" } as unknown as Batch.Transition
    expect(() => Batch.make({ keys: ["x"], writer, transition: inertia })).toThrow(Machine.OptionError)
    expect(() => Batch.make({ keys: ["x"], writer, transition: inertia })).toThrow(/"inertia"/)
    expect(() => Batch.make({ keys: ["x"], writer, transition: { type: "spring", stiffness: -1 } })).toThrow(/stiffness/)
    const batch = Batch.make({ keys: ["x"], writer, transition: spring })
    const slot = Batch.enter(batch, "a", { x: 0 })
    expect(() => Batch.retarget(batch, [slot], () => 1, { transition: { type: "tween", duration: -1 } })).toThrow(/duration/)
  })
})
