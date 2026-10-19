/**
 * Scroll offsets, the DOM's (#234, ADR-0043 *Amendment (#233, #234)*): Motion's syntax for where a
 * target's progress through its scroll container runs, which the DOM's `Probe.scroll` resolves
 * (`internal/scroll.ts`). Core takes an offset as its Environment's own and passes it through, so the
 * syntax, its names and its units are the DOM's alone.
 *
 * - **An edge** is a name (`start`, `center`, `end`), a fraction of a length (`0.5`), or a CSS length:
 *   `"100px"` a distance, `"50%"` a fraction, `"10vw"` / `"10vh"` a share of the viewport.
 * - **A stop** is a pair of edges, `[target, container]`: the scroll position where the target's
 *   edge meets the container's. A string holds both (`"start end"`); one edge alone is both for a
 *   name or a number (`"end"`, `0.5`), else the target's against the container's start (`"100px"`).
 * - **An offset** is two stops or more: progress runs from 0 at the first to 1 at the last, evenly
 *   between them, clamped.
 *
 * `@wardic/dom/ScrollOffset` (ADR-0041): the type a binding gives its `scroll` helper's `offset`.
 */

/** One edge of a stop: a name, a fraction, or a CSS length (see the module's doc). */
export type Edge = string | number

/** One stop: `[target edge, container edge]`, a string of both, or one edge. */
export type Stop = Edge | readonly [Edge, Edge]

/** Where a target's progress runs: two stops or more. */
export type ScrollOffset = ReadonlyArray<Stop>

/** Motion's presets: while the target comes into the container. */
export const Enter: ScrollOffset = [
  [0, 1],
  [1, 1],
]

/** While the target leaves the container. */
export const Exit: ScrollOffset = [
  [0, 0],
  [1, 0],
]

/** While any of the target is in the container. */
export const Any: ScrollOffset = [
  [1, 0],
  [0, 1],
]

/** While all of the target is in the container: the offset with a target and none given. */
export const All: ScrollOffset = [
  [0, 0],
  [1, 1],
]
