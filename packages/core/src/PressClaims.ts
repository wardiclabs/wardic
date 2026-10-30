/**
 * The `PressClaims` module. **Press claims** (#439, ADR-0066): which pointer downs and keys a press started
 * from, and whether that press claimed them (Motion's `claimedPointerDownEvents`,
 * `motion-dom/src/gestures/press/index.ts` @ `16c6122`). A press whose taps don't propagate
 * (`propagate={{ tap: false }}`) claims the down or the key it starts from, and no ancestor's press starts
 * from it. A key that a press inside started from, and didn't claim, presses its pressable ancestors too,
 * as Motion's keyboard press, a synthetic `pointerdown`, bubbles.
 *
 * One platform event reaches each target it passes through as an event of that target's, so a mark is
 * kept by the platform's own event (`raw`), which core never reads, or by the event itself where there's
 * none (the test Environment hands every target the same one). An Environment delivers an event to the
 * targets it passes through innermost first, so a press inside marks it before its ancestors read it.
 * A target never refuses itself: its presses share its claim, as its drags share a **Drag claim**.
 *
 * It is a `Context.Reference`, as **Drag activity** is: by default every runtime shares one, page-wide
 * like Motion's set, and a runtime can provide its own (the test Environment does). The API is
 * synchronous, so the press fold reads it inline.
 *
 * Tier 2 (ADR-0008): Effect-typed, stability tracks Effect.
 */
import * as Bool from "effect/Boolean"
import * as Context from "effect/Context"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"

/**
 * What the presses inside a target made of an event: `"none"`, no press started from it; `"pressed"`, one
 * did and let it propagate; `"claimed"`, one claimed it.
 */
export type Mark = "none" | "pressed" | "claimed"

/** An event a press can start from, a pointer's down or a key's: its `raw`, when it's an object, keys its mark. */
export interface Markable {
  readonly raw?: unknown
}

/** The page's Press claims. */
export interface Shape {
  /**
   * Note that a press on `target` started from `event`: claimed when that press doesn't propagate. A claim
   * stays claimed, and stays its target's.
   */
  readonly mark: (event: Markable, target: unknown, claimed: boolean) => void
  /** What the presses so far made of `event`, as `target` sees it: its own claim reads as `"pressed"`. */
  readonly markOf: (event: Markable, target: unknown) => Mark
}

/** An event's mark, and the target that claimed it. */
interface Entry {
  readonly mark: Mark
  readonly by: unknown
}

/** The object `event`'s mark is kept by: the platform's event, or the event itself. */
const keyOf = (event: Markable): object => {
  const raw = event.raw
  if (Predicate.isObjectKeyword(raw)) return raw
  return event
}

/** `entry` as `target` sees it: a claim by another target, or a press. */
const seenBy = (target: unknown) => (entry: Entry): Mark => {
  if (Bool.and(entry.mark === "claimed", entry.by !== target)) return "claimed"
  return "pressed"
}

/** Fresh Press claims, with nothing marked. Held weakly, so a platform event's mark goes with it. */
export const make = (): Shape => {
  const marks = new WeakMap<object, Entry>()
  return {
    mark: (event, target, claimed) => {
      const key = keyOf(event)
      if (UndefinedOr.map(marks.get(key), (entry) => entry.mark) === "claimed") return
      marks.set(key, { mark: Bool.match(claimed, { onTrue: (): Mark => "claimed", onFalse: (): Mark => "pressed" }), by: target })
    },
    markOf: (event, target) => UndefinedOr.match(marks.get(keyOf(event)), { onUndefined: (): Mark => "none", onDefined: seenBy(target) }),
  }
}

/** The runtime's Press claims: one shared default instance unless a runtime provides its own. */
export const PressClaims: Context.Reference<Shape> = Context.Reference<Shape>("@wardic/PressClaims", {
  defaultValue: make,
})
