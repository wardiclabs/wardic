import type * as Drag from "@wardic/core/Drag"
import * as DragActivity from "@wardic/core/DragActivity"
import * as InputSource from "@wardic/core/InputSource"
import * as Recognizer from "@wardic/core/Recognizer"
import { TestInput } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"

// Drag activity (ADR-0019, decision 3b): a core Context.Reference counting the active
// drags. `drag` counts in it at its `start` sample and counts off at every `end` and in a
// finalizer; hover ignores an enter while active; press can't START while active.
// Each test provides a FRESH activity with Effect.provideService, so nothing is shared.
//
// Drag claims (A7-A13, ADR-0019 *Amendment (#29)*): a drag takes its target's claim on its
// axes at its start; a drag that needs an axis another target holds is refused for its whole
// gesture. TestInput hands every target the same events, in subscription order, as a DOM
// pointer's events reach the targets it went down on innermost first: so the stream
// subscribed first plays the inner draggable.

interface EventOptions {
  readonly pointerId?: number
  readonly buttons?: number
}

/** A primary mouse (`makePointerLikeEvent`): pressed on a down or move, released otherwise. */
const ev = (
  type: InputSource.PointerLikeEvent["type"],
  x: number,
  y: number,
  t: number,
  o: EventOptions = {},
): InputSource.PointerLikeEvent => InputSource.makePointerLikeEvent({ type, x, y, timeStamp: t, ...o })

/**
 * Subscribe `streams` (each in its own forked fiber) to ONE pushable input, all under the
 * given `activity`. Returns the push handle, each stream's recorded output and its fiber.
 */
const rig = <A>(activity: DragActivity.Shape, streams: ReadonlyArray<Stream.Stream<A, never, InputSource.InputSource>>) =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const seen = yield* Ref.make<ReadonlyArray<A>>([])
    const fibers: Array<Fiber.Fiber<void>> = []
    for (const stream of streams) {
      const fiber = yield* Stream.runForEach(stream, (a) => Ref.update(seen, (xs) => [...xs, a])).pipe(
        Effect.provide(input.layer),
        Effect.provideService(DragActivity.DragActivity, activity),
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
    const activity = DragActivity.make()
    const h = yield* rig(activity, [Recognizer.drag(undefined)])
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
    const a = DragActivity.make()
    const ha = yield* rig(a, [Recognizer.drag(undefined)])
    yield* ha.push(ev("down", 0, 0, 0))
    yield* ha.push(dragTo(10, 10))
    expect(a.isDragActive()).toBe(true)
    yield* ha.push(ev("up", 10, 0, 20))
    expect(a.isDragActive()).toBe(false)

    // (b) rule A: the release is lost; the owner moves unpressed
    const b = DragActivity.make()
    const hb = yield* rig(b, [Recognizer.drag(undefined)])
    yield* hb.push(ev("down", 0, 0, 0))
    yield* hb.push(dragTo(10, 10))
    expect(b.isDragActive()).toBe(true)
    yield* hb.push(ev("move", 50, 0, 20, { buttons: 0 }))
    expect(b.isDragActive()).toBe(false)

    // (c) rule B: a new down from the owner releases, the new gesture's start claims again
    const c = DragActivity.make()
    const hc = yield* rig(c, [Recognizer.drag(undefined)])
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
    const activity = DragActivity.make()
    const h = yield* rig(activity, [Recognizer.drag(undefined)])
    yield* h.push(ev("down", 0, 0, 0))
    yield* h.push(dragTo(10, 10))
    expect(activity.isDragActive()).toBe(true)
    // The surface unmounts
    yield* Fiber.interrupt(h.fibers[0]!)
    expect(activity.isDragActive()).toBe(false)

    // Interrupting a drag that never started must not release another's claim
    const shared = DragActivity.make()
    const other = shared.count()
    const idle = yield* rig(shared, [Recognizer.drag(undefined)])
    yield* idle.push(ev("down", 0, 0, 0)) // no start yet
    yield* Fiber.interrupt(idle.fibers[0]!)
    expect(shared.isDragActive()).toBe(true)
    other()
    expect(shared.isDragActive()).toBe(false)
  }))

