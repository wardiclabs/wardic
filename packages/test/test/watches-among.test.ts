// Hover and press over many targets from one source (#665's PR 5, Q56): `Recognizer.watchHoverAmong` and
// `watchPressAmong` on an InputSource's `pointerAmong` and `focusAmong`, each target told what
// `watchHover` and `watchPress` would tell it of its own events.
//
// - WA1: each target's hover edges, interleaved, are `watchHover`'s on that target's events alone: touch
//   never hovers; a leave while a pointer that pressed it is held waits for the release.
// - WA2: no hover starts while a drag is active, on any target.
// - WA3: each target's presses are `watchPress`'s on its events alone: a tap, a release elsewhere (a
//   cancel), a lost release, a press a drag took over.
// - WA4: a down a press inside claimed starts no press among the targets; one only marked does.
// - WA5: a focused target's Enter and Space press it, as `watchPress`'s keyboard press: keys before its
//   focus, or after its blur, press nothing, and another target's focus has its own keys; a blur cancels a
//   key's press.
// - WA6: `memberOf` names the target: a pushed node that's no target's tells nothing.
// - WA7: an InputSource with no `pointerAmong` is a defect naming it.
// - WA8: five hundred targets, their enters and leaves interleaved: each target's edges are its own.
import * as DragActivity from "@wardic/core/DragActivity"
import * as InputSource from "@wardic/core/InputSource"
import * as PressClaims from "@wardic/core/PressClaims"
import * as Recognizer from "@wardic/core/Recognizer"
import { TestInput } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"

/** A primary pointer's event, pressed except at a release, a cancel or a leave. */
const ev = (type: InputSource.PointerLikeEvent["type"], extra: Partial<InputSource.PointerLikeEvent> = {}): InputSource.PointerLikeEvent =>
  InputSource.makePointerLikeEvent({ type, x: 0, y: 0, pressed: type !== "up" && type !== "cancel" && type !== "leave", timeStamp: 0, onTarget: true, ...extra })

/** A key's event: Enter or Space, going down or up. */
const key = (type: "down" | "up", name: InputSource.Key = "enter"): InputSource.KeyboardLikeEvent => ({
  type,
  key: name,
  repeat: false,
  timeStamp: 0,
  fromTarget: true,
  handled: false,
  handle: () => undefined,
  action: "none",
})

/** A focus or blur of the target itself. */
const focusOf = (type: "focus" | "blur"): InputSource.FocusLikeEvent => ({ type, timeStamp: 0, fromTarget: true })

/** Run `watch` in a Scope of its own: the Scope, to close. */
const opened = <R>(watch: Effect.Effect<void, never, Scope.Scope | R>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    yield* watch.pipe(Scope.provide(scope))
    return scope
  })

/** Targets a, b and c, by name: what `memberOf` names. */
const TARGETS = new Set<unknown>(["a", "b", "c"])
const memberOf = (node: unknown): Option.Option<unknown> => Bool.match(TARGETS.has(node), { onTrue: () => Option.some(node), onFalse: () => Option.none() })

/** `heard`'s list for `target`, with `value` added. */
const told = <A>(heard: Map<unknown, Array<A>>, target: unknown, value: A): void => {
  heard.set(target, [...(heard.get(target) ?? []), value])
}

/** A script's events for `target` alone, in order. */
const eventsFor = <A>(script: ReadonlyArray<readonly [unknown, A]>, target: unknown): ReadonlyArray<A> =>
  script.filter(([at]) => at === target).map(([, event]) => event)

/** What `watchHover` tells each target of its own events: one pushable a target. */
const hoverAlone = (script: ReadonlyArray<readonly [unknown, InputSource.PointerLikeEvent]>, target: unknown) =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const heard: Array<boolean> = []
    yield* Effect.gen(function* () {
      yield* opened(Recognizer.watchHover(target, { on: (edge) => heard.push(edge.active) }))
      for (const event of eventsFor(script, target)) yield* input.push(event)
    }).pipe(Effect.provide(input.layer))
    return heard
  })

/** What `watchPress` tells each target of its own events. */
const pressAlone = (script: ReadonlyArray<readonly [unknown, InputSource.PointerLikeEvent]>, target: unknown) =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const heard: Array<string> = []
    yield* Effect.gen(function* () {
      yield* opened(Recognizer.watchPress(target, { on: (told) => heard.push(told.phase) }))
      for (const event of eventsFor(script, target)) yield* input.push(event)
    }).pipe(Effect.provide(input.layer))
    return heard
  })

