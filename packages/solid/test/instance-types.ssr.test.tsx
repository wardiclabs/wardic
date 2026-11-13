// A Wardic instance's types (#516, ADR-0067 *Amendment (#516)*), checked by the type checker
// (`typecheck:tests`): each element is only type-checked here, never rendered. Each
// `@ts-expect-error` is something the types reject.
//
// - IT1: an instance's `w.<tag>` takes the base props whatever its Features, and each of its Features'
//   props; a prop of a Feature it lacks is `NeedsFeature<"name">` (Q15), so the error names it. One
//   Feature at a time, every prop of each.
// - IT2: a preset's Features, a nested list's and a load's are the instance's (Q8).
// - IT3: an instance's element infers its keys as `wardic.*` does (#305): its `transition` takes the
//   keys its targets and drag axis set, and another's is an error.
// - IT4: the defaults are the props as they were: `WardicComponent<Tag>`, `W`, and an instance of every
//   Feature (`domMax`), with no `NeedsFeature` anywhere.
// - IT5: the other forms of an instance's `w` take its Features' props alone: `w.create(tag)`,
//   `w.create(Component)`, `w.create(string)` and `w.createWard(config)`, a value or an accessor.
// - IT6: `WardConfigOf<F>` is what an instance's element takes: a wrapper typed with it takes its
//   Features' props, rejects another's naming it, and hands them on to the instance's element.
// - IT7: an instance with `layout`, given at once or loaded, has the three layout hooks, as the global
//   ones are typed (Q6); one without it hasn't them.
import { domAnimation, domMax, drag, focus, hover, inView, layout, pan, press, type W as PlainW, w, type WardConfig, type WardConfigOf, type WardicComponent, type WardicInstance, createInstantLayoutTransition, createResetProjection, useAnimateLayout } from "@wardic/solid"
import type { JSX } from "solid-js"
import { describe, expectTypeOf, it } from "vitest"
import type { WardicVariantLabels } from "../src/config.ts"
import type { WardicMotionProps, WardicProps } from "../src/element.tsx"
import type { NeedsFeature } from "../src/feature.ts"
import type { InferredMotion, TargetKey } from "../src/ward-keys.ts"

/** An element, type-checked only: the function is never called. */
const typed = (make: () => unknown): void => void make

/** A value typed as Feature `N`'s brand: only a prop typed `NeedsFeature<N>` takes it. Never called. */
declare const needs: <N extends string>(name: N) => NeedsFeature<N>

/** `WardicComponent<Tag>` as it was before #516, word for word: what its default must still be. */
type Before<Tag extends keyof JSX.IntrinsicElements> = <
  K extends TargetKey = never,
  N extends string = never,
  LI extends WardicVariantLabels = never,
  LA extends WardicVariantLabels = never,
  D extends boolean | "x" | "y" = never,
>(props: WardicProps<Tag, InferredMotion<WardicMotionProps, K, N, LI, LA, D>>) => JSX.Element

/** The `w` of an instance of Features `F`. */
type W<F> = WardicInstance<F>["w"]

declare const base: W<[]>
declare const hovers: W<[typeof hover]>
declare const presses: W<[typeof press]>
declare const focuses: W<[typeof focus]>
declare const inViews: W<[typeof inView]>
declare const pans: W<[typeof pan]>
declare const drags: W<[typeof drag]>
declare const layouts: W<[typeof layout]>

const noop = (): void => {}

const FAST = { type: "tween", duration: 0.1 } as const

