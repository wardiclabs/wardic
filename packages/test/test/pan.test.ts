import * as DragActivity from "@wardic/core/DragActivity"
import * as InputSource from "@wardic/core/InputSource"
import * as Recognizer from "@wardic/core/Recognizer"
import { TestInput } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Predicate from "effect/Predicate"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"

// `Recognizer.pan` (#273, ADR-0047): Motion's pan, its session's start at a primary pointer's down,
// then a drag's start, moves and end. It takes no Drag claim; once started it counts in the Drag
// activity until its end (Wardic's rule: a press it took over is neither a tap nor a cancel, and no
// hover starts meanwhile).
//
// - PA1: the session at the down, with the down's point and event and no offset; a start past the
//   threshold, each move, an end at the release.
// - PA2: a press that never passed the threshold: its session only, no end. A right-click or a second
//   finger starts none.
// - PA3: counted in the Drag activity from its start to its end, not at its session; and off when
//   interrupted mid-pan.
// - PA4: a press on the same target it took over ends dragged, whichever subscribed first; a wobble
//   under the threshold still taps.
// - PA5: no claim: a claiming drag on another target isn't refused by it, and it isn't stopped by one.
// - PA6: no hover starts while it's on.
// - PA7: a lost release (the owner's second down) ends it, then a new session starts.

/** A primary mouse event (`makePointerLikeEvent`): pressed on a down or move, released otherwise. */
const ev = (type: InputSource.PointerLikeEvent["type"], x: number, t: number, o: Partial<InputSource.PointerLikeEvent> = {}): InputSource.PointerLikeEvent =>
  InputSource.makePointerLikeEvent({ type, x, y: 0, timeStamp: t, raw: `${type}@${x}`, ...o })

/** Subscribe `streams`, each in its own fiber, to one pushable input under `activity`. */
const rig = (activity: DragActivity.Shape, streams: ReadonlyArray<Stream.Stream<unknown, never, InputSource.InputSource>>) =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const seen = yield* Ref.make<ReadonlyArray<unknown>>([])
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

const isPan = (e: unknown): e is Recognizer.PanSample => Predicate.hasProperty(e, "offset")
const isPress = (e: unknown): e is Recognizer.PressEvent => Predicate.hasProperty(e, "event")

/** The pan samples seen: each phase, its point's x and offset's x, and its event. */
const pansOf = (seen: ReadonlyArray<unknown>): ReadonlyArray<string> =>
  seen.filter(isPan).map((s) => `${s.phase} ${s.point.x} off ${s.offset.x} ${String(s.raw)}`)

it.effect("PA1: the session at the down, then a start past the threshold, each move, and an end", () =>
  Effect.gen(function* () {
    const h = yield* rig(DragActivity.make(), [Recognizer.pan(undefined)])
    yield* h.push(ev("down", 10, 0))
    yield* h.push(ev("move", 12, 10))
    yield* h.push(ev("move", 20, 20))
    yield* h.push(ev("move", 30, 30))
    yield* h.push(ev("up", 30, 40, { pressed: false }))
    expect(pansOf(yield* h.seen)).toEqual([
      "session 10 off 0 down@10",
      "start 20 off 10 move@20",
      "move 30 off 20 move@30",
      "end 30 off 20 up@30",
    ])
    const session = (yield* h.seen).filter(isPan)[0]!
    expect({ delta: session.delta, velocity: session.velocity }).toEqual({ delta: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } })
    for (const fiber of h.fibers) yield* Fiber.interrupt(fiber)
  }))

it.effect("PA2: a press under the threshold: its session only; a right-click or a second finger starts none", () =>
  Effect.gen(function* () {
    const h = yield* rig(DragActivity.make(), [Recognizer.pan(undefined)])
    yield* h.push(ev("down", 0, 0))
    yield* h.push(ev("move", 2, 10))
    yield* h.push(ev("up", 2, 20, { pressed: false }))
    yield* h.push(ev("down", 0, 30, { button: "secondary" }))
    yield* h.push(ev("up", 0, 40, { button: "secondary", pressed: false }))
    yield* h.push(ev("down", 0, 50, { pointerId: 2, kind: "touch" }))
    yield* h.push(ev("down", 5, 60, { pointerId: 3, kind: "touch", primary: false }))
    expect(pansOf(yield* h.seen)).toEqual(["session 0 off 0 down@0", "session 0 off 0 down@0"])
    for (const fiber of h.fibers) yield* Fiber.interrupt(fiber)
  }))

