// Drag controls' core (#431, Motion's `useDragControls`): a pointer pressed elsewhere, adopted by a
// target, starts its drag, and a drag's watch ends its gesture from outside its pointer. Over the Test
// Environment's pushable Input feeds, and core's `heldPointer` over fake feeds.
//
// - DC1: an adopted down starts a drag as the target's own press does; a press and a pan leave it out.
// - DC2: with `listen: false` the target's own press drags nothing, and an adopted down does; the same
//   press adopted after its own down drags from the adopted one.
// - DC3: `threshold` is read at the down: an adopted gesture starts past its own, an own press at 3 px;
//   a direction lock waits for both.
// - DC4: `stop` ends a started gesture as a release, at its last point with its moves' velocity, the
//   claim given back before the end is told; the pointer's later events tell nothing. Before the
//   start it tells nothing, and the pointer drags no more.
// - DC5: `cancel` ends it with no velocity, marked `cancelled`; once the Scope has closed, neither
//   tells anything.
// - DC6: `heldPointer` holds an adopted down from inside the call: delivered marked, its page-wide
//   moves and release unmarked; the same press's own down on the target keeps the one hold.
// - DC7: a watch that isn't `adoptable` can't be ended from outside (#539): its `stop` and `cancel`
//   tell nothing, and its gesture runs on to its pointer's release.
// - DC8 (#618, F3): `watchDrag`'s overloads: an `adoptable: true` watch is an `AdoptableDrag`, a plain
//   one a `WatchedDrag` with no ends, and one with `adoptable` known only at run time an `AdoptableDrag`.
import type * as Drag from "@wardic/core/Drag"
import * as DragActivity from "@wardic/core/DragActivity"
import * as InputSource from "@wardic/core/InputSource"
import * as DragRecognizer from "@wardic/core/DragRecognizer"
import * as Recognizer from "@wardic/core/Recognizer"
import { TestInput } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import { expectTypeOf } from "vitest"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { constVoid } from "effect/Function"
import * as Scope from "effect/Scope"
import * as Option from "effect/Option"

/** A primary mouse's event at `(x, y)`, pressed except at the release. */
const ev = (type: InputSource.PointerLikeEvent["type"], x: number, t: number, y = 0): InputSource.PointerLikeEvent =>
  InputSource.makePointerLikeEvent({ type, x, y, pressed: type !== "up", timeStamp: t })

/** Run `watch` in a Scope of its own: the Scope, to close, and what it returned. */
const opened = <A, R>(watch: Effect.Effect<A, never, Scope.Scope | R>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const value = yield* watch.pipe(Scope.provide(scope))
    return { scope, value }
  })

/** A sample as one line: its phase and offset, and a cancelled one's mark. */
const line = (s: Drag.Sample): string =>
  `${s.phase} ${s.offset.x},${s.offset.y}${Bool.match(s.cancelled === true, { onTrue: () => " cancelled", onFalse: () => "" })}`

it.effect("DC1: an adopted down starts a drag as an own press does; a press and a pan leave it out", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    yield* Effect.gen(function* () {
      const source = yield* InputSource.InputSource
      const drags: Array<string> = []
      const presses: Array<string> = []
      const pans: Array<string> = []
      yield* opened(DragRecognizer.watchDrag("el", {}, { on: (s) => drags.push(line(s)) }))
      yield* opened(Recognizer.watchPress("el", { on: (p) => presses.push(p.phase) }))
      yield* opened(DragRecognizer.watchPan("el", { on: (s) => pans.push(s.phase) }))
      const down = source.adoptPointer("el", ev("down", 0, 0))
      expect(Option.map(down, (d) => d.adopted), "the down as delivered").toEqual(Option.some(true))
      expect(source.adoptPointer("el", ev("up", 0, 0)), "a release isn't a pressed pointer").toEqual(Option.none())
      yield* input.push(ev("move", 20, 16))
      yield* input.push(ev("move", 40, 32))
      yield* input.push(ev("up", 40, 48))
      expect(drags).toEqual(["start 20,0", "move 40,0", "end 40,0"])
      expect(presses, "no press").toEqual([])
      expect(pans, "no pan").toEqual([])
      // The target's own press is a press, a pan and a drag, as ever.
      yield* input.push(ev("down", 100, 100))
      yield* input.push(ev("move", 120, 116))
      yield* input.push(ev("up", 120, 132))
      expect(drags.slice(3)).toEqual(["start 20,0", "end 20,0"])
      expect(presses).toEqual(["start", "dragged"])
      expect(pans).toEqual(["session", "start", "end"])
    }).pipe(Effect.provide(input.layer))
  }))

