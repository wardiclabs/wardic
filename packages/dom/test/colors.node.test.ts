// The DOM Environment's colours (#160, ADR-0036; `@wardic/dom`'s `colors.ts`): CSS Color syntax
// through culori, as a tier of the DOM's registry (`cssColor`) and as a kind of token in its complex
// tier (`cssComplex`, #61). Moved from core when colours left it, so the Test Environment has none:
// - CL1–CL5, `ColorString`: core's `codecs.test.ts`.
// - CL6, the colour Interpolator: core's `interpolate.test.ts`.
// - CL7–CL10, the registry: core's `discrete-pair.test.ts` (DP9, DP11, DP12, and the colour cases of
//   DP5, DP13 and DP15) and `interpolate.test.ts`.
// - CL11–CL15, colour tokens: core's `codecs.test.ts` and `complex-interpolate.test.ts`.
// - CL16–CL18, a spring's colour: `@wardic/test`'s `spring-blend.test.ts` (SB1–SB3).
// - CL19–CL21, Wardic's own sRGB blend (#156, ADR-0026 *Amendment (#156)*): culori's strings, exactly,
//   against culori itself over seeded random pairs, its quirks, and two ends of one colour.
import type * as Frame from "@wardic/core/Frame"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Machine from "@wardic/core/Machine"
import type * as Values from "@wardic/core/Values"
import { color, ColorString, cssColor, cssComplex, InterpolatorRegistryDomLive } from "@wardic/dom"
import { formatRgb, interpolate, parse } from "culori"
import { TestClock, testLayer } from "@wardic/test"
import { describe, expect, it, layer } from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Logger from "effect/Logger"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"

const decodeColor = Schema.decodeUnknownOption(ColorString)
const decodeComplex = Schema.decodeUnknownOption(cssComplex.codec)

/** Schema's decode, then Schema's encode. */
const roundTrip =
  <T, E>(codec: Schema.Codec<T, E>) =>
  (input: unknown): E =>
    Schema.encodeSync(codec)(Schema.decodeUnknownSync(codec)(input))

/** Every input decodes to `None`. */
const rejectsAll = (decode: (input: unknown) => Option.Option<unknown>, inputs: ReadonlyArray<unknown>) =>
  expect(Arr.map(inputs, decode)).toEqual(Arr.map(inputs, () => Option.none()))

describe("ColorString", () => {
  it("CL1: decodes what culori parses, trimmed, in the space it's written in", () => {
    expect(Option.map(decodeColor("#000"), (color) => color.mode)).toEqual(Option.some("rgb"))
    expect(Option.map(decodeColor(" #000 "), (color) => color.mode)).toEqual(Option.some("rgb"))
    expect(Option.map(decodeColor("hsl(0 100% 50%)"), (color) => color.mode)).toEqual(Option.some("hsl"))
    expect(Option.isSome(decodeColor("rebeccapurple"))).toBe(true)
    expect(Option.isSome(decodeColor("transparent"))).toBe(true)
  })

  it("CL2: rejects keywords and strings culori can't parse, prefixed like a colour or not", () => {
    rejectsAll(decodeColor, ["auto", "none", "inherit", "10px", "#zzz", "rgb(var(--x))", 0])
  })

  it("CL3: rejects a CSS function holding a length, which culori's parse throws on (#154)", () => {
    rejectsAll(decodeColor, [
      "blur(4px)",
      "blur(0px)",
      "drop-shadow(0px 0px 4px red)",
      "translateX(10px)",
      "inset(10px)",
      "circle(10px)",
      "rgb(1px 2px 3px)",
    ])
  })

  it("CL4: encodes as rgb() / rgba(), so a round trip canonicalises", () => {
    expect(roundTrip(ColorString)("#000")).toBe("rgb(0, 0, 0)")
    expect(roundTrip(ColorString)("rgba(0,0,0,0.5)")).toBe("rgba(0, 0, 0, 0.5)")
    expect(roundTrip(ColorString)("hsl(0 100% 50%)")).toBe("rgb(255, 0, 0)")
    expect(roundTrip(ColorString)("rebeccapurple")).toBe("rgb(102, 51, 153)")
  })

  it("CL5: is idempotent once canonical", () => {
    const inputs = ["#000", " #fff ", "rgba(10, 20, 30, 0.25)", "hsl(120 50% 50%)", "transparent", "rebeccapurple"]
    const once = Arr.map(inputs, roundTrip(ColorString))
    expect(Arr.map(once, roundTrip(ColorString))).toEqual(once)
  })
})

