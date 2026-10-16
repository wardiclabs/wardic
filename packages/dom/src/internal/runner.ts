/**
 * A Layer-built service's runner (#132, ADR-0041): how `FlushGate.make` and `ProjectionSystem.make`
 * run their Effects after they're built, synchronously and forked, on the context their Layer was
 * built in, forking into its Scope.
 *
 * The context drops the scheduler of the call that built it. A binding's first read builds the
 * Layer inside a `ManagedRuntime.runSync`, whose fiber carries a sync `MixedScheduler`: kept, it
 * would pin every later fork to that scheduler, which resumes a fork's yields on a microtask, where
 * Effect's default resumes them on a macrotask. Without it, forks use the default, as a
 * `ManagedRuntime`'s do (ADR-0027, decision 6: a fork inherits the scheduler it's forked under).
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import * as Scheduler from "effect/Scheduler"
import type * as Scope from "effect/Scope"

/** Runs Effects synchronously, and forked into the Scope it was made in. */
export interface Runner<R> {
  readonly runSync: <A, E>(effect: Effect.Effect<A, E, R>) => A
  readonly runFork: <A, E>(effect: Effect.Effect<A, E, R>) => Fiber.Fiber<A, E>
}

/**
 * A runner over the current context, without its scheduler, forking into a `FiberSet` in the
 * current Scope. It forks with that context itself (`Effect.runForkWith`), not through
 * `FiberSet.runtime`, which reads the context again in the current fiber, where the building call's
 * scheduler still is: `Effect.provideContext` merges into a fiber's context, it doesn't replace it.
 */
export const makeRunner = <R>(): Effect.Effect<Runner<R>, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const context = Context.omit(Scheduler.Scheduler)(yield* Effect.context<R | Scope.Scope>())
    const fibers = yield* FiberSet.make()
    const fork = Effect.runForkWith(context)
    const runFork = <A, E>(effect: Effect.Effect<A, E, R>): Fiber.Fiber<A, E> => {
      const fiber = fork(effect)
      FiberSet.addUnsafe(fibers, fiber)
      return fiber
    }
    return { runSync: Effect.runSyncWith(context), runFork }
  })
