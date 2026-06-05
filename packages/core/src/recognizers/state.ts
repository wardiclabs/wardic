import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type { FocusLikeEvent, PointerLikeEvent } from "../services/InputSource.ts"
import { InputSource } from "../services/InputSource.ts"
import { Probe } from "../services/Probe.ts"

/**
 * Shared shell for the boolean "state" recognizers (`hover`/`press`/`focus`/
 * `inView`). Each one resolves a service, subscribes to an event stream, and
 * folds events into a single boolean ("active") via a pure `fold`. The shell
 * owns the common machinery so the recognizers reduce to a span name, the
 * service-resolving `acquire`, and the per-recognizer `fold`:
 *
 * - `Stream.unwrap(Effect.gen)` — resolve the service then return the stream.
 * - annotated `logDebug("<span>: subscribe")` on subscribe (cold setup, not the
 *   hot path); per-event folding stays silent.
 * - `Stream.mapAccum` over a boolean state, seeded `false` via a thunk (mirrors
 *   drag/scalar), emitting the folded boolean each event.
 * - `Stream.changes` dedups consecutive equal booleans, so only transitions are
 *   surfaced.
 * - `Effect.annotateLogs(attributes)` + `Stream.withSpan(span, { attributes })`
 *   wrap the whole thing in observability, matching the `wardic.*` convention.
 */
const stateRecognizer = <Ev, R>(
  span: string,
  attributes: Record<string, unknown>,
  acquire: Effect.Effect<Stream.Stream<Ev>, never, R>,
  fold: (active: boolean, event: Ev) => boolean,
): Stream.Stream<boolean, never, R> =>
  Stream.unwrap(
    Effect.gen(function* () {
      yield* Effect.logDebug(`${span}: subscribe`).pipe(Effect.annotateLogs(attributes))
      const events = yield* acquire
      return events.pipe(
        Stream.mapAccum(
          () => false,
          (active, ev) => {
            const next = fold(active, ev)
            return [next, [next]] as const
          },
        ),
        Stream.changes,
      )
    }).pipe(Effect.annotateLogs(attributes)),
  ).pipe(Stream.withSpan(span, { attributes }))

/**
 * Recognize hover state on `target`: `true` while the pointer is inside,
 * `false` once it leaves. `enter` -> `true`, `leave` -> `false`; any other
 * pointer event keeps the current state. Emits only on transitions.
 */
export const hover = (target: unknown): Stream.Stream<boolean, never, InputSource> =>
  stateRecognizer(
    "wardic.hover",
    {},
    Effect.map(InputSource, (i) => i.pointer(target)),
    (active, e: PointerLikeEvent) => (e.type === "enter" ? true : e.type === "leave" ? false : active),
  )

/**
 * Recognize press state on `target`: `true` while the pointer is held down,
 * `false` once released or cancelled. `down` -> `true`, `up`|`cancel` ->
 * `false`; other pointer events keep the current state. Emits only on
 * transitions.
 */
export const press = (target: unknown): Stream.Stream<boolean, never, InputSource> =>
  stateRecognizer(
    "wardic.press",
    {},
    Effect.map(InputSource, (i) => i.pointer(target)),
    (active, e: PointerLikeEvent) =>
      e.type === "down" ? true : e.type === "up" || e.type === "cancel" ? false : active,
  )

/**
 * Recognize focus state on `target`: `true` while focused, `false` once
 * blurred. `focus` -> `true`, `blur` -> `false`. Emits only on transitions.
 */
export const focus = (target: unknown): Stream.Stream<boolean, never, InputSource> =>
  stateRecognizer(
    "wardic.focus",
    {},
    Effect.map(InputSource, (i) => i.focus(target)),
    (_active, e: FocusLikeEvent) => e.type === "focus",
  )

/**
 * Recognize in-view (intersection) state on `target` via `Probe`. The probe's
 * `observeIntersection` already emits booleans, so the fold is the identity on
 * the event. Runs through the same shell for the `wardic.inView` span/log and
 * `Stream.changes` dedup.
 *
 * With `{ once: true }` the stream settles after (and including) the first
 * `true` — `Stream.takeUntil(active => active)` keeps the terminating `true`
 * and ends the stream, so once-in-view targets never go back to `false`.
 */
export const inView = (
  target: unknown,
  options?: { readonly once?: boolean },
): Stream.Stream<boolean, never, Probe> => {
  const base = stateRecognizer(
    "wardic.inView",
    {},
    Effect.map(Probe, (p) => p.observeIntersection(target)),
    (_active, inView: boolean) => inView,
  )
  return options?.once === true ? base.pipe(Stream.takeUntil((active) => active)) : base
}
