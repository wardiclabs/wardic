import * as DragActivity from "@wardic/core/DragActivity"
import * as InputSource from "@wardic/core/InputSource"
import * as DragRecognizer from "@wardic/core/DragRecognizer"
import * as Recognizer from "@wardic/core/Recognizer"
import { TestInput } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"

// A direction-locked drag (`DragRecognizer.drag`'s `lock`, #273, ADR-0047): it starts only once its
// offset passes 10 px on one axis (y first, as Motion's), and moves on, claims and counts on that axis
// alone. Motion's starts at 3 px, claiming both axes, and locks after.
//
// - DL1: nothing before the lock; its start at the lock, with the whole offset, kept to the locked
//   axis, which the sample carries; y wins a move past the threshold on both.
// - DL2: a one-axis drag locked the other way doesn't start: nothing, and nothing counted.
// - DL3: nested, each starts only for the axis it locks to and can take: opposite axes, both locked;
//   a free locked card in an unlocked sheet; a free locked card in a locked sheet (the inner wins).
// - DL4: not a drag before its lock: a press that moved 8 px still taps, where a plain drag's
//   would have ended dragged.

/** A primary mouse event (`makePointerLikeEvent`): pressed on a down or move, released otherwise. */
const ev = (type: InputSource.PointerLikeEvent["type"], x: number, y: number, t: number): InputSource.PointerLikeEvent =>
  InputSource.makePointerLikeEvent({ type, x, y, timeStamp: t, pressed: type === "down" || type === "move" })

/** Subscribe `streams`, each in its own fiber, to one pushable input under `activity`; in order, innermost first. */
const rig = (activity: DragActivity.Shape, streams: ReadonlyArray<Stream.Stream<string, never, InputSource.InputSource>>) =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const seen = yield* Ref.make<ReadonlyArray<string>>([])
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

/** A drag's samples, labelled: phase, axis and offset. */
const labelled = (label: string, stream: Stream.Stream<{ readonly phase: string; readonly axis: string; readonly offset: { readonly x: number; readonly y: number } }, never, InputSource.InputSource>) =>
  Stream.map(stream, (s) => `${label} ${s.phase} ${s.axis} ${s.offset.x},${s.offset.y}`)

it.effect("DL1: nothing before the lock; its start at the lock, the whole offset kept to the locked axis; y first", () =>
  Effect.gen(function* () {
    const h = yield* rig(DragActivity.make(), [labelled("d", DragRecognizer.drag({ name: "d" }, { lock: true }))])
    yield* h.push(ev("down", 0, 0, 0))
    yield* h.push(ev("move", 6, 2, 10))
    yield* h.push(ev("move", 10, 4, 20))
    expect(yield* h.seen, "inside 10 px on both: not started").toEqual([])
    yield* h.push(ev("move", 14, 6, 30))
    yield* h.push(ev("move", 20, 30, 40))
    yield* h.push(ev("up", 20, 30, 50))
    expect(yield* h.seen).toEqual(["d start x 14,0", "d move x 20,0", "d end x 20,0"])
    // Past the threshold on both at once: y, as Motion's.
    yield* h.push(ev("down", 0, 0, 60))
    yield* h.push(ev("move", 20, 12, 70))
    expect((yield* h.seen).slice(3)).toEqual(["d start y 0,12"])
    for (const fiber of h.fibers) yield* Fiber.interrupt(fiber)
  }))

it.effect("DL2: a one-axis drag locked the other way doesn't start: nothing, and nothing counted", () =>
  Effect.gen(function* () {
    const activity = DragActivity.make()
    const h = yield* rig(activity, [labelled("d", DragRecognizer.drag({ name: "d" }, { axis: "y", lock: true }))])
    yield* h.push(ev("down", 0, 0, 0))
    yield* h.push(ev("move", 20, 2, 10))
    expect(activity.isDragActive(), "refused: not counted").toBe(false)
    yield* h.push(ev("move", 20, 40, 20))
    yield* h.push(ev("up", 20, 40, 30))
    expect(yield* h.seen).toEqual([])
    for (const fiber of h.fibers) yield* Fiber.interrupt(fiber)
  }))

