/**
 * The **Complete element**'s own code on Solid 2 (#511, ADR-0067; #548): what tells a ward it brings
 * every Feature, and `ward()`, the Complete ward. In a module of its own, apart from the ward every
 * element shares, so an app whose pages use the Slim element (`w.*`) ships no Feature from here, even
 * when one of them uses a Complete element (ADR-0067, *Amendment (#548)*).
 *
 * @module
 */
import * as All from "@wardic/dom/unstable/features/All"
import type { Accessor } from "solid-js"
import type { StageSubject, StageWard, StageWardChecked, StageWardConfig } from "./stage.ts"
import type { Ward, WardChecked, WardConfig, WardInternals, WardOptions } from "./ward.tsx"
import { type HeldWard, wardFrom } from "./ward-first.ts"

/**
 * What a **Complete element** tells its ward (#511, ADR-0067): it brings every Feature. Its forms'
 * (`ward()`, `wardic.*`, `wardic.create`) alone: a Slim element's never name it.
 */
export const COMPLETE: WardInternals = { brings: All.ALL, complete: true }

/**
 * Makes a ward: Wardic's motion for an element of your own. Spread it on the element, `{...card}`, or
 * give it to a Wardic element's `wardRef`. Each key of `config` is a value or an accessor of it.
 * `card.read(key)` reads what the element shows, and `card.next("tap")`, `card.when("tap")` hear its
 * events. With no config, it only listens. This one has every Feature; `w.ward` has its section's.
 *
 * @example
 * const card = ward({ initial: { opacity: 0 }, animate: { opacity: 1 } })
 * <article {...card} />
 * @see https://wardic.dev/reference/solid/elements/ward
 */
// `config` is read per key (#259): a value, an accessor, a getter, a store's property or a component's
// prop (`ward(props)`). Made where you'd make a signal, under a WardicProvider. Its config's type is
// kept, so `read` and `atom` complete the keys it animates. With no config (#398) it listens: spread on
// a plain element, its gestures' events with no motion; given to `wardRef`, the element's props set it.
// A Complete element (#511).
/** Its Subject first (#884): `ward(el, config)` is `ward(config)(el)`, with `held`. */
export function ward<const C extends WardConfig>(subject: Element, config: WardChecked<C>, options?: WardOptions): HeldWard<Ward<C>>
/** A Stage's Subject first, under a `<WardicStage>` (#884): the Stage's ward. */
export function ward<const C extends WardConfig | StageWardConfig>(subject: StageSubject | Accessor<StageSubject | undefined>, config: StageWardChecked<C>, options?: WardOptions): StageWard<C>
// The config first, last of the generic forms, so `ReturnType<typeof ward<C>>` is still a DOM ward.
export function ward<const C extends WardConfig>(config: WardChecked<C>, options?: WardOptions): Ward<C>
export function ward(): Ward<{}>
// Last, so `ReturnType<typeof ward>` is too.
export function ward(config: undefined, options: WardOptions): Ward<{}>
// Overloads, not an optional `config` (#398): a default for `C` left an accessor's literal untyped
// (`transition: () => ({ type: "tween" })` read `type` as a string), as `C` fell back to it.
export function ward(first?: unknown, second?: unknown, third?: unknown): Ward | HeldWard<Ward> | StageWard {
  return wardFrom(first, second, third, COMPLETE)
}
