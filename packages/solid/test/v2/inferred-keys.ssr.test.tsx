// A Wardic element's keys, inferred from its targets (#305, ADR-0049), on Solid 2, checked by the type
// checker (`typecheck:tests`): each element is only type-checked here, never rendered. Each
// `@ts-expect-error` is something the types reject. Solid 1's are IK1–IK7.
//
// - KI1: an element's `transition` takes entries for the keys its targets set and its drag axis's,
//   `default` and `layout`; another value's name is an error, as is a mistyped option, and a key only
//   `style` sets, which never runs on a transition (Q2).
// - KI2: a name the props don't know is an error as ever: an attribute, a value's name in a target,
//   in `style`, in a variant.
// - KI3: an element Variant children can join (`variants`, or a name or a list of them in `initial` or
//   `animate`) takes every value's name in its `transition`.
// - KI4: a target's own transition takes the keys the element animates and `default` (Q3), not
//   `layout`.
// - KI5: what inference can't see takes every name: a target typed wide, an overloaded generic call
//   alone. Beside another target, that call's keys are missing; a type on its result is the way round.
// - KI6: beside a ward given to `wardRef` (#398), the element's `transition` also takes the keys the
//   ward's config animates.
// - KI7: `wardic.create(tag)` is `wardic.<tag>`; `wardic.create(Component)` infers its keys too, and
//   keeps its component's props.
import type { JSX } from "@solidjs/web"
import { ward, wardic, type WardicVariant } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { describe, it } from "vitest"

/** An element, type-checked only: the function is never called. */
const typed = (make: () => unknown): void => void make

const FAST = { type: "tween", duration: 0.1 } as const

declare const open: () => boolean
/** A component to wrap, declared: its wrap is made only inside `typed`. */
declare function Card(props: { readonly title: string; readonly ref?: JSX.Ref<HTMLElement> }): JSX.Element
const wrapCard = () => wardic.create(Card)
declare const either: { readonly opacity: 1 } | { readonly scale: 0.9 }

