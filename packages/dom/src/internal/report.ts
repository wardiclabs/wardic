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
import * as LogLevel from "effect/LogLevel"
import * as Predicate from "effect/Predicate"
import * as References from "effect/References"

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

/**
 * Whether a Debug log would be kept, as Effect's `MinimumLogLevel` says. Run it once (a runtime, a
 * build) and keep the answer, not once a log.
 */
// #618: the spine reads it alone, so an app that logs nothing else doesn't ship debugOf's log.
export const debugKept: Effect.Effect<boolean> = /*#__PURE__*/ Effect.map(References.MinimumLogLevel, (level) => Bool.not(LogLevel.isGreaterThan(level, "Debug")))

/**
 * A lifecycle debug log for `scope` (`wardic.projection`, say): `log(event, annotations?)` logs
 * `scope: event` at Debug, forked on `runner`, with the annotations. Whether a Debug log would be kept
 * is read once, here ({@link debugKept}): when it wouldn't, `on` is `false` and `log` returns at once,
 * forking nothing. A site that builds its annotations per element checks `on` first.
 */
// #618 (M4): each call forked a fiber whatever the level, 0.3-0.5 µs to log nothing (one per layout
// node's mount and unmount); core's Frame loop reads the level once as this does (frameLoop.ts).
export const debugOf = (runner: { readonly runSync: <A>(effect: Effect.Effect<A>) => A; readonly runFork: <A>(effect: Effect.Effect<A>) => unknown }, scope: string): DebugLog => {
  const on = runner.runSync(debugKept)
  const log = (event: string, annotations?: Record<string, unknown>): void => {
    if (!on) return
    const logged = Effect.logDebug(`${scope}: ${event}`)
    if (Predicate.isUndefined(annotations)) {
      runner.runFork(logged)
      return
    }
    runner.runFork(Effect.annotateLogs(logged, annotations))
  }
  return Object.assign(log, { on })
}

/** {@link debugOf}'s log: called with an event and its annotations, and `on` when a Debug log is kept. */
export interface DebugLog {
  (event: string, annotations?: Record<string, unknown>): void
  /** Whether a Debug log would be kept: when it's `false`, a call logs nothing. */
  readonly on: boolean
}
