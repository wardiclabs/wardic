/**
 * `w` on Solid 2 — the **Slim element**'s forms (#511, ADR-0067 decision 6; Motion's `m`): `w.<tag>`,
 * `w.create(tag | Component)` and `w.ward(config)`, each as its Complete form (`wardic.<tag>`,
 * `wardic.create`, `ward()`) is. A Slim element animates values (`initial`, `animate`, `exit`,
 * variants, transitions, Keyframes), with the **Features** chosen above it: its `WardicProvider`'s and
 * every `LazyWardic`'s between them. This module names no Feature, so an app of Slim elements ships
 * only those it chooses.
 *
 * ```tsx
 * <WardicProvider env={DomLive} features={[colors]}>
 *   <w.div animate={{ color: "oklch(0.7 0.1 200)" }} />
 * </WardicProvider>
 * ```
 *
 * @module
 */
import type { JSX } from "@solidjs/web"
import type * as Feature from "@wardic/dom/unstable/Feature"
import type * as All from "@wardic/dom/unstable/features/All"
import type { WardCheckedConfig } from "./ward-keys.ts"
import type { PerKeyApart } from "./config-view.ts"
import { createOf, type CreateFor, type FeatureProps, formOf, type OwnPropsFor, type WardicComponentFor } from "./element.tsx"
import type { Accessor } from "solid-js"
import type { StageSubject, StageWard } from "./stage.ts"
import { SLIM, type Ward, type WardCallbackKey, type WardChecked, type WardConfig, type WardFor, type WardInternals, type WardOptions, type WardStyle } from "./ward.tsx"
import { type HeldWard, wardFrom } from "./ward-first.ts"

/** `w.ward(config, options)`: `ward()`'s ward, on a Slim element. */
interface SlimWard {
  /** Its Subject first (#884): `w.ward(el, config)` is `w.ward(config)(el)`, with `held`. */
  <const C extends WardConfig>(subject: Element, config: WardChecked<C>, options?: WardOptions): HeldWard<Ward<C>>
  /** A Stage's Subject first, under a `<WardicStage>` (#884): the Stage's ward. */
  <const C extends WardConfig>(subject: StageSubject | Accessor<StageSubject | undefined>, config: WardChecked<C>, options?: WardOptions): StageWard<C>
  // The config first, last of the generic forms, so `ReturnType` of an instantiation is still a DOM ward.
  <const C extends WardConfig>(config: WardChecked<C>, options?: WardOptions): Ward<C>
  (): Ward<{}>
  // Last, so `ReturnType` of it is too.
  (config: undefined, options: WardOptions): Ward<{}>
}

/** No config: a ward that only listens (#398), `w.ward()`. */
/** A ward on an element of `kind`, as `w.ward` makes one. */
const wardOf =
  (kind: WardInternals) =>
  (first?: unknown, second?: unknown, third?: unknown): Ward | HeldWard<Ward> | StageWard =>
    wardFrom(first, second, third, kind)

/** Every form of a `w` whose elements are of `kind` (#516): the Slim element's `w`, and a Wardic instance's. */
export const wOf = (kind: WardInternals): W => formOf<W>(createOf(kind), { ward: wardOf(kind) })

/**
 * The type of `w`: `w.create`, `w.ward`, and `w.<tag>`, a Slim element's component for that element (one
 * per tag). `W<F>` is a Wardic instance's `w`, whose elements and wards take only Features `F`'s props,
 * and whose wards hear only their events.
 *
 * @see https://wardic.dev/reference/solid/elements/wardic-instance
 */
// `F`: #516, ADR-0067 *Amendment (#516)*.
export type W<F = All.EveryFeature> = WFor<Feature.PropFeatureNames<F>>

/** {@link W} for the Features named `FN` (#516). */
type WFor<FN extends string> = { readonly create: CreateFor<FN>; readonly ward: MakeWardFor<FN> } & {
  readonly [Tag in keyof JSX.IntrinsicElements]: WardicComponentFor<Tag, FN>
}

/** `w.ward` for the Features named `FN` (#516): the Slim element's with every one; else a Wardic instance's. */
type MakeWardFor<FN extends string> = Feature.NamesEvery<FeatureProps, FN> extends true ? SlimWard : MakeInstanceWard<FN>

/**
 * A Wardic instance's `w.ward` (#516), its Features named `FN`: its config takes their props alone, every
 * other Feature's `NeedsFeature<"name">`, and a key no ward takes `NotAWardKey` (#756). Its ward hears
 * `settled` and their events alone (Q19).
 */
interface MakeInstanceWard<FN extends string> {
  /** Its Subject first (#884), with `held`. */
  <const C extends WardConfig>(
    subject: Element,
    config: WardCheckedConfig<C, PerKeyApart<InstanceValues<FN>, WardCallbackKey & keyof InstanceValues<FN>>>,
    options?: WardOptions,
  ): HeldWard<WardFor<C, FN>>
  /** A Stage's Subject first, under a `<WardicStage>` (#884): the Stage's ward. */
  <const C extends WardConfig>(subject: StageSubject | Accessor<StageSubject | undefined>, config: WardChecked<C>, options?: WardOptions): StageWard<C>
  // The config first, last of the generic forms, so `ReturnType` of an instantiation is still a DOM ward.
  <const C extends WardConfig>(config: WardCheckedConfig<C, PerKeyApart<InstanceValues<FN>, WardCallbackKey & keyof InstanceValues<FN>>>, options?: WardOptions): WardFor<C, FN>
  (): WardFor<{}, FN>
  // Last, so `ReturnType` of it is too.
  (config: undefined, options: WardOptions): WardFor<{}, FN>
}

/** A Wardic instance's ward config values, its Features named `FN`: theirs, `style`, and every other Feature's `NeedsFeature`. */
type InstanceValues<FN extends string> = OwnPropsFor<FN> & Feature.AbsentGroupsOf<FeatureProps, FN> & { readonly style?: WardStyle | string | undefined }

/**
 * The Slim element: `w.div`, `w.button` and every other tag, each taking the element's own props and
 * Wardic's motion props. It has the Features its `WardicProvider` and any `LazyWardic` above it give.
 * `w.create(Component)` makes your own component one, and `w.ward(config)` a ward for an element of
 * your own. Motion's `m.div`.
 *
 * @example <w.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
 * @see https://wardic.dev/reference/solid/elements/w
 */
// Every form of the Slim element, as `wardic`'s and `ward()` are of the Complete one (ADR-0067).
export const w: W = wOf(SLIM)
