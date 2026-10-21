import * as InputSource from "@wardic/core/InputSource"
import * as Recognizer from "@wardic/core/Recognizer"
import { TestInput, TestProbe } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

/** Build a PointerLikeEvent: a primary mouse (`makePointerLikeEvent`), pressed except at the release or a leave. */
const ev = (
  type: InputSource.PointerLikeEvent["type"],
  x = 0,
  y = 0,
  t = 0,
  pointerId = 1,
): InputSource.PointerLikeEvent =>
  InputSource.makePointerLikeEvent({ type, pointerId, x, y, pressed: type !== "up" && type !== "cancel" && type !== "leave", timeStamp: t })

/** Build a FocusLikeEvent. */
const focusEvent = (type: InputSource.FocusLikeEvent["type"], t = 0): InputSource.FocusLikeEvent => ({ type, timeStamp: t })

it.effect("hover: enter/leave toggle, move keeps state, changes dedups", () =>
  Effect.gen(function* () {
    const pointer = [
      ev("enter", 0, 0, 0),
      ev("move", 1, 1, 10), // keeps state (true) — deduped by Stream.changes
      ev("leave", 2, 2, 20),
      ev("enter", 3, 3, 30),
    ]
    const states = yield* Stream.runCollect(Recognizer.hover(undefined)).pipe(
      Effect.provide(TestInput.layer(pointer)),
    )
    expect(Array.from(states)).toEqual([true, false, true])
  }))

it.effect("press: down/up toggles", () =>
  Effect.gen(function* () {
    const pointer = [ev("down", 0, 0, 0), ev("up", 0, 0, 10)]
    const states = yield* Stream.runCollect(Recognizer.press(undefined)).pipe(
      Effect.provide(TestInput.layer(pointer)),
    )
    expect(Array.from(states)).toEqual([true, false])
  }))

it.effect("press: down/cancel toggles", () =>
  Effect.gen(function* () {
    const pointer = [ev("down", 0, 0, 0), ev("cancel", 0, 0, 10)]
    const states = yield* Stream.runCollect(Recognizer.press(undefined)).pipe(
      Effect.provide(TestInput.layer(pointer)),
    )
    expect(Array.from(states)).toEqual([true, false])
  }))

it.effect("focus: focus/blur toggles", () =>
  Effect.gen(function* () {
    const states = yield* Stream.runCollect(Recognizer.focus(undefined)).pipe(
      Effect.provide(TestInput.layer([], [focusEvent("focus", 0), focusEvent("blur", 10)])),
    )
    expect(Array.from(states)).toEqual([true, false])
  }))

it.effect("inView: observeIntersection booleans pass through (changes dedup)", () =>
  Effect.gen(function* () {
    const states = yield* Stream.runCollect(Recognizer.inView(undefined)).pipe(
      Effect.provide(TestProbe.layer({ intersection: [false, true, false] })),
    )
    // No consecutive equal values, so changes leaves the script intact.
    expect(Array.from(states)).toEqual([false, true, false])
  }))

it.effect("inView once: settles after the first true, no later false", () =>
  Effect.gen(function* () {
    const states = yield* Stream.runCollect(Recognizer.inView(undefined, { once: true })).pipe(
      Effect.provide(TestProbe.layer({ intersection: [false, true, true, false] })),
    )
    // takeUntil(active) keeps the terminating true and ends the stream.
    expect(Array.from(states)).toEqual([false, true])
  }))

it.effect("RE1 (#257): hoverEvents: each transition, with the event that turned it", () =>
  Effect.gen(function* () {
    const pointer = [ev("enter", 5, 6, 0), ev("move", 7, 8, 10), ev("leave", 9, 10, 20)]
    const events = yield* Stream.runCollect(Recognizer.hoverEvents(undefined)).pipe(Effect.provide(TestInput.layer(pointer)))
    expect(Array.from(events).map((t) => `${t.active} ${t.event.type}@${t.event.x},${t.event.y}`)).toEqual(["true enter@5,6", "false leave@9,10"])
  }))

it.effect("RE2 (#257): pressEvents: a release on the target taps; one off it, a cancel and a lost release cancel", () =>
  Effect.gen(function* () {
    const off = InputSource.makePointerLikeEvent({ type: "up", x: 50, timeStamp: 30, onTarget: false })
    const pointer = [
      ev("down", 0, 0, 0),
      ev("up", 1, 1, 10),
      ev("down", 0, 0, 20),
      off,
      ev("down", 0, 0, 40),
      ev("cancel", 0, 0, 50),
      ev("down", 0, 0, 60),
      InputSource.makePointerLikeEvent({ type: "move", x: 2, pressed: false, timeStamp: 70 }),
    ]
    const events = yield* Stream.runCollect(Recognizer.pressEvents(undefined)).pipe(Effect.provide(TestInput.layer(pointer)))
    expect(Array.from(events).map((e) => `${e.phase}@${e.event.timeStamp}`)).toEqual([
      "start@0",
      "tap@10",
      "start@20",
      "cancel@30",
      "start@40",
      "cancel@50",
      "start@60",
      "cancel@70",
    ])
    // press, the same fold: on at each start, off at each end.
    const states = yield* Stream.runCollect(Recognizer.press(undefined)).pipe(Effect.provide(TestInput.layer(pointer)))
    expect(Array.from(states)).toEqual([true, false, true, false, true, false, true, false])
  }))
