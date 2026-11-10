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
import * as Batch from "@wardic/core/Batch"
import * as Machine from "@wardic/core/Machine"
import { describe, expect, it } from "vitest"

const F = 1 / 60

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
})
