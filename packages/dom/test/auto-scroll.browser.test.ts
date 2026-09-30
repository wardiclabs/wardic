// The DOM auto-scroller (ADR-0020, grill decision 16): Motion's auto-scroll
// (framer-motion Reorder/utils/auto-scroll.ts at 16c61222c4166bbef5ff6ab0051192faa79fa8c8)
// over core's `autoScrollStep`. It finds the group's nearest `overflow: auto | scroll`
// ancestor on the axis (or the document) once per gesture, and scrolls it while the
// pointer is within 50 px of its visible edge, moving toward it.
import { describe, expect, it } from "@effect/vitest"
import { afterEach, vi } from "vitest"
import { makeAutoScroller } from "../src/index.ts"

afterEach(() => {
  document.body.querySelectorAll("[data-ax]").forEach((el) => el.remove())
  window.scrollTo(0, 0)
})

/** A 200 px tall scroll container holding 1000 px of content, with a group inside. */
const scene = () => {
  const container = document.createElement("div")
  container.dataset.ax = ""
  container.style.cssText = "position:absolute;left:0;top:0;width:220px;height:200px;overflow-y:auto"
  const group = document.createElement("div")
  group.style.cssText = "height:1000px"
  container.append(group)
  document.body.append(container)
  return { container, group, rect: container.getBoundingClientRect() }
}

describe("the auto-scroller", () => {
  it("AX1: the scroller is the group's nearest overflow-y:auto ancestor, found once per gesture", () => {
    const { container, group, rect } = scene()
    const scroller = makeAutoScroller(group)
    const spy = vi.spyOn(window, "getComputedStyle")
    try {
      scroller.update({ x: 50, y: rect.bottom - 10 }, "y", 100)
      const walked = spy.mock.calls.length
      expect(walked).toBeGreaterThan(0)
      for (let k = 0; k < 5; k++) scroller.update({ x: 50, y: rect.bottom - 10 }, "y", 100)
      expect(spy.mock.calls.length, "no second walk in the same gesture").toBe(walked)
      expect(container.scrollTop).toBeGreaterThan(0)
      scroller.reset()
      scroller.update({ x: 50, y: rect.bottom - 10 }, "y", 100)
      expect(spy.mock.calls.length, "a new gesture walks again").toBeGreaterThan(walked)
    } finally {
      spy.mockRestore()
    }
  })

  it("AX2: 10 px from the bottom edge, moving down, it scrolls 16 px per update (25 x 0.8^2)", () => {
    const { container, group, rect } = scene()
    const scroller = makeAutoScroller(group)
    scroller.update({ x: 50, y: rect.bottom - 10 }, "y", 100)
    expect(container.scrollTop).toBeCloseTo(16, 0)
    scroller.update({ x: 50, y: rect.bottom - 10 }, "y", 100)
    expect(container.scrollTop).toBeCloseTo(32, 0)
  })

  it("AX3: a group in the page scrolls the document", () => {
    const tall = document.createElement("div")
    tall.dataset.ax = ""
    tall.style.cssText = "height:4000px"
    document.body.append(tall)
    const scroller = makeAutoScroller(tall)
    scroller.update({ x: 50, y: window.innerHeight - 10 }, "y", 100)
    expect(window.scrollY).toBeCloseTo(16, 0)
  })

  it("AX4: it stops at the scroll range it had when the edge activated", () => {
    const { container, group, rect } = scene()
    const scroller = makeAutoScroller(group)
    scroller.update({ x: 50, y: rect.bottom - 1 }, "y", 100) // activates; the range is 800
    group.style.height = "2000px" // the content grows while dragging
    for (let k = 0; k < 100; k++) scroller.update({ x: 50, y: rect.bottom - 1 }, "y", 100)
    expect(container.scrollTop).toBeLessThanOrEqual(800 + 25)
    expect(container.scrollTop).toBeGreaterThanOrEqual(800)
  })

  it("AX5: reset clears the edge, and the debug callback sees one start and one stop", () => {
    const { container, group, rect } = scene()
    const events: Array<string> = []
    const scroller = makeAutoScroller(group, (event) => events.push(event))
    scroller.update({ x: 50, y: rect.bottom - 10 }, "y", 100)
    scroller.update({ x: 50, y: rect.bottom - 10 }, "y", 100)
    scroller.reset()
    const at = container.scrollTop
    scroller.update({ x: 50, y: rect.bottom - 10 }, "y", 0)
    expect(container.scrollTop, "a new gesture needs velocity toward the edge again").toBe(at)
    expect(events.filter((e) => e === "auto-scroll start")).toHaveLength(1)
    expect(events.filter((e) => e === "auto-scroll stop")).toHaveLength(1)
  })
})
