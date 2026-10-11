import type * as Drag from "@wardic/core/Drag"
import * as InputSource from "@wardic/core/InputSource"
import * as Recognizer from "@wardic/core/Recognizer"
import { TestInput } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"

// Recognizer rules for issue #31 (ADR-0019, decisions D3, D3b, D4, D5), pinned at the
// node tier with TestInput. Rule A: a move with `buttons === 0` from the owning pointer
// ends its gesture as a cancel (a lost release). Rule B: a new down from the owning
// pointer ends the old gesture the same way and starts a new one.

interface EventOptions {
  readonly pointerId?: number
  readonly pointerType?: string
  readonly button?: number
  readonly isPrimary?: boolean
  readonly buttons?: number
}

/** A primary mouse by default (`makePointerLikeEvent`): pressed on a down or move, released otherwise. */
const ev = (
  type: InputSource.PointerLikeEvent["type"],
  x: number,
  y: number,
  t: number,
  o: EventOptions = {},
): InputSource.PointerLikeEvent => InputSource.makePointerLikeEvent({ type, x, y, timeStamp: t, ...o })

const finger = (extra: EventOptions = {}): EventOptions => ({ pointerType: "touch", ...extra })
const secondFinger: EventOptions = { pointerId: 2, pointerType: "touch", isPrimary: false }

const collectDrag = (events: ReadonlyArray<InputSource.PointerLikeEvent>) =>
  Stream.runCollect(Recognizer.drag(undefined)).pipe(Effect.provide(TestInput.layer(events)))

/** Run a stream in a forked fiber over a pushable input, recording what it emits. */
const observe = <A>(stream: Stream.Stream<A, never, InputSource.InputSource>) =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const seen = yield* Ref.make<ReadonlyArray<A>>([])
    yield* Stream.runForEach(stream, (a) => Ref.update(seen, (xs) => [...xs, a])).pipe(
      Effect.provide(input.layer),
      Effect.forkChild,
    )
    yield* Effect.yieldNow
    yield* Effect.yieldNow
    return { push: input.push, seen: Ref.get(seen) }
  })

// ---------------------------------------------------------------- drag

it.effect("N1: a mouse down with button 2 claims nothing, so later moves emit no sample", () =>
  Effect.gen(function* () {
    // A right-button press, then moves far past the threshold.
    const events = [
      ev("down", 0, 0, 0, { button: 2, buttons: 2 }),
      ev("move", 10, 0, 10, { buttons: 2 }),
      ev("move", 30, 0, 20, { buttons: 2 }),
      ev("up", 30, 0, 30, { button: 2 }),
    ]
    const samples = yield* collectDrag(events)
    // Motion's isPrimaryPointer: mouse needs button <= 0.
    expect(samples.length).toBe(0)
    // A left-button down still drags
    const left = yield* collectDrag([ev("down", 0, 0, 0), ev("move", 10, 0, 10)])
    expect((left as ReadonlyArray<Drag.Sample>).map((s) => s.phase)).toEqual(["start"])
  }))

it.effect("N2: a touch pointer with isPrimary false is ignored; a primary touch drags", () =>
  Effect.gen(function* () {
    // The same script from a non-primary and from a primary finger.
    const script = (o: EventOptions) => [
      ev("down", 0, 0, 0, o),
      ev("move", 10, 0, 10, o),
      ev("move", 20, 0, 20, o),
      ev("up", 20, 0, 30, o),
    ]
    const ignored = yield* collectDrag(script(secondFinger))
    const primary = (yield* collectDrag(script(finger()))) as ReadonlyArray<Drag.Sample>
    expect(ignored.length).toBe(0)
    expect(primary.map((s) => s.phase)).toEqual(["start", "move", "end"])
  }))

