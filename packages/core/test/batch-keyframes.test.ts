// A Batch's keyframes driven by a Playhead (#665, Q36): a Sequence's Segment of a Batch, each member's
// key through its own stops. Each member is held to `Machine.keyframes` on the same stops and options,
// frame for frame.
//
// - BK1: each member's key runs its own stops, times, easings and delay, frame for frame as
//   `Machine.keyframes` does; a key it gives none stays; it lands once, its Playhead's time keeping pace.
// - BK2: a `NaN` stop is the one before it, the first the key's value at the first play; a single stop
//   holds there.
// - BK3: a seek, then a play, lands each key exactly where stepping to that time would have, its first
//   step there, as `Playback.drive`'s; played backwards, it retraces its frames to its start, where it
//   ends as if landed.
// - BK4: its repeats are each key's run's: `"loop"`, `"reverse"` and `"mirror"`, a `repeatDelay` between,
//   and `reverse`, frame for frame.
// - BK5: its duration is `Machine.durationOf`'s for its longest key; one that repeats for ever lasts for
//   ever, and never lands.
// - BK6: paused, it holds, its keys' velocities 0; stopped, they stay where they are and rest; cancelled,
//   they're back at their first stops; a later change that takes a key moves it its way, and the
//   animation ends unheard once the keys it kept are done.
// - BK7: `keyframes`' two forms give one type, `pipe` runs the data-last one.
import * as Batch from "@wardic/core/Batch"
import * as Machine from "@wardic/core/Machine"
import * as Playback from "@wardic/core/Playback"
import { describe, expect, expectTypeOf, it } from "vitest"

const F = 1 / 60

/** A writer that draws nothing. */
const writer: Batch.Writer<string> = { writes: () => true, forKeys: () => () => {} }

/** `Machine.keyframes`' frames through `stops` on `options`, until it's done: the oracle. */
const keyframesFrames = (stops: ReadonlyArray<number>, options: Machine.KeyframesOptions): ReadonlyArray<number> => {
  const step = Machine.keyframes(stops, options).start()
  const out: Array<number> = []
  Array.from({ length: 1200 }).some(() => {
    const frame = step(F)
    out.push(frame.value)
    return frame.done
  })
  return out
}

/** `batch`'s `key` at each of `slots`, each step until it rests, or `limit` steps. */
const stepped = (batch: Batch.Batch<string>, slots: ReadonlyArray<number>, key = "x", limit = 1200): ReadonlyArray<Array<number>> => {
  const out = slots.map((): Array<number> => [])
  Array.from({ length: limit }).some(() => {
    const done = Batch.step(batch, F)
    slots.forEach((slot, s) => out[s].push(Batch.get(batch, slot, key)))
    return done
  })
  return out
}

/** `actual` frame for frame as `expected`, to 9 places. */
const expectFrames = (actual: ReadonlyArray<number>, expected: ReadonlyArray<number>): void => {
  expect(actual.length).toBe(expected.length)
  actual.forEach((value, i) => expect(value, `frame ${i}`).toBeCloseTo(expected[i], 9))
}

const A: Batch.Keyframes = { stops: [0, 80, 40, 100], transition: { duration: 1, times: [0, 0.2, 0.7, 1], ease: ["easeIn", "linear", "easeOut"], delay: 0.1 } }
const B: Batch.Keyframes = { stops: [10, -30, 60], transition: { duration: 0.6, ease: "easeInOut" } }

