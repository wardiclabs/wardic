// A free drag's release with real Playwright mouse input (ADR-0004, *Amendment (#139)*): the
// release reads the pointer's velocity over its last 100 ms, the release point counted, as a
// layout drag's does. A flick with moves more than 30 ms apart carries on (the old 30 ms window
// held only the last move and the up, at the same point, and read none); a pause before letting
// go reads none; `dragMomentum={false}` never carries; `dragSnapToOrigin` springs back from the
// flick's velocity. A layout drag past elastic constraints releases with the pointer's velocity,
// not its slower elastic offsets'. Each release runs on the drag transition (ADR-0016, *Amendment
// (#140)*): FL4 and FL5 give it a soft bounce, so a release's carry outward before it turns back
// shows its velocity.
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { wardic, type WardicDragTransition, WardicProvider } from "@wardic/solid"
import { createSignal } from "solid-js"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { page } from "vitest/browser"
import { add, glide, mouse, type Pt, resetScene, sampleFrames, settle, wait } from "./reorder-harness.tsx"

afterEach(resetScene)

let viewport = { width: 0, height: 0 }
beforeAll(async () => {
  viewport = { width: window.innerWidth, height: window.innerHeight }
  await page.viewport(1200, viewport.height)
  await wait(50)
})
afterAll(async () => {
  await page.viewport(viewport.width, viewport.height)
})

interface Box {
  readonly el: HTMLElement
  readonly slot: DOMRect
}

/**
 * A 120x80 draggable box at (40, 400): free (a Fling on release), or `layout`, or springing back.
 * Low on the page: the browser files run side by side in one page and share its one mouse, and
 * most mount near the top, where a flick here could hover them.
 */
const mountBox = async (opts: {
  readonly momentum?: boolean
  readonly snapToOrigin?: boolean
  readonly layout?: boolean
  readonly constraints?: { readonly x: { readonly min: number; readonly max: number } }
  readonly dragTransition?: WardicDragTransition
}): Promise<Box> => {
  const [el, setEl] = createSignal<HTMLElement>()
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "absolute", top: "400px", left: "40px" }}>
        <wardic.div
          ref={(n: HTMLElement) => setEl(n)}
          layout={opts.layout === true}
          drag
          dragMomentum={opts.momentum !== false}
          dragSnapToOrigin={opts.snapToOrigin === true}
          {...(opts.constraints !== undefined ? { dragConstraints: opts.constraints, dragElastic: 0.5 } : {})}
          {...(opts.dragTransition !== undefined ? { dragTransition: opts.dragTransition } : {})}
          style={{ position: "relative", width: "120px", height: "80px", background: "#8af" }}
        />
      </div>
    </WardicProvider>
  ))
  await settle()
  const target = el()!
  return { el: target, slot: target.getBoundingClientRect() }
}

/** How far right of its slot the box paints. */
const dxOf = (b: Box): number => b.el.getBoundingClientRect().left - b.slot.left

/**
 * Grab the box, glide `slow` px right, then flick: 4 moves of `step` px, 35 ms apart (about 50 ms
 * with each move's ack), more than the old 30 ms window. Returns where the pointer is, not yet let go.
 */
const flick = async (b: Box, slow: number, step: number): Promise<Pt> => {
  const g: Pt = { x: b.slot.left + 20, y: b.slot.top + 40 }
  await mouse.down(g)
  await glide(g, add(g, slow, 0), 10, 20)
  for (let k = 1; k <= 4; k++) {
    await mouse.move(add(g, slow + step * k, 0))
    if (k < 4) await wait(35)
  }
  return add(g, slow + 4 * step, 0)
}

/** A soft bounce (40/12), so a release's carry outward before it turns back shows its velocity. */
const SOFT: WardicDragTransition = { bounceStiffness: 40, bounceDamping: 12 }

describe("a free drag's release reads the pointer's last 100 ms (ADR-0004, Amendment (#139))", () => {
  it("FL1: a flick with moves about 50 ms apart carries on past where it was let go", async () => {
    const b = await mountBox({})
    const at = await flick(b, 100, 50)
    const released = dxOf(b)
    await mouse.up(at)
    await wait(1500)
    const carried = dxOf(b) - released
    expect(carried, `it carried ${carried} px past the release`).toBeGreaterThan(30)
  })

  it("FL2: let go after a 200 ms pause, it stays where it was let go", async () => {
    const b = await mountBox({})
    const at = await flick(b, 100, 50)
    await wait(200)
    const released = dxOf(b)
    await mouse.up(at)
    await wait(600)
    expect(Math.abs(dxOf(b) - released), "it stayed").toBeLessThan(0.5)
  })

  it("FL3: with dragMomentum={false} a flick stays where it was let go", async () => {
    const b = await mountBox({ momentum: false })
    const at = await flick(b, 100, 50)
    const released = dxOf(b)
    await mouse.up(at)
    await wait(600)
    expect(Math.abs(dxOf(b) - released), "it stayed").toBeLessThan(0.5)
  })

  it("FL4: with dragSnapToOrigin a flick away from the origin carries on outward first, then springs back to it", async () => {
    const b = await mountBox({ snapToOrigin: true, dragTransition: SOFT })
    const at = await flick(b, 100, 50)
    const released = dxOf(b)
    const sampling = sampleFrames(() => dxOf(b))
    await mouse.up(at)
    await wait(2000)
    const farthest = Math.max(...sampling.stop().map((f) => f.v))
    expect(farthest - released, `it went ${farthest - released} px past the release before turning back`).toBeGreaterThan(5)
    expect(Math.abs(dxOf(b)), "back at its origin").toBeLessThan(0.5)
  })

  it("FL5: a layout drag past elastic constraints releases with the pointer's velocity, as one at the same offset with none", async () => {
    // Both runs let go 150 px right of the slot, at the same pointer speed: free (50 px, then 4 x 25 px)
    // and past a 50 px bound with dragElastic 0.5 (150 px, then 4 x 25 px: 50 + (250 - 50) / 2 = 150).
    // The offsets past the bound move at half the pointer's speed; the release reads the pointer's.
    const carries: Array<number> = []
    for (const constrained of [false, true]) {
      const b = await mountBox({ layout: true, dragTransition: SOFT, ...(constrained ? { constraints: { x: { min: 0, max: 50 } } } : {}) })
      const at = await flick(b, constrained ? 150 : 50, 25)
      const released = dxOf(b)
      expect(released, "let go 150 px right of the slot").toBeCloseTo(150, -1)
      const sampling = sampleFrames(() => dxOf(b))
      await mouse.up(at)
      await wait(400)
      carries.push(Math.max(...sampling.stop().map((f) => f.v)) - released)
      await wait(1400)
      expect(Math.abs(dxOf(b)), "it lands on its slot").toBeLessThan(0.5)
      await resetScene()
    }
    const [free, constrained] = carries as [number, number]
    expect(free, `free, it carried on ${free} px`).toBeGreaterThan(2)
    expect(constrained / free, `constrained ${constrained} px against free ${free} px`).toBeGreaterThan(0.7)
  })
})