it.effect("N3 (rule A): the owner's move with buttons 0 ends the gesture as a cancel at the last pressed point", () =>
  Effect.gen(function* () {
    // Start + a move, then the release is lost: the pointer moves unpressed.
    const events = [
      ev("down", 0, 0, 0),
      ev("move", 10, 0, 10), // start
      ev("move", 20, 0, 20), // move: the last pressed point
      ev("move", 60, 5, 30, { buttons: 0 }), // stale: ends the gesture
      ev("move", 80, 5, 40), // no owner any more
      ev("move", 90, 5, 50),
    ]
    const samples = (yield* collectDrag(events)) as ReadonlyArray<Drag.Sample>
    // Exactly one end, at the last pressed point, no delta, no velocity.
    expect(samples.map((s) => s.phase)).toEqual(["start", "move", "end"])
    const end = samples[2]!
    expect(end.point).toEqual({ x: 20, y: 0 })
    expect(end.offset).toEqual({ x: 20, y: 0 })
    expect(end.delta).toEqual({ x: 0, y: 0 })
    expect(end.velocity).toEqual({ x: 0, y: 0 })

    // A buttons-0 move before the gesture started emits nothing (no `start`, so no `end`)
    const early = yield* collectDrag([ev("down", 0, 0, 0), ev("move", 1, 0, 10), ev("move", 50, 0, 20, { buttons: 0 })])
    expect(early.length).toBe(0)
  }))

it.effect("N4 (rule B): a second down from the owner ends the old gesture, then the new gesture measures from it", () =>
  Effect.gen(function* () {
    // The release of the first press is lost; the same pointer goes down again.
    const events = [
      ev("down", 0, 0, 0),
      ev("move", 10, 0, 10), // start
      ev("move", 20, 0, 20), // move (last pressed point)
      ev("down", 100, 50, 30), // rule B: end, then a new gesture at (100,50)
      ev("move", 110, 50, 40), // start of the new gesture
      ev("move", 130, 50, 50),
    ]
    const samples = (yield* collectDrag(events)) as ReadonlyArray<Drag.Sample>
    expect(samples.map((s) => s.phase)).toEqual(["start", "move", "end", "start", "move"])
    const end = samples[2]!
    expect(end.point).toEqual({ x: 20, y: 0 })
    expect(end.delta).toEqual({ x: 0, y: 0 })
    expect(end.velocity).toEqual({ x: 0, y: 0 })
    // offsets come from the SECOND down, not the first
    expect(samples[3]!.offset).toEqual({ x: 10, y: 0 })
    expect(samples[4]!.offset).toEqual({ x: 30, y: 0 })

    // A second down from a non-owner is still ignored
    const intruder = (yield* collectDrag([
      ev("down", 0, 0, 0),
      ev("move", 10, 0, 10),
      ev("down", 100, 50, 15, finger({ pointerId: 2 })),
      ev("move", 20, 0, 20),
    ])) as ReadonlyArray<Drag.Sample>
    expect(intruder.map((s) => s.phase)).toEqual(["start", "move"])
  }))

it.effect("N5: a buttons-0 move from a non-owner changes nothing (guard)", () =>
  Effect.gen(function* () {
    // Pointer 1 drags; pointer 2 hovers unpressed (buttons 0) mid-gesture.
    const events = [
      ev("down", 0, 0, 0),
      ev("move", 10, 0, 10),
      ev("move", 200, 200, 15, { pointerId: 2, buttons: 0 }),
      ev("move", 20, 0, 20),
    ]
    const samples = (yield* collectDrag(events)) as ReadonlyArray<Drag.Sample>
    // No end, the owner's next move continues.
    expect(samples.map((s) => s.phase)).toEqual(["start", "move"])
    expect(samples[1]!.offset).toEqual({ x: 20, y: 0 })
  }))

// ---------------------------------------------------------------- press

const pressHarness = () => observe(Recognizer.press(undefined))

it.effect("N8: a right-button down doesn't press; a left-button press after it does", () =>
  Effect.gen(function* () {
    const h = yield* pressHarness()
    // Right-button down + up
    yield* h.push(ev("down", 0, 0, 0, { button: 2, buttons: 2 }))
    yield* h.push(ev("up", 0, 0, 10, { button: 2 }))
    // Nothing emitted
    expect(yield* h.seen).toEqual([])
    // A left-button press still presses
    yield* h.push(ev("down", 0, 0, 20))
    yield* h.push(ev("up", 0, 0, 30))
    expect(yield* h.seen).toEqual([true, false])
  }))