it.effect("PA3: counted in the Drag activity from its start to its end, not at its session; off when interrupted", () =>
  Effect.gen(function* () {
    const activity = DragActivity.make()
    const h = yield* rig(activity, [Recognizer.pan(undefined)])
    yield* h.push(ev("down", 0, 0))
    expect(activity.isDragActive(), "at its session").toBe(false)
    yield* h.push(ev("move", 10, 10))
    expect(activity.isDragActive(), "started").toBe(true)
    yield* h.push(ev("up", 10, 20, { pressed: false }))
    expect(activity.isDragActive(), "ended").toBe(false)
    yield* h.push(ev("down", 0, 30))
    yield* h.push(ev("move", 10, 40))
    expect(activity.isDragActive()).toBe(true)
    for (const fiber of h.fibers) yield* Fiber.interrupt(fiber)
    expect(activity.isDragActive(), "interrupted mid-pan").toBe(false)
  }))

it.effect("PA4: a press on its target it took over ends dragged, whichever subscribed first; a wobble still taps", () =>
  Effect.gen(function* () {
    for (const pressFirst of [false, true]) {
      const pan = Recognizer.pan(undefined)
      const press = Recognizer.pressEvents(undefined)
      const h = yield* rig(DragActivity.make(), Bool.match(pressFirst, { onTrue: () => [press, pan], onFalse: () => [pan, press] }))
      const phases = Effect.map(h.seen, (seen) => seen.filter(isPress).map((e) => e.phase).join(" "))
      yield* h.push(ev("down", 0, 0))
      yield* h.push(ev("move", 10, 10))
      yield* h.push(ev("up", 10, 20, { pressed: false }))
      expect(yield* phases, `press subscribed ${Bool.match(pressFirst, { onTrue: () => "first", onFalse: () => "second" })}`).toBe("start dragged")
      yield* h.push(ev("down", 0, 30))
      yield* h.push(ev("move", 2, 40))
      yield* h.push(ev("up", 2, 50, { pressed: false }))
      expect(yield* phases).toBe("start dragged start tap")
      for (const fiber of h.fibers) yield* Fiber.interrupt(fiber)
    }
  }))

it.effect("PA5: no claim: a claiming drag isn't refused by it, and it isn't stopped by one", () =>
  Effect.gen(function* () {
    const activity = DragActivity.make()
    const labelled = <A extends { readonly phase: string }>(label: string, stream: Stream.Stream<A, never, InputSource.InputSource>) =>
      Stream.map(stream, (sample) => `${label} ${sample.phase}`)
    // Subscribed first, the drag plays the inner draggable, and claims first: the pan goes on.
    const h = yield* rig(activity, [labelled("drag", Recognizer.drag({ name: "inner" })), labelled("pan", Recognizer.pan({ name: "outer" }))])
    yield* h.push(ev("down", 0, 0))
    yield* h.push(ev("move", 10, 10))
    yield* h.push(ev("up", 10, 20, { pressed: false }))
    expect(yield* h.seen).toEqual(["pan session", "drag start", "pan start", "drag end", "pan end"])
    for (const fiber of h.fibers) yield* Fiber.interrupt(fiber)
    // The pan first: it takes no claim, so the drag after it isn't refused.
    const h2 = yield* rig(activity, [labelled("pan", Recognizer.pan({ name: "inner" })), labelled("drag", Recognizer.drag({ name: "outer" }))])
    yield* h2.push(ev("down", 0, 30))
    yield* h2.push(ev("move", 10, 40))
    yield* h2.push(ev("up", 10, 50, { pressed: false }))
    expect(yield* h2.seen).toEqual(["pan session", "pan start", "drag start", "pan end", "drag end"])
    for (const fiber of h2.fibers) yield* Fiber.interrupt(fiber)
  }))

it.effect("PA6: no hover starts while it's on", () =>
  Effect.gen(function* () {
    const activity = DragActivity.make()
    const h = yield* rig(activity, [Recognizer.pan(undefined), Recognizer.hover({ name: "elsewhere" })])
    yield* h.push(ev("down", 0, 0))
    yield* h.push(ev("move", 10, 10))
    yield* h.push(ev("enter", 10, 20))
    expect((yield* h.seen).filter((e) => e === true), "no hover mid-pan").toEqual([])
    for (const fiber of h.fibers) yield* Fiber.interrupt(fiber)
  }))

it.effect("PA7: a lost release (the owner's second down) ends it, then a new session starts", () =>
  Effect.gen(function* () {
    const h = yield* rig(DragActivity.make(), [Recognizer.pan(undefined)])
    yield* h.push(ev("down", 0, 0))
    yield* h.push(ev("move", 10, 10))
    yield* h.push(ev("down", 50, 20))
    expect(pansOf(yield* h.seen)).toEqual(["session 0 off 0 down@0", "start 10 off 10 move@10", "end 10 off 10 down@50", "session 50 off 0 down@50"])
    for (const fiber of h.fibers) yield* Fiber.interrupt(fiber)
  }))
