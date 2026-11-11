// A drag among many members (#712, ADR-0072 decision 7): one watch over the feed over many targets
// (`pointerAmong`) hears a member's down, and drags that member as core's drag recognizer would, through
// the down handed to it (`adoptPointer`, as drag controls do, #431). No member listens until it's pressed.
// Over the Test Environment's pushable Input feeds.
//
// The DOM tells a release to this feed's listener before the member's own, and a trusted event runs the
// page's microtasks between them: these tests push the feed's release first, then a microtask, then the
// member's, as the DOM does.
//
// - DA1: a member's drag gives the samples its own press's `watchDrag` gives, each told with the member:
//   the start past the threshold, the moves, the end with its velocity, though the feed's release came first.
// - DA2: a press that never passes the threshold tells nothing, and its watch ends at the release: the
//   pointer's later moves tell nothing, and the next press, on another member, drags that one.
// - DA3: the watch's Scope closing mid-gesture ends it: the drag's claim is given back.
// - DA4: an Environment with no `pointerAmong` fails the watch, naming it.
// - DA5: another pointer's press and release on the member being dragged end nothing: its drag runs on to
//   its own end.
// - DA6: a press whose release was lost (an unpressed move) ends its watch, so the member's next press drags.
import type * as Drag from "@wardic/core/Drag"
import * as DragActivity from "@wardic/core/DragActivity"
import * as DragRecognizer from "@wardic/core/DragRecognizer"
import * as InputSource from "@wardic/core/InputSource"
import { TestInput } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"

/** A primary mouse's event at `(x, y)`, pressed except at the release. */
const ev = (type: InputSource.PointerLikeEvent["type"], x: number, t: number, y = 0, pointerId = 1): InputSource.PointerLikeEvent =>
  InputSource.makePointerLikeEvent({ type, x, y, pressed: type !== "up", timeStamp: t, pointerId })

/** The rest of this task's work run: a trusted event's microtask checkpoint between two listeners. */
const microtask = Effect.promise(() => Promise.resolve())

/** A sample as one line: its phase, offset and velocity. */
const line = (s: Drag.Sample): string => `${s.phase} ${s.offset.x},${s.offset.y} v${Math.round(s.velocity.x)},${Math.round(s.velocity.y)}`

/** Every string is a member: the feed over many targets names the target it was pushed for. */
const memberOf = (node: unknown): Option.Option<unknown> => Option.some(node)

/** Run `watch` in a Scope of its own: the Scope, to close. */
const opened = <A, R>(watch: Effect.Effect<A, never, Scope.Scope | R>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    yield* watch.pipe(Scope.provide(scope))
    return scope
  })

it.effect("DA1: a member's drag gives the samples its own press's watchDrag gives, though the feed's release comes first", () =>
  Effect.gen(function* () {
    // The reference: `watchDrag` on "b" hearing its own press.
    const reference = yield* TestInput.pushable()
    const expected: Array<string> = []
    yield* Effect.gen(function* () {
      yield* opened(DragRecognizer.watchDrag("b", {}, { on: (s) => expected.push(line(s)) }))
      yield* reference.push(ev("down", 0, 0))
      yield* reference.push(ev("move", 20, 16))
      yield* reference.push(ev("move", 40, 32))
      yield* reference.push(ev("move", 70, 48))
      yield* reference.push(ev("up", 70, 64))
    }).pipe(Effect.provide(reference.layer))

    const input = yield* TestInput.pushable()
    const told: Array<string> = []
    yield* Effect.gen(function* () {
      yield* opened(DragRecognizer.watchDragAmong(memberOf, {}, { on: (target, s) => told.push(`${String(target)}: ${line(s)}`) }))
      yield* input.pushTo("b", ev("down", 0, 0))
      yield* input.push(ev("move", 20, 16))
      yield* input.push(ev("move", 40, 32))
      yield* input.push(ev("move", 70, 48))
      // The DOM's order: the feed over the members first, a microtask, then the member's own.
      yield* input.pushTo("b", ev("up", 70, 64))
      yield* microtask
      yield* input.push(ev("up", 70, 64))
    }).pipe(Effect.provide(input.layer))
    expect(expected, "the reference drags").toHaveLength(4)
    expect(told).toEqual(expected.map((sample) => `b: ${sample}`))
  }))

