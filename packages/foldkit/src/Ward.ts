/**
 * A **Ward** on Foldkit (ADR-0071): the types of what a `w.*` element and the `w.attributes` bundle
 * take. Wardic's attributes are a type of their own, beside Foldkit's `Attribute<Message>`, which is
 * a closed `Data.TaggedEnum` (#791, Q6): a `w.*` element takes both, and `h.div` takes Foldkit's alone,
 * so a Wardic attribute given to a plain element is a type error.
 *
 * @module
 */
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import type * as CoreConfig from "@wardic/core/unstable/Config"
import type * as LayoutGroup from "@wardic/dom/unstable/LayoutGroup"
import type * as PresenceController from "@wardic/dom/unstable/PresenceController"
import type * as WardConfig from "@wardic/dom/unstable/WardConfig"
import type { Html } from "foldkit/html"
import type { MountAction } from "foldkit/mount"
import type * as Values from "@wardic/core/Values"
import type * as DomRenderer from "@wardic/dom/DomRenderer"
import type * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import type * as Atom from "effect/reactivity/Atom"

/** The mark of a Wardic attribute: a symbol, so no Foldkit `_tag` is ever mistaken for one. */
export const TypeId: unique symbol = Symbol.for("@wardic/foldkit/Ward.Attribute")
export type TypeId = typeof TypeId

/** The keys of an element's config a Wardic attribute sets (slices 1 and 2's; the rest come with the later slices). */
export type Key =
  | "initial"
  | "animate"
  | "transition"
  | "style"
  | "variants"
  | "custom"
  | "inherit"
  | "config"
  | "animationStart"
  | "animationComplete"
  | "text"
  | "onUpdate"
  | "transformTemplate"
  | "exit"
  | "presence"
  | "key"
  | "layout"
  | "layoutId"
  | "layoutDependency"
  | "layoutScroll"
  | "layoutRoot"
  | "layoutGroup"
  | "layoutAnimationStart"
  | "layoutAnimationComplete"
  | "onBeforeLayoutMeasure"
  | "onLayoutMeasure"

/**
 * A callback as a Message (ADR-0071, decision 23), in Foldkit's two handler shapes: a Message, sent
 * as it is, or a function of what the callback is told, giving a Message, or an `Option` of one, where
 * `Option.none()` sends nothing.
 */
export type Handler<Message, A> = Message | ((value: A) => Message | Option.Option<Message>)

/** What `w.OnAnimationStart` and `w.OnAnimationComplete` are told: the variant name, or the values, the animation went to (Motion's). */
export type AnimationDefinition = CoreConfig.WardicAnimationDefinition

/**
 * A subtree's settings (ADR-0062, Motion's `MotionConfig`; ADR-0071 decision 22): `w.Config(…)` on an
 * element, over the nearest ancestor's, over the Handle's `config`. Each is read when an animation
 * starts, so a change moves nothing by itself.
 */
export interface ConfigOptions {
  /** The **Config transition**: what an element with no `transition` of its own runs on. */
  readonly transition?: WardConfig.WardicVariantTransition | undefined
  /** Reduced motion (ADR-0029): `"user"` follows the preference, `"always"` and `"never"` decide. */
  readonly reducedMotion?: ReducedMotion.Config | undefined
  /** Whether every animation lands at once (#468, Motion's `MotionGlobalConfig.skipAnimations` for a subtree). */
  readonly skipAnimations?: boolean | undefined
}

/**
 * An element's `style` as Wardic sees it (Motion's `style`): every CSS property and the transform keys
 * (`x`, `scale`, `rotate`, …), each a value or a **Live value**, an `effect/reactivity` Atom, followed
 * through the gate (ADR-0043). A value is the element's base value, where a key returns when nothing
 * animates it. Atoms alone are Live here (#791, Q4): a function is a development error.
 */
export type Style = { readonly [K in keyof WardConfig.WardicValues]?: WardConfig.WardicValues[K] | Atom.Atom<WardConfig.WardicValues[K]> }

/** What `w.OnUpdate(atom)` sets each committed frame: the element's values before projection, a copy per frame (#791, Q6). */
export type Latest = Values.Values

/**
 * A Wardic attribute: what `w.Initial(…)`, `w.Animate(…)`, `w.Transition(…)`, `w.Style(…)` and
 * `w.Provider(…)` return, for a `w.*` element's attribute list. The last of a repeated one wins, as
 * Foldkit's second `h.Style` replaces the first.
 */
export interface Attribute {
  readonly [TypeId]: Key | "provider"
  readonly value: unknown
}

/** Whether `value` is a Wardic attribute. */
export const isAttribute = (value: unknown): value is Attribute => Predicate.hasProperty(value, TypeId)

/** A `w.*` element's child, as `h.div`'s: an element, nothing, or text. */
export type Child = Html | string

/**
 * `w.Presence(options)`'s options (ADR-0071 decision 29; Motion's `AnimatePresence` props, `@wardic/solid`'s
 * `AnimatePresence`'s), on the leavers' parent. Each is read as it's needed: `mode` and
 * `presenceAffectsLayout` at each change, `custom` and the anchors as a child leaves, `initial` as a
 * child mounts, `propagate` once.
 */