it.effect("A4: a press can't start while the activity is claimed; a press already on stays on when a drag claims", () =>
  Effect.gen(function* () {
    // (a) claimed before the down: the press doesn't start
    const busy = DragActivity.make()
    const release = busy.count()
    const ha = yield* rig(busy, [Recognizer.press(undefined)])
    yield* ha.push(ev("down", 0, 0, 0))
    yield* ha.push(ev("up", 0, 0, 10))
    expect(yield* ha.seen).toEqual([])
    // once released, a new press starts
    release()
    yield* ha.push(ev("down", 0, 0, 20))
    expect(yield* ha.seen).toEqual([true])

    // (b) a press already on stays on when a drag claims (no end-side check)
    const activity = DragActivity.make()
    const hb = yield* rig<boolean | string>(activity, [Recognizer.press(undefined), Recognizer.drag(undefined).pipe(Stream.map((s) => s.phase))])
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
    const busy = DragActivity.make()
    const release = busy.count()
    const ha = yield* rig(busy, [Recognizer.hover(undefined)])
    yield* ha.push(ev("enter", 0, 0, 0, { buttons: 0 }))
    expect(yield* ha.seen).toEqual([])
    // after the release, an enter hovers
    release()
    yield* ha.push(ev("enter", 0, 0, 10, { buttons: 0 }))
    expect(yield* ha.seen).toEqual([true])

    // (b) hover already on when a drag claims: the leave still ends it
    const activity = DragActivity.make()
    const hb = yield* rig(activity, [Recognizer.hover(undefined)])
    yield* hb.push(ev("enter", 0, 0, 0, { buttons: 0 }))
    const claim = activity.count()
    yield* hb.push(ev("leave", 200, 0, 10))
    expect(yield* hb.seen).toEqual([true, false])
    claim()
  }))

it.effect("A6: two drags claim twice; releasing one leaves the activity active", () =>
  Effect.gen(function* () {
    // (a) the API: a counter, and each release is idempotent
    const counter = DragActivity.make()
    const first = counter.count()
    const second = counter.count()
    first()
    expect(counter.isDragActive()).toBe(true)
    first() // a repeated release must not take the second's claim
    expect(counter.isDragActive()).toBe(true)
    second()
    expect(counter.isDragActive()).toBe(false)

    // (b) two drag streams on one input: both claim at the same start
    const activity = DragActivity.make()
    const h = yield* rig(activity, [Recognizer.drag(undefined), Recognizer.drag(undefined)])
    yield* h.push(ev("down", 0, 0, 0))
    yield* h.push(dragTo(10, 10))
    expect(activity.isDragActive()).toBe(true)
    yield* Fiber.interrupt(h.fibers[0]!)
    expect(activity.isDragActive()).toBe(true) // the other drag still holds it
    yield* Fiber.interrupt(h.fibers[1]!)
    expect(activity.isDragActive()).toBe(false)
  }))

/**
 * Subscribe each named drag stream (in the record's order, so the first plays the inner
 * draggable) to ONE pushable input under `activity`, each stream's samples kept apart.
 */
const rigApart = (
  activity: DragActivity.Shape,
  streams: Record<string, Stream.Stream<Drag.Sample, never, InputSource.InputSource>>,
) =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const seen: Record<string, Array<Drag.Sample>> = {}
    const fibers: Record<string, Fiber.Fiber<void>> = {}
    for (const [name, stream] of Object.entries(streams)) {
      const into: Array<Drag.Sample> = []
      seen[name] = into
      fibers[name] = yield* Stream.runForEach(stream, (sample) => Effect.sync(() => into.push(sample))).pipe(
        Effect.provide(input.layer),
        Effect.provideService(DragActivity.DragActivity, activity),
        Effect.forkChild,
      )
    }
    yield* Effect.yieldNow
    yield* Effect.yieldNow
    return { push: input.push, seen, fibers }
  })

/** The phases of `samples`, joined: `"start move end"`, or `""` for none. */
const phases = (samples: ReadonlyArray<Drag.Sample>): string => samples.map((sample) => sample.phase).join(" ")

/** A whole gesture: down at the origin, moves to (10, 10) and (20, 20), up there. */
const wholeGesture = (push: (event: InputSource.PointerLikeEvent) => Effect.Effect<void>, t = 0) =>
  Effect.gen(function* () {
    yield* push(ev("down", 0, 0, t))
    yield* push(ev("move", 10, 10, t + 10))
    yield* push(ev("move", 20, 20, t + 20))
    yield* push(ev("up", 20, 20, t + 30))
  })

