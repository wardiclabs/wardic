import type * as Drag from "@wardic/core/Drag"
import * as InputSource from "@wardic/core/InputSource"
import * as Recognizer from "@wardic/core/Recognizer"
import { TestInput } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

/** Build a PointerLikeEvent: a primary mouse (`makePointerLikeEvent`), pressed except at the release. */
const ev = (
  type: InputSource.PointerLikeEvent["type"],
  x: number,
  y: number,
  t: number,
  pointerId = 1,
): InputSource.PointerLikeEvent =>
  InputSource.makePointerLikeEvent({ type, pointerId, x, y, buttons: type === "up" || type === "cancel" ? 0 : 1, timeStamp: t })

const collect = (events: ReadonlyArray<InputSource.PointerLikeEvent>) =>
  Stream.runCollect(Recognizer.drag(undefined)).pipe(Effect.provide(TestInput.layer(events)))

it.effect("activation: down + moves past threshold emit start then moves with correct offset/delta", () =>
  Effect.gen(function* () {
    const events = [
      ev("down", 0, 0, 0),
      ev("move", 2, 0, 10), // sub-threshold (<=3) — suppressed
      ev("move", 10, 0, 20), // crosses threshold — "start"
      ev("move", 25, 0, 30), // "move"
    ]
    const samples = yield* collect(events)

    expect(samples.length).toBe(2)

    const [start, move] = samples as ReadonlyArray<Drag.Sample>
    expect(start!.phase).toBe("start")
    // origin is the down-point (0,0); offset measured from there.
    expect(start!.offset).toEqual({ x: 10, y: 0 })
    // delta is from the previous emitted-or-tracked point (the 2px move).
    expect(start!.delta).toEqual({ x: 8, y: 0 })

    expect(move!.phase).toBe("move")
    expect(move!.offset).toEqual({ x: 25, y: 0 })
    expect(move!.delta).toEqual({ x: 15, y: 0 })
  }))

it.effect("velocity: constant-speed moves yield expected px/s from the time window", () =>
  Effect.gen(function* () {
    // Move 10px every 10ms => 1000 px/s along x. Window is 30ms, so the estimate
    // uses the oldest in-window sample up to the newest.
    const events = [
      ev("down", 0, 0, 0),
      ev("move", 10, 0, 10), // start (dist 10 > 3)
      ev("move", 20, 0, 20),
      ev("move", 30, 0, 30),
      ev("move", 40, 0, 40),
    ]
    const samples = yield* collect(events)
    const last = samples[samples.length - 1] as Drag.Sample

    expect(last.phase).toBe("move")
    expect(last.velocity.x).toBeCloseTo(1000, 5)
    expect(last.velocity.y).toBeCloseTo(0, 5)
  }))

it.effect("sub-threshold moves emit nothing", () =>
  Effect.gen(function* () {
    const events = [
      ev("down", 0, 0, 0),
      ev("move", 1, 1, 10), // dist ~1.41 <= 3
      ev("move", 2, 2, 20), // dist ~2.83 <= 3
    ]
    const samples = yield* collect(events)
    expect(samples.length).toBe(0)
  }))

it.effect("pointer ownership: events from a second pointerId are ignored mid-drag", () =>
  Effect.gen(function* () {
    const events = [
      ev("down", 0, 0, 0, 1), // pointer 1 claims the gesture
      ev("move", 10, 0, 10, 1), // start (owner)
      ev("down", 100, 100, 15, 2), // intruder down — ignored
      ev("move", 200, 200, 18, 2), // intruder move — ignored
      ev("move", 20, 0, 20, 1), // owner move
      ev("up", 300, 300, 25, 2), // intruder up — ignored
      ev("move", 30, 0, 30, 1), // owner move
    ]
    const samples = (yield* collect(events)) as ReadonlyArray<Drag.Sample>

    expect(samples.length).toBe(3)
    expect(samples.map((s) => s.phase)).toEqual(["start", "move", "move"])
    // All offsets follow pointer 1 only; intruder coordinates never leak in.
    expect(samples.map((s) => s.offset.x)).toEqual([10, 20, 30])
  }))

