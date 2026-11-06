import * as InputSource from "@wardic/core/InputSource"
import * as Probe from "@wardic/core/Probe"
import * as Recognizer from "@wardic/core/Recognizer"
import { TestInput, TestProbe } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { Atom } from "effect/reactivity"
import * as Arr from "effect/Array"
import * as Feeds from "../src/feeds.ts"

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

/** A Probe whose intersections are `script`, with a record each, and which keeps the options it was asked with. */
const scriptedProbe = (script: ReadonlyArray<boolean>, asked: Array<Probe.IntersectionOptions | undefined>) =>
  Layer.succeed(Probe.Probe, {
    measure: () => Effect.die("unused"),
    viewport: Atom.make({ width: 0, height: 0 }),
    prefersReducedMotion: Atom.make(false),
    visible: Atom.make(true),
    scroll: () => Effect.die("unused"),
    observeResize: () => Stream.empty,
    observeIntersection: (_target, options) => {
      asked.push(options)
      return Feeds.script(Arr.map(script, (intersecting, i) => ({ intersecting, raw: `entry ${i}` })))
    },
  })

it.effect("IV1 (#273): inViewEvents: from out of view, each entry and leave with its record; options passed on, once left out", () =>
  Effect.gen(function* () {
    const asked: Array<Probe.IntersectionOptions | undefined> = []
    const options: Recognizer.InViewOptions = { root: "a root", margin: "10px", amount: 0.5 }
    const transitions = yield* Stream.runCollect(Recognizer.inViewEvents(undefined, options)).pipe(
      Effect.provide(scriptedProbe([false, true, true, false, true], asked)),
    )
    // Out at the start tells nothing; the repeat tells nothing.
    expect(Array.from(transitions)).toEqual([
      { active: true, raw: "entry 1" },
      { active: false, raw: "entry 3" },
      { active: true, raw: "entry 4" },
    ])
    expect(asked).toEqual([{ root: "a root", margin: "10px", amount: 0.5 }])
  }))

it.effect("IV2 (#273): inViewEvents with once: the first entry, then nothing", () =>
  Effect.gen(function* () {
    const transitions = yield* Stream.runCollect(Recognizer.inViewEvents(undefined, { once: true })).pipe(
      Effect.provide(scriptedProbe([true, false, true], [])),
    )
    expect(Array.from(transitions)).toEqual([{ active: true, raw: "entry 0" }])
  }))

it.effect("FV1 (#273): focus with visible: only a focus the Environment shows counts; without, any", () =>
  Effect.gen(function* () {
    const events: ReadonlyArray<InputSource.FocusLikeEvent> = [
      { type: "focus", timeStamp: 0, visible: false },
      { type: "blur", timeStamp: 10 },
      { type: "focus", timeStamp: 20, visible: true },
      { type: "blur", timeStamp: 30 },
      { type: "focus", timeStamp: 40 },
    ]
    const shown = yield* Stream.runCollect(Recognizer.focus(undefined, { visible: true })).pipe(Effect.provide(TestInput.layer([], events)))
    expect(Array.from(shown), "a pointer's focus doesn't count; an unsaid one does").toEqual([false, true, false, true])
    const any = yield* Stream.runCollect(Recognizer.focus(undefined)).pipe(Effect.provide(TestInput.layer([], events)))
    expect(Array.from(any)).toEqual([true, false, true, false, true])
  }))
