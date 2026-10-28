// A Wardic element's keys, inferred from its targets (#305, ADR-0049), checked by the type checker
// (`typecheck:tests`): each element is only type-checked here, never rendered. Each
// `@ts-expect-error` is something the types reject.
//
// - IK1: an element's `transition` takes entries for the keys its targets set and its drag axis's,
//   `default` and `layout`; another value's name is an error, as is a mistyped option, and a key only
//   `style` sets, which never runs on a transition (Q2).
// - IK2: a name the props don't know is an error as ever: an attribute, a value's name in a target,
//   in `style`, in a variant.
// - IK3: an element Variant children can join (`variants`, or a name or a list of them in `initial` or
//   `animate`) takes every value's name in its `transition`: they inherit it.
// - IK4: a target's own transition (`animate`'s, a gesture's, `exit`'s, a variant's) takes the keys the
//   element animates and `default` (Q3), not `layout`.
// - IK5: what inference can't see takes every name: a target typed wide, and an overloaded generic
//   call alone (Effect's `Bool.match`). Beside another target, that call's keys are missing, so an
//   entry for one is rejected; a type on its result is the way round.
// - IK6: `createWard` checks its config the same way, a value or an accessor, and still rejects a name
//   it doesn't know; a config typed wide passes.
// - IK7: `wardic.create(tag)` is `wardic.<tag>`; `wardic.create(Component)` keeps its component's props
//   and takes every name.
// - IK8 (#428): a Transition end on any target, its names checked; a key only a Transition end sets
//   takes no transition entry, and a Transition end widens nothing.
import * as Bool from "effect/Boolean"
import { createWard, type WardConfig, wardic, type WardicVariant } from "@wardic/solid"
import { describe, it } from "vitest"

/** An element or a ward, type-checked only: the function is never called. */
const typed = (make: () => unknown): void => void make

const FAST = { type: "tween", duration: 0.1 } as const

declare const open: () => boolean
declare const either: { readonly opacity: 1 } | { readonly scale: 0.9 }

describe("a Wardic element's keys, inferred from its targets (#305)", () => {
  it("IK1: the element's transition takes its targets' keys, its drag axis's, default and layout", () => {
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

  it("IK2: a name the props don't know is an error as ever", () => {
    // @ts-expect-error no such attribute
    typed(() => <wardic.div fooo="x" />)
    // @ts-expect-error no value has this name
    typed(() => <wardic.div animate={{ opacty: 1 }} />)
    // @ts-expect-error no value has this name, beside one that has
    typed(() => <wardic.div animate={{ opacity: 1, opacty: 1 }} />)
    // @ts-expect-error no style has this name
    typed(() => <wardic.div style={{ colr: "red" }} />)
    // @ts-expect-error no value has this name
    typed(() => <wardic.div animate={{ opacity: 1 }} exit={{ opacty: 0 }} />)
    // @ts-expect-error no value has this name
    typed(() => <wardic.div variants={{ shown: { opacty: 1 } }} animate="shown" />)
  })

  it("IK3: an element Variant children can join takes every value's name", () => {
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

  it("IK4: a target's own transition takes the element's keys and default, not layout", () => {
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
    typed(() => (
      <wardic.div
        variants={{
          shown: {
            opacity: 1,
            transition: {
              // @ts-expect-error the element never animates scale
              scale: FAST,
            },
          },
        }}
      />
    ))
  })

  it("IK5: what inference can't see takes every name; beside another target, an overloaded call's keys are missing", () => {
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

  it("IK6: createWard checks its config the same way, a value or an accessor", () => {
    typed(() => createWard({ initial: { opacity: 0 }, animate: { x: 10 }, drag: "y", transition: { opacity: FAST, x: FAST, y: FAST, default: FAST, layout: FAST } }))
    typed(() => createWard(() => ({ animate: { x: Bool.match(open(), { onTrue: () => 10, onFalse: () => 0 }) }, transition: { x: FAST } })))
    typed(() =>
      createWard({
        animate: { opacity: 1 },
        transition: {
          // @ts-expect-error the ward never animates scale
          scale: FAST,
        },
      }),
    )
    typed(() =>
      // @ts-expect-error the ward never animates scale: an accessor's error is the accessor's
      createWard(() => ({ animate: { opacity: 1 }, transition: { scale: FAST } })),
    )
    // @ts-expect-error no config has this name, beside one that has
    typed(() => createWard({ animate: { opacity: 1 }, fooo: 1 }))
    // @ts-expect-error no viewport has this name, beside one that has
    typed(() => createWard({ animate: { opacity: 1 }, viewport: { amount: 0.5, amout: 1 } }))
    // @ts-expect-error no value has this name
    typed(() => createWard({ animate: { opacty: 1 } }))
    const config: WardConfig = { animate: { opacity: 1 }, transition: { scale: FAST } }
    typed(() => createWard(config))
    typed(() => createWard(() => config))
  })

  it("IK7: wardic.create(tag) is wardic.<tag>; a component's keeps its props and takes every name", () => {
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
    const Card = wardic.create((props: { readonly title: string; readonly ref?: (el: HTMLElement) => void }) => <div ref={props.ref}>{props.title}</div>)
    typed(() => <Card title="a" animate={{ opacity: 1 }} transition={{ scale: FAST }} />)
    // @ts-expect-error the component's own props are checked
    typed(() => <Card animate={{ opacity: 1 }} />)
  })

  it("IK8: a Transition end on any target, its names checked, its keys no transition's", () => {
    typed(() => (
      <wardic.div
        initial={{ opacity: 0, transitionEnd: { display: "none" } }}
        animate={{ opacity: 1, transitionEnd: { display: "block" } }}
        exit={{ opacity: 0, transitionEnd: { visibility: "hidden" } }}
        whileHover={{ scale: 1.05, transitionEnd: { cursor: "grab" } }}
        variants={{ shown: { opacity: 1, transitionEnd: { "--shown": "yes" } } }}
        transition={{ opacity: FAST, scale: FAST }}
      />
    ))
    typed(() => createWard({ animate: { opacity: 0, transitionEnd: { display: "none" } }, transition: { opacity: FAST } }))
    // @ts-expect-error no value has this name, in a Transition end
    typed(() => <wardic.div animate={{ opacity: 0, transitionEnd: { dispaly: "none" } }} />)
    typed(() => (
      <wardic.div
        animate={{ opacity: 0, transitionEnd: { display: "none" } }}
        transition={{
          // @ts-expect-error a key only the Transition end sets never runs on a transition
          display: FAST,
        }}
      />
    ))
    typed(() => (
      <wardic.div
        animate={{ opacity: 0, transitionEnd: { display: "none" } }}
        transition={{
          // @ts-expect-error a Transition end widens nothing: scale is still no key of the element's
          scale: FAST,
        }}
      />
    ))
  })
})
