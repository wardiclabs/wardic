/**
 * Failure reporting where a fiber stops: logged at Error and handed to the Environment's `ErrorReporter`s (ADR-0030, decision 4).
 *
 * `@wardic/dom/Report` (#132, ADR-0041).
 */
export {
  reportFailure as failure,
} from "./internal/report.ts"
