/**
 * Wardic for Foldkit (ADR-0071, #561): a **Handle** made once per program with {@link make}, whose
 * `html(h)` gives a view the builder `w`. A `w.*` element takes Foldkit's attributes and Wardic's
 * (`w.Initial`, `w.Animate`, `w.Transition`, `w.Style`), animates its `Animate` target from `Initial`
 * as it mounts, Retargets on a render that changes its target and holds through one that doesn't. The
 * first `w.*` element to mount builds Wardic's services on the Handle's `env`, which every element
 * shares until the last has left; `w.Provider(options)` on the `w.*` element at the top names the root
 * the subtree options hang on.
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
 *   return w.div([h.Class("app")], [
 *     w.div([h.Class("card"), w.Initial({ opacity: 0, y: 8 }), w.Animate({ opacity: 1, y: 0 }), w.Transition({ duration: 0.3 })], [model.title]),
 *   ])
 * }
 *
 * @module
 */
import * as Stagger from "@wardic/core/Stagger"
import type * as WardicServices from "@wardic/core/unstable/WardicServices"
import type * as Feature from "@wardic/dom/unstable/Feature"
import type * as WardConfig from "@wardic/dom/unstable/WardConfig"
import type * as Layer from "effect/Layer"
import type * as FoldkitHtml from "foldkit/html"
import type { MountAction } from "foldkit/mount"
import * as Predicate from "effect/Predicate"
import type * as Ward from "./Ward.ts"
import { type Attributes, builderOf } from "./internal/builder.ts"
import { HANDLE, resourcesOf, type Wardic as WardicTag } from "./internal/commands.ts"
import { mountOf } from "./internal/mount.ts"
import { makeState, remember, type State } from "./internal/services.ts"

export { animate, type AnimateOptions, AnimationFailed, type AnimationEnd, provide, Wardic } from "./internal/commands.ts"

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
  /** The app-wide settings (ADR-0062; ADR-0071 decision 22): what `w.Config(…)` takes, under every subtree's. */
  readonly config?: Ward.ConfigOptions | undefined
}

/** A `w.*` element's function: `h.div`'s shape, taking Wardic's attributes too. */
export type ElementFunction<Message> = (attributes: Attributes<Message>, children?: ReadonlyArray<Ward.Child>) => FoldkitHtml.Html

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
  keyed: (tag: FoldkitHtml.TagName) => (key: string, attributes: Attributes<Message>, children?: ReadonlyArray<Ward.Child>) => FoldkitHtml.Html
  /**
   * The **Bundle** (ADR-0071, decision 18): a Ward's attributes for any element, `h.div([...w.attributes({ … })])`.
   * It takes the element's own Mount and fuses it with Wardic's, since one element has one `OnMount`.
   * An element it's on isn't stamped, so key such an element (P2).
   */
  attributes: (bundle: Ward.Bundle<Message>) => ReadonlyArray<FoldkitHtml.Attribute<Message> | FoldkitHtml.ChildAttribute>
  /**
   * The **Provider attribute** (decision 9, *Amendment (#791)*): on the `w.*` element at the top of the
   * view, when the subtree options (slice 2's) are wanted: that element is the root they hang on. With
   * none, the first `w.*` element to mount builds Wardic's services, shared until the last has left.
   */
  Provider: (options?: Ward.ProviderOptions) => Ward.Attribute
  /**
   * Where the element starts: values, or `false` to start at `Animate` (Motion's `initial`). Read once,
   * at mount, as Motion reads it: give the same `Initial` on every render, since a view renders it as
   * the element's Starting style, and a changed one would be written over what Wardic draws.
   */
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
  /**
   * Named targets `Initial`, `Animate` and the rest can name (Motion's `variants`). A child with
   * `Variants` and no `Animate` of its own follows the name its nearest Wardic ancestor hands down,
   * staggered by that ancestor's `Transition`.
   */
  Variants: (value: Ward.Config["variants"]) => Ward.Attribute
  /** What the element's dynamic variants resolve with (Motion's `custom`). */
  Custom: (value: Ward.Config["custom"]) => Ward.Attribute
  /** `false` keeps the element out of its ancestor's variants (Motion's `inherit`). */
  Inherit: (value: Ward.Config["inherit"]) => Ward.Attribute
  /** The subtree's settings (Motion's `MotionConfig`), this element's included, over the nearest ancestor's and the Handle's. */
  Config: (options: Ward.ConfigOptions) => Ward.Attribute
  /** Sent as an animation of the element starts, with what it animates to (Motion's `onAnimationStart`). */
  OnAnimationStart: (handler: Ward.Handler<Message, Ward.AnimationDefinition>) => Ward.Attribute
  /** Sent as that animation lands (Motion's `onAnimationComplete`); not for one a new target interrupted. */
  OnAnimationComplete: (handler: Ward.Handler<Message, Ward.AnimationDefinition>) => Ward.Attribute
  /**
   * The element's text, from an Atom, written outside the patch as it changes (a **Live value**, decision
   * 16): the element takes no children from the view, an error in development. Format with a derived Atom.
   */
  Text: (atom: Ward.Config["text"]) => Ward.Attribute
  /** The element's values each committed frame, set on a writable Atom (Motion's `onUpdate`): a copy per frame. */
  OnUpdate: (atom: Ward.Config["onUpdate"]) => Ward.Attribute
  /** The element's transform from its values and the generated string (Motion's `transformTemplate`). Hoist the function. */
  TransformTemplate: (template: Ward.Config["transformTemplate"]) => Ward.Attribute
  /**
   * Where the element animates to as it leaves, under a `w.Presence` above it (Motion's `exit`): values,
   * a variant name, or a dynamic variant resolved with the presence's `custom`. Its presence keeps it on
   * the page, in its place, until it lands.
   */
  Exit: (value: Ward.Config["exit"]) => Ward.Attribute
  /**
   * The **Presence** (ADR-0007; decision 29), on the leavers' parent: each child Foldkit removes stays
   * where it was while its `Exit` plays, in Motion's order through the patches that follow, and one that
   * comes back under its key mid-exit takes over from where the leaver is. Needs `Features.presence`.
   * Give it on the element's first render.
   */
  Presence: (options?: Ward.PresenceOptions<Message>) => Ward.Attribute
}>