it.effect("DC2: with listen: false an own press drags nothing and an adopted down does", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    yield* Effect.gen(function* () {
      const source = yield* InputSource.InputSource
      const drags: Array<string> = []
      yield* opened(DragRecognizer.watchDrag("el", { listen: false }, { on: (s) => drags.push(line(s)) }))
      yield* input.push(ev("down", 0, 0))
      yield* input.push(ev("move", 30, 16))
      yield* input.push(ev("up", 30, 32))
      expect(drags, "the own press drags nothing").toEqual([])
      // The same press, its own down first, then adopted (a handle inside the target): the adopted one claims.
      yield* input.push(ev("down", 0, 100))
      source.adoptPointer("el", ev("down", 5, 100))
      yield* input.push(ev("move", 25, 116))
      yield* input.push(ev("up", 25, 132))
      expect(drags, "from the adopted down's point").toEqual(["start 20,0", "end 20,0"])
    }).pipe(Effect.provide(input.layer))
  }))

it.effect("DC3: the threshold is read at the down: an adopted gesture's own, an own press's 3 px; a lock waits for both", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    yield* Effect.gen(function* () {
      const source = yield* InputSource.InputSource
      const threshold = (down: InputSource.PointerLikeEvent): Option.Option<number> => {
        if (down.adopted === true) return Option.some(20)
        return Option.none()
      }
      const drags: Array<string> = []
      const scope = yield* opened(DragRecognizer.watchDrag("el", { threshold }, { on: (s) => drags.push(line(s)) }))
      source.adoptPointer("el", ev("down", 0, 0))
      yield* input.push(ev("move", 15, 16))
      expect(drags, "not past 20 px").toEqual([])
      yield* input.push(ev("move", 25, 32))
      yield* input.push(ev("up", 25, 48))
      expect(drags).toEqual(["start 25,0", "end 25,0"])
      yield* input.push(ev("down", 0, 100))
      yield* input.push(ev("move", 5, 116))
      yield* input.push(ev("up", 5, 132))
      expect(drags.slice(2), "an own press at 3 px").toEqual(["start 5,0", "end 5,0"])
      yield* Scope.close(scope.scope, Exit.void)

      // A lock: 12 px down is past the lock, not past 20 px; 21 px down is past both.
      const locked: Array<string> = []
      yield* opened(DragRecognizer.watchDrag("el", { threshold, lock: true }, { on: (s) => locked.push(`${line(s)} ${s.axis}`) }))
      source.adoptPointer("el", ev("down", 0, 200))
      yield* input.push(ev("move", 0, 216, 12))
      expect(locked, "past the lock, not the threshold").toEqual([])
      yield* input.push(ev("move", 0, 232, 21))
      yield* input.push(ev("up", 0, 248, 21))
      expect(locked).toEqual(["start 0,21 y", "end 0,21 y"])
    }).pipe(Effect.provide(input.layer))
  }))

it.effect("DC4: stop ends a started gesture as a release, its claim given back first; before the start it tells nothing", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    yield* Effect.gen(function* () {
      const activity = yield* DragActivity.DragActivity
      const told: Array<Drag.Sample> = []
      const active: Array<boolean> = []
      const { value: drag } = yield* opened(DragRecognizer.watchDrag("el", { adoptable: true }, {
        on: (s) => {
          told.push(s)
          active.push(activity.isDragActive())
        },
      }))
      yield* input.push(ev("down", 0, 0))
      yield* input.push(ev("move", 10, 10))
      yield* input.push(ev("move", 20, 20))
      yield* input.push(ev("move", 30, 30))
      drag.stop()
      expect(told.map(line)).toEqual(["start 10,0", "move 20,0", "move 30,0", "end 30,0"])
      const end = told[3]!
      expect(end.point, "at the last point").toEqual({ x: 30, y: 0 })
      expect(end.velocity.x, "the moves' velocity").toBeCloseTo(1000, 0)
      expect(end.cancelled, "a release").toBeUndefined()
      expect(active[3], "the claim given back before the end is told").toBe(false)
      // The pointer is still down: its moves and release tell nothing now.
      yield* input.push(ev("move", 60, 40))
      yield* input.push(ev("up", 60, 50))
      expect(told).toHaveLength(4)

      // Before the start: nothing told, and the pointer drags no more.
      yield* input.push(ev("down", 0, 100))
      yield* input.push(ev("move", 2, 110))
      drag.stop()
      yield* input.push(ev("move", 40, 120))
      yield* input.push(ev("up", 40, 130))
      expect(told, "nothing").toHaveLength(4)
      expect(activity.isDragActive()).toBe(false)
    }).pipe(Effect.provide(input.layer))
  }))