it("CL6: the colour Interpolator decodes '#fff', 'rgb(0,0,0)' and 'rebeccapurple' through culori's parse, not 'auto'", () => {
  const decodes = (value: string): boolean => Option.isSome(Schema.decodeUnknownOption(cssColor.codec)(value))
  expect(Arr.map(["#fff", "rgb(0,0,0)", "rebeccapurple", "auto"], decodes)).toEqual([true, true, true, false])
})

/** A pair's blend at the start, just past it, half-way, and at the end. */
const at = (fn: (t: number) => unknown) => ({ start: fn(0), first: fn(0.01), half: fn(0.5), end: fn(1) })

layer(InterpolatorRegistryDomLive)("the DOM's colours through its registry", (it) => {
  const resolved = (from: unknown, to: unknown) =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      return at(yield* registry.resolve(from, to))
    })

  /** The warnings `resolve` logs for a pair. */
  const warningsOf = (from: unknown, to: unknown) =>
    Effect.gen(function* () {
      const warnings: Array<Record<string, unknown>> = []
      const capture = Logger.map(Logger.formatStructured, (structured) => {
        if (structured.level === "WARN") warnings.push(structured.annotations)
      })
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      yield* registry.resolve(from, to).pipe(Effect.provide(Logger.layer([capture])))
      return warnings
    })

  it.effect("CL7: two colours blend in sRGB and land as rgb(), resolved once", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      const first = yield* registry.resolve("#000", "#fff")
      expect(first(0.5)).toBe("rgb(128, 128, 128)")
      expect(yield* registry.resolve("#000", "#fff")).toBe(first)
      const named = yield* resolved("rebeccapurple", "#fff")
      expect([named.start, named.half, named.end]).toEqual(["rgb(102, 51, 153)", "rgb(179, 153, 204)", "rgb(255, 255, 255)"])
      expect(yield* warningsOf("#000", "#fff")).toEqual([])
    }),
  )

  it.effect("CL8: a colour with spaces around it blends, where it died on the first frame before #65", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      expect((yield* registry.resolve(" #000 ", "#fff"))(0.5)).toBe("rgb(128, 128, 128)")
    }),
  )

  it.effect("CL9: a string culori can't parse, prefixed like a colour or not, isn't a colour: a Discrete pair", () =>
    Effect.gen(function* () {
      expect(yield* resolved("#zzz", "#fff")).toEqual({ start: "#zzz", first: "#fff", half: "#fff", end: "#fff" })
      expect(yield* resolved("rgb(var(--x))", "#fff")).toEqual({ start: "rgb(var(--x))", first: "#fff", half: "#fff", end: "#fff" })
    }),
  )

  it.effect("CL10: a colour into a keyword or a filter switches at the first frame, with no warning (#154)", () =>
    Effect.gen(function* () {
      expect(yield* resolved("rgb(255, 0, 0)", "none")).toEqual({ start: "rgb(255, 0, 0)", first: "none", half: "none", end: "none" })
      expect(yield* warningsOf("rgb(255, 0, 0)", "none")).toEqual([])
      // The colour tier takes only `from`, and the complex tier doesn't take a lone colour.
      expect(yield* resolved("#000", "blur(4px)")).toEqual({ start: "#000", first: "blur(4px)", half: "blur(4px)", end: "blur(4px)" })
      expect(yield* warningsOf("#000", "blur(4px)")).toEqual([])
    }),
  )

  it.effect("CL15: a hex pair is the colour tier's, not the complex tier's, and a shadow's colour is a token", () =>
    Effect.gen(function* () {
      expect((yield* resolved("#000000", "#ffffff")).half).toBe("rgb(128, 128, 128)")
      expect((yield* resolved("0px 0px 10px #f00", "0px 0px 20px #00f")).half).toBe("0px 0px 15px rgb(128, 0, 128)")
    }),
  )
})

