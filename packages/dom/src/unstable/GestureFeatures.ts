/**
 * What an element reads of its section's gesture Features (#511, ADR-0067 decision 3): each gesture's
 * service, `undefined` without its Feature, the gestures' input a section with one has, the words
 * development's message on a missing one names, and which gestures a config wants (Motion's feature
 * definitions). Every binding's; it reaches no Feature's code, only their keys.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672: solid's `gesture-features.ts`, moved to dom with the Features.
import * as InputSource from "@wardic/core/InputSource"
import type * as Recognizer from "@wardic/core/Recognizer"
import * as Context from "effect/Context"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"

/** `key`'s service among `services`, or `undefined` when they hold none: its Feature isn't there. */
export const serviceIn = <I, S>(services: Context.Context<never>, key: Context.Key<I, S>): S | undefined =>
  Option.getOrUndefined(Context.getOption(services as Context.Context<I>, key))

/** The gestures' input among `services`: a section with any gesture Feature but `inView` has it. */
export const inputIn = (services: Context.Context<never>): InputSource.InputSource["Service"] =>
  Context.get(services as Context.Context<InputSource.InputSource>, InputSource.InputSource)

/** What development's word on a missing gesture Feature names, by Feature: what the element asked of it. */
export const GESTURE_WORDS = {
  hover: "Its hover (`whileHover`, or a hover event)",
  press: "Its press (`whileTap`, or a tap event)",
  focus: "Its focus (`whileFocus`)",
  inView: "Its view (`whileInView`, or a viewport event)",
  pan: "Its pan (a pan event)",
  drag: "Its drag (`drag`)",
} as const

/** Whether `services` hold `key`'s service: its Feature is there. */
export const hasService = <I, S>(services: Context.Context<never>, key: Context.Key<I, S>): boolean => Option.isSome(Context.getOption(services as Context.Context<I>, key))

/** `key`'s service among `services`, which hold it: a Feature a hook or component brought. */
export const serviceOf = <I, S>(services: Context.Context<never>, key: Context.Key<I, S>): S => Context.get(services as Context.Context<I>, key)

/**
 * The keys a gesture is wanted by (Motion's `features/definitions.ts`): every binding's config has
 * them, its callbacks in its own shape (Solid 1's functions, Foldkit's Messages), so only their presence
 * is read.
 */
export interface GestureWants {
  readonly whileHover?: unknown
  readonly onHoverStart?: unknown
  readonly onHoverEnd?: unknown
  readonly whileTap?: unknown
  readonly onTap?: unknown
  readonly onTapStart?: unknown
  readonly onTapCancel?: unknown
  readonly onPan?: unknown
  readonly onPanStart?: unknown
  readonly onPanSessionStart?: unknown
  readonly onPanEnd?: unknown
  readonly whileInView?: unknown
  readonly onViewportEnter?: unknown
  readonly onViewportLeave?: unknown
  readonly whileFocus?: unknown
}

/**
 * Every key the `wants*` below read (#525): an element given none of them, its keys fixed, can never
 * want a gesture, so it starts no computation to watch for one. Solid's `gesture-keys.ssr.test.tsx`
 * checks each of them turns its gesture on.
 */
// #793 (PR 1's review): solid's `gesture-callbacks.ts`'s, moved to dom for every binding's gesture start.
export const GESTURE_KEYS = [
  "whileHover",
  "onHoverStart",
  "onHoverEnd",
  "whileTap",
  "onTap",
  "onTapStart",
  "onTapCancel",
  "onPan",
  "onPanStart",
  "onPanSessionStart",
  "onPanEnd",
  "whileInView",
  "onViewportEnter",
  "onViewportLeave",
  "whileFocus",
] as const satisfies ReadonlyArray<keyof GestureWants>

/**
 * Whether `config` runs the hover recognizer (Motion's hover feature). Read at every config change of
 * an element that doesn't run it yet: statement `if`s, no array (ADR-0025).
 */
export const wantsHover = (config: GestureWants): boolean => {
  if (Predicate.isNotUndefined(config.whileHover)) return true
  if (Predicate.isNotUndefined(config.onHoverStart)) return true
  return Predicate.isNotUndefined(config.onHoverEnd)
}

/** Whether `config` runs the press recognizer (Motion's tap feature): as {@link wantsHover}. */
export const wantsPress = (config: GestureWants): boolean => {
  if (Predicate.isNotUndefined(config.whileTap)) return true
  if (Predicate.isNotUndefined(config.onTap)) return true
  if (Predicate.isNotUndefined(config.onTapStart)) return true
  return Predicate.isNotUndefined(config.onTapCancel)
}

/** Whether `config` runs the pan recognizer (Motion's pan feature, #273): as {@link wantsHover}. */
export const wantsPan = (config: GestureWants): boolean => {
  if (Predicate.isNotUndefined(config.onPan)) return true
  if (Predicate.isNotUndefined(config.onPanStart)) return true
  if (Predicate.isNotUndefined(config.onPanSessionStart)) return true
  return Predicate.isNotUndefined(config.onPanEnd)
}

/** Whether `config` runs the in-view recognizer (Motion's inView feature, #273): `whileInView` or a viewport callback. */
export const wantsInView = (config: GestureWants): boolean => {
  if (Predicate.isNotUndefined(config.whileInView)) return true
  if (Predicate.isNotUndefined(config.onViewportEnter)) return true
  return Predicate.isNotUndefined(config.onViewportLeave)
}

/** Whether `config` runs the focus recognizer (Motion's focus feature, #273): `whileFocus`. */
export const wantsFocus = (config: GestureWants): boolean => Predicate.isNotUndefined(config.whileFocus)

/** Each press phase's callback (Motion's `onTapStart`, `onTap`, `onTapCancel`): a press a drag took over has none, as Motion tells neither. */
export const PRESS_CALLBACK = { start: "onTapStart", tap: "onTap", cancel: "onTapCancel", dragged: undefined } as const

/** Motion's `amount` as a share of the element: `"some"` any of it, `"all"` all of it; a number as it is. Built once. */
export const amountOf: (amount: "some" | "all" | number | undefined) => number | undefined = Match.type<"some" | "all" | number | undefined>().pipe(
  Match.when("some", () => 0),
  Match.when("all", () => 1),
  Match.orElse((share) => share),
)

/** Motion's `viewport` as a binding holds it: dom's `WardicViewport`, or Foldkit's with its root resolved into an accessor. */
export interface ViewportLike {
  readonly once?: boolean | undefined
  readonly margin?: string | undefined
  readonly amount?: "some" | "all" | number | undefined
  readonly root?: (() => Element | undefined) | undefined
}

/** Motion's `viewport` as core's in-view options (#273): its root read now, when the recognizer starts. */
export const inViewOptionsOf = (viewport: ViewportLike | undefined): Recognizer.InViewOptions =>
  UndefinedOr.match(viewport, {
    onUndefined: () => ({}),
    onDefined: (v) => ({
      once: v.once,
      margin: v.margin,
      amount: amountOf(v.amount),
      ...UndefinedOr.match(v.root, { onUndefined: () => ({}), onDefined: (root) => ({ root: root() }) }),
    }),
  })
