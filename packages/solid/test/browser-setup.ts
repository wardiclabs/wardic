// Browser-harness setup: polyfill `setImmediate`/`clearImmediate`.
//
// Effect's scheduler (effect@4 beta) schedules fibers via `setImmediate`, a
// Node/happy-dom global absent in a real browser — without it any test running the
// Wardic Effect runtime (WardicProvider) throws "globalThis.setImmediate is not a
// function".
//
// We back it with `queueMicrotask`, NOT setTimeout: a fiber chain schedules many
// setImmediates, and microtasks all drain before the next macrotask (`await`), so
// the deterministic frame-driver flushes the whole Effect chain per frame. A
// setTimeout(0) polyfill produces chained macrotasks that a single `await` won't
// drain (the coordinator never ticks). A `cancelled` flag keeps clearImmediate
// honest (a queued microtask can't be unqueued).
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
