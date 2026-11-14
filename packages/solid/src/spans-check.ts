/**
 * Development's word on a tracer that reads no Wardic span (#746, ADR-0067 *Amendment (#746)*, decision
 * 8): a provider whose `env` installs a tracer, tracing on, but gives no `WardicSpans` says so once, as
 * it builds. Each binding's provider calls it under its Solid's `DEV`, so a production build ships none
 * of it, and none of Effect's `Tracer`.
 *
 * @module
 */
import * as Spans from "@wardic/core/Spans"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import type { WardicRuntime } from "./runtime.ts"

/** What development says. */
const MESSAGE =
  "wardic.spans: a tracer is installed, but Wardic opens no spans without WardicSpans. Merge it beside DomLive: Layer.mergeAll(DomLive, WardicSpans, …). See https://wardic.dev/guides/observability."

/** Says, on `runtime`, that its tracer reads no Wardic span: run once a provider, at its idle build (#535). */
export const warnWithoutSpans = (runtime: WardicRuntime): void => {
  try {
    runtime.runSync(Effect.flatMap(Spans.missing, (missing) => Bool.match(missing, { onTrue: () => Effect.logWarning(MESSAGE), onFalse: () => Effect.void })))
  } catch {
    // An env that fails to build is the first element's to report.
  }
}
