/**
 * A **Wardic instance**'s types on Solid 2 (#516, ADR-0067 *Amendment (#516)*): what
 * `createWardic(features)` returns, its `w` and its wards typed to those Features.
 *
 * @module
 */
import type { LayoutHooksFor, NamesEvery, PropFeatureNames } from "../../feature.ts"
import type { WardicMotionPropsV2 } from "../../motion-props.ts"
import type { FeatureProps, OwnPropsFor } from "./element.tsx"
import type { createInstantLayoutTransition, createResetProjection, useAnimateLayout } from "./provider.tsx"
import type { W } from "./w.tsx"

/**
 * What `createWardic(features)` returns for Features `F`: a `w` whose elements bring them wherever they
 * render, and take their props alone; a ward from its `w.ward()`, or one its element hands to
 * `wardRef`, hears `settled` and their events alone. A prop or an event of a Feature `F` lacks is
 * typed `NeedsFeature<"name">`, so giving it is a type error that names the Feature. With `layout`,
 * given at once or loaded, it has the layout hooks too. Its `w.li` below takes `layout` and
 * `whileHover`; `<w.li drag />` would be an error naming `drag`.
 *
 * @example
 * export const { w } = createWardic([domAnimation, layout])
 *
 * <w.li layout whileHover={{ scale: 1.05 }} />
 * @see https://wardic.dev/reference/solid/elements/wardic-instance
 */
// ADR-0067 *Amendment (#516)*: decisions 2 (elements bring their Features), 5 (the layout hooks bring
// `layout`), 7 (loads), 10 (NeedsFeature, and the events, Q19).
export type WardicInstance<F> = { readonly w: W<F> } & LayoutHooksFor<PropFeatureNames<F>, LayoutHooks>

/** The layout hooks a Wardic instance with `layout` has, typed as the binding's own. */
interface LayoutHooks {
  readonly useAnimateLayout: typeof useAnimateLayout
  readonly createInstantLayoutTransition: typeof createInstantLayoutTransition
  readonly createResetProjection: typeof createResetProjection
}

/**
 * The motion props of a Wardic instance with Features `F`: the base props and its Features', for a
 * component that hands them on, to the instance's elements or to any with more Features. Another
 * Feature's prop isn't one of them, so giving it is a type error, though not one that names the
 * Feature. With every Feature, it's `WardicMotionProps`.
 *
 * @example
 * const Card = (props: WardConfigOf<typeof domAnimation> & { title: string }) => <w.article {...props}>{props.title}</w.article>
 * @see https://wardic.dev/reference/solid/elements/wardic-instance
 */
// #516. No `NeedsFeature` here: no element that has a Feature takes its brand, so a wrapper's props
// with them would fit none with more Features than `F`.
export type WardConfigOf<F> = NamesEvery<FeatureProps, PropFeatureNames<F>> extends true ? WardicMotionPropsV2 : OwnPropsFor<PropFeatureNames<F>>
