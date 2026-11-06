// Press claims (#439, ADR-0066): core's ledger, and the press recognizer reading it, over a two-target
// Input source whose platform events reach the inner target before the outer one, as the DOM's bubble.
//
// - PC1: the ledger: an event nothing marked is "none"; a press's mark "pressed"; a claim "claimed" to
//   every other target and "pressed" to its own; a claim stays; marks are kept by `raw`, else the event.
// - PC2: a down on the inner target presses both by default; claimed (`propagate: false`), the outer
//   one doesn't press, and a down on the outer one alone still does.
// - PC3: `propagate` as a function is read at each press's start.
// - PC4: a key from inside presses the outer target only when a press inside started from it and didn't
//   claim it: none from a plain element inside, none claimed; a key the inner press took (Space) still does.
// - PC5: a blur from inside cancels a keyboard press that reached the target from inside; `focus` counts
//   the target's own focus only.
import * as DragActivity from "@wardic/core/DragActivity"
import * as InputSource from "@wardic/core/InputSource"
import * as PressClaims from "@wardic/core/PressClaims"
import * as Recognizer from "@wardic/core/Recognizer"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as Option from "effect/Option"
import * as Feeds from "../src/feeds.ts"

type Name = "inner" | "outer"

/** A source of two targets, `inner` inside `outer`: each platform event pushed to the targets it passes through, the inner one first. */
const twoTargets = () => {
  const hubsOf = () => ({ pointer: Feeds.hub<InputSource.PointerLikeEvent>(), keys: Feeds.hub<InputSource.KeyboardLikeEvent>(), focus: Feeds.hub<InputSource.FocusLikeEvent>() })
  const hubs = { inner: hubsOf(), outer: hubsOf() }
  return {
    layer: Layer.succeed(InputSource.InputSource, {
      pointer: (target) => hubs[target as Name].pointer.feed,
      keyboard: (target) => hubs[target as Name].keys.feed,
      focus: (target) => hubs[target as Name].focus.feed,
      adoptPointer: () => Option.none(),
    }),
    /** A pointer event at `on` (the inner target, so the outer one too, or the outer one alone), as one platform event. */
    pointer: (type: InputSource.PointerLikeEvent["type"], on: Name, t: number) =>
      Effect.gen(function* () {
        const raw = { type, t }
        const at = (): InputSource.PointerLikeEvent =>
          InputSource.makePointerLikeEvent({ type, pressed: type === "down", timeStamp: t, onTarget: true, raw })
        if (on === "inner") yield* hubs.inner.pointer.push(at())
        yield* hubs.outer.pointer.push(at())
      }),
    /** A key at the inner target, as one platform event: from the inner one itself, from inside the outer one. */
    key: (type: "down" | "up", name: InputSource.Key, t: number) =>
      Effect.gen(function* () {
        const raw = { type, name, t }
        let handled = false
        const at = (fromTarget: boolean): InputSource.KeyboardLikeEvent => ({
          type,
          key: name,
          repeat: false,
          timeStamp: t,
          fromTarget,
          handled,
          handle: () => {
            handled = true
          },
          action: "none",
          raw,
        })
        yield* hubs.inner.keys.push(at(true))
        yield* hubs.outer.keys.push(at(false))
      }),
    /** A key at a plain element inside the outer target: it reaches the outer one alone, from inside. */
    plainKey: (type: "down" | "up", name: InputSource.Key, t: number) =>
      hubs.outer.keys.push({ type, key: name, repeat: false, timeStamp: t, fromTarget: false, handled: false, handle: () => {}, action: "none", raw: { t } }),
    /** The inner target's blur or focus: its own, and from inside the outer one. */
    focus: (type: "focus" | "blur", t: number) =>
      Effect.gen(function* () {
        yield* hubs.inner.focus.push({ type, timeStamp: t, fromTarget: true })
        yield* hubs.outer.focus.push({ type, timeStamp: t, fromTarget: false })
      }),
  }
}

/** Run `watch` in a Scope of its own. */
const opened = <R>(watch: Effect.Effect<void, never, Scope.Scope | R>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    yield* watch.pipe(Scope.provide(scope))
    return scope
  })

/** Watch the inner target's press, then the outer one's, each told into `heard` as `name phase input`. */
const watchBoth = (heard: Array<string>, inner: Recognizer.PressOptions = {}, outer: Recognizer.PressOptions = {}) =>
  Effect.gen(function* () {
    yield* opened(Recognizer.watchPress("inner", { on: (p) => heard.push(`inner ${p.phase} ${p.input}`) }, inner))
    yield* opened(Recognizer.watchPress("outer", { on: (p) => heard.push(`outer ${p.phase} ${p.input}`) }, outer))
  })

/** Fresh Drag activity and Press claims, so each test stands alone. */
const isolated = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provideService(PressClaims.PressClaims, PressClaims.make()), Effect.provideService(DragActivity.DragActivity, DragActivity.make()))

