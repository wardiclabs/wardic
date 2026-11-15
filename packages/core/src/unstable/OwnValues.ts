/**
 * How an Environment reads a Subject's own values (**Own value**): a raw value in the shape of a
 * target, a key's value in the style a binding was given for its Subject, and that style as a record.
 * One of the Environment's optional members. An Environment other than `@wardic/dom`'s gives
 * one (`@wardic/test`'s `TestLive` a headless one); a binding on `@wardic/dom` falls back to
 * `@wardic/dom/unstable/DomValues`' when its Environment gives none, so an app that never reads it
 * ships none of that code.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672 (PR2-Q1, PR2-Q2; ADR-0071's *Amendment (#672)*): a port, so the
// spine and `live-style` read their Environment's values through it, not through dom. A provider
// resolves it once into its record when its Environment gives one, else its DOM binding gives the
// DOM's (PR2-Q4: so `DomLive` ships none of it to an app that never reads it); each element's spine gets it in its options. Each member is a plain
// function: `valueLike` runs on a Follow leg's every step.
import * as Context from "effect/Context"
import type * as Option from "effect/Option"

/** An Environment's reads of its Subjects' own values. */
export interface Shape {
  /** `raw` in the shape of `like`: a number for a number, a string with `like`'s unit for a string; none when it can't be read so. */
  readonly valueLike: (raw: unknown, like: number | string) => Option.Option<number | string>
  /** `key`'s value in `style`, the style a binding was given for its Subject: an object, or the Environment's text form. */
  readonly styleValueOf: (style: object | string | undefined, key: string) => Option.Option<unknown>
  /** `style` as a record: an object as it is, the Environment's text form read into one, none as an empty one. */
  readonly recordOf: (style: object | string | undefined) => Readonly<Record<string, unknown>>
}

/** The Environment's member that reads its Subjects' own values. */
export class OwnValues extends /*#__PURE__*/ Context.Service<OwnValues, Shape>()("@wardic/core/unstable/OwnValues") {}
