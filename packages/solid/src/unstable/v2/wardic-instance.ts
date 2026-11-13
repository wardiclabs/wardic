/**
 * A **Wardic instance**'s types on Solid 2 (#516, ADR-0067 *Amendment (#516)*): what
 * `createWardic(features)` returns, its `w` and its ward typed to those Features.
 *
 * @module
 */
import type { PropNames } from "../../feature.ts"
import type { MotionPropsWith } from "./element.tsx"
import type { createInstantLayoutTransition, createResetProjection, useAnimateLayout } from "./provider.tsx"
import type { W } from "./w.tsx"

/**
 * What `createWardic(features)` returns for Features `F`: a `w` whose elements bring them, wherever
 * they render, and take their props alone; its `w.ward()`'s ward hears `settled` and their events
 * alone. A prop or an event of a Feature `F` lacks is typed `NeedsFeature<"name">`, so giving it is an
 * error naming the Feature. With `layout`, given at once or loaded, the layout hooks too, which bring
 * it (ADR-0067 *Amendment (#516)*, decision 5).
 *
 * @example
 * export const { w } = createWardic([domAnimation, layout])
 * <w.li layout whileHover={{ scale: 1.05 }} />   // ok
 * <w.li drag />                                  // error: NeedsFeature<"drag">
 */
export type WardicInstance<F> = { readonly w: W<F> } & LayoutHooksWith<PropNames<F>>

/** The layout hooks an instance has when its Features named `FN` include `layout`; nothing else. */
type LayoutHooksWith<FN extends string> = "layout" extends FN
  ? {
      readonly useAnimateLayout: typeof useAnimateLayout
      readonly createInstantLayoutTransition: typeof createInstantLayoutTransition
      readonly createResetProjection: typeof createResetProjection
    }
  : unknown

/**
 * The motion props an element of a Wardic instance with Features `F` takes (#516): the base props and
 * its Features', every other Feature's prop typed `NeedsFeature<"name">`. For a component that hands
 * them on to the instance's element. With every Feature, it's `WardicMotionProps`.
 *
 * @example
 * const Card = (props: WardConfigOf<typeof domAnimation> & { title: string }) => <w.article {...props} />
 */
export type WardConfigOf<F> = MotionPropsWith<PropNames<F>>
