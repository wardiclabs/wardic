/**
 * The Scopes a binding opens on its provider's runtime, for an element's or a hook's work: each a child
 * of the runtime's own, so one nothing closed ends with the runtime, and closed with its owner without
 * throwing into the Solid cleanup that closes it. Solid-free, for both bindings.
 *
 * @module
 */
import * as Report from "@wardic/dom/Report"
import * as Exit from "effect/Exit"
import type * as ManagedRuntime from "effect/ManagedRuntime"
import * as Scope from "effect/Scope"

/**
 * A Scope for one owner's work on `runtime`: a child of the runtime's, so the runtime's disposal closes
 * it if its owner hasn't. Its finalizers run in reverse order, as a Scope's do.
 */
// #618 (L1): no detached `Scope.makeUnsafe()`. A child closed first takes itself off its parent.
export const open = (runtime: { readonly scope: Scope.Scope }): Scope.Closeable => Scope.forkUnsafe(runtime.scope, "sequential")

/**
 * Closes `scope` now, synchronously, on `runtime`. A finalizer that fails is logged and reported as
 * `label` (`Report.failure`), never thrown: the rest of the Solid cleanup that closes it still runs. A
 * Scope the runtime's disposal already closed is left as it is.
 */
// #618 (decision 5): `runtime.runSync(Scope.close(…))` threw a failed finalizer's cause into Solid's
// cleanup, which skipped the rest of it.
export const close = <R>(runtime: ManagedRuntime.ManagedRuntime<R, never>, scope: Scope.Closeable, label: string): void => {
  if (scope.state._tag === "Closed") return
  const exit = runtime.runSyncExit(Scope.close(scope, Exit.void))
  if (Exit.isFailure(exit)) runtime.runFork(Report.failure(label, exit.cause))
}
