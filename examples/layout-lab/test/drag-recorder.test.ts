// The drag recorder's border read (#89): a box's padding box sits in from its border box by its
// borders as drawn. At a pixel ratio that isn't whole a border snaps to device pixels (a 1px one is
// drawn 0.740741 css px wide at 1.35), where `clientLeft`/`clientTop` round it to 1: every box the
// recorder read was 0.26 px off per bordered level, 0.53 px in scenario 14's container. Measured in
// Chrome with `--force-device-scale-factor` (`.tmp/89/drive.ts`); CDP's emulated ratio doesn't snap.
import { afterEach, describe, expect, it, vi } from "vitest"
import { insetOf } from "../src/scenarios/drag-recorder.ts"

afterEach(() => {
  vi.unstubAllGlobals()
})

/** An element `clientLeft`/`clientTop` read as given, whose computed borders are `left` and `top`. */
const box = (clientLeft: number, clientTop: number, left: string, top: string): HTMLElement => {
  const el = { clientLeft, clientTop } as HTMLElement
  vi.stubGlobal("getComputedStyle", (e: Element) => {
    expect(e).toBe(el)
    return { borderLeftWidth: left, borderTopWidth: top }
  })
  return el
}

describe("insetOf (#89)", () => {
  it("reads a border as drawn, not as clientLeft rounds it", () => {
    // A 1px border at a 1.35 pixel ratio: one device pixel.
    expect(insetOf(box(1, 1, "0.740741px", "0.740741px"))).toEqual({ x: 0.740741, y: 0.740741 })
  })

  it("reads as clientLeft does where the border is whole, and with none", () => {
    expect(insetOf(box(1, 1, "1px", "1px"))).toEqual({ x: 1, y: 1 })
    expect(insetOf(box(0, 0, "0px", "0px"))).toEqual({ x: 0, y: 0 })
  })

  it("keeps whatever else clientLeft counts: a scrollbar on the left", () => {
    // An rtl box's 17px scrollbar beside its 0.74px border: clientLeft rounds the sum to 18.
    expect(insetOf(box(18, 1, "0.740741px", "0.740741px")).x).toBeCloseTo(17.740741, 9)
  })
})
