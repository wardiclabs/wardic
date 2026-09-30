import { drag, hover, press, withMomentum } from "@wardic/core"
import type { DragSample, PointerLikeEvent, Vec2 } from "@wardic/core"
import { TestClock, TestInput } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import type { InputSource } from "@wardic/core"

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

/**
 * Local builder (a cast, so this file compiles and runs before the new fields exist).
 * Mouse defaults as `makePointerLikeEvent`: button 0 on down/up, -1 otherwise; buttons 1
 * on down/move, 0 otherwise. Ticket 08 swaps this for `makePointerLikeEvent`.
 */
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
    pointerType: o.pointerType ?? "mouse",
    button: o.button ?? (type === "down" || type === "up" ? 0 : -1),
    isPrimary: o.isPrimary ?? true,
  }) as PointerLikeEvent

const finger = (extra: EventOptions = {}): EventOptions => ({ pointerType: "touch", ...extra })
const secondFinger: EventOptions = { pointerId: 2, pointerType: "touch", isPrimary: false }

const collectDrag = (events: ReadonlyArray<PointerLikeEvent>) =>
  Stream.runCollect(drag(undefined)).pipe(Effect.provide(TestInput.layer(events)))

/** Run a stream in a forked fiber over a pushable input, recording what it emits. */
const observe = <A>(stream: Stream.Stream<A, never, InputSource>) =>
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
    expect((left as ReadonlyArray<DragSample>).map((s) => s.phase)).toEqual(["start"])
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
    const primary = (yield* collectDrag(script(finger()))) as ReadonlyArray<DragSample>
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
    const samples = (yield* collectDrag(events)) as ReadonlyArray<DragSample>
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
    const samples = (yield* collectDrag(events)) as ReadonlyArray<DragSample>
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
    ])) as ReadonlyArray<DragSample>
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
    const samples = (yield* collectDrag(events)) as ReadonlyArray<DragSample>
    // No end, the owner's next move continues.
    expect(samples.map((s) => s.phase)).toEqual(["start", "move"])
    expect(samples[1]!.offset).toEqual({ x: 20, y: 0 })
  }))

// ---------------------------------------------------------------- momentum

/** withMomentum over push-based input + clock (same shape as momentum.test.ts). */
const momentumHarness = () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const clock = yield* TestClock.pushable()
    const emitted = yield* Ref.make<ReadonlyArray<Vec2>>([])
    yield* Stream.runForEach(withMomentum(undefined), (p) => Ref.update(emitted, (xs) => [...xs, p])).pipe(
      Effect.provide(Layer.merge(input.layer, clock.layer)),
      Effect.forkChild,
    )
    yield* Effect.yieldNow
    yield* Effect.yieldNow
    return { push: input.push, advance: clock.advance, positions: () => Ref.get(emitted) }
  })

it.effect("N6: a non-primary down mid-drag neither rebases nor interrupts", () =>
  Effect.gen(function* () {
    const h = yield* momentumHarness()

    // A mouse drag in progress, then a second finger goes down.
    yield* h.push(ev("down", 0, 0, 0))
    yield* h.push(ev("move", 10, 0, 10))
    yield* h.push(ev("move", 20, 0, 20)) // position 20
    yield* h.push(ev("down", 100, 0, 25, secondFinger))
    yield* h.push(ev("move", 30, 0, 30))
    // The owner's offset is still measured from the original base (0), so 30, not 50.
    const positions = yield* h.positions()
    expect(positions[positions.length - 1]!.x).toBeCloseTo(30, 5)

    // Part 2: a running fling is not interrupted by a non-primary down.
    yield* h.push(ev("move", 40, 0, 40))
    yield* h.push(ev("up", 40, 0, 40)) // release at speed: a fling starts
    for (let i = 0; i < 3; i++) yield* h.advance()
    const before = (yield* h.positions()).length
    yield* h.push(ev("down", 300, 0, 50, secondFinger))
    for (let i = 0; i < 3; i++) yield* h.advance()
    const after = yield* h.positions()
    expect(after.length).toBeGreaterThan(before) // decay frames kept coming
    expect(after[after.length - 1]!.x).toBeGreaterThan(after[before - 1]!.x)
  }))

it.effect("N7 (rule B under withMomentum): the second gesture continues from where the first ended, with no fling and no double rebase", () =>
  Effect.gen(function* () {
    const h = yield* momentumHarness()

    // Gesture 1 drags to x=30 (fast), its release is lost, the pointer goes down again.
    yield* h.push(ev("down", 0, 0, 0))
    yield* h.push(ev("move", 10, 0, 10))
    yield* h.push(ev("move", 30, 0, 30)) // position 30
    // Rule B's restart, then frames with no input (a fling would show here).
    yield* h.push(ev("down", 100, 0, 40))
    for (let i = 0; i < 5; i++) yield* h.advance()
    const beforeSecond = yield* h.positions()
    yield* h.push(ev("move", 110, 0, 50)) // second gesture: offset 10
    yield* h.push(ev("move", 130, 0, 60)) // offset 30
    const afterSecond = yield* h.positions()

    // The first gesture ended with no fling...
    expect(Math.max(...beforeSecond.map((p) => p.x))).toBeCloseTo(30, 5)
    // ...and the second gesture = where the first ended + the second's offset.
    expect(afterSecond[afterSecond.length - 1]!.x).toBeCloseTo(30 + 30, 5)
  }))

// ---------------------------------------------------------------- press

const pressHarness = () => observe(press(undefined))

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

const hoverHarness = () => observe(hover(undefined))

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
