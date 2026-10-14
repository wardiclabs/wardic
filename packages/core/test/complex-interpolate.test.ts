import * as Interpolator from "@wardic/core/Interpolator"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { expect, it, layer } from "@effect/vitest"

// Pure interpolator tests — the same-structure tier of path morphing (ADR-0015). The entry is a
// codec and a blend (ADR-0026): `decodes` asks `ComplexString`, and `blendOf` decodes both
// endpoints once, then blends.

const decode = Schema.decodeUnknownOption(Interpolator.complex.codec)

/** Whether a value is a complex value: whether the entry's codec decodes it. */
const decodes = (value: unknown): boolean => Option.isSome(decode(value))

/** The entry's blend of two complex values: `None` when they can't blend. */
const blendOf = (from: string, to: string): Option.Option<(t: number) => string> =>
  Option.flatMap(Option.all([decode(from), decode(to)] as const), ([a, b]) => Interpolator.complex.blend(a, b))

/** The blend of two complex values that blend, at `t`. */
const at = (from: string, to: string, t: number): string => Option.getOrThrow(blendOf(from, to))(t)

it("decodes a multi-number string, not single-number / non-string values", () => {
  expect(decodes("M0,0 L10,10")).toBe(true) // 4 numbers
  expect(decodes("0,0 10,10")).toBe(true) // points
  expect(decodes("10px")).toBe(false) // single number → unit's job
  expect(decodes("none")).toBe(false) // no numbers
  expect(decodes(5)).toBe(false)
})

it("interpolates a same-structure SVG path component-wise", () => {
  expect(at("M0,0 L10,10", "M0,0 L20,20", 0.5)).toBe("M0,0 L15,15")
})

it("interpolates a points list (polyline/polygon) component-wise", () => {
  expect(at("0,0 10,10", "0,0 20,30", 0.5)).toBe("0,0 15,20")
})

it("handles signed + decimal numbers", () => {
  expect(at("M-1.5,0", "M1.5,0", 0.5)).toBe("M0,0")
})

it("interpolates a multi-part box-shadow / filter string", () => {
  expect(at("0px 0px 0px", "10px 20px 4px", 0.5)).toBe("5px 10px 2px")
})

it("can't blend two templates — mismatched command structure — so the pair is Discrete", () => {
  // Different command (L vs C) → different structure → `None`: a Discrete pair, which `resolve`
  // switches at the first frame (ADR-0024; DP1 and DP8 in discrete-pair.test.ts).
  expect(blendOf("M0,0 L10,10", "M0,0 C1,1 2,2 3,3")).toEqual(Option.none())
})

it("can't blend two number counts, even with the same leading commands", () => {
  expect(blendOf("M0,0 L10,10", "M0,0 L10,10 L20,20")).toEqual(Option.none())
})

it("decodes one number inside a function (#61)", () => {
  expect(decodes("blur(4px)")).toBe(true)
  expect(decodes("translateX(10px)")).toBe(true)
  expect(decodes("120")).toBe(false) // a bare number string → unit's job
})

it("matches number by number, written in the target's structure (#61, Motion's mixComplex)", () => {
  // The start's extra number is dropped.
  expect(at("0px 1px 2px 0px", "0px 8px 24px", 0.5)).toBe("0px 4.5px 13px")
  // Fewer numbers in the start than the target: Motion's rule can't blend it (the DOM's shadow rule pads it).
  expect(blendOf("0px 8px 24px", "0px 1px 2px 0px")).toEqual(Option.none())
  // A word is text, and the target's text is written.
  expect(at("0px 0px 10px red", "0px 0px 20px blue", 0.5)).toBe("0px 0px 15px blue")
})

it("blends around an Environment's text spans; the target's spans are written (#158, ADR-0035; Motion's)", () => {
  // A made-up syntax, `@name`: core names no Environment's own (the DOM's `var()` is @wardic/dom's).
  const entry = Interpolator.complexWith({ text: [/@[\w-]+/] })
  const decodeWith = Schema.decodeUnknownSync(entry.codec)
  const blendWith = (from: string, to: string) => entry.blend(decodeWith(from), decodeWith(to))
  expect(Option.getOrThrow(blendWith("0px 0px 4px @shade-1", "0px 0px 8px @shade-2"))(0.5)).toBe("0px 0px 6px @shade-2")
  // A different count of spans can't blend (Motion's mixComplex, for its var()).
  expect(blendWith("0px 4px @a", "0px 8px")).toEqual(Option.none())
})

// Registry-backed: resolution order — `complex` only catches what the specific
// interpolators don't.
layer(InterpolatorRegistry.layer)("complex interpolator routing", (it) => {
  it.effect("resolves a same-structure path pair to the complex interpolator", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      const fn = yield* registry.resolve("M0,0 L10,10", "M0,0 L20,20")
      expect(fn(0.5)).toBe("M0,0 L15,15")
    }),
  )

  it.effect("does NOT steal a single-number unit pair (`10px` stays with unit)", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      const fn = yield* registry.resolve("10px", "20px")
      expect(fn(0.5)).toBe("15px")
    }),
  )

  it.effect("blends a drop-shadow with a named colour, a two-function filter and a two-length clip path (#61, #154)", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      const shadow = yield* registry.resolve("drop-shadow(0px 0px 4px red)", "drop-shadow(0px 0px 8px red)")
      expect(shadow(0.5)).toBe("drop-shadow(0px 0px 6px red)")
      const filter = yield* registry.resolve("blur(2px) brightness(1.5)", "blur(4px) brightness(2)")
      expect(filter(0.5)).toBe("blur(3px) brightness(1.75)")
      const inset = yield* registry.resolve("inset(10px 20px)", "inset(20px 40px)")
      expect(inset(0.5)).toBe("inset(15px 30px)")
    }),
  )

  it.effect("switches two templates at the first frame through the registry", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      const fn = yield* registry.resolve("M0,0 L10,10", "M0,0 C1,1 2,2 3,3")
      expect([fn(0), fn(0.5), fn(1)]).toEqual(["M0,0 L10,10", "M0,0 C1,1 2,2 3,3", "M0,0 C1,1 2,2 3,3"])
    }),
  )
})

