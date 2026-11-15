/**
 * How an Environment reads a value that names a variable it resolves when it draws (**Variable
 * value**): whether a value is one, and a Subject's Key rule, which blends a pair with one at either
 * end by what it resolves to there. One of the Environment's optional members. An Environment that isn't the DOM gives
 * one (`@wardic/test`'s `TestLive` a headless one); a DOM binding falls back to
 * `@wardic/dom/unstable/DomValues`' when its Environment gives none, so an app that never reads it
 * ships none of the DOM's.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672 (PR2-Q1, PR2-Q2; ADR-0071's *Amendment (#672)*): a port, so the
// spine reads its Environment's variables through it, not through dom (#55, ADR-0035).
import * as Context from "effect/Context"
import type * as InterpolatorRegistry from "../InterpolatorRegistry.ts"

/** An Environment's reads of its Subjects' Variable values. */
export interface Shape {
  /** Whether `value` names a variable the Environment resolves when it draws. */
  readonly isValue: (value: unknown) => boolean
  /** `subject`'s Key rule for its Variable values: it takes a pair with one at either end, and declines every other. */
  readonly values: (subject: object) => InterpolatorRegistry.KeyRule
}

/** The Environment's member that reads its Subjects' Variable values. */
export class VariableValues extends /*#__PURE__*/ Context.Service<VariableValues, Shape>()("@wardic/core/unstable/VariableValues") {}
