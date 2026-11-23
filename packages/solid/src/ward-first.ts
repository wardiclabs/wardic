/**
 * `ward`'s forms with its Subject first (ADR-0073 decision 8; *Amendment (#884)*, Q4 and Q8): an element,
 * the Stage's Subject, or an accessor of one, then its config. `ward(el, config)` is `ward(config)(el)`,
 * with `held`; a Subject the Stage in context says is its own, or any accessor under a Stage, is the
 * Stage's ward. Anything else first is a config, so `ward(config, { parent })` keeps its meaning.
 *
 * @module
 */
// #884's PR 3. The DOM's ward (`wardWith`) is untouched: a Stage's Subject goes to the Stage's own ward,
// so the DOM's bundle carries this hand-off and nothing of a Stage's.
import type { JSX } from "@solidjs/web"
import * as Arr from "effect/Array"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import { DEV, useContext } from "solid-js"
import { type StageWard, WardicStage } from "./stage.ts"
import { heldOf, internalsOf, type Ward, type WardConfig, type WardInternals, wardWith, type WardOptions } from "./ward.tsx"

/** No config: a ward that only listens. */
const NO_CONFIG: WardConfig = {}

/** A ward made Subject first on an element: the ward, with `held`. */
export type HeldWard<W> = W & { readonly held: JSX.Element }

/** Whether `value` is an element, by its `nodeType`. */
const isElement = (value: unknown): value is Element => Predicate.hasProperty(value, "nodeType")

/** Whether `value` carries a three.js-style flag, an own `is…` key set `true`: a scene's Subject, which needs a Stage. */
const isFlagged = (value: unknown): boolean =>
  Predicate.isObject(value) && Arr.some(Rec.keys(value as Readonly<Record<string, unknown>>), (key) => /^is[A-Z]/.test(key) && (value as Readonly<Record<string, unknown>>)[key] === true)

/** A scene's Subject given to `ward` with no Stage above it. */
const NO_STAGE =
  "ward(subject, config): its Subject is a scene's (an object with an `is…` flag, as three.js's are), and no <WardicStage> is above it. " +
  "Give the scene's Stage to its tree, <WardicStage value={stage}>, or call the Stage itself, stage.ward(subject, config)."

/** `ward` made Subject first on `el`: `ward(config)(el)`, with `held`. */
const onElement = (el: Element, config: WardConfig, options: WardOptions | undefined, kind: WardInternals): HeldWard<Ward> => {
  const made = wardWith(config, internalsOf(options, kind))
  made(el as HTMLElement)
  return Object.defineProperty(made, "held", { value: heldOf(made) }) as HeldWard<Ward>
}

/** An accessor first with no Stage above: on the page, a ward given to `ref` follows each element. */
const NO_STAGE_ACCESSOR =
  "ward(subject, config): an accessor Subject is a Stage's, and no <WardicStage> is above it. On the page, give the ward to the element's `ref`, which follows each element it's given: <div ref={card} />."

/**
 * The ward `ward(first, second, third)` makes for a `kind` of element (Complete or Slim): its Subject
 * first, or its config.
 */
// Per ward made: plain checks, cheapest first, a config's path two of them and the context's read.
export const wardFrom = (first: unknown, second: unknown, third: unknown, kind: WardInternals): Ward | HeldWard<Ward> | StageWard => {
  if (Predicate.isUndefined(first)) return wardWith(NO_CONFIG, internalsOf(second as WardOptions | undefined, kind))
  if (isElement(first)) return onElement(first, second as WardConfig, third as WardOptions | undefined, kind)
  // A whole accessor as the config, with nothing after it: the ward's own error (WHOLE_ACCESSOR) says so.
  if (Predicate.isFunction(first) && Predicate.isUndefined(second)) return wardWith(first as WardConfig, internalsOf(undefined, kind))
  const stage = useContext(WardicStage)
  if (Predicate.isNotNull(stage)) {
    if (Predicate.isFunction(first) || stage.isSubject(first)) return stage.ward(first, second as WardConfig, third as WardOptions | undefined)
  }
  // An accessor is a scene's Subject (ADR-0073 decision 10): a ward given to `ref` follows a page's
  // elements. Said in development; in production the ward's own error for a function config is thrown.
  if (DEV && Predicate.isFunction(first)) throw new Error(NO_STAGE_ACCESSOR)
  if (DEV && isFlagged(first)) throw new Error(NO_STAGE)
  return wardWith(first as WardConfig, internalsOf(second as WardOptions | undefined, kind))
}