describe("a Wardic element's keys, inferred from its targets, on Solid 2 (#305)", () => {
  it("KI1: the element's transition takes its targets' keys, its drag axis's, default and layout", () => {
    typed(() => (
      <wardic.div
        initial={{ opacity: 0 }}
        animate={{ x: 10 }}
        exit={{ rotate: 5 }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ skewX: 2 }}
        whileDrag={{ skewY: 3 }}
        whileInView={{ "--accent": "red" }}
        drag="y"
        transition={{ ...FAST, opacity: FAST, x: FAST, rotate: FAST, scale: FAST, skewX: FAST, skewY: FAST, "--accent": FAST, y: FAST, default: { stiffness: 300 }, layout: FAST }}
      />
    ))
    typed(() => (
      <wardic.div
        animate={{ opacity: 1 }}
        transition={{
          // @ts-expect-error the element never animates rotate
          rotate: FAST,
        }}
      />
    ))
    typed(() => (
      <wardic.div
        animate={{ opacity: 1 }}
        transition={{
          // @ts-expect-error a mistyped option
          duraton: 0.2,
        }}
      />
    ))
    typed(() => (
      <wardic.div
        animate={{ opacity: 1 }}
        style={{ color: "red" }}
        transition={{
          // @ts-expect-error a key only `style` sets never runs on a transition (Q2)
          color: FAST,
        }}
      />
    ))
  })

  it("KI2: a name the props don't know is an error as ever", () => {
    // @ts-expect-error no such attribute
    typed(() => <wardic.div fooo="x" />)
    // @ts-expect-error no value has this name
    typed(() => <wardic.div animate={{ opacty: 1 }} />)
    // @ts-expect-error no value has this name, beside one that has
    typed(() => <wardic.div animate={{ opacity: 1, opacty: 1 }} />)
    // @ts-expect-error no style has this name
    typed(() => <wardic.div style={{ colr: "red" }} />) // eslint-disable-line solid/style-prop -- the misspelt name is what this checks
    // @ts-expect-error no value has this name
    typed(() => <wardic.div animate={{ opacity: 1 }} exit={{ opacty: 0 }} />)
    // @ts-expect-error no value has this name
    typed(() => <wardic.div variants={{ shown: { opacty: 1 } }} animate="shown" />)
  })

  it("KI3: an element Variant children can join takes every value's name", () => {
    typed(() => (
      <wardic.ul
        variants={{ shown: { opacity: 1 }, hidden: { opacity: 0 } }}
        initial="hidden"
        animate="shown"
        transition={{ staggerChildren: 0.05, y: { stiffness: 400 }, "background-color": FAST }}
      />
    ))
    typed(() => <wardic.li animate="shown" transition={{ y: { stiffness: 400 } }} />)
    typed(() => <wardic.li initial={["hidden", "low"]} animate={{ opacity: 1 }} transition={{ scale: FAST }} />)
    // A name TS can't infer (an overloaded call's) is a name all the same.
    typed(() => <wardic.li animate={Bool.match(open(), { onTrue: () => "shown", onFalse: () => "hidden" })} transition={{ scale: FAST }} />)
  })

  it("KI4: a target's own transition takes the element's keys and default, not layout", () => {
    typed(() => (
      <wardic.div
        animate={{ opacity: 1, transition: { opacity: FAST, x: FAST, default: FAST } }}
        whileHover={{ x: 4, transition: { x: { stiffness: 500 } } }}
        exit={{ opacity: 0, transition: { opacity: FAST } }}
      />
    ))
    typed(() => (
      <wardic.div
        animate={{
          opacity: 1,
          transition: {
            // @ts-expect-error the element never animates scale
            scale: FAST,
          },
        }}
      />
    ))
    typed(() => (
      <wardic.div
        animate={{
          opacity: 1,
          transition: {
            // @ts-expect-error a layout animation reads only the element's transition
            layout: FAST,
          },
        }}
      />
    ))
  })

  it("KI5: what inference can't see takes every name; beside another target, an overloaded call's keys are missing", () => {
    const wide: WardicVariant = { opacity: 1 }
    typed(() => <wardic.div animate={wide} transition={{ scale: FAST }} />)
    typed(() => (
      <wardic.div
        animate={Bool.match(open(), { onTrue: () => ({ opacity: 1 }), onFalse: () => ({ opacity: 0, scale: 0.9 }) })}
        transition={{ scale: FAST }}
      />
    ))
    typed(() => (
      <wardic.div
        initial={{ opacity: 0 }}
        animate={Bool.match(open(), { onTrue: () => ({ opacity: 1 }), onFalse: () => ({ opacity: 0, scale: 0.9 }) })}
        transition={{
          // @ts-expect-error `Bool.match` is overloaded: TS infers nothing through it, so only `initial`'s keys are known
          scale: FAST,
        }}
      />
    ))
    typed(() => (
      <wardic.div
        initial={{ opacity: 0 }}
        animate={Bool.match(open(), { onTrue: () => ({ opacity: 1 }), onFalse: () => ({ opacity: 0, scale: 0.9 }) }) as WardicVariant}
        transition={{ scale: FAST }}
      />
    ))
    // A target that's one of several maps, as a ternary's is, sets every map's keys.
    typed(() => <wardic.div initial={{ opacity: 0 }} animate={either} transition={{ scale: FAST }} />)
  })

  it("KI6: beside a given ward, the transition also takes the keys the ward's config animates", () => {
    typed(() => {
      const card = ward({ animate: { opacity: 1 } })
      return <wardic.div wardRef={card} whileHover={{ scale: 1.1 }} transition={{ opacity: FAST, scale: FAST }} />
    })
    typed(() => {
      const card = ward({ animate: { opacity: 1 } })
      return (
        <wardic.div
          wardRef={card}
          whileHover={{ scale: 1.1 }}
          transition={{
            // @ts-expect-error neither the element nor its ward animates rotate
            rotate: FAST,
          }}
        />
      )
    })
  })

  it("KI7: wardic.create(tag) is wardic.<tag>; a component's infers its keys too and keeps its props", () => {
    const Div = wardic.create("div")
    typed(() => <Div animate={{ opacity: 1 }} transition={{ opacity: FAST }} />)
    typed(() => (
      <Div
        animate={{ opacity: 1 }}
        transition={{
          // @ts-expect-error the element never animates scale
          scale: FAST,
        }}
      />
    ))
    typed(() => {
      const Card = wrapCard()
      return <Card title="a" animate={{ opacity: 1 }} transition={{ opacity: FAST }} />
    })
    typed(() => {
      const Card = wrapCard()
      return (
        <Card
          title="a"
          animate={{ opacity: 1 }}
          transition={{
            // @ts-expect-error the element never animates scale
            scale: FAST,
          }}
        />
      )
    })
    typed(() => {
      const Card = wrapCard()
      // @ts-expect-error the component's own props are checked
      return <Card animate={{ opacity: 1 }} />
    })
  })
})
