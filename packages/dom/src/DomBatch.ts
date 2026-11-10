/**
 * The DOM's writer for a Batch: each moving member's `transform` and `opacity`, written onto its
 * element's style as Wardic's renderer draws the same values. A Batch's keys on the DOM are the
 * transform keys (`x`, `y`, `z`, `translateX/Y/Z`, `scale`, `scaleX/Y`, `rotate`, `rotateX/Y/Z`,
 * `skewX/Y`) and `opacity`, as numbers.
 *
 * @example
 * import * as Batch from "@wardic/core/Batch"
 * import * as DomBatch from "@wardic/dom/DomBatch"
 *
 * const grid = Batch.make({ keys: ["x", "y", "opacity"], writer: DomBatch.writer, transition: { type: "spring" } })
 */
// `@wardic/dom/DomBatch` (#665, ADR-0070 *Amendment (#665)*): the DOM's implementation of core's
// `Batch.Writer`, Dom-prefixed as `DomRenderer` is, its member without the module's noun (ADR-0041).
// Not in `DomLive`: a binding's `createBatch` imports it, so an app that never makes a Batch ships none.
export { writer } from "./internal/batch-writer.ts"
