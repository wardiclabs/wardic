/**
 * The Scopes a binding opens on its provider's runtime, for an element's or a hook's work: each a child
 * of the runtime's own, so one nothing closed ends with the runtime, and closed with its owner without
 * throwing into the cleanup that closes it. Every binding's.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672: solid's `owner-scope.ts`, moved to dom for every DOM binding's
// elements, hooks and Features, on a Runner (PR5-Q1).
import * as Report from "../Report.ts"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import type * as WardicServices from "@wardic/core/unstable/WardicServices"

/**
 * A Scope for one owner's work on `runtime`: a child of the runtime's, so the runtime's disposal closes
 * it if its owner hasn't. Its finalizers run in reverse order, as a Scope's do.
 */
// #618 (L1): no detached `Scope.makeUnsafe()`. A child closed first takes itself off its parent.
export const open = (runtime: { readonly scope: Scope.Scope }): Scope.Closeable => Scope.forkUnsafe(runtime.scope, "sequential")

/**
 * Closes `scope` now, synchronously, on `runtime`. A finalizer that fails is logged and reported as
 * `label` (`Report.failure`), never thrown: the rest of the binding's cleanup that closes it still runs. A
 * Scope the runtime's disposal already closed is left as it is.
 */
// #618 (decision 5): `runtime.runSync(Scope.close(…))` threw a failed finalizer's cause into Solid's
// cleanup, which skipped the rest of it.
export const close = <R>(runtime: WardicServices.Runner<R>, scope: Scope.Closeable, label: string): void => {
  if (scope.state._tag === "Closed") return
  const exit = runtime.runSyncExit(Scope.close(scope, Exit.void))
  if (Exit.isFailure(exit)) runtime.runFork(Report.failure(label, exit.cause))
}
