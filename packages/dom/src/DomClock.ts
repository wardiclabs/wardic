/**
 * The DOM's Clock: core's Clock and its Refresh frame source over the browser's `requestAnimationFrame`,
 * as one Layer that needs nothing. `DomLive` provides it.
 *
 * @example
 * import * as DomClock from "@wardic/dom/DomClock"
 *
 * const now = Effect.map(Clock.Clock, (clock) => clock.now()).pipe(Effect.provide(DomClock.layer))
 */
// `@wardic/dom/DomClock` (#132, ADR-0041): rAF-driven (ADR-0031).
export {
  ClockDomLive as layer,
} from "./internal/clock.ts"