it.effect("DA2: a press below the threshold tells nothing and ends at its release; the next press drags its own member", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const told: Array<string> = []
    yield* Effect.gen(function* () {
      yield* opened(DragRecognizer.watchDragAmong(memberOf, {}, { on: (target, s) => told.push(`${String(target)}: ${s.phase}`) }))
      yield* input.pushTo("a", ev("down", 0, 0))
      yield* input.push(ev("move", 2, 16))
      yield* input.pushTo("a", ev("up", 2, 32))
      yield* microtask
      yield* input.push(ev("up", 2, 32))
      // Its watch ended at the release: "a" hears nothing more.
      yield* input.push(ev("move", 40, 48))
      expect(told, "a tap tells nothing").toEqual([])
      yield* input.pushTo("c", ev("down", 100, 64))
      yield* input.push(ev("move", 120, 80))
      yield* input.pushTo("c", ev("up", 120, 96))
      yield* microtask
      yield* input.push(ev("up", 120, 96))
    }).pipe(Effect.provide(input.layer))
    expect(told).toEqual(["c: start", "c: end"])
  }))

it.effect("DA3: the watch's Scope closing mid-gesture ends it, its claim given back", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    yield* Effect.gen(function* () {
      const activity = yield* DragActivity.DragActivity
      const scope = yield* opened(DragRecognizer.watchDragAmong(memberOf, {}, { on: () => {} }))
      yield* input.pushTo("a", ev("down", 0, 0))
      yield* input.push(ev("move", 30, 16))
      expect(activity.isDragActive(), "a drag on").toBe(true)
      yield* Scope.close(scope, Exit.void)
      expect(activity.isDragActive(), "its claim given back").toBe(false)
    }).pipe(Effect.provide(input.layer))
  }))

it.effect("DA4: an Environment with no pointerAmong fails the watch, naming it", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const without = Layer.effect(InputSource.InputSource)(
      Effect.map(InputSource.InputSource, (source) => ({ ...source, pointerAmong: undefined })),
    ).pipe(Layer.provide(input.layer))
    const exit = yield* Effect.exit(opened(DragRecognizer.watchDragAmong(memberOf, {}, { on: () => {} })).pipe(Effect.provide(without)))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(String(Exit.isFailure(exit) && exit.cause)).toContain("pointerAmong")
  }))

it.effect("DA5: another pointer's press and release on the dragged member end nothing; its drag runs on to its end", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const told: Array<string> = []
    yield* Effect.gen(function* () {
      yield* opened(DragRecognizer.watchDragAmong(memberOf, {}, { on: (target, s) => told.push(`${String(target)}: ${s.phase}`) }))
      yield* input.pushTo("a", ev("down", 0, 0))
      yield* input.push(ev("move", 30, 16))
      // A second finger taps "a" mid-drag.
      yield* input.pushTo("a", ev("down", 200, 20, 0, 2))
      yield* input.pushTo("a", ev("up", 200, 24, 0, 2))
      yield* microtask
      yield* input.push(ev("move", 60, 32))
      yield* input.pushTo("a", ev("up", 60, 48))
      yield* microtask
      yield* input.push(ev("up", 60, 48))
    }).pipe(Effect.provide(input.layer))
    expect(told).toEqual(["a: start", "a: move", "a: end"])
  }))

it.effect("DA6: a press whose release was lost ends its watch, so the member's next press drags", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const told: Array<string> = []
    yield* Effect.gen(function* () {
      yield* opened(DragRecognizer.watchDragAmong(memberOf, {}, { on: (target, s) => told.push(`${String(target)}: ${s.phase}`) }))
      yield* input.pushTo("a", ev("down", 0, 0))
      // Its release lost (a context menu took it): the held pointer moves unpressed.
      yield* input.pushTo("a", InputSource.makePointerLikeEvent({ type: "move", x: 1, y: 0, pressed: false, timeStamp: 16 }))
      yield* microtask
      yield* input.pushTo("a", ev("down", 10, 32))
      yield* input.push(ev("move", 40, 48))
      yield* input.pushTo("a", ev("up", 40, 64))
      yield* microtask
      yield* input.push(ev("up", 40, 64))
    }).pipe(Effect.provide(input.layer))
    expect(told).toEqual(["a: start", "a: end"])
  }))
