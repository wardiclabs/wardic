/**
 * The end of the current task: `next` waits for it, then goes on before any timer, frame or later task,
 * the same on every platform. The Clock starts its loop there, and an Environment can hold work to it,
 * as `@wardic/dom` does its end-of-task holds.
 *
 * @example
 * import * as Microtask from "@wardic/core/Microtask"
 *
 * yield* Microtask.next // the rest of this task's work has run
 */
// ADR-0017.
import * as Effect from "effect/Effect"

// @wardic/core compiles against ES2022 alone (no DOM lib, no Node types), which does
// not declare `queueMicrotask`. It is a host global in every environment Wardic
// targets, so it is declared here, in module scope only.
declare const queueMicrotask: (callback: () => void) => void

/**
 * Waits for the end of the current task, then goes on, inside that microtask: before any timer, frame or
 * later task. It needs nothing, no Clock, no scheduler. Interrupting it before then cancels it.
 */
// Built from `Effect.callback` + `queueMicrotask`. When the microtask fires it calls `resume`, and
// because the fiber has already yielded, `resume` runs the continuation synchronously inside that
// microtask: it does not go back through the Effect scheduler.
//
// Why not a forked `Clock` tick or `Effect.yieldNow`: those resume through the Effect scheduler, whose
// fork dispatch is `setTimeout(0)` in browsers (no `setImmediate`) but a microtask on React Native and in
// the browser test harness (its `setImmediate` polyfill is `queueMicrotask`-backed). An "end of task"
// window built on them would last a task longer in browsers than elsewhere. `queueMicrotask` is the same
// checkpoint everywhere: browsers, Node, React Native ≥ 0.66 and Hermes (with its microtask queue
// enabled). Interrupting it leaves the pending microtask's `resume` a no-op.
//
// Deliberately untraced: a building block. Callers own the span for the window they are waiting out
// (e.g. `wardic.projection.leaverHold`).
export const next: Effect.Effect<void> = Effect.callback<void>((resume) => {
  queueMicrotask(() => resume(Effect.void))
})
