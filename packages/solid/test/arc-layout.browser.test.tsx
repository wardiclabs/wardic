// A layout animation along `transition.path` on Solid 1 (#438 PR 2, ADR-0065, Motion's
// `interpolateProjection`): a move of 20 px or more curves its centre along the path, its size still
// mixed straight; a `layoutId` handover the same. Real frames. Solid 2's are LPV1–.
//
// - LP1: a `layout` move of 300 px, `arc({ strength: 1 })`: it sets off from where it was, its centre
//   bulges by half the distance midway, and it lands on its box.
// - LP2: a move under 20 px goes straight.
// - LP3: a `layoutId` handover curves: the new twin's centre off the straight line, its Follower on it.
// - LP4: reduced motion lands it at once: no curve.
// - LP5: a path on the element's transition, with no `layout` entry: its layout transition, so it curves.
// - LP6: a path on the element's transition beside a `layout` entry without one goes straight, as
//   Motion's (`getValueTransition(transition, "layout")` is the entry).
// - LP7: `rotate: true` turns it along the curve, as Motion's `pathRotation`: up to the arc's 13.4°
//   over 300 px, and none once it lands.
// - LP8: a turning handover: its Follower turns with its Lead.
// - LP9: the side it bulges to is the path's from where it was to its box, Motion's
//   `sample(delta.translate, 0)`: `cw`'s, and the other side for `ccw`.
// - LP10: a straight flight in the same frames as a turning one doesn't turn: the turn is its own node's.
import { cleanup, render } from "@solidjs/testing-library"
import * as Arc from "@wardic/core/Arc"
import { DomLive } from "@wardic/dom"
import { arc, wardic, WardicProvider, type WardicTransition } from "@wardic/solid"
import { createSignal, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"

afterEach(cleanup)

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}
const centreOf = (el: Element): { readonly x: number; readonly y: number } => {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}
// A slow, linear layout flight.
// The path on the layout transition, as Motion reads it: its `layout` entry here.
const CURVED: WardicTransition = { layout: { type: "tween", duration: 0.6, ease: "linear", path: arc({ strength: 1 }) } }
// The same, turning along it.
const TURNING: WardicTransition = { layout: { type: "tween", duration: 0.6, ease: "linear", path: arc({ strength: 1, rotate: true }) } }
// Clear of the page's one mouse, parked at (5, 5).
const FRAME: JSX.CSSProperties = { position: "relative", "margin-left": "40px", "margin-top": "200px", height: "400px" }

/** `el`'s drawn turn, in degrees. */
const angleOf = (el: Element): number => {
  const m = new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
  return (Math.atan2(m.b, m.a) * 180) / Math.PI
}

/** A `layout` box `left` px along its wrapper, moved by `setLeft`, under `reducedMotion`. */
const mountMove = (reducedMotion: "always" | "user" = "user", transition: WardicTransition = CURVED) => {
  const [left, setLeft] = createSignal(0)
  const { container } = render(() => (
    <WardicProvider env={DomLive} reducedMotion={reducedMotion}>
      <div style={{ ...FRAME, "padding-left": `${left()}px`, "padding-top": "100px" }}>
        {/* Moved by its wrapper's padding: a layout change the next pass measures (layoutDependency). */}
        <wardic.div data-k="box" layout layoutDependency={left()} transition={transition} style={{ width: "40px", height: "40px", background: "teal" }} />
      </div>
    </WardicProvider>
  ))
  return { move: setLeft, box: container.querySelector<HTMLElement>("[data-k=box]")! }
}

/** The largest distance of `el`'s centre from its starting line's y over `n` frames. */
const bulgeOver = async (el: HTMLElement, y0: number, n: number): Promise<number> => {
  let most = 0
  for (let i = 0; i < n; i++) {
    await raf()
    most = Math.max(most, Math.abs(centreOf(el).y - y0))
  }
  return most
}

