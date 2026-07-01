// drag + layout handoff (ADR-0016) in a REAL browser. A draggable element that is
// ALSO a projection node (`layout`) drives its drag through the projection target
// (the renderer ignores a projected element's raw x/y), so it follows the pointer
// via the projection transform and FLIPs to its slot on release. Free drag (no
// `layout`) still direct-sets raw x/y — the regression guard at the end.
import { cleanup, render } from "@solidjs/testing-library"
import { afterEach, expect, it } from "vitest"
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid"
import { leftOf, raf, topOf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const down = (x: number, y: number): PointerEvent =>
  new PointerEvent("pointerdown", { clientX: x, clientY: y, buttons: 1, pointerId: 1 })
const move = (x: number, y: number): PointerEvent =>
  new PointerEvent("pointermove", { clientX: x, clientY: y, buttons: 1, pointerId: 1 })
const up = (x: number, y: number): PointerEvent =>
  new PointerEvent("pointerup", { clientX: x, clientY: y, buttons: 0, pointerId: 1 })

it("a drag+layout element FOLLOWS the pointer via the projection (not raw x/y)", async () => {
  let el: HTMLElement | undefined
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "absolute", top: "50px", left: "50px", width: "300px", height: "300px" }}>
        {/* eslint-disable-next-line solid/reactivity */}
        <wardic.div ref={(n: HTMLElement) => (el = n)} layout drag style={{ width: "40px", height: "40px" }} />
      </div>
    </WardicProvider>
  ))
  const box = el as HTMLElement
  await raf()
  await raf() // let the projection measure the slot (identity, no FLIP)
  const startLeft = leftOf(box)
  const startTop = topOf(box)

  // Grab at (0,0) and drag to a +100,+60 offset. The recognizer attaches its
  // listener asynchronously, so re-dispatch down+move until the projection follows.
  await until(() => {
    box.dispatchEvent(down(0, 0))
    box.dispatchEvent(move(100, 60))
    return Math.abs(leftOf(box) - (startLeft + 100)) < 5
  })
  // The element sits under the pointer via the projection transform.
  expect(Math.abs(leftOf(box) - (startLeft + 100))).toBeLessThan(5)
  expect(Math.abs(topOf(box) - (startTop + 60))).toBeLessThan(5)
  // Driven by the projection, not a raw transform: no translateX() term.
  expect(box.style.transform).not.toContain("translateX")

  // Release with no reorder → FLIPs back to its slot (offset springs to 0).
  box.dispatchEvent(up(100, 60))
  await until(() => Math.abs(leftOf(box) - startLeft) < 2 && Math.abs(topOf(box) - startTop) < 2)
  expect(Math.abs(leftOf(box) - startLeft)).toBeLessThan(2)
  expect(Math.abs(topOf(box) - startTop)).toBeLessThan(2)
})

it("a free-drag element (no layout) still direct-sets raw x/y — regression guard", async () => {
  let el: HTMLElement | undefined
  render(() => (
    <WardicProvider env={DomLive}>
      {/* eslint-disable-next-line solid/reactivity */}
      <wardic.div ref={(n: HTMLElement) => (el = n)} drag style={{ width: "40px", height: "40px" }} />
    </WardicProvider>
  ))
  const box = el as HTMLElement
  await until(() => {
    box.dispatchEvent(down(0, 0))
    box.dispatchEvent(move(30, 0))
    return box.style.transform.includes("translateX(30")
  })
  // No projection node → the raw x/y path drives a translateX transform.
  expect(box.style.transform).toContain("translateX(30")
})
