/**
 * Reporting a failure where a fiber stops: logged at Error and handed to the Environment's
 * `ErrorReporter`s, so an app's error tracking sees it. An interruption is neither: it's how a run is
 * removed.
 *
 * @example
 * import * as Report from "@wardic/dom/Report"
 *
 * yield* Report.failure("wardic: an animation failed", cause)
 */
// `@wardic/dom/Report` (#132, ADR-0041): ADR-0030, decision 4. Core's since #672 (ADR-0030's
// *Amendment (#672)*): the spine reports from core once it's lifted there; this stays its Tier 2 face.
export { failure, debugKept, debugOf, type DebugLog } from "@wardic/core/unstable/Report"
