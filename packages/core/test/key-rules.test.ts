import * as Interpolator from "@wardic/core/Interpolator"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { expect, it } from "@effect/vitest"

// The registry's Key rules (ADR-0035; CONTEXT.md): an Environment's rule for how one key's pair
// blends, by the key's name. Core holds none: `InterpolatorRegistry.layer` has no Key rules, and
// the DOM's are `@wardic/dom`'s `keyRules`. A rule declines with `None`, synchronously, and the
// first that takes a key, latest registered first, gives its blend.

/** A rule that takes `key` and blends it to `"rule:<name>"` until the last frame. */
const ruleFor = (name: string, key: string): InterpolatorRegistry.KeyRule => ({
  name,
  blend: (k, _from, to) => {
    if (k !== key) return Option.none()
    return Option.some(
      Effect.succeed((_t: number, done: boolean) => {
        if (done) return to
        return `rule:${name}`
      }),
    )
  },
})

/** The blend a registry's Key rules give `key`'s pair, at progress 0.5 and on the last frame; `None` when they decline. */
const keyBlendAt = (registry: Effect.Effect<InterpolatorRegistry.InterpolatorRegistry["Service"]>, key: string, from: number | string, to: number | string) =>
  Effect.gen(function* () {
    const r = yield* registry
    const rule = r.keyBlendOf(key, from, to)
    if (Option.isNone(rule)) return Option.none<readonly [unknown, unknown]>()
    const blend = yield* rule.value
    return Option.some([blend(0.5, false), blend(0.5, true)] as const)
  })

it.effect("KR1: a Key rule gives the blend of the key it takes", () =>
  Effect.gen(function* () {
    const registry = InterpolatorRegistry.make(Interpolator.defaults, [ruleFor("glow", "glow")])
    expect(yield* keyBlendAt(registry, "glow", "a", "b")).toEqual(Option.some(["rule:glow", "b"]))
  }),
)

it.effect("KR2: a key every rule declines has no Key blend: it blends by value", () =>
  Effect.gen(function* () {
    const registry = InterpolatorRegistry.make(Interpolator.defaults, [ruleFor("glow", "glow")])
    expect(yield* keyBlendAt(registry, "opacity", 0, 1)).toEqual(Option.none())
  }),
)

it.effect("KR3: the first rule that takes a key wins: make's order, and registerKeyRule ahead of them", () =>
  Effect.gen(function* () {
    const made = InterpolatorRegistry.make(Interpolator.defaults, [ruleFor("first", "glow"), ruleFor("second", "glow")])
    expect(yield* keyBlendAt(made, "glow", "a", "b")).toEqual(Option.some(["rule:first", "b"]))
    const registered = Effect.tap(made, (r) => r.registerKeyRule(ruleFor("later", "glow")))
    expect(yield* keyBlendAt(registered, "glow", "a", "b")).toEqual(Option.some(["rule:later", "b"]))
  }),
)

it.effect("KR4 (guard): core's default registry has no Key rules, so no CSS property is special in core", () =>
  Effect.gen(function* () {
    const registry = InterpolatorRegistry.make()
    for (const [key, from, to] of [
      ["display", "block", "none"],
      ["visibility", "visible", "hidden"],
      ["boxShadow", "none", "0px 0px 10px rgb(255, 0, 0)"],
      ["filter", "blur(4px)", "none"],
    ] as const) {
      expect(yield* keyBlendAt(registry, key, from, to), key).toEqual(Option.none())
    }
  }),
)