// Token kinds (#160, ADR-0036): an Environment's kinds of token besides numbers, each a pattern and
// the Interpolator its tokens decode, blend and encode through. Two made-up kinds, since core names
// no Environment's own (the DOM's colours are `@wardic/dom`'s, `colors.node.test.ts`): `<n>`, a
// step that blends rounded, and `!word`, a flag that blends only into itself.

/** `<n>`: a whole step, blended and rounded. */
const step: Interpolator.Entry<number, string> = {
  name: "step",
  codec: Schema.String.pipe(
    Schema.decodeTo(
      Schema.Number,
      Interpolator.parseAndFormat(
        (input: string) => Option.map(Option.fromNullishOr(/^<(-?\d+)>$/.exec(input.trim())), ([, n]) => Number(n)),
        (n: number) => `<${n}>`,
      ),
    ),
  ),
  blend: (from, to) => Option.some((t: number) => `<${Math.round(from + (to - from) * t)}>`),
}

/** `!word`: a flag, which blends only into itself. */
const flag: Interpolator.Entry<string, string> = {
  name: "flag",
  codec: Schema.String,
  blend: (from, to) => Option.liftPredicate(() => to, () => from === to),
}

const stepped = Interpolator.complexWith({ tokens: [{ pattern: /<-?\d+>/, entry: step }, { pattern: /![a-z]+/, entry: flag }] })
const decodeStepped = Schema.decodeUnknownOption(stepped.codec)
const blendStepped = (from: string, to: string): Option.Option<(t: number) => string> =>
  Option.flatMap(Option.all([decodeStepped(from), decodeStepped(to)] as const), ([a, b]) => stepped.blend(a, b))
const atStepped = (from: string, to: string, t: number): string => Option.getOrThrow(blendStepped(from, to))(t)

it("TK1: decodes a kind's tokens as that kind, its digits never numbers; a lone token is its kind's own", () => {
  expect(decodeStepped("move <3> by 4px")).toEqual(Option.some({ parts: ["move ", " by ", "px"], tokens: [{ kind: "step", value: 3 }, 4] }))
  expect(decodeStepped("!on 4px")).toEqual(Option.some({ parts: ["", " ", "px"], tokens: [{ kind: "flag", value: "!on" }, 4] }))
  expect(decodeStepped("<12>")).toEqual(Option.none())
  expect(decodeStepped(" !on ")).toEqual(Option.none())
  // Core's default has no kinds: the same digits are numbers.
  expect(decode("move <3> by 4px")).toEqual(Option.some({ parts: ["move <", "> by ", "px"], tokens: [3, 4] }))
})

it("TK2: blends a kind's tokens through its Interpolator, and numbers as numbers", () => {
  expect(atStepped("<0> 0px", "<10> 10px", 0.25)).toBe("<3> 2.5px")
  expect(atStepped("<0> 0px", "<10> 10px", 1)).toBe("<10> 10px")
})

it("TK3: matches kind by kind, in order, and needs the same count of each kind (Motion's mixComplex)", () => {
  expect(atStepped("<1> 2px <5>", "0px <3> <9>", 0.5)).toBe("1px <2> <7>")
  expect(blendStepped("<1> 0px", "0px 4px")).toEqual(Option.none())
  expect(blendStepped("<1> 0px !on", "<2> 0px <3> !on")).toEqual(Option.none())
})

it("TK4: a pair of tokens its kind can't blend makes the pair a Discrete pair", () => {
  expect(atStepped("!on 0px", "!on 10px", 0.5)).toBe("!on 5px")
  expect(blendStepped("!on 0px", "!off 10px")).toEqual(Option.none())
})

it("TK5: encodes a kind's token by its kind's encode, and fails on a kind the codec doesn't have", () => {
  const roundTrip = (input: string) => Schema.encodeSync(stepped.codec)(Schema.decodeUnknownSync(stepped.codec)(input))
  expect(roundTrip("<03> 1.50px")).toBe("<3> 1.5px")
  expect(() => Schema.encodeSync(stepped.codec)({ parts: ["", " ", "px"], tokens: [{ kind: "colour", value: 1 }, 4] })).toThrow()
})

layer(
  Layer.effect(InterpolatorRegistry.InterpolatorRegistry)(
    InterpolatorRegistry.make([Interpolator.number, Interpolator.array, step, Interpolator.unit, stepped]),
  ),
)("an Environment's token kinds through its registry (#160)", (it) => {
  it.effect("TK6: a lone token goes to its kind's own Interpolator, and one among other text to the complex tier", () =>
    Effect.gen(function* () {
      const registry = yield* InterpolatorRegistry.InterpolatorRegistry
      expect((yield* registry.resolve("<0>", "<10>"))(0.25)).toBe("<3>")
      expect((yield* registry.resolve("<0> 0px", "<10> 10px"))(0.5)).toBe("<5> 5px")
      expect((yield* registry.resolve("10px", "20px"))(0.5)).toBe("15px")
    }),
  )
})
