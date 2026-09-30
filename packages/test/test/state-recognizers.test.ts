import { focus, hover, inView, makePointerLikeEvent, press } from "@wardic/core"
import type { FocusLikeEvent, PointerLikeEvent } from "@wardic/core"
import { TestInput, TestProbe } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

/** Build a PointerLikeEvent: a primary mouse (`makePointerLikeEvent`), pressed except at the release or a leave. */
const ev = (
  type: PointerLikeEvent["type"],
  x = 0,
  y = 0,
  t = 0,
  pointerId = 1,
): PointerLikeEvent =>
  makePointerLikeEvent({ type, pointerId, x, y, buttons: type === "up" || type === "cancel" || type === "leave" ? 0 : 1, timeStamp: t })

/** Build a FocusLikeEvent. */
const focusEvent = (type: FocusLikeEvent["type"], t = 0): FocusLikeEvent => ({ type, timeStamp: t })

it.effect("hover: enter/leave toggle, move keeps state, changes dedups", () =>
  Effect.gen(function* () {
    const pointer = [
      ev("enter", 0, 0, 0),
      ev("move", 1, 1, 10), // keeps state (true) — deduped by Stream.changes
      ev("leave", 2, 2, 20),
      ev("enter", 3, 3, 30),
    ]
    const states = yield* Stream.runCollect(hover(undefined)).pipe(
      Effect.provide(TestInput.layer(pointer)),
    )
    expect(Array.from(states)).toEqual([true, false, true])
  }))

it.effect("press: down/up toggles", () =>
  Effect.gen(function* () {
    const pointer = [ev("down", 0, 0, 0), ev("up", 0, 0, 10)]
    const states = yield* Stream.runCollect(press(undefined)).pipe(
      Effect.provide(TestInput.layer(pointer)),
    )
    expect(Array.from(states)).toEqual([true, false])
  }))

it.effect("press: down/cancel toggles", () =>
  Effect.gen(function* () {
    const pointer = [ev("down", 0, 0, 0), ev("cancel", 0, 0, 10)]
    const states = yield* Stream.runCollect(press(undefined)).pipe(
      Effect.provide(TestInput.layer(pointer)),
    )
    expect(Array.from(states)).toEqual([true, false])
  }))

it.effect("focus: focus/blur toggles", () =>
  Effect.gen(function* () {
    const states = yield* Stream.runCollect(focus(undefined)).pipe(
      Effect.provide(TestInput.layer([], [focusEvent("focus", 0), focusEvent("blur", 10)])),
    )
    expect(Array.from(states)).toEqual([true, false])
  }))

it.effect("inView: observeIntersection booleans pass through (changes dedup)", () =>
  Effect.gen(function* () {
    const states = yield* Stream.runCollect(inView(undefined)).pipe(
      Effect.provide(TestProbe.layer({ intersection: [false, true, false] })),
    )
    // No consecutive equal values, so changes leaves the script intact.
    expect(Array.from(states)).toEqual([false, true, false])
  }))

it.effect("inView once: settles after the first true, no later false", () =>
  Effect.gen(function* () {
    const states = yield* Stream.runCollect(inView(undefined, { once: true })).pipe(
      Effect.provide(TestProbe.layer({ intersection: [false, true, true, false] })),
    )
    // takeUntil(active) keeps the terminating true and ends the stream.
    expect(Array.from(states)).toEqual([false, true])
  }))