/**
 * A **Handle**: one Wardic runtime inside a Foldkit program (ADR-0071, decision 9), typed by its
 * Features `F`. Made once, at module scope.
 */
export interface Handle<F = never> {
  /** The Handle's mark: what the `Wardic` service carries. */
  readonly [HANDLE]: true
  /** The builder `w` for a view's `h`, made once per `h`. */
  readonly html: <Message>(h: FoldkitHtml.HtmlBuilder<Message>) => Html<Message, F>
  /** The provider's raw Mount, for a Scene test to resolve by name (decision 36): `Scene.Mount.resolve(wardic.Provider, Done())`. */
  readonly Provider: MountAction<never>
  /** An element's raw Mount, for a Scene test to resolve by name (decision 36): one per `w.*` element in the view. */
  readonly Element: MountAction<never>
  /** A `w.Presence` element's raw Mount, for a Scene test to resolve by name (#792, Q19). */
  readonly Presence: MountAction<never>
  /**
   * The Layer a program's `resources` takes (decision 9): its Commands then run `Wardic.animate` and
   * `Wardic.provide`, which need the `Wardic` service, this Handle.
   */
  readonly resources: Layer.Layer<WardicTag>
}

/**
 * Makes a Handle on `env`, with `features` (above). One per program, at module scope: a second
 * `w.Provider()` for it while the first's element is mounted is reported and ignored.
 */
export const make = <const F extends Feature.InstanceFeaturesProp = never>(options: MakeOptions<F>): Handle<F> => {
  const state: State = makeState(options.env, options.features, options.config)
  // Made once per `h` (decision 18): as `===`-stable as `h` is, for `createLazy`.
  const builders = new WeakMap<object, object>()
  const html = <Message>(h: FoldkitHtml.HtmlBuilder<Message>): Html<Message, F> => {
    const known = builders.get(h)
    if (Predicate.isNotUndefined(known)) return known as Html<Message, F>
    const made = builderOf(state, h)
    builders.set(h, made)
    return made as Html<Message, F>
  }
  const handle: Handle<F> = {
    [HANDLE]: true,
    html,
    Provider: mountOf<never>(state, { provider: {}, user: undefined, presence: false }),
    Element: mountOf<never>(state, { provider: undefined, user: undefined, presence: false }),
    Presence: mountOf<never>(state, { provider: undefined, user: undefined, presence: true }),
    resources: resourcesOf(() => handle),
  }
  remember(handle, state)
  return handle
}

/** `stagger(duration, options)`'s options (#436, Motion's `stagger`): `startDelay`, `from` and `ease`, core's. */
export type StaggerOptions = Stagger.Options

/**
 * A stagger for a transition's `delayChildren`, or an `animate`'s `delay` (Motion's `stagger`): `duration`
 * seconds between children, from `options.from`, after `options.startDelay`.
 */
export const stagger = (duration = 0.1, options: StaggerOptions = {}): WardConfig.WardicStagger => Stagger.make(duration, options)
