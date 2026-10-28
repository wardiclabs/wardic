// Keyboard presses (#427, ADR-0056): core's press recognizer hears Enter and Space on its target, as
// a press like a pointer's, over the Test Environment's pushable Input feeds.
//
// - KP1: Enter's down starts a press and its up taps it, as Space's do; each told `input: "keyboard"`,
//   with its key event; a pointer's press is told `input: "pointer"`.
// - KP2: a key that doesn't press: a repeat, one from inside the target, one the page took, another
//   key, and Space where the target types it; Enter in a text field still presses.
// - KP3: a blur cancels a keyboard press, with the blur; its key's up after it taps nothing. A
//   pointer's press goes on through a blur.
// - KP4: one press at a time: a key while a pointer presses starts nothing, nor a pointer's down
//   while a key presses; the other key's up ends nothing. No press starts while a drag is active,
//   and one a drag became active during ends `"dragged"`.
// - KP5: Space's down is taken where its target does nothing with it (the page would scroll), not
//   where it acts on it (a button's click); Enter is never taken.
// - KP6: `keys: false` (a Reorder item's) hears no key and no blur: a pointer's press only.
// - KP7: the Stream over the watch ends once every feed has run out, not at the first: a key script
//   after a pointer script is heard, and `press` toggles on each.
// - KP8: a second down of the same key without an up (a lost keyup) keeps the press, as a pointer's
//   second down does.
import * as DragActivity from "@wardic/core/DragActivity"
import * as InputSource from "@wardic/core/InputSource"
import * as Recognizer from "@wardic/core/Recognizer"
import { TestInput } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"

/** A primary mouse's event, pressed except at the release. */
const ev = (type: InputSource.PointerLikeEvent["type"], t = 0): InputSource.PointerLikeEvent =>
  InputSource.makePointerLikeEvent({ type, pressed: type !== "up" && type !== "cancel", timeStamp: t, onTarget: true })

/** Each key taken, by its time. */
const taken: Array<number> = []

/** A key at the target: from it, untaken, no repeat, its target doing nothing with it, unless `over` says. */
const key = (type: "down" | "up", name: InputSource.Key, t = 0, over: Partial<InputSource.KeyboardLikeEvent> = {}): InputSource.KeyboardLikeEvent => ({
  type,
  key: name,
  repeat: false,
  timeStamp: t,
  fromTarget: true,
  handled: false,
  handle: () => taken.push(t),
  action: "none",
  ...over,
})

const blur = (t = 0): InputSource.FocusLikeEvent => ({ type: "blur", timeStamp: t })

/** Run `watch` in a Scope of its own. */
const opened = <R>(watch: Effect.Effect<void, never, Scope.Scope | R>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    yield* watch.pipe(Scope.provide(scope))
    return scope
  })

/** A press as `phase input@time`. */
const told = (press: Recognizer.PressEvent): string => `${press.phase} ${press.input}@${press.event.timeStamp}`

it.effect("KP1: Enter and Space press and tap, told as the keyboard's; a pointer's press as the pointer's", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const heard: Array<string> = []
    const events: Array<unknown> = []
    yield* Effect.gen(function* () {
      yield* opened(Recognizer.watchPress("el", {
          on: (p) => {
            heard.push(told(p))
            events.push(p.event)
          },
        }))
      const enter = key("down", "enter", 1)
      yield* input.pushKey(enter)
      yield* input.pushKey(key("up", "enter", 2))
      yield* input.pushKey(key("down", "space", 3))
      yield* input.pushKey(key("up", "space", 4))
      yield* input.push(ev("down", 5))
      yield* input.push(ev("up", 6))
      expect(events[0], "the key's own event").toBe(enter)
    }).pipe(Effect.provide(input.layer))
    expect(heard).toEqual(["start keyboard@1", "tap keyboard@2", "start keyboard@3", "tap keyboard@4", "start pointer@5", "tap pointer@6"])
  }))

it.effect("KP2: a repeat, a key from inside, a taken key, another key and a typed Space don't press; Enter in a text field does", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const heard: Array<string> = []
    yield* Effect.gen(function* () {
      yield* opened(Recognizer.watchPress("el", { on: (p) => heard.push(told(p)) }))
      yield* input.pushKey(key("down", "enter", 1, { repeat: true }))
      yield* input.pushKey(key("down", "enter", 2, { fromTarget: false }))
      yield* input.pushKey(key("down", "enter", 3, { handled: true }))
      yield* input.pushKey(key("down", "escape", 4))
      yield* input.pushKey(key("down", "space", 5, { action: "type" }))
      yield* input.pushKey(key("up", "space", 6, { action: "type" }))
      expect(heard, "nothing pressed").toEqual([])
      yield* input.pushKey(key("down", "enter", 7, { action: "activate" }))
      yield* input.pushKey(key("up", "enter", 8, { action: "activate" }))
    }).pipe(Effect.provide(input.layer))
    expect(heard).toEqual(["start keyboard@7", "tap keyboard@8"])
  }))

