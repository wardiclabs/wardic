import * as Easing from "@wardic/core/Easing"
import type * as Frame from "@wardic/core/Frame"
import type * as Values from "@wardic/core/Values"
import * as Machine from "@wardic/core/Machine"
import { TestClock, testLayer } from "@wardic/test"
import { expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

// The Animatable none and the shadow rule (#61, ADR-0015 *Amendment (#61)*; CONTEXT.md), through
// `animateValues` and `springBlend`, which prepare each key's pair before the registry resolves it.
// An empty end (`"none"`, `0`, `"0"`, `"0px"`) facing a complex value or a colour stands for that
// value at zero, and the leg's last frame writes the target as given. Before #61 each of these
// pairs was a Discrete pair and switched at the first frame: all but the guards (AN8, AN14) fail on main.
// Motion's runtime for the same pairs: `.tmp/vel/none-drive.ts` (framer-motion 13.4.0).

const quarter = [0.25, 0.25, 0.25, 0.25]

/** The values one key takes over a 1 s linear tween, at 0.25, 0.5, 0.75 and its last frame. */
const run = (from: Values.Values, to: Values.Values) =>
  Stream.runCollect(
    Machine.animateValues(from, to, { duration: 1, easing: Easing.linear }).pipe(Effect.map(Machine.toStream), Stream.unwrap),
  ).pipe(
    Effect.provide(testLayer(quarter)),
    Effect.map((frames) => Array.from(frames) as ReadonlyArray<Frame.Frame<Values.Values>>),
  )
const keyOf = (to: Values.Values): string => Object.keys(to)[0]!
const frames = (from: Values.Values, to: Values.Values) =>
  Effect.map(run(from, to), (fs) => fs.map((f) => f.value[keyOf(to)]))

it.effect("AN1: a box-shadow grows from none, from a transparent zero shadow, and goes back to none", () =>
  Effect.gen(function* () {
    expect(yield* frames({ boxShadow: "none" }, { boxShadow: "0px 0px 10px rgb(255, 0, 0)" })).toEqual([
      "0px 0px 2.5px rgba(255, 0, 0, 0.25)",
      "0px 0px 5px rgba(255, 0, 0, 0.5)",
      "0px 0px 7.5px rgba(255, 0, 0, 0.75)",
      "0px 0px 10px rgb(255, 0, 0)",
    ])
    // The way back blends to the zero shadow, and its last frame writes `none` as given (Motion rests at the zero).
    expect(yield* frames({ boxShadow: "0px 0px 10px rgb(255, 0, 0)" }, { boxShadow: "none" })).toEqual([
      "0px 0px 7.5px rgba(255, 0, 0, 0.75)",
      "0px 0px 5px rgba(255, 0, 0, 0.5)",
      "0px 0px 2.5px rgba(255, 0, 0, 0.25)",
      "none",
    ])
  }),
)

it.effect("AN2: a blur grows from none through blur(0px), and rests at none, not blur(0px), on the way back", () =>
  Effect.gen(function* () {
    expect(yield* frames({ filter: "none" }, { filter: "blur(4px)" })).toEqual(["blur(1px)", "blur(2px)", "blur(3px)", "blur(4px)"])
    expect(yield* frames({ filter: "blur(4px)" }, { filter: "none" })).toEqual(["blur(3px)", "blur(2px)", "blur(1px)", "none"])
  }),
)

it.effect("AN3: each filter function starts at its identity, and a drop-shadow grows from a transparent zero", () =>
  Effect.gen(function* () {
    const to = "blur(4px) brightness(150%) hue-rotate(90deg) drop-shadow(0px 0px 4px rgb(255, 0, 0))"
    const fs = yield* frames({ filter: "none" }, { filter: to })
    expect(fs[1]).toBe("blur(2px) brightness(125%) hue-rotate(45deg) drop-shadow(0px 0px 2px rgba(255, 0, 0, 0.5))")
    expect(fs[3]).toBe(to)
    expect((yield* frames({ filter: "none" }, { filter: "brightness(2) contrast(3) saturate(0) opacity(0.5) grayscale(1)" }))[1]).toBe(
      "brightness(1.5) contrast(2) saturate(0.5) opacity(0.75) grayscale(0.5)",
    )
  }),
)

it.effect("AN4: backdropFilter and WebkitFilter take the filter rule: brightness from 1, where Motion's backdrop goes through black", () =>
  Effect.gen(function* () {
    expect(yield* frames({ backdropFilter: "none" }, { backdropFilter: "brightness(2)" })).toEqual([
      "brightness(1.25)",
      "brightness(1.5)",
      "brightness(1.75)",
      "brightness(2)",
    ])
    expect((yield* frames({ WebkitFilter: "none" }, { WebkitFilter: "brightness(2)" }))[0]).toBe("brightness(1.25)")
    // Written as CSS names, as `WardicValues` types them.
    expect((yield* frames({ "backdrop-filter": "none" }, { "backdrop-filter": "brightness(2)" }))[0]).toBe("brightness(1.25)")
    expect((yield* frames({ "-webkit-backdrop-filter": "none" }, { "-webkit-backdrop-filter": "brightness(2)" }))[0]).toBe("brightness(1.25)")
    expect((yield* frames({ backdropFilter: "brightness(2)" }, { backdropFilter: "none" })).at(-1)).toBe("none")
  }),
)

it.effect("AN5: a mask image keeps its colours opaque, so the element stays visible; another image's colours fade", () =>
  Effect.gen(function* () {
    const gradient = "linear-gradient(rgba(0, 0, 0, 1) 40%, rgba(0, 0, 0, 0) 100%)"
    expect((yield* frames({ maskImage: "none" }, { maskImage: gradient }))[1]).toBe(
      "linear-gradient(rgb(0, 0, 0) 20%, rgba(0, 0, 0, 0.5) 50%)",
    )
    expect((yield* frames({ mask: "none" }, { mask: gradient }))[1]).toBe("linear-gradient(rgb(0, 0, 0) 20%, rgba(0, 0, 0, 0.5) 50%)")
    expect((yield* frames({ "-webkit-mask-image": "none" }, { "-webkit-mask-image": gradient }))[1]).toBe(
      "linear-gradient(rgb(0, 0, 0) 20%, rgba(0, 0, 0, 0.5) 50%)",
    )
    expect((yield* frames({ backgroundImage: "none" }, { backgroundImage: gradient }))[1]).toBe(
      "linear-gradient(rgba(0, 0, 0, 0.5) 20%, rgba(0, 0, 0, 0) 50%)",
    )
    expect((yield* frames({ maskImage: gradient }, { maskImage: "none" })).at(-1)).toBe("none")
  }),
)

it.effect("AN6: a fill fades in from transparent, and rests at none on the way back", () =>
  Effect.gen(function* () {
    expect(yield* frames({ fill: "none" }, { fill: "#ff0000" })).toEqual([
      "rgba(255, 0, 0, 0.25)",
      "rgba(255, 0, 0, 0.5)",
      "rgba(255, 0, 0, 0.75)",
      "#ff0000",
    ])
    expect(yield* frames({ fill: "#ff0000" }, { fill: "none" })).toEqual([
      "rgba(255, 0, 0, 0.75)",
      "rgba(255, 0, 0, 0.5)",
      "rgba(255, 0, 0, 0.25)",
      "none",
    ])
  }),
)

it.effect("AN7: a zero against a multi-value padding or margin opens from 0px 0px", () =>
  Effect.gen(function* () {
    expect(yield* frames({ padding: "0px" }, { padding: "4px 8px" })).toEqual(["1px 2px", "2px 4px", "3px 6px", "4px 8px"])
    expect(yield* frames({ margin: 0 }, { margin: "10px 20px" })).toEqual(["2.5px 5px", "5px 10px", "7.5px 15px", "10px 20px"])
    expect((yield* frames({ padding: "0" }, { padding: "4px 8px" }))[1]).toBe("2px 4px")
  }),
)

it.effect("AN8 (guard): none against a plain length or auto stays a Discrete pair: max-height none isn't 0", () =>
  Effect.gen(function* () {
    expect(yield* frames({ maxHeight: "none" }, { maxHeight: "100px" })).toEqual(["100px", "100px", "100px", "100px"])
    expect(yield* frames({ maxHeight: "100px" }, { maxHeight: "none" })).toEqual(["none", "none", "none", "none"])
    expect((yield* frames({ boxShadow: "auto" }, { boxShadow: "0px 0px 10px rgb(255, 0, 0)" }))[0]).toBe("0px 0px 10px rgb(255, 0, 0)")
  }),
)

it.effect("AN9: a shadow from a stylesheet, read colour first with its spread, blends both ways with an authored one", () =>
  Effect.gen(function* () {
    const sheet = "rgba(0, 0, 0, 0.2) 0px 1px 2px 0px"
    const hover = "0px 8px 24px rgba(0, 0, 0, 0.3)"
    expect((yield* frames({ boxShadow: sheet }, { boxShadow: hover }))[1]).toBe("0px 4.5px 13px rgba(0, 0, 0, 0.25)")
    expect((yield* frames({ "box-shadow": hover }, { "box-shadow": sheet }))[1]).toBe("rgba(0, 0, 0, 0.25) 0px 4.5px 13px 0px")
    // Back: the start has no spread, so it counts as 0 (Motion switches this way at once).
    expect(yield* frames({ boxShadow: hover }, { boxShadow: sheet })).toEqual([
      "rgba(0, 0, 0, 0.28) 0px 6.25px 18.5px 0px",
      "rgba(0, 0, 0, 0.25) 0px 4.5px 13px 0px",
      "rgba(0, 0, 0, 0.23) 0px 2.75px 7.5px 0px",
      sheet,
    ])
  }),
)

it.effect("AN10: stacked shadows line up shadow by shadow, a computed list against an authored one", () =>
  Effect.gen(function* () {
    const computed = "rgba(0, 0, 0, 0.2) 0px 1px 2px 0px, rgba(0, 0, 0, 0.1) 0px 4px 8px 0px"
    const authored = "0px 2px 4px rgba(0, 0, 0, 0.4), 0px 8px 16px rgba(0, 0, 0, 0.2)"
    expect((yield* frames({ boxShadow: computed }, { boxShadow: authored }))[1]).toBe(
      "0px 1.5px 3px rgba(0, 0, 0, 0.3), 0px 6px 12px rgba(0, 0, 0, 0.15)",
    )
  }),
)

it.effect("AN11: a shadow missing from one end grows from its transparent zero, and the list lands as given", () =>
  Effect.gen(function* () {
    const one = "0px 2px 4px rgb(0, 0, 0)"
    const two = "0px 2px 4px rgb(0, 0, 0), 0px 8px 16px rgb(255, 0, 0)"
    expect((yield* frames({ boxShadow: one }, { boxShadow: two }))[1]).toBe("0px 2px 4px rgb(0, 0, 0), 0px 4px 8px rgba(255, 0, 0, 0.5)")
    expect(yield* frames({ boxShadow: two }, { boxShadow: one })).toEqual([
      "0px 2px 4px rgb(0, 0, 0), 0px 6px 12px rgba(255, 0, 0, 0.75)",
      "0px 2px 4px rgb(0, 0, 0), 0px 4px 8px rgba(255, 0, 0, 0.5)",
      "0px 2px 4px rgb(0, 0, 0), 0px 2px 4px rgba(255, 0, 0, 0.25)",
      one,
    ])
  }),
)

it.effect("AN12: textShadow takes the shadow rule, and a transform grows from none", () =>
  Effect.gen(function* () {
    expect(yield* frames({ textShadow: "1px 1px 2px rgb(0, 0, 0)" }, { textShadow: "none" })).toEqual([
      "0.75px 0.75px 1.5px rgba(0, 0, 0, 0.75)",
      "0.5px 0.5px 1px rgba(0, 0, 0, 0.5)",
      "0.25px 0.25px 0.5px rgba(0, 0, 0, 0.25)",
      "none",
    ])
    expect(yield* frames({ transform: "none" }, { transform: "translateX(40px)" })).toEqual([
      "translateX(10px)",
      "translateX(20px)",
      "translateX(30px)",
      "translateX(40px)",
    ])
  }),
)

it.effect("AN13: under a bouncy spring, a shadow going to none writes none once, on the settle frame", () =>
  Effect.gen(function* () {
    const fs = yield* Stream.runCollect(
      Machine.springBlend({ boxShadow: "0px 0px 10px rgb(255, 0, 0)" }, { boxShadow: "none" }, { stiffness: 100, damping: 5 }).pipe(
        Effect.map(Machine.toStream),
        Stream.unwrap,
      ),
    ).pipe(
      Effect.provide(testLayer(TestClock.frames(600, 1 / 60))),
      Effect.map((frames) => Array.from(frames) as ReadonlyArray<Frame.Frame<Values.Values>>),
    )
    const nones = fs.flatMap((f, i) => (f.value.boxShadow === "none" ? [i] : []))
    expect(nones, "none on the settle frame only").toEqual([fs.length - 1])
    expect(fs.at(-1)?.done).toBe(true)
    expect(fs.filter((f) => String(f.value.boxShadow).includes("rgba")).length, "frames on the way").toBeGreaterThan(10)
  }),
)

it.effect("AN14 (guard): pairs with no empty end and no shadow list blend as before", () =>
  Effect.gen(function* () {
    expect(yield* frames({ opacity: 1 }, { opacity: 0 })).toEqual([0.75, 0.5, 0.25, 0])
    expect((yield* frames({ color: "#000000" }, { color: "#ffffff" })).at(-1)).toBe("rgb(255, 255, 255)")
    expect((yield* frames({ width: "0px" }, { width: "100px" }))[1]).toBe("50px")
    expect((yield* frames({ boxShadow: "0px 0px 10px" }, { boxShadow: "0px 0px 20px" }))[1]).toBe("0px 0px 15px")
  }),
)
