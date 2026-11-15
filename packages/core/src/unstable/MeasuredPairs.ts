/**
 * How an Environment measures a key whose two ends are in units its interpolators can't blend
 * (**Measured pair**): whether a pair needs it, and its measure, whose result each pair reads once
 * it's done. One of the Environment's optional members. An Environment that isn't the DOM gives
 * one (`@wardic/test`'s `TestLive` a headless one); a DOM binding falls back to
 * `@wardic/dom/unstable/DomValues`' when its Environment gives none, so an app that never reads it
 * ships none of the DOM's.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672 (PR2-Q1, PR2-Q2; ADR-0071's *Amendment (#672)*): a port, so the
// spine reads its Environment's measures through it, not through dom. A pair carries the read of its
// result, so the legs that run it need no port of their own.
import * as Context from "effect/Context"
import type * as Option from "effect/Option"
import type * as Values from "../Values.ts"

/** A key's pair: its two ends, as given. */
export interface Pair {
  readonly key: string
  /** Its start, as given. */
  readonly from: number | string
  /** Its target, as given. */
  readonly to: number | string
}

/** A pair asked to be measured, which reads its result once it's done. */
export interface Requested extends Pair {
  /** Its ends in px, once measured; none before, or when they couldn't be read. */
  readonly measured: () => Option.Option<Measured>
}

/** A pair, measured. */
export interface Measured extends Pair {
  /** Its start in px. */
  readonly fromPx: number
  /** Its target in px. */
  readonly toPx: number
}

/** An Environment's measures of its Subjects' pairs. */
export interface Shape {
  /** Whether `key` from `from` to `to` needs its pair measured: its ends in units that don't blend. */
  readonly needs: (key: string, from: number | string, to: number | string) => boolean
  /** Asks `pairs` measured on `subject`, at `values`: each key's pair, whose result it reads once it's done. */
  readonly measure: (
    subject: object,
    pairs: Readonly<Record<string, { readonly from: number | string; readonly to: number | string }>>,
    values: Values.Values,
  ) => Readonly<Record<string, Requested>>
}

/** The Environment's member that measures its Subjects' pairs. */
export class MeasuredPairs extends /*#__PURE__*/ Context.Service<MeasuredPairs, Shape>()("@wardic/core/unstable/MeasuredPairs") {}
