// A free drag's release (ADR-0004, *Amendment (#139)*), FL1–FL4 with real Playwright mouse input and
// FL5 with pushed input: the release reads the pointer's velocity over its last 100 ms, the release
// point counted, as a layout drag's does. A flick with moves more than 30 ms apart carries on (the old
// 30 ms window held only the last move and the up, at the same point, and read none); a pause before
// letting go reads none; `dragMomentum={false}` never carries; `dragSnapToOrigin` springs back from the
// flick's velocity. A layout drag past elastic constraints releases with the pointer's velocity, not
// its slower elastic offsets'. Each release runs on the drag transition (ADR-0016, *Amendment
// (#140)*): FL4 and FL5 give it a soft bounce, so a release's carry outward before it turns back
// shows its velocity. A release that should carry lets go with its flick's last move (`fling`, #496,
// as drag-transition's did for #369): FL1 and FL4. FL2 and FL3 let go a command after it, since
// theirs shouldn't carry. FL5 compares two releases' carries, so it runs on pushed input whose
// timestamps it sets (#729, as DR1 does for #206): on the real mouse a loaded runner can land one
// run's up late, and its velocity reads low.
import { render } from "@solidjs/testing-library"
import * as InputSource from "@wardic/core/InputSource"
import { DomLive } from "@wardic/dom"
import { wardic, type WardicBoundingBox, type WardicDragTransition, type WardicEnv, WardicProvider } from "@wardic/solid"
import { TestInput } from "@wardic/test"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as UndefinedOr from "effect/UndefinedOr"
import { createSignal } from "solid-js"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { page } from "vitest/browser"
import { raf } from "./browser-helpers.ts"
import { add, flingFrom, glide, mouse, type Pt, resetScene, sampleFrames, settle, wait } from "./reorder-harness.tsx"

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
 * A 120x80 draggable box at (40, 400), on `env`: free (a Fling on release), or `layout`, or springing
 * back. Low on the page: the browser files run side by side in one page and share its one mouse, and
 * most mount near the top, where a flick here could hover them.
 */
const mountBox = async (
  opts: {
    readonly momentum?: boolean
    readonly snapToOrigin?: boolean
    readonly layout?: boolean
    readonly constraints?: Partial<WardicBoundingBox>
    readonly dragTransition?: WardicDragTransition
  },
  env: WardicEnv = DomLive,
): Promise<Box> => {
  const [el, setEl] = createSignal<HTMLElement>()
  render(() => (
    <WardicProvider env={env}>
      <div style={{ position: "absolute", top: "400px", left: "40px" }}>
        <wardic.div
          ref={(n: HTMLElement) => setEl(n)}
          layout={opts.layout === true}
          drag
          dragMomentum={opts.momentum !== false}
          dragSnapToOrigin={opts.snapToOrigin === true}
          {...UndefinedOr.match(opts.constraints, { onUndefined: () => ({}), onDefined: (dragConstraints) => ({ dragConstraints, dragElastic: 0.5 }) })}
          {...UndefinedOr.match(opts.dragTransition, { onUndefined: () => ({}), onDefined: (dragTransition) => ({ dragTransition }) })}
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

/** A {@link fling}'s release: where the pointer lets go, and where the box is then. */
interface Fling {
  readonly pointer: Pt
  readonly released: number
}

/**
 * {@link flick}'s moves, but the up makes the last one and lets go in one command ({@link flingFrom},
 * #496), so the release reads the flick's velocity however loaded the suite is. Returns where the up
 * lets go, and where the box is then: a step on from where it is.
 */
const fling = async (b: Box, slow: number, step: number): Promise<Fling> => {
  const pointer = await flingFrom({ x: b.slot.left + 20, y: b.slot.top + 40 }, slow, step)
  return { pointer, released: dxOf(b) + step }
}

/** A soft bounce (40/12), so a release's carry outward before it turns back shows its velocity. */
const SOFT: WardicDragTransition = { bounceStiffness: 40, bounceDamping: 12 }

describe("a free drag's release reads the pointer's last 100 ms (ADR-0004, Amendment (#139))", () => {
  it("FL1: a flick with moves about 50 ms apart carries on past where it was let go", async () => {
    const b = await mountBox({})
    const { pointer, released } = await fling(b, 100, 50)
    await mouse.up(pointer)
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
    const { pointer, released } = await fling(b, 100, 50)
    const sampling = sampleFrames(() => dxOf(b))
    await mouse.up(pointer)
    await wait(2000)
    const farthest = Math.max(...sampling.stop().map((f) => f.v))
    expect(farthest - released, `it went ${farthest - released} px past the release before turning back`).toBeGreaterThan(5)
    expect(Math.abs(dxOf(b)), "back at its origin").toBeLessThan(0.5)
  })

  it("FL5: a layout drag past elastic constraints releases with the pointer's velocity, as one at the same offset with none", async () => {
    // Both runs let go 150 px right of the slot, on the same gesture: free (50 px, then 4 x 25 px) and
    // past a 50 px bound with dragElastic 0.5 (150 px, then 4 x 25 px: 50 + (250 - 50) / 2 = 150). The
    // offsets past the bound move at half the pointer's speed; the release reads the pointer's. Pushed
    // input with the gesture's own timestamps, so both runs read the same velocity on any host (#729):
    // the 4 moves are 50 ms apart and the up 5 ms after the last, so the window starts at the second,
    // (150 - 100) px over 105 ms, about 476 px/s. On the soft bounce from 150 px that carries about
    // 13 px; at half of it, about 4 px. The track, the projection and the paint are the real ones.
    const carries: Array<number> = []
    for (const constrained of [false, true]) {
      const input = Effect.runSync(TestInput.pushable())
      const b = await mountBox(
        { layout: true, dragTransition: SOFT, ...Bool.match(constrained, { onTrue: () => ({ constraints: { left: 0, right: 50 } }), onFalse: () => ({}) }) },
        input.layer.pipe(Layer.provideMerge(DomLive)),
      )
      let t = 0
      const push = (type: InputSource.PointerLikeEvent["type"], x: number, after: number): void => {
        t += after
        Effect.runSync(input.push(InputSource.makePointerLikeEvent({ type, x, y: 0, timeStamp: t })))
      }
      const slow = Bool.match(constrained, { onTrue: () => 150, onFalse: () => 50 })
      push("down", 0, 0)
      for (let k = 1; k <= 10; k++) {
        push("move", (slow * k) / 10, 20)
        await raf()
      }
      for (let k = 1; k <= 4; k++) {
        push("move", slow + 25 * k, 50)
        await raf()
      }
      // The last move painted.
      await raf()
      await raf()
      const released = dxOf(b)
      expect(released, "let go 150 px right of the slot").toBeCloseTo(150, 0)
      const sampling = sampleFrames(() => dxOf(b))
      push("up", slow + 100, 5)
      await wait(400)
      carries.push(Math.max(...sampling.stop().map((f) => f.v)) - released)
      await wait(1400)
      expect(Math.abs(dxOf(b)), "it lands on its slot").toBeLessThan(0.5)
      await resetScene()
    }
    const [free, constrained] = carries as [number, number]
    expect(free, `free, it carried on ${free} px (about 13 at the pointer's velocity, 4 at half of it)`).toBeGreaterThan(8)
    expect(constrained / free, `constrained ${constrained} px against free ${free} px`).toBeGreaterThan(0.7)
  })
})
