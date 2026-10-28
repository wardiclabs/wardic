// A ward's transitions, checked against the keys each drives (#301's PR 2, ADR-0049), by the type
// checker (`typecheck:tests`): `ward(config)` is only type-checked here, never called (a ward needs
// a provider). Each `@ts-expect-error` is an entry the config's types reject.
//
// - TK1: the element's `transition` takes entries for the keys the element animates (any layer, its
//   drag axis), `default` and `layout`; another value's name is an error, as is a mistyped option, and
//   a key only `style` sets, which never runs on a transition (#305's Q2).
// - TK2: an element Variant children can join (`variants`, or a name in `initial` or `animate`) takes
//   every value's name in its `transition`: they inherit it, and may animate keys it doesn't.
// - TK3: a target's own transition (`animate`'s, a variant's, a gesture's, `exit`'s) takes the keys
//   that target sets and `default`; another key, or `layout`, is an error.
// - TK4: an accessor's transition (#259) is checked as its value.
// - TK5: a config typed wide, a wide variants map and a dynamic variant take every name.
// - TK6: a callback's parameters keep their types beside the checks, and every other key takes what
//   it took, a value or an accessor: `layoutDependency` any value (a draft gave it `never`).
// - TK7: a wrapper hands its config on as `ward<C>(config)`.
// - TK8 (#305's Q4): a name in a values map that isn't a value is an error, in a target, a variant or
//   `initial`, as a value or an accessor; `style` isn't checked (left: its check broke completion in a
//   `style` accessor).
import { ward, type WardChecked, type WardConfig, type WardicVariants } from "@wardic/solid/unstable/v2"
import { describe, expectTypeOf, it } from "vitest"

/** `ward(config)`, type-checked only: the function is never called. */
const typed = (make: () => unknown): void => void make

const FAST = { type: "tween", duration: 0.1 } as const