it("PC1: the ledger marks presses and claims, a claim its target's, kept by raw", () => {
  const claims = PressClaims.make()
  const raw = {}
  const a: PressClaims.Markable = { raw }
  const b: PressClaims.Markable = { raw }
  expect(claims.markOf(a, "inner"), "nothing marked").toBe("none")
  claims.mark(a, "inner", false)
  expect(claims.markOf(b, "outer"), "a press, kept by its raw").toBe("pressed")
  claims.mark(b, "middle", true)
  expect(claims.markOf(a, "outer"), "a claim, to another target").toBe("claimed")
  expect(claims.markOf(a, "middle"), "to its own").toBe("pressed")
  claims.mark(a, "outer", false)
  expect(claims.markOf(a, "inner"), "a claim stays").toBe("claimed")
  const bare: PressClaims.Markable = {}
  claims.mark(bare, "inner", true)
  expect(claims.markOf(bare, "outer"), "no raw: the event itself").toBe("claimed")
  expect(claims.markOf({}, "outer"), "another event").toBe("none")
})

it.effect("PC2: a down inside presses both; claimed, the outer one doesn't, though a down on it alone does", () =>
  isolated(
    Effect.gen(function* () {
      const open = twoTargets()
      const heard: Array<string> = []
      yield* Effect.gen(function* () {
        yield* watchBoth(heard)
        yield* open.pointer("down", "inner", 1)
        yield* open.pointer("up", "inner", 2)
      }).pipe(Effect.provide(open.layer))
      expect(heard).toEqual(["inner start pointer", "outer start pointer", "inner tap pointer", "outer tap pointer"])

      const claimed = twoTargets()
      const claimedHeard: Array<string> = []
      yield* Effect.gen(function* () {
        yield* watchBoth(claimedHeard, { propagate: false })
        yield* claimed.pointer("down", "inner", 1)
        yield* claimed.pointer("up", "inner", 2)
        yield* claimed.pointer("down", "outer", 3)
        yield* claimed.pointer("up", "outer", 4)
      }).pipe(Effect.provide(claimed.layer))
      expect(claimedHeard).toEqual(["inner start pointer", "inner tap pointer", "outer start pointer", "outer tap pointer"])
    }),
  ))

it.effect("PC3: propagate is read at each press's start", () =>
  isolated(
    Effect.gen(function* () {
      const input = twoTargets()
      const heard: Array<string> = []
      let stops = true
      yield* Effect.gen(function* () {
        yield* watchBoth(heard, { propagate: () => !stops })
        yield* input.pointer("down", "inner", 1)
        yield* input.pointer("up", "inner", 2)
        stops = false
        yield* input.pointer("down", "inner", 3)
        yield* input.pointer("up", "inner", 4)
      }).pipe(Effect.provide(input.layer))
      expect(heard).toEqual(["inner start pointer", "inner tap pointer", "inner start pointer", "outer start pointer", "inner tap pointer", "outer tap pointer"])
    }),
  ))

it.effect("PC4: a key from inside presses the outer target only from a press inside that didn't claim it", () =>
  isolated(
    Effect.gen(function* () {
      const input = twoTargets()
      const heard: Array<string> = []
      yield* Effect.gen(function* () {
        yield* watchBoth(heard)
        yield* input.key("down", "enter", 1)
        yield* input.key("up", "enter", 2)
        // Space: the inner press takes it, and it still reaches the outer one.
        yield* input.key("down", "space", 3)
        yield* input.key("up", "space", 4)
        // A plain element inside: no press there, so none here.
        yield* input.plainKey("down", "enter", 5)
        yield* input.plainKey("up", "enter", 6)
      }).pipe(Effect.provide(input.layer))
      expect(heard).toEqual([
        "inner start keyboard",
        "outer start keyboard",
        "inner tap keyboard",
        "outer tap keyboard",
        "inner start keyboard",
        "outer start keyboard",
        "inner tap keyboard",
        "outer tap keyboard",
      ])

      const claimed = twoTargets()
      const claimedHeard: Array<string> = []
      yield* Effect.gen(function* () {
        yield* watchBoth(claimedHeard, { propagate: false })
        yield* claimed.key("down", "enter", 1)
        yield* claimed.key("up", "enter", 2)
      }).pipe(Effect.provide(claimed.layer))
      expect(claimedHeard).toEqual(["inner start keyboard", "inner tap keyboard"])
    }),
  ))

it.effect("PC5: a blur from inside cancels a key's press that came from inside; focus counts the target's own", () =>
  isolated(
    Effect.gen(function* () {
      const input = twoTargets()
      const heard: Array<string> = []
      const focused: Array<boolean> = []
      yield* Effect.gen(function* () {
        yield* watchBoth(heard)
        yield* opened(Recognizer.watchFocus("outer", {}, { on: (f) => focused.push(f) }))
        yield* input.focus("focus", 1)
        yield* input.key("down", "enter", 2)
        yield* input.focus("blur", 3)
        yield* input.key("up", "enter", 4)
      }).pipe(Effect.provide(input.layer))
      expect(heard).toEqual(["inner start keyboard", "outer start keyboard", "inner cancel keyboard", "outer cancel keyboard"])
      expect(focused, "the outer target never focused: its own first report only").toEqual([false])
    }),
  ))
