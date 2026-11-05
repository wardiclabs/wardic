/**
 * Where a binding's failure stops (ADR-0030, decision 4): `reportFailure` logs it at Error and
 * reports it to the Environment's `ErrorReporter`s. Core doesn't report: the Frame loop hands each
 * run's failure to its caller (ADR-0027, decision 7), and a Tier 2 caller may recover. A binding
 * boundary that ends a fiber nobody observes calls this, so a failure there reaches the console
 * and an app's reporters instead of stopping its feature with nothing said.
 *
 * An app installs its reporters on the Environment it hands the provider,
 * `ErrorReporter.layer([…])` merged into `env`; Wardic ships none. With none installed, a report
 * is one `getRef` and a size check, on the failure path only. A reporter built with
 * `ErrorReporter.make` dedupes a cause and its original error, so a failure that crosses two
 * boundaries reports once: pass the cause on as it came, never wrapped.
 *
 * Tier 2 (ADR-0008): for binding authors.
 */
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as ErrorReporter from "effect/ErrorReporter"

/**
 * `cause` logged at Error as `message`, with the cause, and handed to the Environment's
 * `ErrorReporter`s. An interruption is neither: it's how a run is removed, by a retarget, an unmount or a
 * dispose. Annotate the log by piping `Effect.annotateLogs` onto it.
 */
export const reportFailure = (message: string, cause: Cause.Cause<unknown>): Effect.Effect<void> =>
  Bool.match(Cause.hasInterruptsOnly(cause), {
    onTrue: () => Effect.void,
    onFalse: () => Effect.logError(message, cause).pipe(Effect.andThen(ErrorReporter.report(cause))),
  })
