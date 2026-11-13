/**
 * Timeline values: a Live value derived from a container's scroll by ranges alone, which the
 * browser draws with the scroll itself, on a native `ScrollTimeline` or `ViewTimeline`, so it doesn't
 * trail a scroll the browser runs off the main thread. The gate goes on writing the key: the animation
 * draws over it, and where the timeline can't (a container that doesn't overflow) the gate's value shows.
 *
 * A binding makes one for a key whose Live value core describes (`LiveValue.scrollDerivationOf`), and
 * hands it to the gate while the key shows it (`FlushGate`'s `timeline`). It's built only where it draws
 * what the gate would: `make` gives `None` for anything else, which the gate draws as ever.
 *
 * @example
 * import * as TimelineValue from "@wardic/dom/TimelineValue"
 *
 * const derivation = Option.getOrThrow(LiveValue.scrollDerivationOf(opacity))
 * const timeline = yield* TimelineValue.make(derivation, element, "opacity")
 */
// `@wardic/dom/TimelineValue` (ADR-0041's names; CONTEXT.md's **Timeline value**), #240, ADR-0043
// *Amendment (#240)*. Only the `scroll` Feature's code imports it.
export { make, type TimelineValue } from "./internal/timeline.ts"
