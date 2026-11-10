/**
 * The DOM's writer for a Batch (#665): each moving member's `transform` and `opacity`, written onto
 * its element's style as it steps, as `DomRenderer.project` draws the same values.
 *
 * @module
 */
// ADR-0069 decision 11 and *Amendment (#665)*, ADR-0070 *Amendment (#665)*: the DOM's keys are core's
// transform keys and `opacity`, numbers in their `px`, `deg` or no unit. A Batch writes outside the
// Flush gate (ADR-0034, *Amendment (#665)*), so its write is a `setProperty` per moving member.
import type * as Batch from "@wardic/core/Batch"
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { TRANSFORM_FUNCS, unitOf } from "./renderer.ts"

/** A transform function a Batch writes: its key's index in the Batch, what goes either side of its value, and its identity. */
interface Part {
  readonly k: number
  readonly open: string
  readonly close: string
  readonly identity: number
}

/** The transform functions a member draws: the renderer's, less a path's turn, which an arc's element draws (#438). */
const FUNCS = Arr.filter(TRANSFORM_FUNCS, (func) => func.key !== "pathRotation")

/** The keys the DOM's writer draws: those transform keys and `opacity`. */
const DRAWS: ReadonlySet<string> = new Set([...Arr.map(FUNCS, (func) => func.key), "opacity"])

/** A Batch's write, for its keys in their order: built once, when the Batch is made. */
const forKeys = (keys: ReadonlyArray<string>): ((el: Element, positions: Float64Array, base: number) => void) => {
  const parts: ReadonlyArray<Part> = Arr.filterMap(FUNCS, (func) =>
    Option.match(Arr.findFirstIndex(keys, (key) => key === func.key), {
      onNone: () => Result.failVoid,
      onSome: (k) => Result.succeed({ k, open: `${func.fn}(`, close: `${unitOf(func.key)})`, identity: func.identity }),
    }))
  const count = parts.length
  // Its index for the per-frame write, or -1 for none: a plain read there (ADR-0025, the per-frame path).
  const opacityAt = Option.getOrElse(Arr.findFirstIndex(keys, (key) => key === "opacity"), () => -1)
  // Per frame, per moving member (ADR-0025, *Amendment (#69)*): a counted loop over its transform
  // functions in the renderer's order, each left out at its identity, the string built by concatenation
  // as the renderer's is (ADR-0034); `none` when every one is at its identity (ADR-0023).
  return (el, positions, base) => {
    const style = (el as HTMLElement).style
    if (count > 0) {
      let transform = ""
      let separator = ""
      for (let p = 0; p < count; p++) {
        const part = parts[p]
        const value = positions[base + part.k]
        if (value === part.identity) continue
        transform = transform + separator + part.open + value + part.close
        separator = " "
      }
      if (transform === "") transform = "none"
      style.setProperty("transform", transform)
    }
    if (opacityAt !== -1) style.setProperty("opacity", String(positions[base + opacityAt]))
  }
}

/** The DOM's Batch writer: an element's `transform` and `opacity`. */
export const writer: Batch.Writer<Element> = {
  writes: (key) => DRAWS.has(key),
  forKeys,
}
