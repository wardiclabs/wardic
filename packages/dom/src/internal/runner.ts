/**
 * A Layer-built service's runner (#132, ADR-0041): how `FlushGate.make` and `DomProjectionSystem.make`
 * run their Effects after they're built, synchronously and forked, on the context their Layer was
 * built in, forking into its Scope.
 *
 * The context drops a sync scheduler, and keeps any other (ADR-0041, *Amendment (#208)*). A
 * binding's first read builds the Layer inside a `ManagedRuntime.runSync`, whose fiber carries a sync
 * `MixedScheduler`: kept, it would pin every later fork to that scheduler, which resumes a fork's
 * yields on a microtask, where Effect's default resumes them on a macrotask. Without it, forks use
 * the default, as a `ManagedRuntime`'s do. A host's own async scheduler, provided in the Layers it
 * hands Wardic (Foldkit's microtask `MixedScheduler`), is the host's choice: forks keep it (ADR-0027,
 * decision 6: a fork inherits the scheduler it's forked under). A host that provides a *sync* one is
 * overridden too: a sync scheduler is for draining a `runSync`.
 */
import * as Bool from "effect/Boolean"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import * as Scheduler from "effect/Scheduler"
import * as Scope from "effect/Scope"

/** Runs Effects synchronously, and forked into the Scope it was made in. */
export interface Runner<R> {
  readonly runSync: <A, E>(effect: Effect.Effect<A, E, R>) => A
  readonly runFork: <A, E>(effect: Effect.Effect<A, E, R>) => Fiber.Fiber<A, E>
  /**
   * The Scope it was made in: what a service built with it keeps its own fibers in, so closing the
   * Scope ends them, after the service's own cleanup, and awaits them.
   */
  // #618 (L1): each service opened a detached Scope of its own, closed by a fork or a throwing runSync.
  readonly scope: Scope.Scope
}

/**
 * A runner over the current context, without a sync scheduler, forking into a `FiberSet` in the
 * current Scope. It forks with that context itself (`Effect.runForkWith`), not through
 * `FiberSet.runtime`, which reads the context again in the current fiber, where the building call's
 * scheduler still is: `Effect.provideContext` merges into a fiber's context, it doesn't replace it.
 */
export const makeRunner = <R>(): Effect.Effect<Runner<R>, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const context = withoutSyncScheduler(yield* Effect.context<R | Scope.Scope>())
    const fibers = yield* FiberSet.make()
    const fork = Effect.runForkWith(context)
    const runFork = <A, E>(effect: Effect.Effect<A, E, R>): Fiber.Fiber<A, E> => {
      const fiber = fork(effect)
      FiberSet.addUnsafe(fibers, fiber)
      return fiber
    }
    return { runSync: Effect.runSyncWith(context), runFork, scope: Context.get(context, Scope.Scope) }
  })

/**
 * `context` without its scheduler when that one is sync (`runSync`'s), else as it is: a host's
 * async scheduler stays, and with none stored the context has Effect's default already.
 */
const withoutSyncScheduler = <S>(context: Context.Context<S>): Context.Context<S> =>
  Bool.match(Context.get(context, Scheduler.Scheduler).executionMode === "sync", {
    onTrue: () => Context.omit(Scheduler.Scheduler)(context),
    onFalse: () => context,
  })
