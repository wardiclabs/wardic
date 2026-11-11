/**
 * A Batch's gesture watches, their code loaded at the first (#665's PR 5, Q62): a Batch with no gesture
 * ships none of it, nor of the gestures' input it stands on. Shared by both bindings.
 *
 * @module
 */
// Q62 A: the gestures' code is about 7.4 KB gzipped, nearly all the DOM's input, which a Wardic element's
// gesture Features share. Loaded with `import()` at a Batch's first `listen`, each watch starts as it
// arrives, as a `LazyWardic` Feature takes effect as it arrives: nothing before it is replayed.
import * as Report from "@wardic/dom/Report"
import * as Cause from "effect/Cause"
import * as Predicate from "effect/Predicate"
import type { BatchGestureWatches } from "./batch.ts"
import type { BatchGesturesOn } from "./batch-gestures.ts"
import type { FeatureRegistry } from "./feature.ts"
import type { WardicRuntime } from "./runtime.ts"

/** A Batch's gesture watches, and their end, with the Batch. */
export interface LazyBatchGestures extends BatchGestureWatches {
  readonly close: () => void
}

/**
 * A Batch's gesture watches, each run once its code has loaded, on `runtime`, over the input `registry`
 * builds; none once `close` has ended them. A failed load is reported once.
 */
export const lazyBatchGestures = (runtime: WardicRuntime, registry: FeatureRegistry): LazyBatchGestures => {
  let loaded: BatchGesturesOn | undefined
  let closed = false
  // Settled once, never rejected: a failed load reported there, and nothing watched.
  let loading: Promise<BatchGesturesOn | undefined> | undefined
  /** `use` its gestures: at once once they've loaded, else once they arrive, unless they've closed. */
  const withGestures = (use: (on: BatchGesturesOn) => void): void => {
    if (Predicate.isNotUndefined(loaded)) return use(loaded)
    if (Predicate.isUndefined(loading)) {
      loading = import("./batch-gestures.ts").then(
        (module) => {
          if (closed) return undefined
          loaded = module.batchGesturesOn(runtime, () => registry.build(module.BATCH_GESTURES))
          return loaded
        },
        (error: unknown) => {
          runtime.runFork(Report.failure("createBatch: its gestures' code failed to load", Cause.die(error)))
          return undefined
        },
      )
    }
    loading.then((on) => {
      if (Predicate.isUndefined(on)) return
      if (closed) return
      use(on)
    })
  }
  return {
    listen: (gesture, host) => withGestures((on) => on.listen(gesture, host)),
    focusable: (el) => withGestures((on) => on.focusable(el)),
    close: () => {
      closed = true
      if (Predicate.isNotUndefined(loaded)) loaded.close()
    },
  }
}