describe("colour tokens in the DOM's complex values (#61)", () => {
  /** The complex tier's blend of two values that blend, at `t`; `None` when they can't. */
  const blendOf = (from: string, to: string): Option.Option<(t: number) => string> =>
    Option.flatMap(Option.all([decodeComplex(from), decodeComplex(to)] as const), ([a, b]) => cssComplex.blend(a, b))
  const blendAt = (from: string, to: string, t: number): string => Option.getOrThrow(blendOf(from, to))(t)

  it("CL11: decodes a colour as one token, not its channels; a lone colour is the colour tier's", () => {
    expect(decodeComplex("0px 0px 5px rgba(0,0,0,0.5)")).toEqual(
      Option.some({
        parts: ["", "px ", "px ", "px ", ""],
        tokens: [0, 0, 5, { kind: "color(rgb)", value: { mode: "rgb", r: 0, g: 0, b: 0, alpha: 0.5 } }],
      }),
    )
    rejectsAll(decodeComplex, ["#f00", " rgb(255, 0, 0) "])
  })

  it("CL12: encodes a colour token as rgb() / rgba()", () => {
    expect(roundTrip(cssComplex.codec)("0px 0px 5px rgba(0,0,0,0.5)")).toBe("0px 0px 5px rgba(0, 0, 0, 0.5)")
    expect(roundTrip(cssComplex.codec)("0px 0px 5px #f00")).toBe("0px 0px 5px rgb(255, 0, 0)")
  })

  it("CL13: blends a shadow's colour as a colour, in sRGB as the colour tier does", () => {
    expect(blendAt("0px 0px 10px rgb(255, 0, 0)", "0px 0px 20px rgb(0, 0, 255)", 0.5)).toBe("0px 0px 15px rgb(128, 0, 128)")
    expect(blendAt("0px 0px 0px rgba(255, 0, 0, 0)", "0px 0px 10px rgb(255, 0, 0)", 0.5)).toBe("0px 0px 5px rgba(255, 0, 0, 0.5)")
    // A hex and an rgb() are both colours, so they match.
    expect(blendAt("0px 0px 10px #f00", "0px 0px 20px rgb(0, 0, 255)", 0.5)).toBe("0px 0px 15px rgb(128, 0, 128)")
  })

  it("CL14: matches kind by kind, in order, written in the target's structure (Motion's mixComplex)", () => {
    // A computed shadow (colour first, a spread) into an authored one: the start's extra number is dropped.
    expect(blendAt("rgba(0, 0, 0, 0.2) 0px 1px 2px 0px", "0px 8px 24px rgba(0, 0, 0, 0.3)", 0.5)).toBe("0px 4.5px 13px rgba(0, 0, 0, 0.25)")
    // Fewer numbers in the start than the target: Motion's rule can't blend it (the shadow rule pads it).
    expect(blendOf("0px 8px 24px rgba(0, 0, 0, 0.3)", "rgba(0, 0, 0, 0.2) 0px 1px 2px 0px")).toEqual(Option.none())
    // A different count of colours can't blend.
    expect(blendOf("0px 0px 10px rgb(255, 0, 0)", "0px 0px 10px rgb(255, 0, 0), 0px 0px 4px rgb(0, 0, 0)")).toEqual(Option.none())
    // A named colour isn't a token: it's text, and the target's text is written.
    expect(blendAt("0px 0px 10px red", "0px 0px 20px blue", 0.5)).toBe("0px 0px 15px blue")
  })
})

