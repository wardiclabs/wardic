// A Wardic instance's types on Solid 2 (#516, ADR-0067 *Amendment (#516)*), checked by the type checker
// (`typecheck:tests`): each element and ward is only type-checked here, never made. Each
// `@ts-expect-error` is something the types reject.
//
// - ITV1: an instance's `w.<tag>` takes the base props whatever its Features, and each of its
//   Features' props; a prop of a Feature it lacks is `NeedsFeature<"name">` (Q15). Solid 2's props have
//   no Solid 1 callbacks, so `pan` adds none, and `onDrag` is the DOM's, whatever the Features.
// - ITV2: a preset's Features, a nested list's and a load's are the instance's (Q8).
// - ITV3: an instance's element infers its keys as `wardic.*` does (#305), a given ward's too.
// - ITV4: the defaults are the props as they were: `WardicComponent<Tag>`, `W`, and an instance of
//   every Feature, with no `NeedsFeature` anywhere.
// - ITV5: the other forms take its Features' props alone: `w.create(tag)`, `w.create(Component)`,
//   `w.create(string)` and `w.ward(config)`, whose unknown key is still `NotAWardKey` (#756).
// - ITV6: `WardConfigOf<F>` is what an instance's element takes, its Features' props: a wrapper typed
//   with it rejects another's, and hands them on to the instance's element, to one with more Features,
//   and to a plain `w.*`.
// - ITV7: an instance with `layout`, given at once or loaded, has the three layout hooks (Q6).
// - ITV8: an instance's ward's `next`, `each` and `when` take `settled` and its Features' events; another
//   Feature's event is an error (Q19). A plain ward's take every event, as they did.
import type { JSX } from "@solidjs/web"
import {
  createInstantLayoutTransition,
  createResetProjection,
  domAnimation,
  domMax,
  drag,
  focus,
  hover,
  inView,
  layout,
  pan,
  press,
  useAnimateLayout,
  type W as PlainW,
  w,
  ward,
  type WardConfigOf,
  type WardicComponent,
  type WardicInstance,
  type WardicMotionProps,
} from "@wardic/solid/unstable/v2"
import { describe, expectTypeOf, it } from "vitest"
import type { WardicVariantLabels } from "../../src/config.ts"
import type { NeedsFeature } from "../../src/feature.ts"
import type { DrivenKey, InferredMotion, TargetKey } from "../../src/ward-keys.ts"
import type { WardicProps } from "../../src/unstable/v2/element.tsx"

/** An element or a ward, type-checked only: the function is never called. */
const typed = (make: () => unknown): void => void make

/** A value typed as Feature `N`'s brand: only a prop typed `NeedsFeature<N>` takes it. Never called. */
declare const needs: <N extends string>(name: N) => NeedsFeature<N>

/** `WardicComponent<Tag>` as it was before #516, word for word: what its default must still be. */
type Before<Tag extends keyof JSX.IntrinsicElements> = <
  C = {},
  K extends TargetKey = never,
  N extends string = never,
  LI extends WardicVariantLabels = never,
  LA extends WardicVariantLabels = never,
  D extends boolean | "x" | "y" = never,
>(props: WardicProps<Tag, C, InferredMotion<WardicMotionProps, K, N, LI, LA, D, DrivenKey<C>>>) => JSX.Element

/** The `w` of an instance of Features `F`. */
type W<F> = WardicInstance<F>["w"]

declare const base: W<[]>
declare const hovers: W<[typeof hover]>
declare const presses: W<[typeof press]>
declare const focuses: W<[typeof focus]>
declare const inViews: W<[typeof inView]>
declare const drags: W<[typeof drag]>
declare const layouts: W<[typeof layout]>

const noop = (): void => {}

/** A component of your own, forwarding its ref, as `w.create(Component)` takes: declared, never rendered. */
declare function Buy(props: { readonly ref?: JSX.Ref<HTMLElement>; readonly label: string }): JSX.Element

const FAST = { type: "tween", duration: 0.1 } as const

