/**
 * Measured pairs: a key that places or sizes the box, whose two ends are lengths of different types,
 * `"auto"` against px, `"50%"` against a number, a `calc()`, can't blend as written. Both ends are
 * measured in px at the end of the task that asks, as Motion's are, so the animation runs between them
 * and lands on its target as given.
 *
 * @example
 * import * as MeasuredPair from "@wardic/dom/MeasuredPair"
 *
 * MeasuredPair.needs("width", "auto", 200) // true
 * MeasuredPair.needs("opacity", 0, 1) // false
 */
// **Measured pairs** (#430, CONTEXT.md, Motion's `DOMKeyframesResolver`). `@wardic/dom/MeasuredPair`: for
// binding authors.
import type * as Values from "@wardic/core/Values"
import { measure as measureFor, measured, type Requested } from "./internal/measured-pairs.ts"

export { measured, type Measured, needs, type Requested } from "./internal/measured-pairs.ts"

/**
 * Measures `pairs` on `element` at the end of this task, with every other element's in the same batch:
 * each pair, as asked, {@link measured} before the next tick. `values` are what the element draws now,
 * its other transforms among them. If writing them throws (a Transform template among `values`), its
 * pairs are never measured, the throw is reported to the page as an uncaught one is, and the rest of the
 * batch goes on.
 */
// #979, row 8 (ADR-0074): Wardic's own askers tell the batch's throw to their runtime (`DomValues`' port).
export const measure = (
  element: HTMLElement,
  pairs: Readonly<Record<string, { readonly from: number | string; readonly to: number | string }>>,
  values: Values.Values,
): Readonly<Record<string, Requested>> => measureFor(element, pairs, values, reportToPage)

/** A request's throw, with no runtime to tell: the page's. */
const reportToPage = (defect: unknown): void => globalThis.reportError(defect)
