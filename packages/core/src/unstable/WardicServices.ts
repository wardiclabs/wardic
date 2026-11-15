/**
 * What a binding runs Wardic on: the services an Environment gives ({@link WardicServices}), the Layer
 * an app hands its provider ({@link WardicEnv}), and a {@link Runner}, which runs Effects on a built
 * context, synchronously and forked into the Scope it was made in.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672: `WardicServices` and `WardicEnv` from solid's `runtime.ts`,
// the Runner from dom's `internal/runner.ts` (ADR-0071 decision 4; #561 round 1, Q6). A
// `ManagedRuntime` meets the Runner's shape, so Solid hands its runtime over as it is.
import * as Bool from "effect/Boolean"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import type * as Layer from "effect/Layer"
import type * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as Scheduler from "effect/Scheduler"
import * as Scope from "effect/Scope"
import type * as Announcer from "../Announcer.ts"
import type * as Clock from "../Clock.ts"
import type * as DefaultTransition from "../DefaultTransition.ts"
import type * as FrameLoop from "../FrameLoop.ts"
import type * as InterpolatorRegistry from "../InterpolatorRegistry.ts"
import type * as Probe from "../Probe.ts"
import type * as ReducedMotion from "../ReducedMotion.ts"
import type * as RefreshFrameSource from "../RefreshFrameSource.ts"
import type * as Renderer from "../Renderer.ts"

/**
 * The services an Environment gives: what the provider's `env` must provide, and what a binding's
 * Effects run with.
 */
export type WardicServices =
  | Clock.Clock
  | RefreshFrameSource.RefreshFrameSource
  | FrameLoop.FrameLoop
  | Renderer.Renderer
  | Probe.Probe
  | InterpolatorRegistry.InterpolatorRegistry
  | ReducedMotion.PositionalKeys
  | DefaultTransition.DefaultTransition
  | Announcer.Announcer
  | AtomRegistry.AtomRegistry

/** The Layer an app hands its provider: an Environment, giving every one of {@link WardicServices}. */
export type WardicEnv = Layer.Layer<WardicServices, never, never>

/** Runs Effects synchronously, and forked into the Scope it was made in. */
export interface Runner<R> {
  readonly runSync: <A, E>(effect: Effect.Effect<A, E, R>) => A
  readonly runFork: <A, E>(effect: Effect.Effect<A, E, R>) => Fiber.Fiber<A, E>
  /**
   * Run `effect` now, synchronously, to its Exit: its failure, a defect, or an effect that suspends is
   * in the Exit, never thrown. What a binding closes an owner's Scope with (`OwnerScope.close`).
   */
  // #672 (PR5-Q1): a ManagedRuntime has it, so a binding's runtime meets the Runner as it is.
  readonly runSyncExit: <A, E>(effect: Effect.Effect<A, E, R>) => Exit.Exit<A, E>
  /**
   * The Scope it was made in: what a service built with it keeps its own fibers in, so closing the
   * Scope ends them, after the service's own cleanup, and awaits them.
   */
  // #618 (L1): each service opened a detached Scope of its own, closed by a fork or a throwing runSync.
  readonly scope: Scope.Scope
}

// A Layer-built service's runner (#132, ADR-0041; dom's `internal/runner.ts` until #672): how the
// Flush gate's and the projection system's `make` run their Effects after they're built, synchronously
// and forked, on the context their Layer was built in, forking into its Scope.
//
// The context drops a sync scheduler, and keeps any other (ADR-0041, *Amendment (#208)*). A
// binding's first read builds the Layer inside a `ManagedRuntime.runSync`, whose fiber carries a sync
// `MixedScheduler`: kept, it would pin every later fork to that scheduler, which resumes a fork's
// yields on a microtask, where Effect's default resumes them on a macrotask. Without it, forks use
// the default, as a `ManagedRuntime`'s do. A host's own async scheduler, provided in the Layers it
// hands Wardic (Foldkit's microtask `MixedScheduler`), is the host's choice: forks keep it (ADR-0027,
// decision 6: a fork inherits the scheduler it's forked under). A host that provides a *sync* one is
// overridden too: a sync scheduler is for draining a `runSync`.
/**
 * A runner over the current context, without a sync scheduler, holding its forks in a set of its own
 * until the current Scope closes and interrupts them (#746: what a `FiberSet` held, so an app ships no
 * FiberSet); a fork after that is interrupted at once. It forks with that context itself (`Effect.runForkWith`), not through
 * `FiberSet.runtime`, which reads the context again in the current fiber, where the building call's
 * scheduler still is: `Effect.provideContext` merges into a fiber's context, it doesn't replace it.
 */
// Not `Effect.fnUntraced`, as effect-4's guide prefers: TypeScript can't carry `R` through it, and the
// runner's context would be `unknown` (#618, H1).
export const makeRunner = <R>(): Effect.Effect<Runner<R>, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const context = withoutSyncScheduler(yield* Effect.context<R | Scope.Scope>())
    const fibers = new Set<Fiber.Fiber<unknown, unknown>>()
    let closed = false
    yield* Effect.addFinalizer(() =>
      Effect.suspend(() => {
        closed = true
        return Fiber.interruptAll(fibers)
      }),
    )
    const fork = Effect.runForkWith(context)
    const runFork = <A, E>(effect: Effect.Effect<A, E, R>): Fiber.Fiber<A, E> => {
      const fiber = fork(effect)
      if (closed) {
        fiber.interruptUnsafe()
        return fiber
      }
      fibers.add(fiber)
      fiber.addObserver(() => {
        if (!closed) fibers.delete(fiber)
      })
      return fiber
    }
    return { runSync: Effect.runSyncWith(context), runSyncExit: Effect.runSyncExitWith(context), runFork, scope: Context.get(context, Scope.Scope) }
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