it.effect("KP3: a blur cancels a keyboard press, its key's up taps nothing; a pointer's press goes on through a blur", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const heard: Array<string> = []
    const events: Array<unknown> = []
    const lost = blur(2)
    yield* Effect.gen(function* () {
      yield* opened(Recognizer.watchPress("el", {
          on: (p) => {
            heard.push(told(p))
            events.push(p.event)
          },
        }))
      yield* input.pushKey(key("down", "enter", 1))
      yield* input.pushFocus(lost)
      yield* input.pushKey(key("up", "enter", 3))
      yield* input.push(ev("down", 4))
      yield* input.pushFocus(blur(5))
      yield* input.push(ev("up", 6))
    }).pipe(Effect.provide(input.layer))
    expect(heard).toEqual(["start keyboard@1", "cancel keyboard@2", "start pointer@4", "tap pointer@6"])
    expect(events[1], "the blur that cancelled it").toBe(lost)
  }))

it.effect("KP4: one press at a time; none starts while a drag is active, and one a drag took over ends dragged", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const activity = DragActivity.make()
    const heard: Array<string> = []
    yield* Effect.gen(function* () {
      yield* opened(Recognizer.watchPress("el", { on: (p) => heard.push(told(p)) }))
      yield* input.push(ev("down", 1))
      yield* input.pushKey(key("down", "enter", 2))
      yield* input.pushKey(key("up", "enter", 3))
      yield* input.push(ev("up", 4))
      yield* input.pushKey(key("down", "space", 5))
      yield* input.push(ev("down", 6))
      yield* input.pushKey(key("up", "enter", 7))
      yield* input.push(ev("up", 8))
      yield* input.pushKey(key("up", "space", 9))
      expect(heard).toEqual(["start pointer@1", "tap pointer@4", "start keyboard@5", "tap keyboard@9"])
      const release = activity.count()
      yield* input.pushKey(key("down", "enter", 10))
      yield* input.pushKey(key("up", "enter", 11))
      release()
      yield* input.pushKey(key("down", "enter", 12))
      const again = activity.count()
      yield* input.pushKey(key("up", "enter", 13))
      again()
    }).pipe(Effect.provide(input.layer), Effect.provideService(DragActivity.DragActivity, activity))
    expect(heard.slice(4)).toEqual(["start keyboard@12", "dragged keyboard@13"])
  }))

it.effect("KP5: Space is taken where its target does nothing with it, not where it acts on it; Enter never", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    taken.length = 0
    yield* Effect.gen(function* () {
      yield* opened(Recognizer.watchPress("el", { on: () => {} }))
      yield* input.pushKey(key("down", "space", 1, { action: "none" }))
      yield* input.pushKey(key("up", "space", 2, { action: "none" }))
      yield* input.pushKey(key("down", "space", 3, { action: "activate" }))
      yield* input.pushKey(key("up", "space", 4, { action: "activate" }))
      yield* input.pushKey(key("down", "enter", 5, { action: "none" }))
      yield* input.pushKey(key("up", "enter", 6, { action: "none" }))
      yield* input.pushKey(key("down", "space", 7, { action: "none", repeat: true }))
    }).pipe(Effect.provide(input.layer))
    expect(taken, "only the scrolling Space's down").toEqual([1])
  }))

it.effect("KP6: keys: false hears no key and no blur", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const heard: Array<string> = []
    taken.length = 0
    yield* Effect.gen(function* () {
      yield* opened(Recognizer.watchPress("el", { on: (p) => heard.push(told(p)) }, { keys: false }))
      yield* input.pushKey(key("down", "enter", 1))
      yield* input.pushKey(key("up", "enter", 2))
      yield* input.pushKey(key("down", "space", 3))
      yield* input.push(ev("down", 4))
      yield* input.pushFocus(blur(5))
      yield* input.push(ev("up", 6))
    }).pipe(Effect.provide(input.layer))
    expect(heard).toEqual(["start pointer@4", "tap pointer@6"])
    expect(taken, "nothing taken").toEqual([])
  }))

it.effect("KP7: the Stream ends once every feed has run out: a key script after a pointer script is heard", () =>
  Effect.gen(function* () {
    const layer = TestInput.layer([ev("down", 1), ev("up", 2)], [], [key("down", "enter", 3), key("up", "enter", 4)])
    const events = yield* Stream.runCollect(Recognizer.pressEvents(undefined)).pipe(Effect.provide(layer))
    expect(Array.from(events).map(told)).toEqual(["start pointer@1", "tap pointer@2", "start keyboard@3", "tap keyboard@4"])
    const states = yield* Stream.runCollect(Recognizer.press(undefined)).pipe(Effect.provide(layer))
    expect(Array.from(states)).toEqual([true, false, true, false])
  }))

it.effect("KP8: a second down of the same key without its up keeps the press", () =>
  Effect.gen(function* () {
    const input = yield* TestInput.pushable()
    const heard: Array<string> = []
    yield* Effect.gen(function* () {
      yield* opened(Recognizer.watchPress("el", { on: (p) => heard.push(told(p)) }))
      yield* input.pushKey(key("down", "enter", 1))
      yield* input.pushKey(key("down", "enter", 2))
      yield* input.pushKey(key("up", "enter", 3))
    }).pipe(Effect.provide(input.layer))
    expect(heard).toEqual(["start keyboard@1", "tap keyboard@3"])
  }))
