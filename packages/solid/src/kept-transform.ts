/**
 * A transform's function on both bindings, Solid-free: an app's function, or the `mixer` in its ranges,
 * its last value kept while it throws, the first throw of a run of them reported. And where a failure
 * with no fiber of a binding's to see it is reported: on the provider's runtime, else on Effect's own.
 *
 * @module
 */
// #979, group D (ADR-0074): before, the throw failed the transform's Atom (Solid 2), or broke the update it
// ran in (Solid 1's memo), and came back through whatever set its source. Each try is in the closure Solid
// calls, a memo's compute, around direct calls: a helper called from it measured a few points a change on
// Bun. Solid 2's Atom form writes its own in its read.
import * as Report from "@wardic/core/unstable/Report"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import type { WardicRuntime } from "./runtime.ts"

/** A transform's own function that threw. */
export const FUNCTION_FAILED = "wardic.transform: its function failed"

/** A transform's ranges that threw: an app's `mixer`. */
export const MIXER_FAILED = "wardic.transform: its mixer failed"

/** A failure's `cause`, reported as `message` on `runtime`, or on Effect's own outside a provider. Its failure path. */
// #979 group I (row 26): a Stage's sensor's too, a Stage needing no provider.
export const failedOn = (runtime: WardicRuntime | undefined, message: string, cause: Cause.Cause<unknown>): void => {
  const failure = Report.failure(message, cause)
  if (Predicate.isUndefined(runtime)) {
    Effect.runFork(failure)
    return
  }
  runtime.runFork(failure)
}

/**
 * A memo's compute for `fn` over `read`: its last value kept while `fn` throws, the first throw of a run of
 * them reported as `message` on `runtime`, again after a clean call. With no value yet to keep, its throw
 * is its reader's.
 */
export const keptComputeOf = <A, B>(read: () => A, fn: (a: A) => B, runtime: WardicRuntime | undefined, message: string): (() => B) => {
  let last: B | undefined
  let kept = false
  let failing = false
  return () => {
    const v = read()
    try {
      last = fn(v)
      kept = true
      if (failing) failing = false
    } catch (defect) {
      if (!kept) throw defect
      if (!failing) failedOn(runtime, message, Cause.die(defect))
      failing = true
    }
    return last as B
  }
}