it.effect("WA1: each target's hover edges are watchHover's on its events alone", () =>
  Effect.gen(function* () {
    const script: ReadonlyArray<readonly [unknown, InputSource.PointerLikeEvent]> = [
      ["a", ev("enter")],
      ["b", ev("enter", { kind: "touch", pointerId: 2 })],
      ["a", ev("down")],
      ["a", ev("leave")],
      ["b", ev("enter")],
      ["a", ev("up", { onTarget: false })],
      ["b", ev("leave")],
      ["c", ev("enter")],
    ]
    const input = yield* TestInput.pushable()
    const heard = new Map<unknown, Array<boolean>>()
    yield* Effect.gen(function* () {
      yield* opened(Recognizer.watchHoverAmong(memberOf, { on: (target, edge) => told(heard, target, edge.active) }))
      for (const [target, event] of script) yield* input.pushTo(target, event)
    }).pipe(Effect.provide(input.layer))
    for (const target of TARGETS) expect(heard.get(target) ?? [], `target ${String(target)}`).toEqual(yield* hoverAlone(script, target))
    expect(heard.get("a")).toEqual([true, false])
    expect(heard.get("b")).toEqual([true, false])
    expect(heard.get("c")).toEqual([true])
  }))

it.effect("WA2: no hover starts while a drag is active, on any target", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const heard: Array<readonly [unknown, boolean]> = []
    yield* Effect.gen(function* () {
      const activity = yield* DragActivity.DragActivity
      yield* opened(Recognizer.watchHoverAmong(memberOf, { on: (target, edge) => heard.push([target, edge.active]) }))
      const release = activity.count()
      yield* input.pushTo("a", ev("enter"))
      release()
      yield* input.pushTo("b", ev("enter"))
    }).pipe(Effect.provide(input.layer))
    expect(heard).toEqual([["b", true]])
  }))

it.effect("WA3: each target's presses are watchPress's on its events alone", () =>
  Effect.gen(function* () {
    const script: ReadonlyArray<readonly [unknown, InputSource.PointerLikeEvent]> = [
      ["a", ev("down")],
      ["b", ev("down", { pointerId: 2, button: "secondary" })],
      ["a", ev("up")],
      ["b", ev("down")],
      ["b", ev("up", { onTarget: false })],
      ["c", ev("down")],
      ["c", ev("move", { pressed: false })],
      ["a", ev("down")],
      ["a", ev("cancel")],
    ]
    const input = yield* TestInput.pushable()
    const heard = new Map<unknown, Array<string>>()
    yield* Effect.gen(function* () {
      yield* opened(Recognizer.watchPressAmong(memberOf, { on: (target, press) => told(heard, target, press.phase) }))
      for (const [target, event] of script) yield* input.pushTo(target, event)
    }).pipe(Effect.provide(input.layer))
    for (const target of TARGETS) expect(heard.get(target) ?? [], `target ${String(target)}`).toEqual(yield* pressAlone(script, target))
    expect(heard.get("a")).toEqual(["start", "tap", "start", "cancel"])
    expect(heard.get("b")).toEqual(["start", "cancel"])
    expect(heard.get("c")).toEqual(["start", "cancel"])
    // A press a drag took over: neither a tap nor a cancel.
    const dragged: Array<string> = []
    const later = yield* TestInput.pushable()
    yield* Effect.gen(function* () {
      const activity = yield* DragActivity.DragActivity
      yield* opened(Recognizer.watchPressAmong(memberOf, { on: (_, press) => dragged.push(press.phase) }))
      yield* later.pushTo("a", ev("down"))
      const release = activity.count()
      yield* later.pushTo("a", ev("move"))
      release()
      yield* later.pushTo("a", ev("up"))
    }).pipe(Effect.provide(later.layer))
    expect(dragged).toEqual(["start", "dragged"])
  }))

