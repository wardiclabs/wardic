/**
 * Press claims: the pointer downs and keys presses started from, and whether a press claimed one, so a
 * press that doesn't propagate (`Recognizer.press`'s `propagate: false`) keeps its ancestors' presses
 * from starting on the same down. A key a press inside started from, and didn't claim, presses its
 * pressable ancestors too, as a pointer's down does. `Recognizer`'s presses mark and read them; a
 * recognizer of your own that presses does the same.
 *
 * Every runtime shares one by default, page-wide, as Motion's are; a runtime can provide its own, as
 * the test Environment does. It's synchronous, so a press reads it as it decides.
 *
 * @example
 * import * as PressClaims from "@wardic/core/PressClaims"
 *
 * const claims = yield* PressClaims.PressClaims
 * claims.mark(down, button, true) // the button's press claims the down
 * claims.markOf(down, card) // "claimed": the card's press doesn't start
 */
// #439, ADR-0066: Motion's `claimedPointerDownEvents`, `motion-dom/src/gestures/press/index.ts` @ `16c6122`.
//
// One platform event reaches each target it passes through as an event of that target's, so a mark is
// kept by the platform's own event (`raw`), which core never reads, or by the event itself where there's
// none (the test Environment hands every target the same one). Two contracts of `InputSource` make that
// work: one platform event's copies share their `raw`, and a pointer's down or a key reaches the targets
// it passes through innermost first, so a press inside marks it before its ancestors read it. A target
// never refuses itself: its presses share its claim, as its drags share a **Drag claim**.
//
// A `Context.Reference`, as **Drag activity** is. Tier 2 (ADR-0008): Effect-typed, stability tracks Effect.
import * as Bool from "effect/Boolean"
import * as Context from "effect/Context"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"

/**
 * What the presses inside a target made of an event: `"none"`, no press started from it; `"pressed"`, one
 * did and let it propagate; `"claimed"`, one claimed it.
 */
export type Mark = "none" | "pressed" | "claimed"

/** An event a press can start from, a pointer's down or a key's. */
export interface Markable {
  /**
   * The platform's own event, which keys its mark when it's an object: each target an event passes
   * through gets its own copy, and the copies share it. Without one, the event itself keys it.
   */
  readonly raw?: unknown
}

/** The page's Press claims: what `PressClaims` gives. */
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

/** Fresh Press claims, with nothing marked: for a runtime that provides its own. Each mark goes with its event. */
// Held weakly.
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

/** The runtime's Press claims: one shared by every runtime unless a runtime provides its own. */
export const PressClaims: Context.Reference<Shape> = /*#__PURE__*/ Context.Reference<Shape>("@wardic/PressClaims", {
  defaultValue: make,
})
