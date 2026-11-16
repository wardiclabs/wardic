/**
 * Wardic for Foldkit (ADR-0071, #561): a **Handle** made once per program with {@link make}, whose
 * `html(h)` gives a view the builder `w`. A `w.*` element takes Foldkit's attributes and Wardic's
 * (`w.Initial`, `w.Animate`, `w.Transition`, `w.Style`), animates its `Animate` target from `Initial`
 * as it mounts, Retargets on a render that changes its target and holds through one that doesn't. The
 * `w.*` element at the top of the view carries `w.Provider()`, whose Mount builds Wardic's services on
 * the Handle's `env` for every element under it.
 *
 * @example
 * // src/lib/wardic.ts
 * import { DomLive } from "@wardic/dom"
 * import * as Wardic from "@wardic/foldkit/Wardic"
 *
 * export const wardic = Wardic.make({ env: DomLive })
 *
 * // src/view.ts
 * const view = (model: Model, h: HtmlBuilder<Message>): Html => {
 *   const w = wardic.html(h)
 *   return w.div([w.Provider(), h.Class("app")], [
 *     w.div([h.Class("card"), w.Initial({ opacity: 0, y: 8 }), w.Animate({ opacity: 1, y: 0 }), w.Transition({ duration: 0.3 })], [model.title]),
 *   ])
 * }
 *
 * @module
 */
import type * as WardicServices from "@wardic/core/unstable/WardicServices"
import type * as Feature from "@wardic/dom/unstable/Feature"
import type * as FoldkitHtml from "foldkit/html"
import type { MountAction } from "foldkit/mount"
import * as Predicate from "effect/Predicate"
import type * as Ward from "./Ward.ts"
import { type Attributes, builderOf } from "./internal/builder.ts"
import { ELEMENT_NAME, mountOf, PROVIDER_NAME } from "./internal/mount.ts"
import { makeState, type State } from "./internal/services.ts"

/** What {@link make} takes. */
export interface MakeOptions<F> {
  /** Wardic's Environment: `@wardic/dom`'s `DomLive` in a browser. Required, as a Solid provider's `env` is (#791, Q1). */
  readonly env: WardicServices.WardicEnv
  /**
   * The **Features** its elements have (#511, ADR-0067 *Amendment (#516)*): given at once, or loads
   * (`() => import(…)`), as Solid's `createWardic` takes them. Without any, the base props alone: a
   * gesture or layout attribute is then a type error naming its Feature (from slice 3 on).
   */
  readonly features?: F | undefined
}

/** A `w.*` element's child, as `h.div`'s: an element, nothing, or text. */
export type Child = FoldkitHtml.Html | string

/** A `w.*` element's function: `h.div`'s shape, taking Wardic's attributes too. */
export type ElementFunction<Message> = (attributes: Attributes<Message>, children?: ReadonlyArray<Child>) => FoldkitHtml.Html

/** The phantom that carries a Handle's Features on its builder. */
declare const FEATURES: unique symbol

/**
 * The builder `w` of `wardic.html(h)`: `h`'s element factories, each taking Wardic's attributes beside
 * Foldkit's; `keyed`; the `attributes` bundle, for an element `w` doesn't make (a custom element, a
 * component library's); and Wardic's attribute factories. Foldkit's own attributes stay on `h`.
 */
export type Html<Message, F = never> = { readonly [Tag in FoldkitHtml.TagName]: ElementFunction<Message> } & Readonly<{
  readonly [FEATURES]?: F
  /** `w.keyed(tag)(key, attributes, children)`: a keyed `w.*` element, as `h.keyed`'s. */
  keyed: (tag: FoldkitHtml.TagName) => (key: string, attributes: Attributes<Message>, children?: ReadonlyArray<Child>) => FoldkitHtml.Html
  /**
   * The **Bundle** (ADR-0071, decision 18): a Ward's attributes for any element, `h.div([...w.attributes({ … })])`.
   * It takes the element's own Mount and fuses it with Wardic's, since one element has one `OnMount`.
   * An element it's on isn't stamped, so key such an element (P2).
   */
  attributes: (bundle: Ward.Bundle<Message>) => ReadonlyArray<FoldkitHtml.Attribute<Message> | FoldkitHtml.ChildAttribute>
  /**
   * The **Provider attribute** (decision 9): on the `w.*` element at the top of the view. Its Mount
   * builds Wardic's services on the Handle's `env`, which every `w.*` element under it animates with.
   */
  Provider: (options?: Ward.ProviderOptions) => Ward.Attribute
  /** Where the element starts: values, or `false` to start at `Animate` (Motion's `initial`). */
  Initial: (value: Ward.Config["initial"]) => Ward.Attribute
  /** Where the element animates to (Motion's `animate`): a change Retargets it from wherever it is. */
  Animate: (value: Ward.Config["animate"]) => Ward.Attribute
  /** How it gets there (Motion's `transition`). */
  Transition: (value: Ward.Config["transition"]) => Ward.Attribute
  /**
   * The element's `style` as Wardic sees it (Motion's `style`): its base values, where a key returns
   * when nothing animates it. A key in both `w.Style` and `h.Style` is an error in development.
   */
  Style: (value: Ward.Config["style"]) => Ward.Attribute
}>

/**
 * A **Handle**: one Wardic runtime inside a Foldkit program (ADR-0071, decision 9), typed by its
 * Features `F`. Made once, at module scope.
 */
export interface Handle<F = never> {
  /** The builder `w` for a view's `h`, made once per `h`. */
  readonly html: <Message>(h: FoldkitHtml.HtmlBuilder<Message>) => Html<Message, F>
  /** The provider's raw Mount, for a Scene test to resolve by name (decision 36): `Scene.Mount.resolve(wardic.Provider, Done())`. */
  readonly Provider: MountAction<never>
  /** An element's raw Mount, for a Scene test to resolve by name (decision 36): one per `w.*` element in the view. */
  readonly Element: MountAction<never>
}

/**
 * Makes a Handle on `env`, with `features` (above). One per program, at module scope: a second
 * `w.Provider()` for it while one is live is reported and ignored.
 */
export const make = <const F extends Feature.InstanceFeaturesProp = never>(options: MakeOptions<F>): Handle<F> => {
  const state: State = makeState(options.env)
  // Made once per `h` (decision 18): as `===`-stable as `h` is, for `createLazy`.
  const builders = new WeakMap<object, object>()
  const html = <Message>(h: FoldkitHtml.HtmlBuilder<Message>): Html<Message, F> => {
    const known = builders.get(h)
    if (Predicate.isNotUndefined(known)) return known as Html<Message, F>
    const made = builderOf(state, h)
    builders.set(h, made)
    return made as Html<Message, F>
  }
  return {
    html,
    Provider: mountOf<never>(state, { provider: {}, user: undefined }),
    Element: mountOf<never>(state, { provider: undefined, user: undefined }),
  }
}

export { ELEMENT_NAME, PROVIDER_NAME }