it.effect("cancel emits a final end sample then nothing", () =>
  Effect.gen(function* () {
    const events = [
      ev("down", 0, 0, 0),
      ev("move", 10, 0, 10), // start
      ev("move", 20, 0, 20), // move
      ev("cancel", 20, 0, 25), // end
      ev("move", 30, 0, 30), // after reset — no owner, ignored
    ]
    const samples = (yield* collect(events)) as ReadonlyArray<Drag.Sample>

    expect(samples.map((s) => s.phase)).toEqual(["start", "move", "end"])
    const end = samples[samples.length - 1]!
    expect(end.phase).toBe("end")
    expect(end.offset).toEqual({ x: 20, y: 0 })
  }))

it.effect("a cancel ends at the last move's point, not its own: Chromium's pointercancel carries (0, 0)", () =>
  Effect.gen(function* () {
    // Motion's pan session does the same (PanSession.ts:329-333 at
    // 16c61222c4166bbef5ff6ab0051192faa79fa8c8): a cancel's info is the last move's, and
    // its velocity comes from the moves alone.
    const events = [
      ev("down", 0, 0, 0),
      ev("move", 10, 0, 10), // start
      ev("move", 20, 0, 20), // move
      ev("cancel", 0, 0, 25), // end, at the cancel's unreliable (0, 0)
    ]
    const samples = (yield* collect(events)) as ReadonlyArray<Drag.Sample>

    expect(samples.map((s) => s.phase)).toEqual(["start", "move", "end"])
    const [, move, end] = samples
    expect(end!.point).toEqual({ x: 20, y: 0 })
    expect(end!.offset).toEqual({ x: 20, y: 0 })
    expect(end!.delta).toEqual({ x: 0, y: 0 })
    expect(end!.velocity).toEqual(move!.velocity)
  }))

// A drag's `axis` (#29: it replaced `Drag.axisLock`): a one-axis drag's samples have their
// off-axis offset, delta and velocity zeroed; `point` and `phase` stay as they were.
const collectOn = (axis: "x" | "y" | "xy", events: ReadonlyArray<InputSource.PointerLikeEvent>) =>
  Stream.runCollect(Recognizer.drag(undefined, { axis })).pipe(Effect.provide(TestInput.layer(events)))

it.effect("axis 'x' zeroes the off-axis offset, delta and velocity, and keeps point and phase", () =>
  Effect.gen(function* () {
    const events = [ev("down", 0, 0, 0), ev("move", 10, 5, 10), ev("move", 20, 15, 20), ev("up", 20, 15, 30)]
    const samples = yield* collectOn("x", events)
    expect(samples.map((s) => s.phase)).toEqual(["start", "move", "end"])
    const [, move] = samples as ReadonlyArray<Drag.Sample>
    expect(move!.offset).toEqual({ x: 20, y: 0 })
    expect(move!.delta).toEqual({ x: 10, y: 0 })
    expect(move!.velocity.y).toBe(0)
    expect(move!.velocity.x).toBeGreaterThan(0)
    // point is the true pointer position.
    expect(move!.point).toEqual({ x: 20, y: 15 })
  }))

it.effect("axis 'y' zeroes x; 'xy' (the default) passes both", () =>
  Effect.gen(function* () {
    const events = [ev("down", 0, 0, 0), ev("move", 10, 5, 10), ev("move", 20, 15, 20)]
    const [, onY] = (yield* collectOn("y", events)) as ReadonlyArray<Drag.Sample>
    expect(onY!.offset).toEqual({ x: 0, y: 15 })
    expect(onY!.delta).toEqual({ x: 0, y: 10 })
    expect(onY!.velocity.x).toBe(0)
    const [, free] = (yield* collectOn("xy", events)) as ReadonlyArray<Drag.Sample>
    expect(free!.offset).toEqual({ x: 20, y: 15 })
    const [, byDefault] = (yield* collect(events)) as ReadonlyArray<Drag.Sample>
    expect(byDefault!.offset).toEqual({ x: 20, y: 15 })
  }))
