/**
 * A **Wardic instance**'s types (#516, ADR-0067 *Amendment (#516)*): what `createWardic(features)`
 * returns, its `w` typed to those Features' props alone.
 *
 * @module
 */
import type { WardConfig, WardFeatureConfigs } from "./config.ts"
import type { PropNames, WardConfigWith } from "./element.tsx"
import type { NamesEvery } from "./feature.ts"
import type { createInstantLayoutTransition, createResetProjection, useAnimateLayout } from "./provider.tsx"
import type { W } from "./w.tsx"

/**
 * What `createWardic(features)` returns for Features `F`: a `w` whose elements bring them, wherever
 * they render, and take their props alone. A prop of a Feature `F` lacks is typed
 * `NeedsFeature<"name">`, so giving it is an error naming the Feature. With `layout`, given at once or
 * loaded, the layout hooks too, which bring it (ADR-0067 *Amendment (#516)*, decision 5).
 *
 * Its `w.li` takes `layout` and `whileHover` below; `<w.li drag />` would be a type error naming `drag`.
 *
 * @example
 * export const { w } = createWardic([domAnimation, layout])
 *
 * <w.li layout whileHover={{ scale: 1.05 }} />
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
 * The motion props of a Wardic instance with Features `F` (#516): the base props and its Features', for
 * a component that hands them on, to the instance's elements or to any with more Features. Another
 * Feature's prop isn't one of them: unlike the instance's own elements, its error doesn't name the
 * Feature, since props typed `NeedsFeature` would fit no element that has it. With every Feature, it's
 * `WardConfig`.
 *
 * @example
 * const Card = (props: WardConfigOf<typeof domAnimation> & { title: string }) => <w.article {...props}>{props.title}</w.article>
 */
export type WardConfigOf<F> = NamesEvery<WardFeatureConfigs, PropNames<F>> extends true ? WardConfig : WardConfigWith<PropNames<F>>