it.effect("DC5: cancel ends it with no velocity, marked cancelled; once the Scope has closed neither tells anything", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    yield* Effect.gen(function* () {
      const activity = yield* DragActivity.DragActivity
      const told: Array<Drag.Sample> = []
      const { scope, value: drag } = yield* opened(DragRecognizer.watchDrag("el", { axis: "x", adoptable: true }, { on: (s) => told.push(s) }))
      yield* input.push(ev("down", 0, 0))
      yield* input.push(ev("move", 10, 10))
      yield* input.push(ev("move", 20, 20))
      drag.cancel()
      expect(told.map(line)).toEqual(["start 10,0", "move 20,0", "end 20,0 cancelled"])
      expect(told[2]!.velocity).toEqual({ x: 0, y: 0 })
      expect(told[2]!.axis, "kept to its axis").toBe("x")
      expect(activity.isDragActive(), "its claim given back").toBe(false)
      yield* input.push(ev("up", 20, 30))

      yield* input.push(ev("down", 0, 100))
      yield* input.push(ev("move", 10, 110))
      yield* Scope.close(scope, Exit.void)
      drag.stop()
      drag.cancel()
      expect(told.map(line).slice(3), "the start only").toEqual(["start 10,0"])
      expect(activity.isDragActive()).toBe(false)
    }).pipe(Effect.provide(input.layer))
  }))

it("DC6: heldPointer holds an adopted down from inside the call; its later events come unmarked", () => {
  let emitTarget: ((event: InputSource.PointerLikeEvent, raw: unknown) => void) | undefined
  let emitAdopted: ((event: InputSource.PointerLikeEvent, raw: unknown) => void) | undefined
  let emitGlobal: ((event: InputSource.PointerLikeEvent, raw: unknown) => void) | undefined
  let globals = 0
  const seen: Array<string> = []
  const stop = InputSource.heldPointer({
    target: (emit) => {
      emitTarget = emit
      return () => (emitTarget = undefined)
    },
    adopted: (emit) => {
      emitAdopted = emit
      return () => (emitAdopted = undefined)
    },
    global: (emit) => {
      globals++
      emitGlobal = emit
      return () => (emitGlobal = undefined)
    },
  })((event) => seen.push(`${event.type} ${event.x}${Bool.match(event.adopted === true, { onTrue: () => " adopted", onFalse: () => "" })}`), constVoid)
  const pressed = {}
  emitAdopted!(ev("down", 5, 0), pressed)
  expect(emitGlobal, "the page-wide feed, subscribed inside the adoption").toBeDefined()
  // The same press reaching the target itself (a handle inside it): one hold, delivered.
  emitTarget!(ev("down", 5, 0), pressed)
  emitGlobal!(ev("move", 25, 16), {})
  emitGlobal!(ev("up", 25, 32), {})
  expect(seen).toEqual(["down 5 adopted", "down 5", "move 25", "up 25"])
  expect(emitGlobal, "unsubscribed at the release").toBeUndefined()
  expect(globals, "one hold").toBe(1)
  // A move of another pointer adopted nowhere isn't forwarded.
  emitAdopted!(ev("move", 50, 40), {})
  expect(seen).toHaveLength(4)
  stop()
  expect(emitAdopted, "stopped with the feed").toBeUndefined()
})

it.effect("DC7: a watch that isn't adoptable can't be ended from outside: its gesture runs on to its release", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    yield* Effect.gen(function* () {
      const told: Array<Drag.Sample> = []
      const { value: drag } = yield* opened(DragRecognizer.watchDrag("el", { axis: "x" }, { on: (s) => told.push(s) }))
      yield* input.push(ev("down", 0, 0))
      yield* input.push(ev("move", 10, 10))
      yield* input.push(ev("move", 20, 20))
      // Its type has no ends (#618, F3); at run time they're there and do nothing.
      const ends = drag as DragRecognizer.AdoptableDrag
      ends.stop()
      ends.cancel()
      expect(told.map(line), "nothing told by either").toEqual(["start 10,0", "move 20,0"])
      yield* input.push(ev("move", 30, 30))
      yield* input.push(ev("up", 30, 40))
      expect(told.map(line), "its pointer's release ends it").toEqual(["start 10,0", "move 20,0", "move 30,0", "end 30,0"])
    }).pipe(Effect.provide(input.layer))
  }))

it("DC8: an adoptable watch is an AdoptableDrag; a plain one, a WatchedDrag with no ends (#618)", () => {
  const handlers = { on: constVoid }
  type Watch<A> = Effect.Effect<A, never, Scope.Scope | InputSource.InputSource>
  expectTypeOf(DragRecognizer.watchDrag("el", { adoptable: true }, handlers)).toEqualTypeOf<Watch<DragRecognizer.AdoptableDrag>>()
  expectTypeOf(DragRecognizer.watchDrag("el", { axis: "x" }, handlers)).toEqualTypeOf<Watch<DragRecognizer.WatchedDrag>>()
  expectTypeOf<DragRecognizer.WatchedDrag>().not.toHaveProperty("stop")
  const adoptable: boolean = Math.random() < 2
  expectTypeOf(DragRecognizer.watchDrag("el", { adoptable }, handlers)).toEqualTypeOf<Watch<DragRecognizer.AdoptableDrag>>()
})