describe("a ward's transitions, checked against the keys each drives (#301)", () => {
  it("TK1: the element's transition takes the keys the element animates, default and layout", () => {
    typed(() =>
      ward({
        initial: { opacity: 0 },
        animate: { x: 10 },
        whileHover: { scale: 1.1 },
        style: { color: "red" },
        drag: "y",
        transition: { ...FAST, opacity: FAST, x: FAST, scale: FAST, y: FAST, default: { stiffness: 300 }, layout: FAST },
      }),
    )
    typed(() =>
      ward({
        animate: { opacity: 1 },
        style: { color: "red" },
        transition: {
          // @ts-expect-error a key only `style` sets never runs on a transition (#305's Q2)
          color: FAST,
        },
      }),
    )
    typed(() =>
      ward({
        animate: { opacity: 1 },
        transition: {
          // @ts-expect-error the element never animates rotate
          rotate: FAST,
        },
      }),
    )
    typed(() =>
      ward({
        animate: { opacity: 1 },
        transition: {
          // @ts-expect-error a mistyped option
          duraton: 0.2,
        },
      }),
    )
  })

  it("TK2: an element Variant children can join takes every value's name in its transition", () => {
    typed(() => ward({ variants: { shown: {}, hidden: {} }, transition: { staggerChildren: 0.05, y: { stiffness: 400 } } }))
    typed(() => ward({ initial: "hidden", animate: "shown", transition: { rotate: FAST } }))
    typed(() => ward({ animate: ["shown", "active"], transition: { rotate: FAST } }))
  })

  it("TK3: a target's own transition takes the keys that target sets and default", () => {
    typed(() =>
      ward({
        animate: { opacity: 1, transition: { opacity: FAST, default: FAST } },
        whileTap: { scale: 0.9, transition: { scale: { stiffness: 500 } } },
        exit: { x: -20, transition: { x: FAST } },
        variants: { open: { x: 0, opacity: 1, transition: { x: FAST, opacity: { inherit: true, delay: 0.1 } } } },
      }),
    )
    typed(() =>
      ward({
        variants: {
          open: { x: 0, opacity: 1 },
          shut: {
            x: -20,
            transition: {
              // @ts-expect-error shut never sets opacity
              opacity: FAST,
            },
          },
        },
        animate: "open",
      }),
    )
    typed(() =>
      ward({
        animate: {
          opacity: 1,
          transition: {
            // @ts-expect-error a layout animation never reads a target's transition
            layout: FAST,
          },
        },
      }),
    )
  })

  it("TK4: an accessor's transition is checked as its value", () => {
    typed(() => ward({ animate: { opacity: 1 }, transition: () => ({ ...FAST, opacity: FAST }) }))
    typed(() =>
      ward({
        animate: { opacity: 1 },
        // @ts-expect-error the element never animates scale
        transition: () => ({ scale: FAST }),
      }),
    )
  })

  it("TK5: a config typed wide, a wide variants map and a dynamic variant take every name", () => {
    const wide: WardConfig = { animate: { opacity: 1 }, transition: { scale: FAST } }
    typed(() => ward(wide))
    const variants: WardicVariants = { at: { x: 0, transition: { scale: FAST } } }
    typed(() => ward({ variants, animate: "at" }))
    typed(() => ward({ variants: { at: (i: number) => ({ x: i, transition: { scale: FAST } }) }, custom: 1, animate: "at" }))
  })

  it("TK6: a callback's parameters keep their types beside the checks, and every other key takes what it took", () => {
    typed(() =>
      ward({
        animate: { opacity: 1 },
        transition: { opacity: FAST },
        onUpdate: (latest) => expectTypeOf(latest).toEqualTypeOf<Readonly<Record<string, number | string>>>(),
      }),
    )
    typed(() => ward({ layout: true, layoutDependency: () => 1, viewport: () => ({ amount: 0.5 }), style: { opacity: 0.5 } }))
    typed(() => ward({ layout: "position", layoutDependency: { any: "value" }, dragConstraints: { left: 0, right: 100 } }))
  })

  it("TK7: a wrapper hands its config on as ward<C>(config)", () => {
    const fade = <const C extends WardConfig>(config: WardChecked<C>) => ward<C>(config)
    typed(() => fade({ animate: { opacity: 1 }, transition: { opacity: FAST } }))
    typed(() =>
      fade({
        animate: { opacity: 1 },
        transition: {
          // @ts-expect-error checked through the wrapper too
          scale: FAST,
        },
      }),
    )
  })

  it("TK8: a name in a values map that isn't a value is an error (#305)", () => {
    typed(() => ward({ initial: { opacity: 0 }, animate: { opacity: 1, "--accent": "red" }, variants: { shown: { x: 1 } }, whileHover: { scale: 1.1 } }))
    typed(() => ward({ initial: false, animate: "shown", variants: { shown: { opacity: 1 } } }))
    typed(() => ward({ initial: ["a", "b"], variants: { a: { opacity: 0 }, b: { x: 1 } } }))
    // @ts-expect-error no value has this name
    typed(() => ward({ animate: { opacty: 1 } }))
    // @ts-expect-error no value has this name, beside one that has
    typed(() => ward({ animate: { opacity: 1, opacty: 1 } }))
    // @ts-expect-error no value has this name
    typed(() => ward({ initial: { opacty: 0 }, animate: { opacity: 1 } }))
    // @ts-expect-error no value has this name
    typed(() => ward({ variants: { shown: { opacty: 1 } }, animate: "shown" }))
    // @ts-expect-error no value has this name
    typed(() => ward({ animate: { opacity: 1 }, whileTap: { scal: 0.9 } }))
    // @ts-expect-error no value has this name, in an accessor
    typed(() => ward({ animate: () => ({ opacity: 1, opacty: 1 }) }))
    // Left: `style` isn't checked.
    typed(() => ward({ animate: { opacity: 1 }, style: { colr: "red" } }))
  })
})
