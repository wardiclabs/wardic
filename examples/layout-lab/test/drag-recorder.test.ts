// The drag recorder's border read (#89): a box's padding box sits in from its border box by its
// borders as drawn. At a pixel ratio that isn't whole a border snaps to device pixels (a 1px one is
// drawn 0.740741 css px wide at 1.35), where `clientLeft`/`clientTop` round it to 1: every box the
// recorder read was 0.26 px off per bordered level, 0.53 px in scenario 14's container. Measured in
// Chrome with `--force-device-scale-factor` (`.tmp/89/drive.ts`); CDP's emulated ratio doesn't snap.
import { afterEach, describe, expect, it, vi } from "vitest"
import { insetOf, layoutBox } from "../src/scenarios/drag-recorder.ts"

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

/** An element with offsets, a scroll and a parent, as `layoutBox` reads one. */
const node = (o: { readonly offsetTop?: number; readonly scrollTop?: number; readonly parentElement?: HTMLElement | null; readonly offsetParent?: HTMLElement | null }): HTMLElement =>
  ({
    offsetLeft: 0,
    offsetTop: o.offsetTop ?? 0,
    offsetWidth: 180,
    offsetHeight: 36,
    scrollLeft: 0,
    scrollTop: o.scrollTop ?? 0,
    parentElement: o.parentElement ?? null,
    offsetParent: o.offsetParent ?? null,
  }) as unknown as HTMLElement

describe("layoutBox (#267)", () => {
  it("takes the stage's own scroll out: a stage with overflow hidden scrolls to show a focused item", () => {
    const stage = node({ scrollTop: 26 })
    const item = node({ offsetTop: 272, parentElement: stage, offsetParent: stage })
    // Painted 246 px down the stage's padding box: the slot reads the same, not 26 px below it.
    expect(layoutBox(item, stage).y).toBe(246)
  })

  it("takes every scroll from the item up to the stage out, the stage's included", () => {
    vi.stubGlobal("getComputedStyle", () => ({ borderLeftWidth: "0px", borderTopWidth: "0px" }))
    const stage = node({ scrollTop: 10 })
    const list = node({ offsetTop: 20, scrollTop: 30, parentElement: stage, offsetParent: stage })
    Object.assign(list, { clientLeft: 0, clientTop: 0 })
    const item = node({ offsetTop: 100, parentElement: list, offsetParent: list })
    expect(layoutBox(item, stage).y).toBe(100 + 20 - 30 - 10)
  })
})
