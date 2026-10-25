import * as Easing from "@wardic/core/Easing"
import type * as Frame from "@wardic/core/Frame"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Interpolator from "@wardic/core/Interpolator"
import * as Machine from "@wardic/core/Machine"
import type * as Values from "@wardic/core/Values"
import { testLayer } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as UndefinedOr from "effect/UndefinedOr"

// `animateValues` through a registry's Key rules (ADR-0035): a rule's blend replaces the key's
// blend by value, for the whole leg. The Test Environment's registry has none, so a `display` pair
// turning `none` is a Discrete pair here, switching at the first frame; with `@wardic/dom`'s
// registry it waits for the last (its `key-rules.node.test.ts`).

const quarter = [0.25, 0.25, 0.25, 0.25]
const run = (from: Values.Values, to: Values.Values, registry?: Layer.Layer<InterpolatorRegistry.InterpolatorRegistry>) => {
  const frames = Stream.runCollect(
    Machine.animateValues(from, to, { duration: 1, ease: Easing.linear }).pipe(Effect.map(Machine.toStream), Stream.unwrap),
  )
  const withRegistry = UndefinedOr.match(registry, { onUndefined: () => frames, onDefined: (layer) => Effect.provide(frames, layer) })
  return withRegistry.pipe(
    Effect.provide(testLayer(quarter)),
    Effect.map((fs) => (Array.from(fs) as ReadonlyArray<Frame.Frame<Values.Values>>).map((f) => f.value)),
  )
}

/** A rule taking `glow`: a count of the leg's progress, then the target on the last frame. */
const glow: InterpolatorRegistry.KeyRule = {
  name: "glow",
  blend: (key, _from, to) => {
    if (key !== "glow") return Option.none()
    return Option.some(
      Effect.succeed((t: number, done: boolean) => {
        if (done) return to
        return `glow ${t}`
      }),
    )
  },
}

it.effect("KB1: a Key rule's blend runs for its key, every frame; the other keys blend by value", () =>
  Effect.gen(function* () {
    const registry = Layer.effect(InterpolatorRegistry.InterpolatorRegistry)(InterpolatorRegistry.make(Interpolator.defaults, [glow]))
    const values = yield* run({ glow: "off", opacity: 0 }, { glow: "on", opacity: 1 }, registry)
    expect(values.map((v) => v.glow)).toEqual(["glow 0.25", "glow 0.5", "glow 0.75", "on"])
    expect(values.map((v) => v.opacity)).toEqual([0.25, 0.5, 0.75, 1])
  }),
)

it.effect("KB2 (guard): with the Test Environment's registry, which has no Key rules, display → none is a Discrete pair", () =>
  Effect.gen(function* () {
    const values = yield* run({ display: "block" }, { display: "none" })
    expect(values.map((v) => v.display)).toEqual(["none", "none", "none", "none"])
  }),
)
