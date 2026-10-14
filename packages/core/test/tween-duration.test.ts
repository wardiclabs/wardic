import * as Easing from "@wardic/core/Easing"
import type * as Frame from "@wardic/core/Frame"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Machine from "@wardic/core/Machine"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

/**
 * A tween's `duration` is optional (#107): when it's missing it's 0.3 s, per field like `easing`
 * and `delay`, so the rest of the options still apply. Each constructor without a `duration` gives
 * the Frames, and the span, that `duration: 0.3` gives.
 */
const DTS: ReadonlyArray<number> = Array.from({ length: 40 }, () => 1 / 30)

/** `machine` stepped by hand over `DTS`. */
const framesOf = <F extends Frame.Frame<unknown>>(machine: Machine.Machine<F>): ReadonlyArray<F> => {
  const step = machine.start()
  return DTS.map((dt) => step(dt))
}

const MODIFIERS = { easing: Easing.easeInOutCubic, delay: 0.1, repeat: 2, yoyo: true, repeatDelay: 0.05 }

describe("a missing duration is 0.3 s, and the other options still apply", () => {
  it("tween", () => {
    const options = { easing: Easing.easeInOutCubic, delay: 0.1 }
    expect(framesOf(Machine.tween(0, 16, options))).toEqual(framesOf(Machine.tween(0, 16, { duration: 0.3, ...options })))
    expect(Machine.tween(0, 16, {}).span.attributes).toEqual({ from: 0, to: 16, duration: 0.3 })
  })

  it("animate, with a delay, an easing, repeat, yoyo and repeatDelay", () => {
    expect(framesOf(Machine.animate(0, 16, MODIFIERS))).toEqual(framesOf(Machine.animate(0, 16, { duration: 0.3, ...MODIFIERS })))
  })

  it("animate with no options at all", () => {
    expect(framesOf(Machine.animate(0, 16))).toEqual(framesOf(Machine.animate(0, 16, { duration: 0.3 })))
  })

  it("keyframes: the default spread over its segments, and in its span", () => {
    const stops = [0, 8, 4, 16]
    expect(framesOf(Machine.keyframes(stops, { delay: 0.1 }))).toEqual(framesOf(Machine.keyframes(stops, { duration: 0.3, delay: 0.1 })))
    expect(Machine.keyframes(stops, {}).span.attributes).toEqual({ stops: 4, duration: 0.3 })
  })

  it("animateValues", () => {
    const build = (options: Machine.AnimateOptions) =>
      Effect.runSync(Effect.provide(Machine.animateValues({ x: 0, width: "0px" }, { x: 16, width: "16px" }, options), InterpolatorRegistry.layer))
    expect(framesOf(build(MODIFIERS))).toEqual(framesOf(build({ duration: 0.3, ...MODIFIERS })))
  })
})
