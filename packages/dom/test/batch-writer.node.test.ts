// The DOM's Batch writer (#665, ADR-0069 decision 11, ADR-0070 *Amendment (#665)*): what a Batch's member
// writes as it moves, held to what `DomRenderer.project` gives the same values, so a batched element
// draws as a Wardic element does.
//
// - BW1: a member's transform is `project`'s for the same values, whatever order the Batch's keys are in.
// - BW2: every transform key at its identity writes `none`; with no transform key, none is written;
//   `opacity` is written as `project` gives it.
// - BW3: it draws the transform keys and `opacity`, and nothing else.
import type * as Batch from "@wardic/core/Batch"
import * as DomBatchWriter from "@wardic/dom/DomBatchWriter"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import { describe, expect, it } from "vitest"

/** An element's style as the writer reaches it: each `setProperty`, recorded. */
const element = () => {
  const written: Record<string, string> = {}
  const style = { setProperty: (name: string, value: string) => (written[name] = value) }
  return { el: { style } as unknown as HTMLElement, written }
}

/** `values` written as a Batch whose keys are `keys` would write them: its write, built once. */
const writeOf = (keys: ReadonlyArray<string>, values: Readonly<Record<string, number>>): Record<string, string> => {
  const writer: Batch.Writer<HTMLElement> = DomBatchWriter.writer
  const write = writer.forKeys(keys)
  const positions = Float64Array.from(keys.map((key) => values[key] as number))
  const { el, written } = element()
  write(el, positions, 0)
  return written
}

/** `project`'s patch as an element's style would hold it: each value as a string. */
const projected = (values: Readonly<Record<string, number>>): Record<string, string> =>
  Object.fromEntries(Object.entries(DomRenderer.project(values)).map(([key, value]) => [key, String(value)]))

describe("the DOM's Batch writer (#665)", () => {
  it("BW1: a member's transform is project's for the same values, in any key order", () => {
    const values = { scale: 1.5, x: 10.25, opacity: 0.4, rotate: 30, y: -3, skewY: 4, z: 2, rotateX: 15, scaleY: 0.5 }
    const keys = Object.keys(values)
    expect(writeOf(keys, values)).toEqual(projected(values))
    expect(writeOf([...keys].reverse(), values)).toEqual(projected(values))
    expect(writeOf(keys, values).transform).toBe("translateX(10.25px) translateY(-3px) translateZ(2px) scale(1.5) scaleY(0.5) rotate(30deg) rotateX(15deg) skewY(4deg)")
  })

  it("BW2: at its identity it writes none; with no transform key none is written; opacity as project's", () => {
    expect(writeOf(["x", "scale", "rotate"], { x: 0, scale: 1, rotate: 0 })).toEqual({ transform: "none" })
    expect(writeOf(["x", "scale"], { x: 0, scale: 2 })).toEqual({ transform: "scale(2)" })
    expect(writeOf(["opacity"], { opacity: 0 })).toEqual({ opacity: "0" })
    expect(writeOf(["opacity"], { opacity: 0.25 })).toEqual(projected({ opacity: 0.25 }))
  })

  it("BW3: it draws the transform keys and opacity, and nothing else", () => {
    const draws = ["x", "y", "z", "translateX", "translateY", "translateZ", "scale", "scaleX", "scaleY", "rotate", "rotateX", "rotateY", "rotateZ", "skewX", "skewY", "opacity"]
    expect(draws.filter((key) => !DomBatchWriter.writer.writes(key))).toEqual([])
    expect(["width", "backgroundColor", "pathRotation", "--x", "originX", "transform"].filter(DomBatchWriter.writer.writes)).toEqual([])
  })
})
