/**
 * A Batch's gesture watches (#665's PR 5, ADR-0070 decision 12, Q56–Q60): its members' hover and presses,
 * from one source each over the gestures' input, run on its provider in a Scope the binding closes with
 * the Batch. Shared by both bindings.
 *
 * @module
 */
// Q56: core's `Recognizer.watchHoverAmong` and `watchPressAmong`, over the InputSource's feeds over many
// targets (Q17's probe: a listener set per member cost 12 ms and 4.6 KB a member per 1,000). The input is
// the gesture Features' (`features/input.ts`), brought as the Batch listens (ADR-0067 decision 12).
import * as InputSource from "@wardic/core/InputSource"
import * as Recognizer from "@wardic/core/Recognizer"
import * as DomInput from "@wardic/dom/DomInput"
import * as Report from "@wardic/dom/Report"
import type * as Cause from "effect/Cause"
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Scope from "effect/Scope"
import type { BatchGestureWatches } from "./batch.ts"
import type { Feature } from "./feature.ts"
import { input } from "./features/input.ts"
import { serviceOf } from "./gesture-features.ts"
import type { WardicRuntime } from "./runtime.ts"

/** What a Batch's gestures stand on, which it brings (ADR-0067 decision 12): the gestures' input. */
export const BATCH_GESTURES: ReadonlyArray<Feature> = [{ name: "createBatch's gestures", key: InputSource.InputSource, layer: input }]

/**
 * A Batch's gesture watches, on `runtime`: each run over the input `services` gives, in `scope`, so the
 * binding stops them with the Batch; a handler's throw reported, and the watch goes on.
 */
export const batchGestureWatches = (runtime: WardicRuntime, services: () => Context.Context<never>, scope: Scope.Scope): BatchGestureWatches => {
  const onDefect = (cause: Cause.Cause<never>): void => {
    runtime.runFork(Report.failure("createBatch: a gesture failed", cause))
  }
  const run = (watch: Effect.Effect<void, never, Scope.Scope | InputSource.InputSource>): void => {
    runtime.runSync(watch.pipe(Effect.provideService(InputSource.InputSource, serviceOf(services(), InputSource.InputSource)), Scope.provide(scope)))
  }
  return {
    hover: (memberOf, on) => run(Recognizer.watchHoverAmong(memberOf, { on, onDefect })),
    press: (memberOf, on) => run(Recognizer.watchPressAmong(memberOf, { on, onDefect })),
    focusable: DomInput.makeFocusable,
  }
}
