// A Wardic instance's types (#516, ADR-0067 *Amendment (#516)*), checked by the type checker
// (`typecheck:tests`): each element is only type-checked here, never rendered. Each
// `@ts-expect-error` is something the types reject.
//
// - IT1: an instance's `w.<tag>` takes the base props whatever its Features, and each of its Features'
//   props; a prop of a Feature it lacks is `NeedsFeature<"name">` (Q15), so the error names it. One
//   Feature at a time, every prop of each.
// - IT2: a preset's Features, a nested list's and a load's are the instance's (Q8).
import { domAnimation, domMax, drag, focus, hover, inView, layout, pan, press, type WardicInstance } from "@wardic/solid"
import { describe, it } from "vitest"
import type { NeedsFeature } from "../src/feature.ts"

/** An element, type-checked only: the function is never called. */
const typed = (make: () => unknown): void => void make

/** A value typed as Feature `N`'s brand: only a prop typed `NeedsFeature<N>` takes it. Never called. */
declare const needs: <N extends string>(name: N) => NeedsFeature<N>

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
})
