/**
 * `createAnimationFrame`'s run, Solid-free, on both bindings (#443, Motion's `useAnimationFrame`):
 * core's `LiveValue.eachFrame`, the app's callback in it reported as every per-frame callback is.
 *
 * @module
 */
import * as LiveValue from "@wardic/core/LiveValue"
import * as Report from "@wardic/dom/Report"
import * as Cause from "effect/Cause"
import type * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import type { WardicRuntime, WardicServices } from "./runtime.ts"

/**
 * `callback` told each frame's time and delta on `runtime`'s Frame loop, for as long as the Scope is
 * open. A throw from it is logged at the first of a run of throws, and the next frame calls it as ever
 * (ADR-0030, *Amendment (#257 item 4)*, as `onUpdate`): a frame that returns ends the run, so the next
 * throw logs again.
 */
export const eachFrameOf = (runtime: WardicRuntime, callback: (time: number, delta: number) => void): Effect.Effect<void, never, WardicServices | Scope.Scope> => {
  let failing = false
  return LiveValue.eachFrame((time, delta) => {
    try {
      callback(time, delta)
      failing = false
    } catch (defect) {
      if (failing) return
      failing = true
      runtime.runFork(Report.failure("wardic.createAnimationFrame: the callback failed", Cause.die(defect)))
    }
  })
}