describe("a Batch's keyframes driven by a Playhead (#665)", () => {
  it("BK1: each member's key runs its own stops, frame for frame as Machine.keyframes does, and lands once", () => {
    const head = Playback.make()
    let landed = 0
    const batch = Batch.make({ keys: ["x", "y"], writer, transition: { type: "spring" } })
    const a = Batch.enter(batch, "a", { x: 0, y: 5 })
    const b = Batch.enter(batch, "b", { x: 10, y: 5 })
    const tracks = new Map([[a, A], [b, B]])
    const keyframesOf = (slot: number, k: number): Batch.Keyframes | undefined => {
      if (k !== 0) return undefined
      return tracks.get(slot)
    }
    const animation = Batch.keyframes(batch, [a, b], keyframesOf, { head, onLanded: () => landed++ })
    expect(Batch.play(animation)).toBe(2)
    const [xa, xb] = stepped(batch, [a, b])
    const oracleA = keyframesFrames(A.stops, A.transition)
    const oracleB = keyframesFrames(B.stops, B.transition)
    expectFrames(xa, oracleA)
    expectFrames(xb.slice(0, oracleB.length), oracleB)
    // Done before `a`, it holds its last stop.
    xb.slice(oracleB.length).forEach((value) => expect(value).toBe(60))
    expect(Batch.get(batch, a, "y")).toBe(5)
    expect(head.time).toBeCloseTo(oracleA.length * F, 9)
    expect(landed).toBe(1)
  })

  it("BK2: a NaN stop is the one before it, the first the key's value at the first play; a single stop holds", () => {
    const head = Playback.make()
    const batch = Batch.make({ keys: ["x"], writer, transition: { type: "spring" } })
    const a = Batch.enter(batch, "a", { x: 25 })
    const b = Batch.enter(batch, "b", { x: 7 })
    const given: Record<number, Batch.Keyframes> = {
      [a]: { stops: [Number.NaN, 90, Number.NaN, 0], transition: { duration: 0.5, times: [0, 0.4, 0.6, 1] } },
      [b]: { stops: [-4], transition: { duration: 0.2 } },
    }
    const animation = Batch.keyframes(batch, [a, b], (slot) => given[slot], { head })
    Batch.play(animation)
    const [xa, xb] = stepped(batch, [a, b])
    expectFrames(xa, keyframesFrames([25, 90, 90, 0], given[a].transition))
    xb.forEach((value) => expect(value).toBe(-4))
  })

  it("BK3: a seek, then a play, lands each key where stepping would; backwards, it retraces its frames to its start", () => {
    const options: Machine.KeyframesOptions = { duration: 0.8, times: [0, 0.3, 1], ease: ["easeOut", "easeInOut"], delay: 0.05 }
    const stops = [0, 120, 30]
    const oracle = keyframesFrames(stops, options)
    // Seeked 20 frames in.
    const head = Playback.make()
    const batch = Batch.make({ keys: ["x"], writer, transition: { type: "spring" } })
    const slot = Batch.enter(batch, "a", { x: 0 })
    const animation = Batch.keyframes(batch, [slot], () => ({ stops, transition: options }), { head })
    Playback.seek(head, 20 * F)
    Batch.play(animation)
    expect(Batch.get(batch, slot, "x")).toBeCloseTo(oracle[19], 9)
    // Its first step lands there, as a driven machine's does (`Playback.drive`), then it goes on.
    const [after] = stepped(batch, [slot])
    expect(after[0]).toBeCloseTo(oracle[19], 9)
    expectFrames(after.slice(1), oracle.slice(20))
    // Played forwards 30 frames, then backwards at speed -1: each frame the one before, back to its start.
    const back = Playback.make()
    const other = Batch.make({ keys: ["x"], writer, transition: { type: "spring" } })
    const at = Batch.enter(other, "b", { x: 0 })
    let landed = 0
    const turned = Batch.keyframes(other, [at], () => ({ stops, transition: options }), { head: back, onLanded: () => landed++ })
    Batch.play(turned)
    stepped(other, [at], "x", 30)
    Playback.setSpeed(back, -1)
    const [retraced] = stepped(other, [at], "x", 100)
    retraced.slice(0, 29).forEach((value, i) => expect(value, `frame ${i}`).toBeCloseTo(oracle[28 - i], 9))
    expect([retraced.at(-1), back.time, landed, Batch.isMoving(other)]).toEqual([0, 0, 1, false])
  })

  it("BK4: its repeats are each key's run's, loop, reverse and mirror, a repeatDelay between, and reverse", () => {
    const stops = [0, 100, 40]
    const runs: ReadonlyArray<Machine.KeyframesOptions> = [
      { duration: 0.4, times: [0, 0.25, 1], ease: ["easeIn", "easeOut"], repeat: 2, repeatType: "loop", repeatDelay: 0.1 },
      { duration: 0.4, times: [0, 0.25, 1], ease: ["easeIn", "easeOut"], repeat: 2, repeatType: "reverse", repeatDelay: 0.05 },
      { duration: 0.4, times: [0, 0.25, 1], ease: ["easeIn", "easeOut"], repeat: 3, repeatType: "mirror" },
      { duration: 0.4, times: [0, 0.25, 1], ease: "easeInOut", repeat: 1, repeatType: "mirror", reverse: true, delay: 0.1 },
    ]
    const head = Playback.make()
    const batch = Batch.make({ keys: ["x"], writer, transition: { type: "spring" } })
    const slots = runs.map((_, i) => Batch.enter(batch, `m${i}`, { x: 0 }))
    const animation = Batch.keyframes(batch, slots, (slot) => ({ stops, transition: runs[slot] }), { head })
    Batch.play(animation)
    const frames = stepped(batch, slots)
    const oracles = runs.map((run) => keyframesFrames(stops, run))
    const longest = Math.max(...oracles.map((oracle) => oracle.length))
    expect(frames[0].length).toBe(longest)
    oracles.forEach((oracle, i) => {
      expectFrames(frames[i].slice(0, oracle.length), oracle)
      frames[i].slice(oracle.length).forEach((value) => expect(value).toBe(oracle.at(-1)))
    })
  })

  it("BK5: its duration is Machine.durationOf's for its longest key; one that repeats for ever lasts for ever", () => {
    const long: Machine.KeyframesOptions = { duration: 0.7, repeat: 1, repeatDelay: 0.2, delay: 0.15 }
    const short: Machine.KeyframesOptions = { duration: 0.3 }
    const batch = Batch.make({ keys: ["x", "y"], writer, transition: { type: "spring" } })
    const slot = Batch.enter(batch, "a", { x: 0, y: 0 })
    const animation = Batch.keyframes(batch, [slot], (_, k) => ({ stops: [0, 10, 5], transition: [short, long][k] }), { head: Playback.make() })
    expect(Batch.durationOf(animation)).toBeCloseTo(Machine.durationOf(Machine.keyframes([0, 10, 5], long)), 9)
    // For ever.
    const head = Playback.make()
    let landed = 0
    const forever = Batch.keyframes(batch, [slot], () => ({ stops: [0, 10], transition: { duration: 0.2, repeat: Infinity, repeatType: "reverse" } }), { head, onLanded: () => landed++ })
    expect(Batch.durationOf(forever)).toBe(Number.POSITIVE_INFINITY)
    Batch.play(forever)
    const [x] = stepped(batch, [slot], "x", 300)
    const oracle = keyframesFrames([0, 10], { duration: 0.2, repeat: Infinity, repeatType: "reverse" })
    expect(x.length).toBe(300)
    expectFrames(x, oracle.slice(0, 300))
    expect(landed).toBe(0)
  })

  it("BK6: paused it holds; stopped it rests where it is; cancelled it's back at its first stops; a later change takes a key", () => {
    const transition: Machine.KeyframesOptions = { duration: 0.5, ease: "easeInOut" }
    const make = (onLanded: () => void = () => {}) => {
      const head = Playback.make()
      const batch = Batch.make({ keys: ["x", "y"], writer, transition: { type: "spring" } })
      const slot = Batch.enter(batch, "a", { x: 0, y: 0 })
      const animation = Batch.keyframes(batch, [slot], () => ({ stops: [10, 60, 20], transition }), { head, onLanded })
      Batch.play(animation)
      stepped(batch, [slot], "x", 10)
      return { head, batch, slot, animation }
    }
    const oracle = keyframesFrames([10, 60, 20], transition)
    // Paused: it holds, its time with it, its speed 0.
    const paused = make()
    Playback.pause(paused.head)
    const [held] = stepped(paused.batch, [paused.slot], "x", 5)
    held.forEach((value) => expect(value).toBeCloseTo(oracle[9], 9))
    expect([paused.head.time, Batch.velocity(paused.batch, paused.slot, "x")]).toEqual([10 * F, 0])
    // Stopped: where it is, at rest.
    let stoppedLanded = 0
    const stopped = make(() => stoppedLanded++)
    const there = Batch.get(stopped.batch, stopped.slot, "x")
    Batch.stop(stopped.animation)
    expect(Batch.step(stopped.batch, F)).toBe(true)
    expect([Batch.get(stopped.batch, stopped.slot, "x"), Batch.velocity(stopped.batch, stopped.slot, "x"), stoppedLanded]).toEqual([there, 0, 0])
    // Cancelled: back at its first stops.
    const cancelled = make()
    Batch.cancel(cancelled.animation)
    expect(Batch.step(cancelled.batch, F)).toBe(true)
    expect(Batch.get(cancelled.batch, cancelled.slot, "x")).toBe(10)
    // Taken: a change of both keys moves them its way; the animation never lands.
    let takenLanded = 0
    const taken = make(() => takenLanded++)
    Batch.retarget(taken.batch, [taken.slot], () => 200, { transition: { type: "tween", duration: 0.2 } })
    const [x] = stepped(taken.batch, [taken.slot])
    expect(x.at(-1)).toBe(200)
    expect([Batch.get(taken.batch, taken.slot, "y"), takenLanded]).toEqual([200, 0])
  })

  it("BK7: keyframes' two forms give one type, and pipe runs the data-last one", () => {
    const batch = Batch.make({ keys: ["x"], writer, transition: { type: "spring" } })
    const slot = Batch.enter(batch, "a", { x: 0 })
    const options = { head: Playback.make() }
    const of = (): Batch.Keyframes => ({ stops: [0, 1], transition: {} })
    const first = Batch.keyframes(batch, [slot], of, options)
    const last = batch.pipe(Batch.keyframes([slot], of, options))
    expectTypeOf(first).toEqualTypeOf<Batch.Animation>()
    expectTypeOf(last).toEqualTypeOf<Batch.Animation>()
    expect([Batch.isAnimation(first), Batch.isAnimation(last)]).toEqual([true, true])
  })
})
