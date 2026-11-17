/**
 * A **Ward** on Foldkit (ADR-0071): the types of what a `w.*` element and the `w.attributes` bundle
 * take. Wardic's attributes are a type of their own, beside Foldkit's `Attribute<Message>`, which is
 * a closed `Data.TaggedEnum` (#791, Q6): a `w.*` element takes both, and `h.div` takes Foldkit's alone,
 * so a Wardic attribute given to a plain element is a type error.
 *
 * @module
 */
import type * as WardConfig from "@wardic/dom/unstable/WardConfig"
import type { Html } from "foldkit/html"
import type { MountAction } from "foldkit/mount"
import * as Predicate from "effect/Predicate"

/** The mark of a Wardic attribute: a symbol, so no Foldkit `_tag` is ever mistaken for one. */
export const TypeId: unique symbol = Symbol.for("@wardic/foldkit/Ward.Attribute")
export type TypeId = typeof TypeId

/** The keys of an element's config a Wardic attribute sets (slice 1's; the rest come with the later slices). */
export type Key = "initial" | "animate" | "transition" | "style"

/**
 * An element's `style` as Wardic sees it (Motion's `style`): every CSS property and the transform keys
 * (`x`, `scale`, `rotate`, …), each a value: the element's base values, where a key returns when
 * nothing animates it. Live values (Atoms) join in slice 1's PR 3.
 */
export type Style = { readonly [K in keyof WardConfig.WardicValues]?: WardConfig.WardicValues[K] }

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
 * An element's config in slice 1: where it starts, where it animates to, how, and its `style`, whose
 * values are its base values (dom's `WardConfig`'s, Motion's props). Each key is typed on its own
 * (#791, Q17): nothing is inferred across attributes.
 */
export interface Config extends Pick<WardConfig.WardConfig, Exclude<Key, "style">> {
  readonly style?: Style | undefined
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
export interface Bundle<Message> extends Config {
  readonly mount?: MountAction<Message> | undefined
}
