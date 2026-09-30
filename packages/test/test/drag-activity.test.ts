import { DragActivity, drag, hover, makeDragActivity, press } from "@wardic/core"
import type { DragActivityShape, InputSource, PointerLikeEvent } from "@wardic/core"
import { TestInput } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"

// Drag activity (ADR-0019, decision 3b): a core Context.Reference counting the active
// drags. `drag` claims at its `start` sample and releases at every `end` and in a
// finalizer; hover ignores an enter while active; press can't START while active.
// Each test provides a FRESH activity with Effect.provideService, so nothing is shared.
//
// Note: the imports above are missing at e57c54e (missing-api red); `typecheck:tests`
// fails on them until ticket 08 lands.

interface EventOptions {
  readonly pointerId?: number
  readonly buttons?: number
}

/** Local builder with mouse defaults (as `makePointerLikeEvent`): buttons 1 on down/move, else 0. */
const ev = (
  type: PointerLikeEvent["type"],
  x: number,
  y: number,
  t: number,
  o: EventOptions = {},
): PointerLikeEvent =>
  ({
    type,
    pointerId: o.pointerId ?? 1,
    x,
    y,
    buttons: o.buttons ?? (type === "down" || type === "move" ? 1 : 0),
    timeStamp: t,
    pointerType: "mouse",
    button: type === "down" || type === "up" ? 0 : -1,
    isPrimary: true,
  }) as PointerLikeEvent

/**
 * Subscribe `streams` (each in its own forked fiber) to ONE pushable input, all under the
 * given `activity`. Returns the push handle, each stream's recorded output and its fiber.
 */
const rig = <A>(activity: DragActivityShape, streams: ReadonlyArray<Stream.Stream<A, never, InputSource>>) =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const seen = yield* Ref.make<ReadonlyArray<A>>([])
    const fibers: Array<Fiber.Fiber<void>> = []
    for (const stream of streams) {
      const fiber = yield* Stream.runForEach(stream, (a) => Ref.update(seen, (xs) => [...xs, a])).pipe(
        Effect.provide(input.layer),
        Effect.provideService(DragActivity, activity),
        Effect.forkChild,
      )
      fibers.push(fiber)
    }
    yield* Effect.yieldNow
    yield* Effect.yieldNow
    return { push: input.push, seen: Ref.get(seen), fibers }
  })

/** Press down at the origin and move `x` px right, each with the mouse defaults. */
const dragTo = (x: number, t: number) => ev("move", x, 0, t)

it.effect("A1: a drag claims at its start sample, not at the down or a sub-threshold move", () =>
  Effect.gen(function* () {
    const activity = makeDragActivity()
    const h = yield* rig(activity, [drag(undefined)])
    // No claim at the down, none at a move inside the 3 px threshold
    yield* h.push(ev("down", 0, 0, 0))
    expect(activity.isDragActive()).toBe(false)
    yield* h.push(dragTo(2, 10))
    expect(activity.isDragActive()).toBe(false)
    // the move that crosses the threshold is the `start` sample: claimed
    yield* h.push(dragTo(10, 20))
    expect(activity.isDragActive()).toBe(true)
  }))

it.effect("A2: a drag releases at the end of an up, of rule A and of rule B (and rule B's new start claims again)", () =>
  Effect.gen(function* () {
    // (a) an up
    const a = makeDragActivity()
    const ha = yield* rig(a, [drag(undefined)])
    yield* ha.push(ev("down", 0, 0, 0))
    yield* ha.push(dragTo(10, 10))
    expect(a.isDragActive()).toBe(true)
    yield* ha.push(ev("up", 10, 0, 20))
    expect(a.isDragActive()).toBe(false)

    // (b) rule A: the release is lost; the owner moves unpressed
    const b = makeDragActivity()
    const hb = yield* rig(b, [drag(undefined)])
    yield* hb.push(ev("down", 0, 0, 0))
    yield* hb.push(dragTo(10, 10))
    expect(b.isDragActive()).toBe(true)
    yield* hb.push(ev("move", 50, 0, 20, { buttons: 0 }))
    expect(b.isDragActive()).toBe(false)

    // (c) rule B: a new down from the owner releases, the new gesture's start claims again
    const c = makeDragActivity()
    const hc = yield* rig(c, [drag(undefined)])
    yield* hc.push(ev("down", 0, 0, 0))
    yield* hc.push(dragTo(10, 10))
    expect(c.isDragActive()).toBe(true)
    yield* hc.push(ev("down", 100, 0, 20))
    expect(c.isDragActive()).toBe(false)
    yield* hc.push(ev("move", 110, 0, 30))
    expect(c.isDragActive()).toBe(true)
  }))