it.effect("N9: while the primary finger presses, a non-primary finger's down and up change nothing", () =>
  Effect.gen(function* () {
    const h = yield* pressHarness()
    // The primary finger presses
    yield* h.push(ev("down", 0, 0, 0, finger()))
    // A second finger touches and lifts
    yield* h.push(ev("down", 50, 0, 10, secondFinger))
    yield* h.push(ev("up", 50, 0, 20, secondFinger))
    // No flicker (no false between the true and the primary's up)
    expect(yield* h.seen).toEqual([true])
    yield* h.push(ev("up", 0, 0, 30, finger()))
    expect(yield* h.seen).toEqual([true, false])
  }))

it.effect("N10 (rule A): the owner's buttons-0 move ends the press", () =>
  Effect.gen(function* () {
    const h = yield* pressHarness()
    yield* h.push(ev("down", 0, 0, 0))
    yield* h.push(ev("move", 5, 0, 10)) // still pressed
    expect(yield* h.seen).toEqual([true])
    // The release was lost; the pointer moves unpressed
    yield* h.push(ev("move", 50, 0, 20, { buttons: 0 }))
    expect(yield* h.seen).toEqual([true, false])
    // and later pressed-looking moves don't press again
    yield* h.push(ev("move", 60, 0, 30))
    expect(yield* h.seen).toEqual([true, false])

    // A buttons-0 move from a non-owner keeps the press
    const other = yield* pressHarness()
    yield* other.push(ev("down", 0, 0, 0))
    yield* other.push(ev("move", 50, 0, 20, { pointerId: 2, buttons: 0 }))
    expect(yield* other.seen).toEqual([true])
  }))

// ---------------------------------------------------------------- hover

const hoverHarness = () => observe(Recognizer.hover(undefined))

it.effect("N11: enter/leave from a touch pointer never emit true (a mouse enter does)", () =>
  Effect.gen(function* () {
    const touch = yield* hoverHarness()
    yield* touch.push(ev("enter", 0, 0, 0, finger({ buttons: 0 })))
    yield* touch.push(ev("leave", 0, 0, 10, finger()))
    expect(yield* touch.seen).toEqual([])

    const mouse = yield* hoverHarness()
    yield* mouse.push(ev("enter", 0, 0, 0))
    expect(yield* mouse.seen).toEqual([true])
  }))

it.effect("N12 (H2): enter, down on the target, leave: hover stays true until the up, then false", () =>
  Effect.gen(function* () {
    const h = yield* hoverHarness()
    yield* h.push(ev("enter", 0, 0, 0))
    yield* h.push(ev("down", 0, 0, 10))
    // The pointer leaves the target while still pressed (a drag outrunning its element)
    yield* h.push(ev("leave", 200, 0, 20, { buttons: 1 }))
    // Deferred
    expect(yield* h.seen).toEqual([true])
    yield* h.push(ev("move", 300, 0, 30))
    expect(yield* h.seen).toEqual([true])
    yield* h.push(ev("up", 300, 0, 40))
    expect(yield* h.seen).toEqual([true, false])
  }))

it.effect("N13: a deferred hover end resolves at a cancel and at a buttons-0 move; a leave with no press ends it at once", () =>
  Effect.gen(function* () {
    // (a) cancel
    const a = yield* hoverHarness()
    yield* a.push(ev("enter", 0, 0, 0))
    yield* a.push(ev("down", 0, 0, 10))
    yield* a.push(ev("leave", 200, 0, 20, { buttons: 1 }))
    expect(yield* a.seen).toEqual([true])
    yield* a.push(ev("cancel", 200, 0, 30))
    expect(yield* a.seen).toEqual([true, false])

    // (b) rule A: the release is lost, the pointer moves unpressed
    const b = yield* hoverHarness()
    yield* b.push(ev("enter", 0, 0, 0))
    yield* b.push(ev("down", 0, 0, 10))
    yield* b.push(ev("leave", 200, 0, 20, { buttons: 1 }))
    expect(yield* b.seen).toEqual([true])
    yield* b.push(ev("move", 250, 0, 30, { buttons: 0 }))
    expect(yield* b.seen).toEqual([true, false])

    // (c) no pointer pressed on the target: the leave ends hover at once
    const c = yield* hoverHarness()
    yield* c.push(ev("enter", 0, 0, 0))
    yield* c.push(ev("leave", 200, 0, 10))
    expect(yield* c.seen).toEqual([true, false])
  }))

