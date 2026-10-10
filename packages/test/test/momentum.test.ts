import * as Drag from "@wardic/core/Drag"
import * as InputSource from "@wardic/core/InputSource"
import type * as Point from "@wardic/core/Point"
import { TestClock, TestInput } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
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

/**
 * Spin up a momentum surface driven by push-based input + clock. Returns the
 * push/advance handles plus a `positions()` reader over everything `Drag.fling`
 * has emitted so far. The stream runs in a forked fiber (interrupted when the
 * test scope closes); we yield after forking so its pointer/clock subscriptions
 * are live before the test pushes the first event (the PubSubs don't replay).
 */
const harness = () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const clock = yield* TestClock.pushable()
    const emitted = yield* Ref.make<ReadonlyArray<Point.Point>>([])

    yield* Stream.runForEach(Drag.fling(undefined), (p) =>
      Ref.update(emitted, (xs) => [...xs, p]),
    ).pipe(
      Effect.provide(Layer.merge(input.layer, clock.layer)),
      Effect.forkChild,
    )

    // Let the forked stream subscribe to both PubSubs before anything is pushed.
    yield* Effect.yieldNow
    yield* Effect.yieldNow

    return {
      push: input.push,
      advance: clock.advance,
      positions: () => Ref.get(emitted),
    }
  })

it.effect("fling tail: after release, position continues past the release point and decays toward rest", () =>
  Effect.gen(function* () {
    const h = yield* harness()

    // Drag right at ~1000 px/s (10px every 10ms), then release.
    yield* h.push(ev("down", 0, 0, 0))
    yield* h.push(ev("move", 10, 0, 10)) // start (crosses threshold)
    yield* h.push(ev("move", 20, 0, 20))
    yield* h.push(ev("move", 30, 0, 30))
    yield* h.push(ev("up", 30, 0, 30)) // end -> launches decay from x=30

    const atRelease = yield* h.positions()
    const releaseX = atRelease[atRelease.length - 1]!.x
    expect(releaseX).toBeCloseTo(30, 5)

    // Advance the clock — the fling tail should carry x *past* the release point.
    for (let i = 0; i < 10; i++) yield* h.advance()
    const afterFling = yield* h.positions()
    const flungX = afterFling[afterFling.length - 1]!.x
    expect(flungX).toBeGreaterThan(releaseX)

    // And it should be slowing: within the decay tail (everything after the
    // 3-sample drag that ended at x=30), each later per-frame step is smaller
    // than the earlier ones (decay friction), while still moving the same way.
    const tail = afterFling.map((p) => p.x).slice(3) // decay frames only
    expect(tail.length).toBeGreaterThan(2)
    const earlyStep = tail[1]! - tail[0]!
    const lateStep = tail[tail.length - 1]! - tail[tail.length - 2]!
    expect(earlyStep).toBeGreaterThan(0) // moving in the fling direction
    expect(lateStep).toBeGreaterThanOrEqual(0) // same direction (or settled)
    expect(lateStep).toBeLessThan(earlyStep) // and slowing down
  }))

it.effect("grab mid-fling: a re-grab interrupts the decay and a new drag continues from the interrupted position", () =>
  Effect.gen(function* () {
    const h = yield* harness()

    // Fling right, then release.
    yield* h.push(ev("down", 0, 0, 0))
    yield* h.push(ev("move", 10, 0, 10))
    yield* h.push(ev("move", 20, 0, 20))
    yield* h.push(ev("move", 30, 0, 30))
    yield* h.push(ev("up", 30, 0, 30))

    // Let the fling run a few frames.
    for (let i = 0; i < 4; i++) yield* h.advance()
    const beforeGrab = yield* h.positions()
    const grabX = beforeGrab[beforeGrab.length - 1]!.x
    expect(grabX).toBeGreaterThan(30) // decay advanced past release

    // Re-grab mid-fling: a bare pointer-down interrupts the decay inner.
    yield* h.push(ev("down", 100, 0, 40))

    // Advance more frames — the decay must NOT keep advancing (it was cancelled).
    for (let i = 0; i < 6; i++) yield* h.advance()
    const afterGrabFrames = yield* h.positions()
    const heldX = afterGrabFrames[afterGrabFrames.length - 1]!.x
    expect(heldX).toBeCloseTo(grabX, 5) // no further decay samples

    // A subsequent drag continues from the interrupted position (no jump to 0).
    yield* h.push(ev("move", 110, 0, 50)) // start: offset.x = 10 from the new down
    yield* h.push(ev("move", 130, 0, 60)) // move:  offset.x = 30
    const afterDrag = yield* h.positions()
    const draggedX = afterDrag[afterDrag.length - 1]!.x
    expect(draggedX).toBeCloseTo(grabX + 30, 5) // base = grabX, plus the drag offset
  }))

it.effect("cross-session accumulation: a new drag continues from where the previous one settled", () =>
  Effect.gen(function* () {
    const h = yield* harness()

    // Session 1: drag right and release with (near-)zero velocity so the fling is
    // negligible, then let any tail settle.
    yield* h.push(ev("down", 0, 0, 0))
    yield* h.push(ev("move", 10, 0, 100))
    yield* h.push(ev("move", 50, 0, 200)) // slow move -> tiny release velocity
    yield* h.push(ev("up", 50, 0, 300))
    for (let i = 0; i < 20; i++) yield* h.advance()

    const afterSettle = yield* h.positions()
    const settledX = afterSettle[afterSettle.length - 1]!.x
    expect(settledX).toBeGreaterThanOrEqual(50) // at least the drag distance

    // Session 2: a fresh drag's offset accumulates onto the settled position.
    yield* h.push(ev("down", 0, 0, 400))
    yield* h.push(ev("move", 10, 0, 500)) // start: offset 10
    yield* h.push(ev("move", 30, 0, 600)) // move:  offset 30
    const afterSecond = yield* h.positions()
    const secondX = afterSecond[afterSecond.length - 1]!.x
    expect(secondX).toBeCloseTo(settledX + 30, 5)
  }))