describe("a Wardic instance's element props (#516)", () => {
  it("IT1: the base props whatever its Features, its Features' props, and NeedsFeature for the rest", () => {
    typed(() => (
      <base.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        variants={{ open: { x: 10 } }}
        transition={{ duration: 0.2 }}
        custom={1}
        inherit={false}
        onAnimationStart={noop}
        onAnimationComplete={noop}
        onUpdate={noop}
        transformTemplate={(_, generated) => generated}
        appear={false}
        class="card"
      />
    ))

    // hover
    typed(() => <hovers.div whileHover={{ scale: 1.1 }} onHoverStart={noop} onHoverEnd={noop} />)
    typed(() => <base.div whileHover={needs("hover")} onHoverStart={needs("hover")} onHoverEnd={needs("hover")} />)
    typed(() => (
      // @ts-expect-error hover isn't the instance's
      <base.div whileHover={{ scale: 1.1 }} />
    ))

    // press
    typed(() => <presses.div whileTap={{ scale: 0.9 }} propagate={{ tap: false }} onTapStart={noop} onTap={noop} onTapCancel={noop} />)
    typed(() => <base.div whileTap={needs("press")} propagate={needs("press")} onTapStart={needs("press")} onTap={needs("press")} onTapCancel={needs("press")} />)
    typed(() => (
      // @ts-expect-error press isn't the instance's
      <hovers.div whileTap={{ scale: 0.9 }} />
    ))

    // focus
    typed(() => <focuses.div whileFocus={{ opacity: 1 }} />)
    typed(() => <base.div whileFocus={needs("focus")} />)
    typed(() => (
      // @ts-expect-error focus isn't the instance's
      <base.div whileFocus={{ opacity: 1 }} />
    ))

    // inView
    typed(() => <inViews.div whileInView={{ opacity: 1 }} viewport={{ once: true }} onViewportEnter={noop} onViewportLeave={noop} />)
    typed(() => <base.div whileInView={needs("inView")} viewport={needs("inView")} onViewportEnter={needs("inView")} onViewportLeave={needs("inView")} />)
    typed(() => (
      // @ts-expect-error inView isn't the instance's
      <base.div viewport={{ once: true }} />
    ))

    // pan
    typed(() => <pans.div onPanSessionStart={noop} onPanStart={noop} onPan={noop} onPanEnd={noop} />)
    typed(() => <base.div onPanSessionStart={needs("pan")} onPanStart={needs("pan")} onPan={needs("pan")} onPanEnd={needs("pan")} />)
    typed(() => (
      // @ts-expect-error pan isn't the instance's
      <drags.div onPan={noop} />
    ))

    // drag
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
        onDragStart={noop}
        onDrag={noop}
        onDragEnd={noop}
        onDragTransitionEnd={noop}
        onDirectionLock={noop}
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
        onDragStart={needs("drag")}
        onDrag={needs("drag")}
        onDragEnd={needs("drag")}
        onDragTransitionEnd={needs("drag")}
        onDirectionLock={needs("drag")}
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

    // layout
    typed(() => (
      <layouts.li
        layout="position"
        layoutDependency={1}
        layoutId="card"
        layoutScroll
        layoutRoot
        layoutAnchor={{ x: 0.5, y: 0 }}
        layoutCrossfade={false}
        onLayoutAnimationStart={noop}
        onLayoutAnimationComplete={noop}
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
        onLayoutAnimationStart={needs("layout")}
        onLayoutAnimationComplete={needs("layout")}
        onBeforeLayoutMeasure={needs("layout")}
        onLayoutMeasure={needs("layout")}
      />
    ))
    typed(() => (
      // @ts-expect-error layout isn't the instance's
      <drags.li layout />
    ))
  })

  it("IT2: a preset's Features, a nested list's and a load's are the instance's", () => {
    const shell = null as unknown as W<typeof domAnimation>
    typed(() => <shell.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} whileFocus={{ opacity: 1 }} whileInView={{ opacity: 1 }} />)
    typed(() => (
      // @ts-expect-error domAnimation has no drag
      <shell.div drag />
    ))

    const page = null as unknown as W<[typeof domAnimation, typeof layout]>
    typed(() => <page.li whileHover={{ scale: 1.1 }} layout layoutId="card" />)
    typed(() => <page.li drag={needs("drag")} onPan={needs("pan")} />)

    const later = null as unknown as W<[typeof domAnimation, () => Promise<typeof drag>]>
    typed(() => <later.div whileHover={{ scale: 1.1 }} drag="x" />)
    typed(() => (
      // @ts-expect-error neither the list nor its load has layout
      <later.div layout />
    ))

    const all = null as unknown as W<() => Promise<typeof domMax>>
    typed(() => <all.div whileHover={{ scale: 1.1 }} drag layout onPan={noop} />)
  })

  it("IT3: an instance's element infers its keys as wardic.* does (#305)", () => {
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
    typed(() => <drags.div drag="y" animate={{ opacity: 1 }} transition={{ y: FAST, opacity: FAST }} />)
    typed(() => (
      <drags.div
        drag="y"
        transition={{
          // @ts-expect-error a drag along y never moves x
          x: FAST,
        }}
      />
    ))
    typed(() => (
      <base.div
        animate={{ opacity: 1 }}
        transition={{
          // @ts-expect-error the element never animates scale
          scale: FAST,
        }}
      />
    ))
  })

  it("IT4: the defaults are the props as they were, and an instance of every Feature has them too", () => {
    expectTypeOf<WardicComponent<"div">>().toEqualTypeOf<Before<"div">>()
    expectTypeOf<WardicComponent<"li", typeof domMax>>().toEqualTypeOf<Before<"li">>()
    expectTypeOf<W<typeof domMax>>().toEqualTypeOf<PlainW>()
    expectTypeOf<W<[typeof domAnimation, typeof pan, typeof drag, typeof layout]>>().toEqualTypeOf<PlainW>()

    const all = null as unknown as W<typeof domMax>
    typed(() => <w.div drag whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} whileFocus={{ opacity: 1 }} whileInView={{ opacity: 1 }} onPan={noop} layout />)
    typed(() => <all.div drag whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} whileFocus={{ opacity: 1 }} whileInView={{ opacity: 1 }} onPan={noop} layout />)
    typed(() => (
      // @ts-expect-error every Feature is there, so no prop is NeedsFeature
      <w.div drag={needs("drag")} />
    ))
    typed(() => (
      // @ts-expect-error nor on an instance of every Feature
      <all.div layout={needs("layout")} />
    ))
  })

  it("IT5: the other forms of an instance's w take its Features' props alone", () => {
    const shell = null as unknown as W<typeof domAnimation>
    typed(() => {
      const Card = shell.create("article")
      return <Card whileHover={{ scale: 1.1 }} animate={{ x: 1 }} transition={{ x: FAST }} />
    })
    typed(() => {
      const Card = shell.create("article")
      // @ts-expect-error domAnimation has no layout
      return <Card layout />
    })
    typed(() => {
      const Buy = shell.create((props: { readonly ref?: (el: HTMLElement) => void; readonly label: string }) => <button ref={props.ref}>{props.label}</button>)
      return <Buy label="Buy" whileTap={{ scale: 0.9 }} />
    })
    typed(() => {
      const Buy = shell.create((props: { readonly ref?: (el: HTMLElement) => void; readonly label: string }) => <button ref={props.ref}>{props.label}</button>)
      // @ts-expect-error domAnimation has no drag
      return <Buy label="Buy" drag />
    })
    typed(() => {
      const tag: string = "section"
      const Section = shell.create(tag)
      // @ts-expect-error domAnimation has no drag
      return <Section whileHover={{ scale: 1.1 }} drag />
    })
    typed(() => shell.createWard({ whileHover: { scale: 1.1 }, animate: { x: 1 }, transition: { x: FAST } }))
    typed(() => shell.createWard(() => ({ whileFocus: { opacity: 1 } })))
    typed(() =>
      shell.createWard({
        animate: { opacity: 1 },
        // @ts-expect-error domAnimation has no drag
        drag: "x",
      }),
    )
    typed(() =>
      // @ts-expect-error nor has it layout, in an accessor's config
      shell.createWard(() => ({ layoutId: "card" })),
    )
  })

  it("IT6: WardConfigOf<F> is what an instance's element takes, for a wrapper's props", () => {
    type HoverCard = WardConfigOf<[typeof hover]>
    typed((): HoverCard => ({ whileHover: { scale: 1.1 }, animate: { opacity: 1 }, onHoverStart: noop }))
    typed((): HoverCard => ({ layout: needs("layout"), drag: needs("drag") }))
    typed(
      (): HoverCard => ({
        // @ts-expect-error hover alone has no drag
        drag: "x",
      }),
    )
    expectTypeOf<WardConfigOf<typeof domMax>>().toEqualTypeOf<WardConfig>()

    typed(() => {
      const Card = (props: WardConfigOf<[typeof hover]> & { readonly title: string }) => <hovers.article {...props}>{props.title}</hovers.article>
      return <Card title="Lamp" whileHover={{ scale: 1.05 }} />
    })
  })

  it("IT7: an instance with layout has the layout hooks, as the global ones are typed; one without hasn't", () => {
    type Laid = WardicInstance<[typeof domAnimation, typeof layout]>
    expectTypeOf<Laid["useAnimateLayout"]>().toEqualTypeOf<typeof useAnimateLayout>()
    expectTypeOf<Laid["createInstantLayoutTransition"]>().toEqualTypeOf<typeof createInstantLayoutTransition>()
    expectTypeOf<Laid["createResetProjection"]>().toEqualTypeOf<typeof createResetProjection>()
    expectTypeOf<WardicInstance<[typeof hover, () => Promise<typeof layout>]>["useAnimateLayout"]>().toEqualTypeOf<typeof useAnimateLayout>()

    expectTypeOf<WardicInstance<typeof domAnimation>>().not.toHaveProperty("useAnimateLayout")
    expectTypeOf<WardicInstance<typeof domAnimation>>().not.toHaveProperty("createInstantLayoutTransition")
    expectTypeOf<WardicInstance<typeof domAnimation>>().not.toHaveProperty("createResetProjection")
    typed(() => {
      const shell = null as unknown as WardicInstance<typeof domAnimation>
      // @ts-expect-error domAnimation has no layout
      return shell.useAnimateLayout
    })
  })
})
