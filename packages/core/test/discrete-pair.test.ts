import {
  complexInterpolator,
  InterpolatorRegistry,
  InterpolatorRegistryLive,
  makeInterpolatorRegistry,
  unitInterpolator,
} from "@wardic/core"
import * as Effect from "effect/Effect"
import * as Logger from "effect/Logger"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { expect, layer } from "@effect/vitest"

// A Discrete pair (CONTEXT.md, ADR-0024 decision 3): a pair no Interpolator can blend switches to
// its target at its leg's first frame, `t > 0 ? to : from`, as Motion's `mixImmediate` does
// (motion-dom utils/mix/immediate.ts:1-3 at 16c61222c4166bbef5ff6ab0051192faa79fa8c8). It held its
// start until t = 1 before #56. Since #65 (ADR-0026) the switch is decided in one place, `resolve`:
// an entry's `blend` returns `None` for a pair it decodes but can't blend, and a pair no entry
// decodes both endpoints of never reaches one.

/** A pair's blend at the start, just past it, half-way, and at the end. */
const at = (fn: (t: number) => unknown) => ({ start: fn(0), first: fn(0.01), half: fn(0.5), end: fn(1) })

layer(InterpolatorRegistryLive)("the registry's Discrete pairs", (it) => {
  const resolved = (from: unknown, to: unknown) =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry
      return at(yield* registry.resolve(from, to))
    })

  /**
   * The warnings `resolve` logs for a pair, captured, on a fresh registry: the shared one keeps
   * the string pairs other tests resolved, and a kept pair doesn't warn again (DP14).
   */
  const warningsOf = (from: unknown, to: unknown, times = 1) =>
    Effect.gen(function* () {
      const registry = yield* makeInterpolatorRegistry()
      const warnings: Array<Record<string, unknown>> = []
      const capture = Logger.map(Logger.formatStructured, (structured) => {
        if (structured.level === "WARN") warnings.push(structured.annotations)
      })
      for (let i = 0; i < times; i++) yield* registry.resolve(from, to).pipe(Effect.provide(Logger.layer([capture])))
      return warnings
    })

  it.effect("DP1: the complex tier can't blend a mismatched template, so resolve switches it at the first frame past 0", () =>
    Effect.gen(function* () {
      const from = "M0,0 L10,10"
      const to = "M0,0 C1,1 2,2 3,3"
      const decode = Schema.decodeUnknownSync(complexInterpolator.codec)
      expect(complexInterpolator.blend(decode(from), decode(to))).toEqual(Option.none())
      expect(yield* resolved(from, to)).toEqual({ start: from, first: to, half: to, end: to })
    }),
  )

  it.effect("DP2: the unit tier doesn't decode an unparseable value, so resolve switches the pair at the first frame past 0", () =>
    Effect.gen(function* () {
      expect(Schema.decodeUnknownOption(unitInterpolator.codec)("auto")).toEqual(Option.none())
      expect(yield* resolved("auto", "10px")).toEqual({ start: "auto", first: "10px", half: "10px", end: "10px" })
    }),
  )

  it.effect("DP3: a progress below 0 (an easing that dips under it) still shows the start", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry
      expect((yield* registry.resolve("M0,0 L10,10", "M0,0 C1,1 2,2 3,3"))(-0.1)).toBe("M0,0 L10,10")
      expect((yield* registry.resolve("auto", "10px"))(-0.1)).toBe("auto")
    }),
  )

  it.effect("DP4: two keywords no entry matches ('auto' → 'none') switch at the first frame", () =>
    Effect.gen(function* () {
      expect(yield* resolved("auto", "none")).toEqual({ start: "auto", first: "none", half: "none", end: "none" })
    }),
  )

  it.effect("DP5: a colour and a keyword ('rgb(255, 0, 0)' → 'none') switch at the first frame", () =>
    Effect.gen(function* () {
      expect(yield* resolved("rgb(255, 0, 0)", "none")).toEqual({
        start: "rgb(255, 0, 0)",
        first: "none",
        half: "none",
        end: "none",
      })
    }),
  )

  it.effect("DP6: an unparseable unit pair, either way round, switches at the first frame", () =>
    Effect.gen(function* () {
      expect(yield* resolved("auto", "50px")).toEqual({ start: "auto", first: "50px", half: "50px", end: "50px" })
      expect(yield* resolved("50%", "auto")).toEqual({ start: "50%", first: "auto", half: "auto", end: "auto" })
    }),
  )

  it.effect("DP7: a number and an unparseable string switch at the first frame", () =>
    Effect.gen(function* () {
      expect(yield* resolved(0, "auto")).toEqual({ start: 0, first: "auto", half: "auto", end: "auto" })
      expect(yield* resolved("auto", 0)).toEqual({ start: "auto", first: 0, half: 0, end: 0 })
    }),
  )

  it.effect("DP8: two paths of different structure switch at the first frame through the registry", () =>
    Effect.gen(function* () {
      const from = "M0,0 L10,10"
      const to = "M0,0 L10,10 L20,20"
      expect(yield* resolved(from, to)).toEqual({ start: from, first: to, half: to, end: to })
    }),
  )

  it.effect("DP9 (guard): a pair that blends still blends", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry
      expect((yield* registry.resolve("#000", "#fff"))(0.5)).toBe("rgb(128, 128, 128)")
      expect((yield* registry.resolve("10px", "20px"))(0.5)).toBe("15px")
    }),
  )

  it.effect("DP10: two lengths in different units are a Discrete pair, where resolve died before #65 (ADR-0026)", () =>
    Effect.gen(function* () {
      expect(yield* resolved("10px", "1em")).toEqual({ start: "10px", first: "1em", half: "1em", end: "1em" })
      expect(yield* resolved("50%", "20px")).toEqual({ start: "50%", first: "20px", half: "20px", end: "20px" })
    }),
  )

  it.effect("DP11: a string culori can't parse, prefixed like a colour or not, isn't a colour: a Discrete pair", () =>
    Effect.gen(function* () {
      expect(yield* resolved("#zzz", "#fff")).toEqual({ start: "#zzz", first: "#fff", half: "#fff", end: "#fff" })
      expect(yield* resolved("rgb(var(--x))", "#fff")).toEqual({
        start: "rgb(var(--x))",
        first: "#fff",
        half: "#fff",
        end: "#fff",
      })
    }),
  )

  it.effect("DP12 (guard): a colour with spaces around it blends, where it died on the first frame before #65", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry
      expect((yield* registry.resolve(" #000 ", "#fff"))(0.5)).toBe("rgb(128, 128, 128)")
    }),
  )

  it.effect("DP13: resolve warns once for a pair an entry decodes but can't blend, and not for a keyword switch", () =>
    Effect.gen(function* () {
      expect(yield* warningsOf("10px", "1em")).toEqual([{ interpolator: "unit", from: "10px", to: "1em" }])
      expect(yield* warningsOf("M0,0 L10,10", "M0,0 L10,10 L20,20")).toEqual([
        { interpolator: "complex", from: "M0,0 L10,10", to: "M0,0 L10,10 L20,20" },
      ])
      expect(yield* warningsOf("auto", "none")).toEqual([])
      expect(yield* warningsOf("rgb(255, 0, 0)", "none")).toEqual([])
      expect(yield* warningsOf("#000", "#fff")).toEqual([])
    }),
  )

  it.effect("DP14: a pair of strings warns once per registry, since the registry keeps it (ADR-0026, decision 9)", () =>
    Effect.gen(function* () {
      expect(yield* warningsOf("10px", "1em", 3)).toEqual([{ interpolator: "unit", from: "10px", to: "1em" }])
      const registry = yield* InterpolatorRegistry
      expect((yield* registry.resolve("10px", "1em"))(0.5)).toBe("1em")
    }),
  )
})