// ------------------------------------------------ a scroll during a hold (D14)

// ADR-0019, *Amendment (Reorder)*: a scroll of the page or of a scrollable ancestor while
// a pointer is held reaches `drag` as a move of that pointer, so the drag's offset and
// velocity include it. An InputSource whose `pointer` is core's `InputSource.heldPointer` over
// fake feeds (the Test Environment's own input is unchanged).

const scrolledInput = () => {
  let emitPointer: ((event: InputSource.PointerLikeEvent, raw: unknown) => void) | undefined
  let emitScroll: ((source: unknown, position: { x: number; y: number }, timeStamp: number) => void) | undefined
  const scroller = { name: "list" }
  let position = { x: 0, y: 0 }
  const layer = Layer.succeed(InputSource.InputSource, {
    pointer: () =>
      InputSource.heldPointer({
        target: (emit) => {
          emitPointer = emit
          return () => (emitPointer = undefined)
        },
        scroll: (emit) => {
          emitScroll = emit
          emit(scroller, position, 0)
          return () => (emitScroll = undefined)
        },
      }),
    keyboard: () => Stream.empty,
    wheel: () => Stream.empty,
    focus: () => Stream.empty,
  })
  return {
    layer,
    point: (event: InputSource.PointerLikeEvent) => emitPointer?.(event, {}),
    scrollTo: (y: number, t: number) => {
      position = { x: 0, y }
      emitScroll?.(scroller, position, t)
    },
  }
}

const dragOver = (input: ReturnType<typeof scrolledInput>) =>
  Effect.gen(function* () {
    const seen = yield* Ref.make<ReadonlyArray<Drag.Sample>>([])
    yield* Stream.runForEach(Recognizer.drag(undefined), (s) => Ref.update(seen, (xs) => [...xs, s])).pipe(
      Effect.provide(input.layer),
      Effect.forkChild,
    )
    yield* Effect.yieldNow
    yield* Effect.yieldNow
    return Ref.get(seen)
  })

it.effect("N14: a scroll of 60 px mid-drag is a move sample whose offset includes the scroll, with no pointer move", () =>
  Effect.gen(function* () {
    const input = scrolledInput()
    const seen = yield* dragOver(input)
    input.point(ev("down", 0, 0, 0))
    input.point(ev("move", 0, 10, 10))
    input.scrollTo(60, 20)
    for (let i = 0; i < 10; i++) yield* Effect.yieldNow
    const samples = yield* seen
    expect(samples.map((s) => s.phase)).toEqual(["start", "move"])
    expect(samples[1]!.offset).toEqual({ x: 0, y: 70 })
    expect(samples[1]!.point).toEqual({ x: 0, y: 70 })
  }))

it.effect("N15: the scroll-driven move counts toward the drag's velocity", () =>
  Effect.gen(function* () {
    const input = scrolledInput()
    const seen = yield* dragOver(input)
    input.point(ev("down", 0, 0, 0))
    input.point(ev("move", 0, 10, 10))
    input.scrollTo(60, 20)
    for (let i = 0; i < 10; i++) yield* Effect.yieldNow
    const samples = yield* seen
    // The scroll-driven move is a sample of its own, and drag's 30 ms window measures it:
    // (70 - 0) px over 20 ms.
    const moved = samples.find((s) => s.phase === "move")
    expect(moved?.velocity.y).toBeCloseTo(3500, 6)
    expect(moved?.velocity.x).toBe(0)
  }))
