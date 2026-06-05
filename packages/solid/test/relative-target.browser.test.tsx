// Real-browser tests for the box-based projection engine + relativeTarget
// (ADR-0009). happy-dom has no layout engine, so these run in Playwright/Chromium
// where getBoundingClientRect + CSS transform composition are real.
//
// The engine animates in REAL time (real rAF + real Effect scheduling) and we POLL
// getBoundingClientRect across frames, asserting INVARIANTS that hold every frame
// (robust to timing). Elements are MOVED via a reactive CLASS, not the `style`
// prop — wardic.* does not yet track a reactive `style` prop for non-animated keys
// (a known follow-up); class/classList is forwarded reactively.
import { cleanup, render } from "@solidjs/testing-library"
import { wardic, WardicProvider } from "@wardic/solid"
import { DomLive } from "@wardic/dom"
import { afterEach, expect, it } from "vitest"
import { createSignal } from "solid-js"

afterEach(cleanup)

const leftOf = (el: Element): number => el.getBoundingClientRect().left
const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))

/** Poll `sample()` every real frame until `done()` or timeout. */
const sampleUntil = async (done: () => boolean, sample: () => void, timeoutMs = 3000): Promise<void> => {
  const start = performance.now()
  sample()
  while (!done() && performance.now() - start < timeoutMs) {
    await raf()
    sample()
  }
}

const CSS = `
  .rt-box{position:absolute;top:0;left:0;width:100px;height:100px}
  .rt-box.shifted{left:200px}
  .rt-parent{position:absolute;top:0;left:0;width:120px;height:120px}
  .rt-parent.shifted{left:200px}
  .rt-child{position:absolute;top:10px;left:10px;width:50px;height:50px}
`

it("sanity: a standalone layout element FLIP-animates in a real browser", async () => {
  const [moved, setMoved] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <div style={{ position: "relative", width: "600px", height: "200px" }}>
        <wardic.div data-box class="rt-box" classList={{ shifted: moved() }} layout layoutDependency={moved()} />
      </div>
    </WardicProvider>
  ))
  const box = container.querySelector("[data-box]") as HTMLElement

  await raf()
  await raf() // settle mount
  const base = leftOf(box)

  setMoved(true)
  let maxLeft = base
  await sampleUntil(
    () => leftOf(box) >= base + 199,
    () => {
      maxLeft = Math.max(maxLeft, leftOf(box))
    },
  )

  // Moved through the range (not an instant jump) and settled at ~+200.
  expect(maxLeft).toBeGreaterThan(base + 30)
  expect(Math.abs(leftOf(box) - (base + 200))).toBeLessThan(1.5)
})

it("relativeTarget: a fast nested child stays glued to its slow layout parent (not left behind)", async () => {
  const [moved, setMoved] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <div style={{ position: "relative", width: "600px", height: "300px" }}>
        <wardic.div
          data-parent
          class="rt-parent"
          classList={{ shifted: moved() }}
          layout
          layoutDependency={moved()}
          transition={{ stiffness: 40, damping: 22 }} // SLOW parent
        >
          <wardic.div data-child class="rt-child" layout transition={{ stiffness: 900, damping: 36 }} />
        </wardic.div>
      </div>
    </WardicProvider>
  ))

  const parent = container.querySelector("[data-parent]") as HTMLElement
  const child = container.querySelector("[data-child]") as HTMLElement
  expect(child.parentElement).toBe(parent)

  await raf()
  await raf() // settle mount; child sits 10px right of the parent
  const baseParent = leftOf(parent)
  expect(leftOf(child) - baseParent).toBeCloseTo(10, 0)

  // Slide the parent +200 on its SLOW spring; the child's FAST spring would, under
  // ABSOLUTE projection, race ahead and break the offset by up to ~190px. Sample
  // the offset every frame — relativeTarget keeps it ~10 by tracking the parent.
  setMoved(true)
  // The class applies synchronously (layout jumps to +200) BEFORE the FLIP
  // transform is computed next frame; let it seed so the element snaps back to its
  // old spot, then sample the actual 0→+200 animation.
  await sampleUntil(() => leftOf(parent) < baseParent + 50, () => {})

  const offsets: Array<number> = []
  let sawMidAnimation = false
  await sampleUntil(
    () => leftOf(parent) >= baseParent + 199,
    () => {
      const p = leftOf(parent)
      offsets.push(leftOf(child) - p)
      if (p > baseParent + 20 && p < baseParent + 180) sawMidAnimation = true
    },
  )

  // The parent genuinely animated through the mid-range (the child's fast spring
  // had every chance to detach were projection absolute).
  expect(sawMidAnimation).toBe(true)
  // GLUED: every sampled frame kept the child ~10px right of the parent's CURRENT
  // position — relativeTarget tracked the parent despite the divergent springs.
  const worst = offsets.reduce((m, o) => Math.max(m, Math.abs(o - 10)), 0)
  expect(worst).toBeLessThan(3)

  // Settled: parent slid +200, child carried +200, offset preserved.
  expect(Math.abs(leftOf(parent) - (baseParent + 200))).toBeLessThan(1.5)
  expect(leftOf(child) - leftOf(parent)).toBeCloseTo(10, 0)
})
