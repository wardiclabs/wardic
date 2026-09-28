// Browser-harness setup: polyfill `setImmediate`/`clearImmediate`.
//
// Effect's scheduler (effect@4) dispatches fibers through `setImmediate` when that
// global exists and falls back to `setTimeout(0)` otherwise. It checks once, at
// module load (`"setImmediate" in globalThis`, effect/dist/Scheduler.js). A real
// browser has no `setImmediate`, so this setup file installs one before Effect loads.
//
// We back it with `queueMicrotask`, NOT setTimeout: a fiber chain schedules many
// setImmediates, and microtasks all drain before the next macrotask (`await`), so
// an Effect.yieldNow-based flush (or a deterministic frame driver) drains the whole
// chain in one turn. A setTimeout(0) polyfill produces chained macrotasks a single
// `await` won't drain. A `cancelled` flag keeps clearImmediate honest (a queued
// microtask can't be unqueued).
interface ImmediateHandle {
  cancelled: boolean
}
const g = globalThis as unknown as {
  setImmediate?: (fn: (...a: ReadonlyArray<unknown>) => void, ...a: ReadonlyArray<unknown>) => unknown
  clearImmediate?: (id: unknown) => void
}
if (typeof g.setImmediate !== "function") {
  g.setImmediate = (fn, ...args) => {
    const handle: ImmediateHandle = { cancelled: false }
    queueMicrotask(() => {
      if (!handle.cancelled) fn(...args)
    })
    return handle
  }
  g.clearImmediate = (id) => {
    if (id && typeof id === "object") (id as ImmediateHandle).cancelled = true
  }
}