describe("a Wardic instance's types on Solid 2 (#516)", () => {
  it("ITV1: the base props whatever its Features, its Features' props, and NeedsFeature for the rest", () => {
    typed(() => (
      <base.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        variants={{ open: { x: 10 } }}
        transition={{ duration: 0.2 }}
        custom={1}
        inherit={false}
        onUpdate={noop}
        transformTemplate={(_, generated) => generated}
        appear={false}
        onDrag={noop}
        class="card"
      />
    ))

    typed(() => <hovers.div whileHover={{ scale: 1.1 }} />)
    typed(() => <base.div whileHover={needs("hover")} />)
    typed(() => (
      // @ts-expect-error hover isn't the instance's
      <base.div whileHover={{ scale: 1.1 }} />
    ))

    typed(() => <presses.div whileTap={{ scale: 0.9 }} propagate={{ tap: false }} />)
    typed(() => <base.div whileTap={needs("press")} propagate={needs("press")} />)
    typed(() => (
      // @ts-expect-error press isn't the instance's
      <hovers.div whileTap={{ scale: 0.9 }} />
    ))

    typed(() => <focuses.div whileFocus={{ opacity: 1 }} />)
    typed(() => <base.div whileFocus={needs("focus")} />)
    typed(() => (
      // @ts-expect-error focus isn't the instance's
      <base.div whileFocus={{ opacity: 1 }} />
    ))

    typed(() => <inViews.div whileInView={{ opacity: 1 }} viewport={{ once: true }} />)
    typed(() => <base.div whileInView={needs("inView")} viewport={needs("inView")} />)
    typed(() => (
      // @ts-expect-error inView isn't the instance's
      <base.div viewport={{ once: true }} />
    ))

    typed(() => (
      <drags.div
        drag="x"
        whileDrag={{ scale: 1.05 }}
        dragConstraints={{ left: 0, right: 100 }}
        dragElastic={0.2}
        dragMomentum={false}
        dragSnapToOrigin
        dragTransition={{ power: 0.5 }}
        dragPropagation
        dragDirectionLock
        dragListener={false}
        onMeasureDragConstraints={(box) => box}
      />
    ))
    typed(() => (
      <base.div
        drag={needs("drag")}
        whileDrag={needs("drag")}
        dragConstraints={needs("drag")}
        dragElastic={needs("drag")}
        dragMomentum={needs("drag")}
        dragSnapToOrigin={needs("drag")}
        dragTransition={needs("drag")}
        dragPropagation={needs("drag")}
        dragDirectionLock={needs("drag")}
        dragControls={needs("drag")}
        dragListener={needs("drag")}
        onMeasureDragConstraints={needs("drag")}
      />
    ))
    typed(() => (
      // @ts-expect-error drag isn't the instance's
      <hovers.div drag />
    ))
    typed(() => (
      // @ts-expect-error a prop's brand names its own Feature, not another's
      <base.div drag={needs("layout")} />
    ))

    typed(() => (
      <layouts.li
        layout="position"
        layoutDependency={1}
        layoutId="card"
        layoutScroll
        layoutRoot
        layoutAnchor={{ x: 0.5, y: 0 }}
        layoutCrossfade={false}
        onBeforeLayoutMeasure={noop}
        onLayoutMeasure={noop}
      />
    ))
    typed(() => (
      <base.li
        layout={needs("layout")}
        layoutDependency={needs("layout")}
        layoutId={needs("layout")}
        layoutScroll={needs("layout")}
        layoutRoot={needs("layout")}
        layoutAnchor={needs("layout")}
        layoutCrossfade={needs("layout")}
        onBeforeLayoutMeasure={needs("layout")}
        onLayoutMeasure={needs("layout")}
      />
    ))
    typed(() => (
      // @ts-expect-error layout isn't the instance's
      <drags.li layout />
    ))
  })

  it("ITV2: a preset's Features, a nested list's and a load's are the instance's", () => {
    const shell = null as unknown as W<typeof domAnimation>
    typed(() => <shell.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} whileFocus={{ opacity: 1 }} whileInView={{ opacity: 1 }} />)
    typed(() => (
      // @ts-expect-error domAnimation has no drag
      <shell.div drag />
    ))
    const page = null as unknown as W<[typeof domAnimation, typeof layout]>
    typed(() => <page.li whileHover={{ scale: 1.1 }} layout layoutId="card" />)
    const later = null as unknown as W<[typeof domAnimation, () => Promise<typeof drag>]>
    typed(() => <later.div whileHover={{ scale: 1.1 }} drag="x" />)
    typed(() => (
      // @ts-expect-error neither the list nor its load has layout
      <later.div layout />
    ))
    const all = null as unknown as W<() => Promise<typeof domMax>>
    typed(() => <all.div whileHover={{ scale: 1.1 }} drag layout />)
  })

  it("ITV3: an instance's element infers its keys as wardic.* does (#305)", () => {
    typed(() => <hovers.div animate={{ x: 10 }} whileHover={{ scale: 1.1 }} transition={{ x: FAST, scale: FAST, default: FAST }} />)
    typed(() => (
      <hovers.div
        animate={{ x: 10 }}
        transition={{
          // @ts-expect-error the element never animates rotate
          rotate: FAST,
        }}
      />
    ))
    typed(() => <drags.div drag="y" transition={{ y: FAST }} />)
    typed(() => (
      <drags.div
        drag="y"
        transition={{
          // @ts-expect-error a drag along y never moves x
          x: FAST,
        }}
      />
    ))
  })

  it("ITV4: the defaults are the props as they were, and an instance of every Feature has them too", () => {
    expectTypeOf<WardicComponent<"div">>().toEqualTypeOf<Before<"div">>()
    expectTypeOf<WardicComponent<"li", typeof domMax>>().toEqualTypeOf<Before<"li">>()
    expectTypeOf<W<typeof domMax>>().toEqualTypeOf<PlainW>()
    expectTypeOf<W<[typeof domAnimation, typeof pan, typeof drag, typeof layout]>>().toEqualTypeOf<PlainW>()
    typed(() => <w.div drag whileHover={{ scale: 1.1 }} layout />)
    typed(() => (
      // @ts-expect-error every Feature is there, so no prop is NeedsFeature
      <w.div drag={needs("drag")} />
    ))
  })

  it("ITV5: the other forms of an instance's w take its Features' props alone", () => {
    const shell = null as unknown as W<typeof domAnimation>
    typed(() => {
      const Card = shell.create("article")
      return <Card whileHover={{ scale: 1.1 }} />
    })
    typed(() => {
      const Card = shell.create("article")
      // @ts-expect-error domAnimation has no layout
      return <Card layout />
    })
    typed(() => {
      const Wrapped = shell.create(Buy)
      return <Wrapped label="Buy" whileTap={{ scale: 0.9 }} />
    })
    typed(() => {
      const Wrapped = shell.create(Buy)
      // @ts-expect-error domAnimation has no drag
      return <Wrapped label="Buy" drag />
    })
    typed(() => {
      const tag: string = "section"
      const Section = shell.create(tag)
      // @ts-expect-error domAnimation has no drag
      return <Section drag />
    })
    typed(() => shell.ward({ whileHover: { scale: 1.1 }, animate: { x: 1 }, transition: { x: FAST } }))
    typed(() => shell.ward({ whileFocus: () => ({ opacity: 1 }) }))
    typed(() =>
      shell.ward({
        animate: { opacity: 1 },
        // @ts-expect-error domAnimation has no drag
        drag: "x",
      }),
    )
    typed(() =>
      shell.ward({
        animate: { opacity: 1 },
        // @ts-expect-error still not a key any ward takes (#756)
        foo: 1,
      }),
    )
    typed(() => shell.ward())
  })

  it("ITV6: WardConfigOf<F> is what an instance's element takes, for a wrapper's props", () => {
    type HoverCard = WardConfigOf<[typeof hover]>
    typed((): HoverCard => ({ whileHover: { scale: 1.1 }, animate: { opacity: 1 } }))
    typed(
      (): HoverCard => ({
        // @ts-expect-error hover alone has no drag
        drag: "x",
      }),
    )
    expectTypeOf<WardConfigOf<typeof domMax>>().toEqualTypeOf<WardicMotionProps>()
    typed(() => {
      const Card = (props: WardConfigOf<[typeof hover]> & { readonly title: string }) => <hovers.article {...props}>{props.title}</hovers.article>
      return <Card title="Lamp" whileHover={{ scale: 1.05 }} />
    })
    typed(() => {
      const more = null as unknown as W<[typeof domAnimation, typeof layout]>
      const Laid = (props: WardConfigOf<[typeof hover]>) => <more.li {...props} layout />
      const Plain = (props: WardConfigOf<[typeof hover]>) => <w.li {...props} drag />
      return [<Laid whileHover={{ scale: 1.05 }} />, <Plain whileHover={{ scale: 1.05 }} />]
    })
  })

  it("ITV7: an instance with layout has the layout hooks, as the global ones are typed; one without hasn't", () => {
    type Laid = WardicInstance<[typeof domAnimation, typeof layout]>
    expectTypeOf<Laid["useAnimateLayout"]>().toEqualTypeOf<typeof useAnimateLayout>()
    expectTypeOf<Laid["createInstantLayoutTransition"]>().toEqualTypeOf<typeof createInstantLayoutTransition>()
    expectTypeOf<Laid["createResetProjection"]>().toEqualTypeOf<typeof createResetProjection>()
    expectTypeOf<WardicInstance<[typeof hover, () => Promise<typeof layout>]>["useAnimateLayout"]>().toEqualTypeOf<typeof useAnimateLayout>()
    expectTypeOf<WardicInstance<typeof domAnimation>>().not.toHaveProperty("useAnimateLayout")
  })

  it("ITV8: an instance's ward hears settled and its Features' events; another Feature's is an error", () => {
    const shell = null as unknown as W<typeof domAnimation>
    typed(() => {
      const card = shell.ward({ whileHover: { scale: 1.1 } })
      return [card.next("settled"), card.next("hoverEnd"), card.when("tap"), card.each("viewportEnter"), card.next("pressStart")]
    })
    typed(() => {
      const card = shell.ward()
      // @ts-expect-error domAnimation has no drag
      return card.next("dragEnd")
    })
    typed(() => {
      const card = shell.ward()
      // @ts-expect-error nor pan
      return card.when("panStart")
    })
    typed(() => {
      const card = shell.ward()
      // @ts-expect-error nor layout
      return card.each("layoutComplete")
    })
    const page = null as unknown as W<[typeof domAnimation, typeof drag, typeof layout]>
    typed(() => {
      const card = page.ward({ drag: "x" })
      return [card.next("dragEnd"), card.when("directionLock"), card.each("layoutComplete")]
    })
    typed(() => {
      const card = ward({ animate: { opacity: 1 } })
      return [card.next("dragEnd"), card.when("panStart"), card.each("layoutComplete"), w.ward().next("tap")]
    })
  })
})
