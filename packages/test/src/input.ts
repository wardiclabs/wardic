import * as InputSource from "@wardic/core/InputSource"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Layer from "effect/Layer"
import * as Feeds from "./feeds.ts"

/**
 * An InputSource that replays fixed scripts of events, as **Input feeds** that end after their
 * script (#318: a Stream over one ends too). `pointer(target)` replays the same `pointerEvents`,
 * `focus(target)` the same `focusEvents` and `keyboard(target)` the same `keyEvents` to each
 * subscriber (each ignores `target` — tests address a single surface). The first positional arg is
 * pointer events for back-compat; focus and key events are optional, defaulting to empty so existing
 * call sites emit nothing on them. Each script plays whole when its feed is subscribed, so scripts of
 * two kinds don't interleave: a test that needs them to pushes them ({@link pushable}). Called with no
 * args it yields an InputSource that emits nothing — for tests that don't exercise gestures. It adopts
 * no pointer (#431): `adoptPointer` delivers nothing.
 */
export const layer = (
  pointerEvents: ReadonlyArray<InputSource.PointerLikeEvent> = [],
  focusEvents: ReadonlyArray<InputSource.FocusLikeEvent> = [],
  keyEvents: ReadonlyArray<InputSource.KeyboardLikeEvent> = [],
): Layer.Layer<InputSource.InputSource> =>
  Layer.succeed(InputSource.InputSource, {
    pointer: () => Feeds.script(pointerEvents),
    keyboard: () => Feeds.script(keyEvents),
    focus: () => Feeds.script(focusEvents),
    adoptPointer: () => undefined,
  })

/**
 * A push-based InputSource for tests that need to interleave pointer events with
 * other effects (e.g. advancing the Clock between a release and a re-grab). Unlike
 * {@link layer} — which replays a fixed script that drains immediately — this
 * form lets the test `push` events one at a time, on its own schedule.
 *
 * Backed by a hub (`feeds.ts`, #318) so that every subscription to `pointer(target)`
 * hears every event: a consumer may subscribe to `input.pointer(target)` more than once
 * (a binding's drag track reads the drag fold and the grabs). There is no replay buffer,
 * so only events pushed *after* a subscription is live reach it.
 *
 * `push` doesn't yield (ADR-0032): a subscriber handles the event inside the push, as an
 * Environment's consumers handle a real event inside its dispatch, so a pipeline that hops
 * through Effect's scheduler on its way to its sink hasn't got there when `push` returns,
 * and its test sees it.
 *
 * Returns `{ layer, push }`. Resolve it inside an `Effect.gen`, provide `layer`,
 * and drive the surface with `push`:
 *
 * @example
 * const input = yield* TestInput.pushable()
 * yield* Stream.runForEach(drag(undefined), …).pipe(Effect.fork…)  // subscribe
 * yield* input.push(ev("down", 0, 0, 0))
 *
 * Returns `pushFocus` and `pushKey` alongside `push` so focus/blur transitions and keys (#427) can be
 * driven on the same schedule; `focus(target)` and `keyboard(target)` mirror `pointer(target)`, each
 * with its own hub.
 *
 * `adoptPointer(target, raw)` (#431) takes a pointer event as its `raw`: a pressed one is pushed on
 * the pointer hub as an adopted down, inside the call, as the DOM's is. The hub holds no pointer, so
 * the test pushes that pointer's later events itself.
 */
export const pushable = (): Effect.Effect<{
  readonly layer: Layer.Layer<InputSource.InputSource>
  readonly push: (event: InputSource.PointerLikeEvent) => Effect.Effect<void>
  readonly pushFocus: (event: InputSource.FocusLikeEvent) => Effect.Effect<void>
  readonly pushKey: (event: InputSource.KeyboardLikeEvent) => Effect.Effect<void>
}> =>
  Effect.sync(() => {
    const pointer = Feeds.hub<InputSource.PointerLikeEvent>()
    const focus = Feeds.hub<InputSource.FocusLikeEvent>()
    const keys = Feeds.hub<InputSource.KeyboardLikeEvent>()
    return {
      layer: Layer.succeed(InputSource.InputSource, {
        pointer: () => pointer.feed,
        keyboard: () => keys.feed,
        focus: () => focus.feed,
        adoptPointer: (_target, raw) => {
          if (isPressedPointer(raw)) {
            const down: InputSource.PointerLikeEvent = { ...raw, type: "down", adopted: true }
            Effect.runSync(pointer.push(down))
            return down
          }
          return undefined
        },
      }),
      push: pointer.push,
      pushFocus: focus.push,
      pushKey: keys.push,
    }
  })

/** Whether `raw` is a pointer event with a button pressed: one the pushable InputSource adopts (#431). */
const isPressedPointer = (raw: unknown): raw is InputSource.PointerLikeEvent =>
  Bool.and(Predicate.hasProperty(raw, "pointerId"), Predicate.hasProperty(raw, "pressed")) && (raw as InputSource.PointerLikeEvent).pressed
