// Gesture watches (#318, ADR-0055): a recognizer as an Effect-scoped callback, with no fiber or
// Stream of its own, over the Test Environment's pushable Input feeds.
//
// - WT1: a watch hears an event inside the push (the platform's dispatch), before it returns.
// - WT2: closing the Scope unsubscribes: no event after it, and the target's feed stops.
// - WT3: a throw from a handler goes to `onDefect`, as a die, and the watch goes on with the next
//   event; another watch on the same target hears every event.
// - WT4: with no `onDefect`, the throw goes up the push, as an event listener's would.
// - WT5: an event a handler causes runs nested, inside it, before the handler goes on: a press's
//   handler that focuses its element sees the focus watch run first (Motion's order: its gestures are
//   plain listeners).
// - WT6: `watchInView` with `once` hears the first entry only; without, each entry and leave.
// - WT7: a pan's count in the Drag activity is given back when the Scope closes mid-pan.
// - WT8: a feed that runs out (a script) tells `onEnd`; the Streams over watches end with it.
import * as DragActivity from "@wardic/core/DragActivity"
import * as InputSource from "@wardic/core/InputSource"
import * as Recognizer from "@wardic/core/Recognizer"
import { TestInput, TestProbe } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as MutableRef from "effect/MutableRef"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"

/** A primary mouse's event, pressed except at the release or a leave. */
const ev = (type: InputSource.PointerLikeEvent["type"], x = 0, t = 0): InputSource.PointerLikeEvent =>
  InputSource.makePointerLikeEvent({ type, x, y: 0, pressed: type !== "up" && type !== "cancel" && type !== "leave", timeStamp: t, onTarget: true })

/** Run `watch` in a Scope of its own: the Scope, to close. */
const opened = <R>(watch: Effect.Effect<void, never, Scope.Scope | R>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    yield* watch.pipe(Scope.provide(scope))
    return scope
  })

it.effect("WT1: a watch hears an event inside the push, before it returns", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const heard: Array<boolean> = []
    yield* Effect.gen(function* () {
      yield* opened(Recognizer.watchHover("el", { on: (t) => heard.push(t.active) }))
      yield* input.push(ev("enter"))
      expect(heard, "heard inside the push").toEqual([true])
      yield* input.push(ev("leave"))
      expect(heard).toEqual([true, false])
    }).pipe(Effect.provide(input.layer))
  }))

it.effect("WT2: closing the Scope unsubscribes", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const heard: Array<string> = []
    yield* Effect.gen(function* () {
      const scope = yield* opened(Recognizer.watchPress("el", { on: (p) => heard.push(p.phase) }))
      yield* input.push(ev("down"))
      yield* Scope.close(scope, Exit.void)
      yield* input.push(ev("up"))
      expect(heard, "nothing after the close").toEqual(["start"])
    }).pipe(Effect.provide(input.layer))
  }))

it.effect("WT3: a throw goes to onDefect and the watch goes on; another watch on the target hears every event", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const defects: Array<Cause.Cause<never>> = []
    const heard: Array<string> = []
    const others: Array<boolean> = []
    yield* Effect.gen(function* () {
      yield* opened(
        Recognizer.watchHover("el", {
          on: (t) => {
            heard.push(`hover ${t.active}`)
            if (t.active) throw new Error("handler")
          },
          onDefect: (cause) => defects.push(cause),
        }),
      )
      yield* opened(Recognizer.watchHover("el", { on: (t) => others.push(t.active) }))
      yield* input.push(ev("enter"))
      yield* input.push(ev("leave"))
      expect(heard, "the next event still heard").toEqual(["hover true", "hover false"])
      expect(defects.length).toBe(1)
      expect(Cause.hasDies(defects[0]!), "a die").toBe(true)
      expect(others, "the other watch heard both").toEqual([true, false])
    }).pipe(Effect.provide(input.layer))
  }))

it.effect("WT4: with no onDefect, the throw goes up the push", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    yield* Effect.gen(function* () {
      yield* opened(Recognizer.watchHover("el", { on: () => {
        throw new Error("up the dispatch")
      } }))
      const exit = yield* Effect.exit(input.push(ev("enter")))
      expect(Exit.isFailure(exit)).toBe(true)
    }).pipe(Effect.provide(input.layer))
  }))

it.effect("WT5: an event a handler causes runs nested, inside it: a press that focuses sees the focus watch first", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const order: Array<string> = []
    yield* Effect.gen(function* () {
      yield* opened(Recognizer.watchFocus("el", {}, { on: (focused) => order.push(`focused ${focused}`) }))
      yield* opened(
        Recognizer.watchPress("el", {
          on: (p) => {
            order.push(`press ${p.phase}`)
            // The app's handler focuses the element: the platform dispatches the focus inside it.
            if (p.phase === "start") Effect.runSync(input.pushFocus({ type: "focus", timeStamp: 1 }))
            order.push(`after ${p.phase}`)
          },
        }),
      )
      yield* input.push(ev("down"))
      expect(order).toEqual(["press start", "focused true", "after start"])
    }).pipe(Effect.provide(input.layer))
  }))

it.effect("WT6: watchInView with once hears the first entry only; without, each entry and leave", () =>
  Effect.gen(function* () {
    const probe = yield* TestProbe.pushable()
    const once: Array<boolean> = []
    const every: Array<boolean> = []
    yield* Effect.gen(function* () {
      yield* opened(Recognizer.watchInView("el", { once: true }, { on: (t) => once.push(t.active) }))
      yield* opened(Recognizer.watchInView("el", {}, { on: (t) => every.push(t.active) }))
      yield* Effect.forEach([false, true, false, true], probe.pushIntersection, { discard: true })
      expect(once).toEqual([true])
      expect(every).toEqual([true, false, true])
    }).pipe(Effect.provide(probe.layer))
  }))

it.effect("WT7: a pan's count in the Drag activity is given back when the Scope closes mid-pan", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    yield* Effect.gen(function* () {
      const activity = yield* DragActivity.DragActivity
      const phases: Array<string> = []
      const scope = yield* opened(Recognizer.watchPan("el", { on: (s) => phases.push(s.phase) }))
      yield* input.push(ev("down", 0, 0))
      yield* input.push(ev("move", 20, 16))
      expect(phases).toContain("start")
      expect(activity.isDragActive(), "a pan under way counts").toBe(true)
      yield* Scope.close(scope, Exit.void)
      expect(activity.isDragActive(), "given back at the close").toBe(false)
    }).pipe(Effect.provide(input.layer))
  }))

it.effect("WT8: a feed that runs out tells onEnd; the Streams over watches end with it", () =>
  Effect.gen(function* () {
    const ended = MutableRef.make(0)
    const heard: Array<boolean> = []
    yield* Effect.scoped(Recognizer.watchHover("el", { on: (t) => heard.push(t.active), onEnd: () => MutableRef.increment(ended) })).pipe(
      Effect.provide(TestInput.layer([ev("enter"), ev("leave")])),
    )
    expect(heard).toEqual([true, false])
    expect(MutableRef.get(ended)).toBe(1)
    const collected = yield* Stream.runCollect(Recognizer.hoverEvents("el")).pipe(Effect.provide(TestInput.layer([ev("enter")])))
    expect(Array.from(collected).map((t) => t.active)).toEqual([true])
  }))
