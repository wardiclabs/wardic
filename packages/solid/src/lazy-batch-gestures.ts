/**
 * A Batch's gesture watches, their code loaded at the first (#665's PR 5, Q62): a Batch with no gesture
 * ships none of it, nor of the gestures' input it stands on. Shared by both bindings.
 *
 * @module
 */
// Q62 A: the gestures' code is about 7.4 KB gzipped, nearly all the DOM's input, which a Wardic element's
// gesture Features share. Loaded with `import()` at the page's first Batch `listen`, each watch starts as it
// arrives, as a `LazyWardic` Feature takes effect as it arrives: nothing before it is replayed. Once it
// has, every Batch sets its gestures up as it's made.
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

/** The gestures' module, once it has loaded: every Batch after the first sets its gestures up at once. */
// Module state (#460, Q7): one module, loaded once for the page.
let gesturesModule: typeof import("./batch-gestures.ts") | undefined
// Module state (#460, Q7): its load, settled once, never rejected: a failed load reported, and nothing watched.
let loadingModule: Promise<typeof import("./batch-gestures.ts") | undefined> | undefined

/** The gestures' module's load, started at its first need; a failure reported on `runtime`. */
const loadModule = (runtime: WardicRuntime): Promise<typeof import("./batch-gestures.ts") | undefined> => {
  if (Predicate.isUndefined(loadingModule)) {
    loadingModule = import("./batch-gestures.ts").then(
      (module) => {
        gesturesModule = module
        return module
      },
      (error: unknown) => {
        // Let a later Batch try again.
        loadingModule = undefined
        runtime.runFork(Report.failure("createBatch: its gestures' code failed to load", Cause.die(error)))
        return undefined
      },
    )
  }
  return loadingModule
}

/**
 * A Batch's gesture watches, each run once its code has loaded (at once once it has), on `runtime`, over
 * the input `registry` builds; none once `close` has ended them.
 */
export const lazyBatchGestures = (runtime: WardicRuntime, registry: FeatureRegistry): LazyBatchGestures => {
  let loaded: BatchGesturesOn | undefined
  let closed = false
  /** Its gestures, made over the loaded module. */
  const madeOn = (module: typeof import("./batch-gestures.ts")): BatchGesturesOn => {
    if (Predicate.isUndefined(loaded)) loaded = module.batchGesturesOn(runtime, () => registry.build(module.BATCH_GESTURES))
    return loaded
  }
  /** `use` its gestures: at once once the module has loaded, else once it arrives, unless they've closed. */
  const withGestures = (use: (on: BatchGesturesOn) => void): void => {
    if (closed) return
    if (Predicate.isNotUndefined(gesturesModule)) return use(madeOn(gesturesModule))
    loadModule(runtime).then((module) => {
      if (Predicate.isUndefined(module)) return
      if (closed) return
      use(madeOn(module))
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