it.effect("A3: interrupting the drag stream mid-gesture releases the claim (finalizer)", () =>
  Effect.gen(function* () {
    // A drag past its threshold, holding the claim
    const activity = makeDragActivity()
    const h = yield* rig(activity, [drag(undefined)])
    yield* h.push(ev("down", 0, 0, 0))
    yield* h.push(dragTo(10, 10))
    expect(activity.isDragActive()).toBe(true)
    // The surface unmounts
    yield* Fiber.interrupt(h.fibers[0]!)
    expect(activity.isDragActive()).toBe(false)

    // Interrupting a drag that never started must not release another's claim
    const shared = makeDragActivity()
    const other = shared.claim()
    const idle = yield* rig(shared, [drag(undefined)])
    yield* idle.push(ev("down", 0, 0, 0)) // no start yet
    yield* Fiber.interrupt(idle.fibers[0]!)
    expect(shared.isDragActive()).toBe(true)
    other()
    expect(shared.isDragActive()).toBe(false)
  }))

it.effect("A4: a press can't start while the activity is claimed; a press already on stays on when a drag claims", () =>
  Effect.gen(function* () {
    // (a) claimed before the down: the press doesn't start
    const busy = makeDragActivity()
    const release = busy.claim()
    const ha = yield* rig(busy, [press(undefined)])
    yield* ha.push(ev("down", 0, 0, 0))
    yield* ha.push(ev("up", 0, 0, 10))
    expect(yield* ha.seen).toEqual([])
    // once released, a new press starts
    release()
    yield* ha.push(ev("down", 0, 0, 20))
    expect(yield* ha.seen).toEqual([true])

    // (b) a press already on stays on when a drag claims (no end-side check)
    const activity = makeDragActivity()
    const hb = yield* rig<boolean | string>(activity, [press(undefined), drag(undefined).pipe(Stream.map((s) => s.phase))])
    yield* hb.push(ev("down", 0, 0, 0))
    yield* hb.push(dragTo(10, 10)) // the drag starts and claims
    expect(activity.isDragActive()).toBe(true)
    expect((yield* hb.seen).filter((x) => typeof x === "boolean")).toEqual([true])
    yield* hb.push(ev("up", 10, 0, 20)) // drag ends, press ends
    expect((yield* hb.seen).filter((x) => typeof x === "boolean")).toEqual([true, false])
  }))

it.effect("A5: hover ignores an enter while claimed; a leave while claimed still ends a hover that was on", () =>
  Effect.gen(function* () {
    // (a) an enter while claimed is ignored
    const busy = makeDragActivity()
    const release = busy.claim()
    const ha = yield* rig(busy, [hover(undefined)])
    yield* ha.push(ev("enter", 0, 0, 0, { buttons: 0 }))
    expect(yield* ha.seen).toEqual([])
    // after the release, an enter hovers
    release()
    yield* ha.push(ev("enter", 0, 0, 10, { buttons: 0 }))
    expect(yield* ha.seen).toEqual([true])

    // (b) hover already on when a drag claims: the leave still ends it
    const activity = makeDragActivity()
    const hb = yield* rig(activity, [hover(undefined)])
    yield* hb.push(ev("enter", 0, 0, 0, { buttons: 0 }))
    const claim = activity.claim()
    yield* hb.push(ev("leave", 200, 0, 10))
    expect(yield* hb.seen).toEqual([true, false])
    claim()
  }))

it.effect("A6: two drags claim twice; releasing one leaves the activity active", () =>
  Effect.gen(function* () {
    // (a) the API: a counter, and each release is idempotent
    const counter = makeDragActivity()
    const first = counter.claim()
    const second = counter.claim()
    first()
    expect(counter.isDragActive()).toBe(true)
    first() // a repeated release must not take the second's claim
    expect(counter.isDragActive()).toBe(true)
    second()
    expect(counter.isDragActive()).toBe(false)

    // (b) two drag streams on one input: both claim at the same start
    const activity = makeDragActivity()
    const h = yield* rig(activity, [drag(undefined), drag(undefined)])
    yield* h.push(ev("down", 0, 0, 0))
    yield* h.push(dragTo(10, 10))
    expect(activity.isDragActive()).toBe(true)
    yield* Fiber.interrupt(h.fibers[0]!)
    expect(activity.isDragActive()).toBe(true) // the other drag still holds it
    yield* Fiber.interrupt(h.fibers[1]!)
    expect(activity.isDragActive()).toBe(false)
  }))