describe("a layout animation along transition.path on Solid 1 (#438)", () => {
  it("LP1: a layout move of 300 px bulges by half the distance midway, and lands on its box", async () => {
    const m = mountMove()
    await frames(5)
    const start = centreOf(m.box)
    m.move(300)
    await raf()
    // Its first frame: a frame's run along the curve from where it was, ~8 px on and ~16 px off the line.
    expect(Math.abs(centreOf(m.box).x - start.x), "from where it was").toBeLessThan(20)
    expect(Math.abs(centreOf(m.box).y - start.y)).toBeLessThan(40)
    const bulge = await bulgeOver(m.box, start.y, 50)
    expect(bulge, "half of 300 px, midway").toBeGreaterThan(130)
    expect(bulge).toBeLessThan(151)
    expect(centreOf(m.box).x - start.x, "landed 300 px on").toBeCloseTo(300, 0)
    expect(centreOf(m.box).y, "on its line").toBeCloseTo(start.y, 0)
  })

  it("LP2: a move under 20 px goes straight", async () => {
    const m = mountMove()
    await frames(5)
    const start = centreOf(m.box)
    m.move(15)
    expect(await bulgeOver(m.box, start.y, 40), "no bulge").toBeLessThan(0.5)
    expect(centreOf(m.box).x - start.x).toBeCloseTo(15, 0)
  })

  it("LP3: a layoutId handover curves; its Follower rides it", async () => {
    const [open, setOpen] = createSignal(false)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={FRAME}>
          <wardic.div data-k="thumb" layoutId="t" transition={CURVED} style={{ position: "absolute", top: "100px", left: "0px", width: "40px", height: "40px", background: "teal" }} />
          <Show when={open()}>
            <wardic.div data-k="big" layoutId="t" transition={CURVED} style={{ position: "absolute", top: "100px", left: "300px", width: "80px", height: "80px", background: "teal" }} />
          </Show>
        </div>
      </WardicProvider>
    ))
    await frames(5)
    const thumb = container.querySelector<HTMLElement>("[data-k=thumb]")!
    const line = centreOf(thumb).y
    setOpen(true)
    await raf()
    const big = container.querySelector<HTMLElement>("[data-k=big]")!
    // The straight line runs from the thumb's centre (y 120) to the big one's (y 140).
    let bulge = 0
    let riding = 0
    for (let i = 0; i < 45; i++) {
      await raf()
      bulge = Math.max(bulge, Math.abs(centreOf(big).y - line))
      if (Number(getComputedStyle(thumb).opacity) > 0.01) riding = Math.max(riding, Math.hypot(centreOf(thumb).x - centreOf(big).x, centreOf(thumb).y - centreOf(big).y))
    }
    expect(bulge, "off the straight line").toBeGreaterThan(100)
    expect(riding, "the Follower on its Lead, px").toBeLessThan(0.75)
  })

  it("LP4: reduced motion lands it at once: no curve", async () => {
    const m = mountMove("always")
    await frames(5)
    const start = centreOf(m.box)
    m.move(300)
    expect(await bulgeOver(m.box, start.y, 10), "no bulge").toBeLessThan(0.5)
    expect(centreOf(m.box).x - start.x).toBeCloseTo(300, 0)
  })

  it("LP5: a path on the element's transition, with no layout entry, curves", async () => {
    const m = mountMove("user", { type: "tween", duration: 0.6, ease: "linear", path: arc({ strength: 1 }) })
    await frames(5)
    const start = centreOf(m.box)
    m.move(300)
    expect(await bulgeOver(m.box, start.y, 50), "half of 300 px").toBeGreaterThan(130)
  })

  it("LP6: a path on the element's transition beside a layout entry without one goes straight", async () => {
    const m = mountMove("user", { path: arc({ strength: 1 }), layout: { type: "tween", duration: 0.6, ease: "linear" } })
    await frames(5)
    const start = centreOf(m.box)
    m.move(300)
    expect(await bulgeOver(m.box, start.y, 50), "no bulge: the layout entry has no path").toBeLessThan(0.5)
  })

  it("LP7: rotate: true turns it along the curve, and none once it lands", async () => {
    const m = mountMove("user", TURNING)
    await frames(5)
    m.move(300)
    let most = 0
    for (let i = 0; i < 50; i++) {
      await raf()
      most = Math.max(most, Math.abs(angleOf(m.box)))
    }
    expect(most, "the arc's turn, degrees").toBeGreaterThan(10)
    expect(most).toBeLessThan(14)
    expect(angleOf(m.box), "landed: no turn").toBeCloseTo(0, 3)
  })

  it("LP8: a turning handover: its Follower turns with its Lead", async () => {
    const [open, setOpen] = createSignal(false)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={FRAME}>
          <wardic.div data-k="thumb" layoutId="t" transition={TURNING} style={{ position: "absolute", top: "100px", left: "0px", width: "40px", height: "40px", background: "teal" }} />
          <Show when={open()}>
            <wardic.div data-k="big" layoutId="t" transition={TURNING} style={{ position: "absolute", top: "100px", left: "300px", width: "80px", height: "80px", background: "teal" }} />
          </Show>
        </div>
      </WardicProvider>
    ))
    await frames(5)
    const thumb = container.querySelector<HTMLElement>("[data-k=thumb]")!
    setOpen(true)
    await raf()
    const big = container.querySelector<HTMLElement>("[data-k=big]")!
    let most = 0
    let apart = 0
    for (let i = 0; i < 45; i++) {
      await raf()
      most = Math.max(most, Math.abs(angleOf(big)))
      if (Number(getComputedStyle(thumb).opacity) > 0.01) apart = Math.max(apart, Math.abs(angleOf(thumb) - angleOf(big)))
    }
    expect(most, "the Lead turns, degrees").toBeGreaterThan(5)
    expect(apart, "the Follower's turn on its Lead's, degrees").toBeLessThan(0.1)
    expect(angleOf(big), "landed: no turn").toBeCloseTo(0, 3)
  })

  it("LP9: it bulges to the side of the path from where it was to its box, cw's and ccw's", async () => {
    for (const direction of ["cw", "ccw"] as const) {
      const options = { strength: 1, direction }
      const m = mountMove("user", { layout: { type: "tween", duration: 0.6, ease: "linear", path: arc(options) } })
      await frames(5)
      const start = centreOf(m.box)
      m.move(300)
      let side = 0
      for (let i = 0; i < 50; i++) {
        await raf()
        const off = centreOf(m.box).y - start.y
        if (Math.abs(off) > Math.abs(side)) side = off
      }
      // Its origin's centre is 300 px left of its new box's.
      const expected = Arc.make(options)({ x: -300, y: 0 }, { x: 0, y: 0 })(0.5).y
      expect(Math.abs(expected), direction).toBeGreaterThan(100)
      expect(Math.sign(side), direction).toBe(Math.sign(expected))
      cleanup()
    }
  })

  it("LP10: a straight flight in the same frames as a turning one doesn't turn", async () => {
    const [left, setLeft] = createSignal(0)
    const STRAIGHT: WardicTransition = { layout: { type: "tween", duration: 0.6, ease: "linear" } }
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ ...FRAME, "padding-left": `${left()}px`, "padding-top": "100px" }}>
          <wardic.div data-k="turning" layout layoutDependency={left()} transition={TURNING} style={{ width: "40px", height: "40px", background: "teal" }} />
          <wardic.div data-k="straight" layout layoutDependency={left()} transition={STRAIGHT} style={{ width: "40px", height: "40px", background: "teal" }} />
        </div>
      </WardicProvider>
    ))
    await frames(5)
    const turning = container.querySelector<HTMLElement>("[data-k=turning]")!
    const straight = container.querySelector<HTMLElement>("[data-k=straight]")!
    setLeft(300)
    let turned = 0
    let crooked = 0
    for (let i = 0; i < 50; i++) {
      await raf()
      turned = Math.max(turned, Math.abs(angleOf(turning)))
      crooked = Math.max(crooked, Math.abs(angleOf(straight)))
    }
    expect(turned, "the turning one turns, degrees").toBeGreaterThan(10)
    expect(crooked, "the straight one, degrees").toBeLessThan(0.001)
  })
})