it.effect("DL3: nested: each drag starts only for the axis it locks to and can take", () =>
  Effect.gen(function* () {
    // A swipe of 20 px in four moves, sideways or down. Each rig's streams run innermost first.
    const swipe = (h: { readonly push: (e: InputSource.PointerLikeEvent) => Effect.Effect<void> }, dx: number, dy: number, t: number) =>
      Effect.gen(function* () {
        yield* h.push(ev("down", 0, 0, t))
        for (const k of [1, 2, 3, 4]) yield* h.push(ev("move", (dx * k) / 4, (dy * k) / 4, t + 10 * k))
        yield* h.push(ev("up", dx, dy, t + 50))
      })
    const starts = (seen: ReadonlyArray<string>) => seen.filter((e) => e.includes(" start "))

    // A card that drags sideways in a sheet that drags down, both locked: each takes its own swipe, and
    // the card's drag doesn't start on a vertical one (Motion's would, at 3 px, with its `whileDrag`).
    const opposite = yield* rig(DragActivity.make(), [
      labelled("card", DragRecognizer.drag({ name: "card" }, { axis: "x", lock: true })),
      labelled("sheet", DragRecognizer.drag({ name: "sheet" }, { axis: "y", lock: true })),
    ])
    yield* swipe(opposite, 20, 3, 0)
    yield* swipe(opposite, 3, 20, 100)
    expect(starts(yield* opposite.seen)).toEqual(["card start x 15,0", "sheet start y 0,15"])
    for (const fiber of opposite.fibers) yield* Fiber.interrupt(fiber)

    // A card free on both axes, locked, in a sheet with no lock: the sheet claims y at 3 px, so a vertical
    // swipe is the sheet's; a sideways one locks the card to x, which it takes (Motion's card, asking both
    // axes at 3 px, is refused every gesture).
    const free = yield* rig(DragActivity.make(), [
      labelled("card", DragRecognizer.drag({ name: "card" }, { lock: true })),
      labelled("sheet", DragRecognizer.drag({ name: "sheet" }, { axis: "y" })),
    ])
    yield* swipe(free, 3, 20, 0)
    expect(starts(yield* free.seen), "vertical: the sheet").toEqual(["sheet start y 0,5"])
    yield* swipe(free, 20, 3, 100)
    expect(starts(yield* free.seen).slice(1), "sideways: the card, and the sheet started at 3 px").toEqual(["sheet start y 0,0.75", "card start x 15,0"])
    for (const fiber of free.fibers) yield* Fiber.interrupt(fiber)

    // Both locked, the card free on both axes: they lock at the same move, and the inner claims first, as
    // in Motion: a vertical swipe is the card's.
    const both = yield* rig(DragActivity.make(), [
      labelled("card", DragRecognizer.drag({ name: "card" }, { lock: true })),
      labelled("sheet", DragRecognizer.drag({ name: "sheet" }, { axis: "y", lock: true })),
    ])
    yield* swipe(both, 3, 20, 0)
    expect(starts(yield* both.seen)).toEqual(["card start y 0,15"])
    for (const fiber of both.fibers) yield* Fiber.interrupt(fiber)
  }))

it.effect("DL4: not a drag before its lock: a press that moved 8 px still taps; a plain drag's ends dragged", () =>
  Effect.gen(function* () {
    for (const lock of [true, false]) {
      const h = yield* rig(DragActivity.make(), [
        labelled("d", DragRecognizer.drag({ name: "d" }, { lock })),
        Stream.map(Recognizer.pressEvents({ name: "d" }), (p) => `press ${p.phase}`),
      ])
      yield* h.push(ev("down", 0, 0, 0))
      yield* h.push(ev("move", 8, 0, 10))
      yield* h.push(ev("up", 8, 0, 20))
      const presses = (yield* h.seen).filter((e) => e.startsWith("press"))
      expect(presses, `lock ${lock}`).toEqual(Bool.match(lock, { onTrue: () => ["press start", "press tap"], onFalse: () => ["press start", "press dragged"] }))
      for (const fiber of h.fibers) yield* Fiber.interrupt(fiber)
    }
  }))
