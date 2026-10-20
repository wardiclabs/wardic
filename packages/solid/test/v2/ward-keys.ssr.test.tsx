// A ward's `read`/`atom` keys, typed from its config (#209 PR 3's Q4), checked by the type checker
// (`typecheck:tests`) and read on a server render. Completion offers every key the config animates,
// through `initial`, `animate`, `exit`, a variant, `whileHover`, `whileTap`, `whileDrag` or `style`,
// and `x`/`y` when it drags; any other key is still accepted.
//
// - WK1: the keys a config animates, from every layer, and its drag axis's.
// - WK2: a transform key reads a number; any other the type its config gives it, or `undefined`.
// - WK3: a key the config doesn't animate is accepted, read as any value.
// - WK4: an accessor config's keys, and a Live value's in `style`, read through.
// - WK5: a plain `WardConfig` offers every key, and `atom(key)` follows `read(key)`'s type.
import { type AnimatedKey, ward, type WardConfig } from "@wardic/solid/unstable/v2"
import type { Atom } from "effect/reactivity"
import { type Accessor, createSignal } from "solid-js"
import { describe, expect, expectTypeOf, it } from "vitest"
import { serve } from "./ssr.ts"

/** `ward(config)`'s ward, made in a server render's owner. */
const wardOn = <const C extends WardConfig>(config: C | Accessor<C>) => {
  let made!: ReturnType<typeof ward<C>>
  serve(() => {
    made = ward(config)
    return null
  })
  return made
}

describe("a ward's keys, typed from its config (#209)", () => {
  it("WK1: the keys a config animates, from every layer, and its drag axis's", () => {
    const config = {
      initial: { opacity: 0 },
      animate: { scale: 1 },
      exit: { rotate: 10 },
      variants: { open: { width: "10px" }, shut: { height: 0 } },
      whileHover: { skewX: 2 },
      whileTap: { originX: 0.5 },
      whileDrag: { "z-index": 2 },
      style: { color: "blue" },
      drag: "y",
    } as const
    expectTypeOf<AnimatedKey<typeof config>>().toEqualTypeOf<
      "opacity" | "scale" | "rotate" | "width" | "height" | "skewX" | "originX" | "z-index" | "color" | "y"
    >()
    expectTypeOf<AnimatedKey<{ readonly drag: true }>>().toEqualTypeOf<"x" | "y">()
    expectTypeOf<AnimatedKey<{ readonly drag: "x"; readonly animate: "open" }>>().toEqualTypeOf<"x">()
  })

  it("WK2: a transform key reads a number; any other the type its config gives it, or undefined", () => {
    const card = wardOn({ initial: { opacity: 0.4, color: "red", x: 20 } })
    expectTypeOf(card.read("opacity")).toEqualTypeOf<Accessor<number | undefined>>()
    expectTypeOf(card.read("color")).toEqualTypeOf<Accessor<string | undefined>>()
    expectTypeOf(card.read("x")).toEqualTypeOf<Accessor<number>>()
    expectTypeOf(card.read("rotate")).toEqualTypeOf<Accessor<number>>()
    expect(card.read("opacity")()).toBe(0.4)
    expect(card.read("color")()).toBe("red")
    expect(card.read("x")()).toBe(20)
    expect(card.read("rotate")()).toBe(0)
  })

  it("WK3: a key the config doesn't animate is accepted, read as any value", () => {
    const card = wardOn({ animate: { opacity: 1 } })
    expectTypeOf(card.read("--accent")).toEqualTypeOf<Accessor<number | string | undefined>>()
    expect(card.read("--accent")()).toBeUndefined()
    // A key must still be a string.
    // @ts-expect-error a ward's keys are strings
    card.read(1)
  })

  it("WK4: an accessor config's keys, and a Live value's in style, read through", () => {
    const [x] = createSignal(30)
    const fromAccessor = wardOn(() => ({ animate: { opacity: 1 } }))
    expectTypeOf(fromAccessor.read("opacity")).toEqualTypeOf<Accessor<number | undefined>>()
    const live = wardOn({ style: { left: x } })
    expectTypeOf(live.read("left")).toEqualTypeOf<Accessor<number | undefined>>()
    expect(fromAccessor.read("opacity")()).toBeUndefined()
  })

  it("WK5: a plain WardConfig offers every key, and atom(key) follows read(key)'s type", () => {
    const wide: WardConfig = { animate: { opacity: 1 } }
    expectTypeOf<"background-color">().toExtend<AnimatedKey<WardConfig>>()
    expectTypeOf<"opacity" | "x" | "cx">().toExtend<AnimatedKey<WardConfig>>()
    const card = wardOn(wide)
    expectTypeOf(card.atom("opacity")).toEqualTypeOf<Atom.Atom<number | string | undefined>>()
    expectTypeOf(card.atom("x")).toEqualTypeOf<Atom.Atom<number | undefined>>()
  })
})