it.effect("WA4: a down a press inside claimed starts no press among the targets; one only marked does", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const heard: Array<readonly [unknown, string]> = []
    yield* Effect.gen(function* () {
      const claims = yield* PressClaims.PressClaims
      yield* opened(Recognizer.watchPressAmong(memberOf, { on: (target, press) => heard.push([target, press.phase]) }))
      const claimed = ev("down")
      claims.mark(claimed, "inner", true)
      yield* input.pushTo("a", claimed)
      const marked = ev("down", { pointerId: 3 })
      claims.mark(marked, "inner", false)
      yield* input.pushTo("b", marked)
    }).pipe(Effect.provide(input.layer))
    expect(heard).toEqual([["b", "start"]])
  }))

it.effect("WA5: a focused target's Enter and Space press it; a blur cancels a key's press", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const heard: Array<readonly [unknown, string, string]> = []
    yield* Effect.gen(function* () {
      yield* opened(Recognizer.watchPressAmong(memberOf, { on: (target, press) => heard.push([target, press.phase, press.input]) }))
      // Before any focus: nothing.
      yield* input.pushKey(key("down"))
      yield* input.pushKey(key("up"))
      yield* input.pushFocusTo("a", focusOf("focus"))
      yield* input.pushKey(key("down"))
      yield* input.pushKey(key("up"))
      yield* input.pushKey(key("down", "space"))
      yield* input.pushFocusTo("a", focusOf("blur"))
      // Its keys let go with its focus.
      yield* input.pushKey(key("up", "space"))
      yield* input.pushKey(key("down"))
      yield* input.pushKey(key("up"))
      // Another target's focus: its keys, and none of a's.
      yield* input.pushFocusTo("b", focusOf("focus"))
      yield* input.pushKey(key("down"))
      yield* input.pushKey(key("up"))
    }).pipe(Effect.provide(input.layer))
    expect(heard).toEqual([
      ["a", "start", "keyboard"],
      ["a", "tap", "keyboard"],
      ["a", "start", "keyboard"],
      ["a", "cancel", "keyboard"],
      ["b", "start", "keyboard"],
      ["b", "tap", "keyboard"],
    ])
  }))

it.effect("WA6: a pushed node that's no target's tells nothing", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const heard: Array<unknown> = []
    yield* Effect.gen(function* () {
      yield* opened(Recognizer.watchHoverAmong(memberOf, { on: (target) => heard.push(target) }))
      yield* input.pushTo("elsewhere", ev("enter"))
      yield* input.pushTo("a", ev("enter"))
    }).pipe(Effect.provide(input.layer))
    expect(heard).toEqual(["a"])
  }))

it.effect("WA7: an InputSource with no pointerAmong is a defect naming it", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const bare = Layer.effect(InputSource.InputSource)(
      Effect.map(InputSource.InputSource, (given): InputSource.InputSource["Service"] => ({ ...given, pointerAmong: undefined })),
    ).pipe(Layer.provide(input.layer))
    const exit = yield* Effect.exit(opened(Recognizer.watchHoverAmong(memberOf, { on: () => undefined })).pipe(Effect.provide(bare)))
    expect(Exit.isFailure(exit)).toBe(true)
    const defect = Exit.match(exit, { onSuccess: () => undefined, onFailure: (cause) => Cause.squash(cause) })
    expect(String(UndefinedOr.getOrThrow(defect))).toMatch(/pointerAmong/)
  }))

it.effect("WA8: five hundred targets, interleaved: each target's edges are its own", () =>
  Effect.gen(function* () {
    const many = Array.from({ length: 500 }, (_, n) => ({ n }))
    const known = new Set<unknown>(many)
    const input = yield* TestInput.pushable()
    const heard = new Map<unknown, Array<boolean>>()
    yield* Effect.gen(function* () {
      yield* opened(Recognizer.watchHoverAmong((node) => Bool.match(known.has(node), { onTrue: () => Option.some(node), onFalse: () => Option.none() }), { on: (target, edge) => told(heard, target, edge.active) }))
      // Each one entered, then every other one left, in another order.
      for (const target of many) yield* input.pushTo(target, ev("enter"))
      for (const target of [...many].reverse()) if (target.n % 2 === 0) yield* input.pushTo(target, ev("leave"))
    }).pipe(Effect.provide(input.layer))
    many.forEach((target) => expect(heard.get(target), `target ${target.n}`).toEqual(Bool.match(target.n % 2 === 0, { onTrue: () => [true, false], onFalse: () => [true] })))
  }))