const INNER = { name: "inner" }
const OUTER = { name: "outer" }

it.effect("A7: the drag that starts first claims; another target's is refused for its whole gesture, then claims at its own", () =>
  Effect.gen(function* () {
    const activity = DragActivity.make()
    const h = yield* rigApart(activity, { inner: Recognizer.drag(INNER), outer: Recognizer.drag(OUTER) })
    yield* wholeGesture(h.push)
    expect(phases(h.seen.inner!)).toBe("start move end")
    expect(phases(h.seen.outer!)).toBe("")
    expect(activity.isDragActive()).toBe(false)
    // Without the inner drag, the outer claims the next gesture.
    yield* Fiber.interrupt(h.fibers.inner!)
    yield* wholeGesture(h.push, 100)
    expect(phases(h.seen.outer!)).toBe("start move end")
  }))

it.effect("A8: a refused drag stays refused when the claim frees mid-gesture (the inner unmounts)", () =>
  Effect.gen(function* () {
    const activity = DragActivity.make()
    const h = yield* rigApart(activity, { inner: Recognizer.drag(INNER), outer: Recognizer.drag(OUTER) })
    yield* h.push(ev("down", 0, 0, 0))
    yield* h.push(ev("move", 10, 0, 10))
    expect(phases(h.seen.inner!)).toBe("start")
    // The inner unmounts: its claim goes with it.
    yield* Fiber.interrupt(h.fibers.inner!)
    expect(activity.isDragActive()).toBe(false)
    expect(Option.isSome(activity.claim({ name: "probe" }, "xy").pipe(Option.map((release) => release())))).toBe(true)
    // The outer was refused at the start, and stays so until the gesture's end.
    yield* h.push(ev("move", 30, 0, 20))
    yield* h.push(ev("move", 50, 0, 30))
    yield* h.push(ev("up", 50, 0, 40))
    expect(phases(h.seen.outer!)).toBe("")
    // Its next gesture claims.
    yield* wholeGesture(h.push, 100)
    expect(phases(h.seen.outer!)).toBe("start move end")
  }))

it.effect("A9: claims are per axis: drags on different axes both run, a drag needing a held axis is refused", () =>
  Effect.gen(function* () {
    const runs = "start move end"
    const refused = ""
    const rows: ReadonlyArray<{ readonly inner: Drag.Axis; readonly outer: Drag.Axis; readonly outerSees: string }> = [
      { inner: "y", outer: "x", outerSees: runs },
      { inner: "x", outer: "y", outerSees: runs },
      { inner: "x", outer: "x", outerSees: refused },
      { inner: "x", outer: "xy", outerSees: refused },
      { inner: "xy", outer: "x", outerSees: refused },
      { inner: "xy", outer: "xy", outerSees: refused },
    ]
    for (const row of rows) {
      const activity = DragActivity.make()
      const h = yield* rigApart(activity, {
        inner: Recognizer.drag(INNER, { axis: row.inner }),
        outer: Recognizer.drag(OUTER, { axis: row.outer }),
      })
      yield* wholeGesture(h.push)
      expect(phases(h.seen.inner!), `${row.inner} in ${row.outer}`).toBe("start move end")
      expect(phases(h.seen.outer!), `${row.inner} in ${row.outer}`).toBe(row.outerSees)
      expect(activity.isDragActive()).toBe(false)
    }
    // Each runs on its own axis: y in x.
    const activity = DragActivity.make()
    const h = yield* rigApart(activity, { inner: Recognizer.drag(INNER, { axis: "y" }), outer: Recognizer.drag(OUTER, { axis: "x" }) })
    yield* wholeGesture(h.push)
    expect(h.seen.inner!.at(-1)!.offset).toEqual({ x: 0, y: 20 })
    expect(h.seen.outer!.at(-1)!.offset).toEqual({ x: 20, y: 0 })
  }))

