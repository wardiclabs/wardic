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
// - WT9: `watchDrag` (#379) tells a gesture's start, moves and end inside the push, kept to its axis;
//   its claim is taken before `on` hears the start and given back before it hears the end.
// - WT10: a throw from `on` at the start goes to `onDefect` and keeps no claim: the gesture goes on to
//   its end, then nothing is active, and the next gesture is told.
// - WT11: closing the Scope mid-gesture gives the claim back.
// - WT12: a gesture another target's claim refuses tells nothing, its end included; `claim: false`
//   is never refused and only counts.
import * as DragActivity from "@wardic/core/DragActivity"
import * as InputSource from "@wardic/core/InputSource"
import * as Recognizer from "@wardic/core/Recognizer"
import { TestInput, TestProbe } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
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

/** A drag of a primary mouse along x: down at 0, past the threshold at 20, on to 40, up there. */
const gesture = (t0: number): ReadonlyArray<InputSource.PointerLikeEvent> => [
  ev("down", 0, t0),
  ev("move", 20, t0 + 16),
  ev("move", 40, t0 + 32),
  ev("up", 40, t0 + 48),
]

it.effect("WT9: watchDrag tells a gesture inside the push, kept to its axis; its claim is held from before the start to before the end", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    yield* Effect.gen(function* () {
      const activity = yield* DragActivity.DragActivity
      const told: Array<string> = []
      yield* opened(Recognizer.watchDrag("el", { axis: "x" }, {
        on: (s) => told.push(`${s.phase} ${s.offset.x},${s.offset.y} ${s.axis} active:${activity.isDragActive()}`),
      }))
      const [down, start, move, up] = gesture(0)
      yield* input.push(down!)
      yield* input.push(start!)
      expect(told, "the start, inside its push, with the claim already held").toEqual(["start 20,0 x active:true"])
      yield* input.push(move!)
      yield* input.push(up!)
      expect(told.slice(1)).toEqual(["move 40,0 x active:true", "end 40,0 x active:false"])
    }).pipe(Effect.provide(input.layer))
  }))

it.effect("WT10: a throw from on at the start goes to onDefect and keeps no claim; the next gesture is told", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    yield* Effect.gen(function* () {
      const activity = yield* DragActivity.DragActivity
      const defects: Array<Cause.Cause<never>> = []
      const phases: Array<string> = []
      yield* opened(Recognizer.watchDrag("el", {}, {
        on: (s) => {
          phases.push(s.phase)
          if (phases.length === 1) throw new Error("the response broke")
        },
        onDefect: (cause) => defects.push(cause),
      }))
      yield* Effect.forEach(gesture(0), input.push, { discard: true })
      expect(defects, "reported once").toHaveLength(1)
      expect(activity.isDragActive(), "no claim kept").toBe(false)
      yield* Effect.forEach(gesture(100), input.push, { discard: true })
      expect(phases).toEqual(["start", "move", "end", "start", "move", "end"])
    }).pipe(Effect.provide(input.layer))
  }))

it.effect("WT11: closing the Scope mid-gesture gives the claim back", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    yield* Effect.gen(function* () {
      const activity = yield* DragActivity.DragActivity
      const scope = yield* opened(Recognizer.watchDrag("el", {}, { on: () => undefined }))
      const [down, start] = gesture(0)
      yield* input.push(down!)
      yield* input.push(start!)
      expect(activity.isDragActive(), "held mid-gesture").toBe(true)
      yield* Scope.close(scope, Exit.void)
      expect(activity.isDragActive(), "given back at the close").toBe(false)
    }).pipe(Effect.provide(input.layer))
  }))

it.effect("WT12: a gesture another target's claim refuses tells nothing, its end included; claim: false only counts", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    yield* Effect.gen(function* () {
      const activity = yield* DragActivity.DragActivity
      const refused: Array<string> = []
      const free: Array<string> = []
      yield* opened(Recognizer.watchDrag("el", { axis: "x" }, { on: (s) => refused.push(s.phase) }))
      yield* opened(Recognizer.watchDrag("el", { axis: "x", claim: false }, { on: (s) => free.push(s.phase) }))
      const other = activity.claim("other", "x")
      expect(Option.isSome(other), "another target holds x").toBe(true)
      yield* Effect.forEach(gesture(0), input.push, { discard: true })
      expect(refused, "refused: nothing told").toEqual([])
      expect(free, "claim: false is never refused").toEqual(["start", "move", "end"])
      Option.map(other, (release) => release())
      expect(activity.isDragActive(), "nothing kept").toBe(false)
    }).pipe(Effect.provide(input.layer))
  }))