export interface PresenceOptions<Message = never> {
  /**
   * How a change with a leaver goes: `"sync"` (the default), the entering child beside the leaver at
   * once; `"popLayout"`, the leaver popped out of the flow where it was, so its siblings take their
   * places at once; `"wait"`, the entering child held off the page, hidden, until the last leaver is gone.
   */
  readonly mode?: PresenceController.PresenceMode | undefined
  /** `false`: the children present at the presence's first render start at their `Animate`; one entering later animates in (Motion's `initial`). */
  readonly initial?: boolean | undefined
  /** What a leaving child's dynamic `Exit` resolves with (Motion's `custom`), over the child's own `Custom`. */
  readonly custom?: unknown
  /** Sent once every leaver has animated out and been removed, the last by completing (Motion's `onExitComplete`). Not under replay. */
  readonly onExitComplete?: Handler<Message, void> | undefined
  /** Whether a child's going and coming moves the `layout` elements around it (Motion's prop); `true` by default. */
  readonly presenceAffectsLayout?: boolean | undefined
  /** Motion's `propagate`: inside another presence's child, when that child leaves, these children all leave too, and it goes once they've gone. */
  readonly propagate?: boolean | undefined
  /** Where `"popLayout"` pins a leaver (Motion's): by its inline start or end; the start by default. */
  readonly anchorX?: PresenceController.PopAnchors["x"] | undefined
  /** Where `"popLayout"` pins a leaver: by its top or bottom; the top by default. */
  readonly anchorY?: PresenceController.PopAnchors["y"] | undefined
}

/**
 * `w.LayoutGroup(options)`'s options (#432; Motion's `LayoutGroup`, ADR-0071 decision 22): a namespace
 * for the `layoutId`s under the element, read once as the first of them mounts.
 */
export interface LayoutGroupOptions {
  /** An id put before every `layoutId` under it: under `{ id: "tabs" }`, a `LayoutId("underline")` is `tabs-underline`. */
  readonly id?: string | undefined
  /** Whether it joins the id of the group above it: `true` (the default) and `"id"` both do, `outer-inner`; `false` starts afresh. */
  readonly inherit?: LayoutGroup.LayoutGroupInherit | undefined
}

/**
 * An element's config: where it starts, where it animates to, how, where it exits to, its layout, and
 * its `style`, whose values are its base values (dom's `WardConfig`'s, Motion's props). Each key is
 * typed on its own (#791, Q17): nothing is inferred across attributes.
 */
export interface Config<Message = never>
  extends Pick<WardConfig.WardConfig, "initial" | "animate" | "transition" | "variants" | "custom" | "inherit" | "exit" | "layout" | "layoutId" | "layoutDependency" | "layoutScroll" | "layoutRoot" | "onBeforeLayoutMeasure" | "onLayoutMeasure"> {
  readonly style?: Style | undefined
  /** `w.LayoutGroup(…)`: the namespace of the `layoutId`s under the element (decision 30). */
  readonly layoutGroup?: LayoutGroupOptions | undefined
  /** `w.OnLayoutAnimationStart(…)`: sent at the frame a layout animation's first step is painted (Motion's `onLayoutAnimationStart`). */
  readonly layoutAnimationStart?: Handler<Message, void> | undefined
  /** `w.OnLayoutAnimationComplete(…)`: sent once it has landed (Motion's `onLayoutAnimationComplete`). */
  readonly layoutAnimationComplete?: Handler<Message, void> | undefined
  /** `w.Presence(…)`: the element's children exit before they're removed (decision 29). */
  readonly presence?: PresenceOptions<Message> | undefined
  /** The element's key, as `w.keyed(tag)(key, …)` gave it: what a child re-entering a presence during its exit takes over its leaver by (#286). */
  readonly key?: string | undefined
  /** `w.Config(…)`: the subtree's settings, this element's included. */
  readonly config?: ConfigOptions | undefined
  /** `w.OnAnimationStart(…)`: sent as an animation of the element starts (Motion's `onAnimationStart`). */
  readonly animationStart?: Handler<Message, AnimationDefinition> | undefined
  /** `w.OnAnimationComplete(…)`: sent as it lands, once every value it moves has settled; not for one a new target interrupted. */
  readonly animationComplete?: Handler<Message, AnimationDefinition> | undefined
  /** `w.Text(atom)`: the element's text, written outside the patch as the Atom changes (decision 16). */
  readonly text?: Atom.Atom<string | number> | undefined
  /** `w.OnUpdate(atom)`: set to the element's values each committed frame (decision 24, Motion's `onUpdate`). */
  readonly onUpdate?: Atom.Writable<Latest> | undefined
  /** `w.TransformTemplate(fn)`: the element's transform from its values and the generated string (Motion's). Hoist it: it's followed by reference. */
  readonly transformTemplate?: DomRenderer.TransformTemplate | undefined
}

/**
 * `w.Provider(options)`'s options (#791, Q16): none in slice 1. Slice 2's `layoutTrigger` and what comes
 * after join here, so the attribute's shape doesn't change.
 */
export interface ProviderOptions {}

/**
 * What `w.attributes(bundle)` takes: an element's {@link Config}, and the element's own Mount, which the
 * bundle fuses with Wardic's, since a second `h.OnMount` replaces the first on Foldkit 0.170 and throws
 * on its preview (ADR-0071, decision 18).
 */
export interface Bundle<Message> extends Config<Message> {
  readonly mount?: MountAction<Message> | undefined
}