it.effect("A10: a target's subscriptions share its claim; another target is refused while it holds it", () =>
  Effect.gen(function* () {
    const activity = DragActivity.make()
    const h = yield* rigApart(activity, {
      track: Recognizer.drag(INNER),
      observer: Recognizer.drag(INNER, { axis: "x" }),
      outer: Recognizer.drag(OUTER),
    })
    yield* wholeGesture(h.push)
    expect(phases(h.seen.track!)).toBe("start move end")
    expect(phases(h.seen.observer!)).toBe("start move end")
    expect(phases(h.seen.outer!)).toBe("")
    expect(activity.isDragActive()).toBe(false)
  }))

it.effect("A11: claim: false neither claims nor is refused, but keeps the activity on", () =>
  Effect.gen(function* () {
    // On the outer: it runs beside the inner's claim.
    const a = DragActivity.make()
    const ha = yield* rigApart(a, { inner: Recognizer.drag(INNER), outer: Recognizer.drag(OUTER, { claim: false }) })
    yield* wholeGesture(ha.push)
    expect(phases(ha.seen.inner!)).toBe("start move end")
    expect(phases(ha.seen.outer!)).toBe("start move end")
    // On the inner: it leaves the claim to the outer (Motion's dragPropagation).
    const b = DragActivity.make()
    const hb = yield* rigApart(b, { inner: Recognizer.drag(INNER, { claim: false }), outer: Recognizer.drag(OUTER) })
    yield* hb.push(ev("down", 0, 0, 0))
    yield* hb.push(ev("move", 10, 10, 10))
    expect(phases(hb.seen.inner!)).toBe("start")
    expect(phases(hb.seen.outer!)).toBe("start")
    yield* hb.push(ev("up", 10, 10, 20))
    // Alone, it keeps the activity on while it runs.
    const c = DragActivity.make()
    const hc = yield* rigApart(c, { only: Recognizer.drag(INNER, { claim: false }) })
    yield* hc.push(ev("down", 0, 0, 0))
    yield* hc.push(ev("move", 10, 10, 10))
    expect(c.isDragActive()).toBe(true)
    // And it holds no axis.
    expect(Option.isSome(c.claim(OUTER, "xy").pipe(Option.map((release) => release())))).toBe(true)
    yield* hc.push(ev("up", 10, 10, 20))
    expect(c.isDragActive()).toBe(false)
  }))

it.effect("A12: an axis function is read at each gesture's start, and its axis holds to the gesture's end", () =>
  Effect.gen(function* () {
    let next: Drag.Axis = "x"
    const activity = DragActivity.make()
    const h = yield* rigApart(activity, {
      inner: Recognizer.drag(INNER, { axis: () => next }),
      outer: Recognizer.drag(OUTER, { axis: "y" }),
    })
    // On x: the outer, on y, runs too; a change mid-gesture doesn't apply until the next start.
    yield* h.push(ev("down", 0, 0, 0))
    yield* h.push(ev("move", 10, 10, 10))
    next = "y"
    yield* h.push(ev("move", 20, 20, 20))
    yield* h.push(ev("up", 20, 20, 30))
    expect(phases(h.seen.inner!)).toBe("start move end")
    expect(h.seen.inner!.at(-1)!.offset).toEqual({ x: 20, y: 0 })
    expect(phases(h.seen.outer!)).toBe("start move end")
    // On y: the outer needs y and is refused, so it sees nothing more.
    yield* wholeGesture(h.push, 100)
    expect(h.seen.inner!.at(-1)!.offset).toEqual({ x: 0, y: 20 })
    expect(phases(h.seen.outer!)).toBe("start move end")
  }))

it.effect("A13: a Stale gesture's end releases the claim (rule A)", () =>
  Effect.gen(function* () {
    const activity = DragActivity.make()
    const h = yield* rigApart(activity, { inner: Recognizer.drag(INNER), outer: Recognizer.drag(OUTER) })
    yield* h.push(ev("down", 0, 0, 0))
    yield* h.push(ev("move", 10, 0, 10))
    // The release is lost: the owner moves with no button pressed.
    yield* h.push(ev("move", 40, 0, 20, { buttons: 0 }))
    expect(phases(h.seen.inner!)).toBe("start end")
    expect(phases(h.seen.outer!)).toBe("")
    expect(activity.isDragActive()).toBe(false)
    expect(Option.isSome(activity.claim(OUTER, "xy").pipe(Option.map((release) => release())))).toBe(true)
  }))