describe("a spring's colour (ADR-0024, decision 5)", () => {
  const ticks = TestClock.frames(400, 1 / 60)

  /** `springBlend`'s frames over the Test Environment, with the DOM's registry. */
  const blend = (from: Values.Values, to: Values.Values, options?: Machine.SpringOptions) =>
    Stream.runCollect(Machine.springBlend(from, to, options).pipe(Effect.map(Machine.toStream), Stream.unwrap)).pipe(
      Effect.provide(InterpolatorRegistryDomLive),
      Effect.provide(testLayer(ticks)),
      Effect.map((frames) => Array.from(frames) as ReadonlyArray<Frame.Frame<Values.Values>>),
    )
  /** The reference: a numeric key springing 0 → 100 with the same options. */
  const reference = (options: Machine.SpringOptions = {}) =>
    Stream.runCollect(Machine.toStream(Machine.springValues({ x: 100 }, options, { x: 0 }, { x: 0 }))).pipe(
      Effect.provide(testLayer(ticks)),
      Effect.map((frames) => (Array.from(frames) as ReadonlyArray<Frame.MultiPhysics>).map((f) => f.value.x ?? 0)),
    )
  /** A colour's red channel; `NaN` for what isn't an rgb(). */
  const red = (colour: unknown): number => Number(/^rgba?\((\d+)/.exec(String(colour))?.[1])

  it.effect("CL16: a colour and a unit string share a numeric key's progress, frame for frame, and land on their targets", () =>
    Effect.gen(function* () {
      const options = { stiffness: 170, damping: 26 }
      const frames = yield* blend({ bg: "#000", w: "0px" }, { bg: "#fff", w: "100px" }, options)
      const xs = yield* reference(options)
      expect(frames.length).toBe(xs.length)
      frames.forEach((frame, i) => {
        expect(Number.parseFloat(String(frame.value.w)), `frame ${i}`).toBeCloseTo(xs[i] ?? 0, 6)
        expect(Math.abs(red(frame.value.bg) - (255 * Math.min(xs[i] ?? 0, 100)) / 100), `frame ${i}`).toBeLessThanOrEqual(0.5)
      })
      expect(frames.filter((f) => red(f.value.bg) > 0 && red(f.value.bg) < 255).length).toBeGreaterThan(5)
      expect(frames.at(-1)).toEqual({ value: { bg: "rgb(255, 255, 255)", w: "100px" }, done: true })
    }),
  )

  it.effect("CL17: the transition's delay holds the start, as it holds the numeric spring", () =>
    Effect.gen(function* () {
      const options = { delay: 0.1 }
      const frames = yield* blend({ bg: "#000" }, { bg: "#fff" }, options)
      const xs = yield* reference(options)
      expect(frames.length).toBe(xs.length)
      expect(frames.slice(0, 5).map((f) => f.value.bg)).toEqual(Arr.makeBy(5, () => "rgb(0, 0, 0)"))
      frames.forEach((frame, i) => {
        expect(Math.abs(red(frame.value.bg) - (255 * Math.min(xs[i] ?? 0, 100)) / 100), `frame ${i}`).toBeLessThanOrEqual(0.5)
      })
    }),
  )

  it.effect("CL18: under an underdamped spring a colour holds at its target past 1 (culori clamps), and dims on the swing back", () =>
    Effect.gen(function* () {
      const options = { stiffness: 100, damping: 5 }
      const frames = yield* blend({ bg: "#000" }, { bg: "#fff" }, options)
      const xs = yield* reference(options)
      const past = Arr.filter(Arr.makeBy(xs.length, (i) => i), (i) => (xs[i] ?? 0) > 100)
      expect(past.length).toBeGreaterThan(0)
      expect(past.map((i) => frames[i]?.value.bg)).toEqual(past.map(() => "rgb(255, 255, 255)"))
      expect(frames.slice(past[0]).some((f) => red(f.value.bg) < 250)).toBe(true)
      expect(frames.at(-1)?.value.bg).toBe("rgb(255, 255, 255)")
    }),
  )
})

describe("Wardic's own sRGB blend (#156): culori's strings, without a colour object per frame", () => {
  const decode = Schema.decodeUnknownSync(ColorString)
  /** `entry`'s blend of two colour strings. */
  const blendWith = (entry: typeof cssColor, from: string, to: string) => Option.getOrThrow(entry.blend(decode(from), decode(to)))
  /** culori's own: `formatRgb(interpolate([from, to], mode)(t))`. */
  const culoriAt = (from: string, to: string, mode = "rgb") => {
    const at = interpolate([parse(from)!, parse(to)!], mode)
    return (t: number): string => formatRgb(at(t))
  }

  // Seeded, so a failure reproduces: a linear congruential generator.
  const random = (seed: number) => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const next = random(156)
  const byte = () => Math.floor(next() * 256)
  const NOTATIONS: ReadonlyArray<() => string> = [
    () => `rgb(${byte()}, ${byte()}, ${byte()})`,
    () => `rgba(${byte()}, ${byte()}, ${byte()}, ${next().toFixed(3)})`,
    () => `#${Math.floor(next() * 0xffffff).toString(16).padStart(6, "0")}`,
    () => `#${Math.floor(next() * 0xffffffff).toString(16).padStart(8, "0")}`,
    () => `hsl(${Math.floor(next() * 360)} ${Math.floor(next() * 100)}% ${Math.floor(next() * 100)}%)`,
    () => `hsl(${Math.floor(next() * 360)} ${Math.floor(next() * 100)}% ${Math.floor(next() * 100)}% / ${next().toFixed(2)})`,
    () => ["red", "transparent", "rebeccapurple", "white", "black", "rgb(none none none / none)"][Math.floor(next() * 6)]!,
    () => `color(display-p3 ${next().toFixed(3)} ${next().toFixed(3)} ${next().toFixed(3)})`,
    () => `oklch(${next().toFixed(3)} ${(next() * 0.4).toFixed(3)} ${Math.floor(next() * 360)})`,
    () => `rgb(none ${byte()} ${byte()})`,
    () => `rgb(${byte()} ${byte()} ${byte()} / none)`,
  ]
  const notation = () => NOTATIONS[Math.floor(next() * NOTATIONS.length)]!()
  /** Below 0, through the leg, its ends, and past 1 (a spring's overshoot). */
  const TS = [-0.3, 0, 1e-9, 0.01, 0.125, 0.25, 0.3333, 0.5, 0.75, 0.999, 1, 1.2, 1.4]

  it("CL19: writes culori's string for every pair and t: seeded random pairs in every notation, and pairs of one colour", () => {
    const pairs: Array<readonly [string, string]> = Arr.makeBy(3000, () => [notation(), notation()] as const)
    // Two ends of one colour, written the same or differently, take the shortcut (Q3).
    Arr.makeBy(500, () => notation()).forEach((c) => pairs.push([c, c], [c, formatRgb(parse(c)!)]))
    const differ: Array<string> = []
    for (const [from, to] of pairs) {
      const ours = blendWith(cssColor, from, to)
      const theirs = culoriAt(from, to)
      for (const t of [...TS, next()]) if (ours(t) !== theirs(t)) differ.push(`${from} → ${to} at ${t}: ${ours(t)}, culori ${theirs(t)}`)
    }
    expect(differ.slice(0, 5)).toEqual([])
    // Another mode still blends through culori, as it did.
    const lab = blendWith(color("oklch"), "#ff0000", "#0000ff")
    expect(Arr.map(TS, lab)).toEqual(Arr.map(TS, culoriAt("#ff0000", "#0000ff", "oklch")))
  })

  it("CL20: keeps culori's quirks: rgba(…, 1) just under 1, the start as written at t ≤ 0, and t clamped", () => {
    // Alpha 0.999 isn't exactly 1, so it's an rgba(), with its alpha rounded to 1.
    expect(blendWith(cssColor, "rgba(0, 0, 0, 0.999)", "rgba(255, 0, 0, 0.999)")(0.5)).toBe("rgba(128, 0, 0, 1)")
    // A `none` channel is 0 in the start as written, and the other end's once the leg moves.
    const none = blendWith(cssColor, "rgb(none 10 20)", "rgb(40 30 20)")
    expect([none(-0.5), none(0), none(0.5), none(1)]).toEqual(["rgb(0, 10, 20)", "rgb(0, 10, 20)", "rgb(40, 20, 20)", "rgb(40, 30, 20)"])
    // Past 1 a colour holds at its target (ADR-0024, decision 5).
    const fade = blendWith(cssColor, "#000", "#fff")
    expect([fade(1), fade(1.3)]).toEqual(["rgb(255, 255, 255)", "rgb(255, 255, 255)"])
    // A NaN channel is written 0, as culori writes it. No colour string converts to one; only a
    // colour built by hand does, as the Key rules build theirs (`{ ...color, alpha: 0 }`).
    const built = { mode: "rgb", r: Number.NaN, g: 0.5, b: 0, alpha: Number.NaN }
    const nan = Option.getOrThrow(cssColor.blend(built, { mode: "rgb", r: 1, g: 0.5, b: 0 }))
    const culoriNan = interpolate([built, { mode: "rgb", r: 1, g: 0.5, b: 0 }], "rgb")
    expect([nan(0.5), nan(1)]).toEqual([formatRgb(culoriNan(0.5)), formatRgb(culoriNan(1))])
    expect(nan(0.5)).toBe("rgba(0, 128, 0, 0)")
  })

  it("CL21: two ends of one colour write it on every frame past 0, the start as written at 0", () => {
    const same = blendWith(cssColor, "rgb(none 10 20)", "rgb(30 10 20)")
    expect([same(0), same(0.01), same(0.5), same(1.2)]).toEqual(["rgb(0, 10, 20)", "rgb(30, 10, 20)", "rgb(30, 10, 20)", "rgb(30, 10, 20)"])
    // A shadow that grows at one colour: the colour token holds while the lengths blend.
    const decodeComplex = Schema.decodeUnknownSync(cssComplex.codec)
    const shadow = Option.getOrThrow(cssComplex.blend(decodeComplex("0px 2px 4px rgba(0,0,0,0.2)"), decodeComplex("0px 8px 24px rgba(0,0,0,0.2)")))
    expect([shadow(0.5), shadow(1)]).toEqual(["0px 5px 14px rgba(0, 0, 0, 0.2)", "0px 8px 24px rgba(0, 0, 0, 0.2)"])
  })
})

