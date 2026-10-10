/**
 * The `Microtask` module: the end of the current task, for the Clock's Priming tick and dom's
 * end-of-task holds.
 */
import * as Effect from "effect/Effect"

// @wardic/core compiles against ES2022 alone (no DOM lib, no Node types), which does
// not declare `queueMicrotask`. It is a host global in every environment Wardic
// targets, so it is declared here, in module scope only.
declare const queueMicrotask: (callback: () => void) => void

/**
 * Suspend the current fiber until the next microtask checkpoint, then continue.
 *
 * Built from `Effect.callback` + `queueMicrotask`. When the microtask fires it
 * calls `resume`, and because the fiber has already yielded, `resume` runs the
 * continuation **synchronously inside that microtask** — it does not go back
 * through the Effect scheduler. The code after `yield* Microtask.next` therefore
 * runs at the end of the current task, before any timer, animation frame or
 * later task.
 *
 * Why not a forked `Clock` tick or `Effect.yieldNow`: those resume through the
 * Effect scheduler, whose fork dispatch is `setTimeout(0)` in browsers (no
 * `setImmediate`) but a microtask on React Native and in the browser test
 * harness (its `setImmediate` polyfill is `queueMicrotask`-backed). An "end of
 * task" window built on them would last a task longer in browsers than
 * elsewhere. `queueMicrotask` is the same checkpoint everywhere: browsers,
 * Node, React Native ≥ 0.66 and Hermes (with its microtask queue enabled).
 *
 * No `R` requirement, no `Clock`, no sleep and no scheduler yield. Interrupting
 * the fiber before the microtask fires cancels the continuation: the pending
 * microtask's `resume` becomes a no-op.
 *
 * Deliberately untraced — it is a building block. Callers own the span for the
 * window they are waiting out (e.g. `wardic.projection.leaverHold`).
 */
export const next: Effect.Effect<void> = Effect.callback<void>((resume) => {
  queueMicrotask(() => resume(Effect.void))
})
