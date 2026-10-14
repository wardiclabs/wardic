// A drag's release on its drag transition (#140, ADR-0016 *Amendment (#140)*), Motion's: an
// inertia on each axis the gesture moved, from the release's velocity, toward the drag's edges. With
// real Playwright mouse input, timed by the frames' own timestamps.
//
// - DT1: a free flick glides on Motion's curve: its steps shrink by e^(−t / 0.75 s), and it's still
//   on its way at 1.5 s. Before #140 a Fling was a decay that stopped in about 1.7 s, a third as far.
// - DT2–DT3: past `dragConstraints` a Fling springs back to the edge and rests on it: on the 200 / 40
//   bounce with the default `dragElastic` (0.35, which pulls the drag back past the edge), a wall
//   with `dragElastic={0}`. Before #140 it coasted on past the edge and rested there.
// - DT4: `dragMomentum={false}` past an edge springs back to it; DT5: a snap back to the origin with
//   no momentum returns directly, never carrying on outward first.
// - DT6: `dragTransition`'s `power`, `timeConstant` (in ms) and `modifyTarget`.
// - DT7: the constraints bound the element's x, whichever gesture moved it there.
// - DT9: an x drag's release runs on x alone, from x's velocity; its y is never constrained, even
//   outside its y bounds.
// - DT8: a `<Reorder.Item>`'s release: on Motion's 200 / 40 bounce from rest by default, and on its
//   slot at once with `dragElastic={0}`, Motion's wall.
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { wardic, type WardicDragTransition, WardicProvider } from "@wardic/solid"
import { createSignal } from "solid-js"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { page } from "vitest/browser"
import { add, glide, mountReorder, mouse, type Pt, resetScene, sampleFrames, settle, wait } from "./reorder-harness.tsx"

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

interface BoxOptions {
  readonly axis?: "x" | "y"
  readonly constraints?: { readonly x?: { readonly min: number; readonly max: number }; readonly y?: { readonly min: number; readonly max: number } }
  readonly elastic?: number
  readonly momentum?: boolean
  readonly snapToOrigin?: boolean
  readonly dragTransition?: WardicDragTransition
}

/**
 * A 120x80 box free to drag at (40, 400). Low on the page: the browser files run side by side in one
 * page and share its one mouse, and most mount near the top, where a flick here could hover them.
 */
const mountBox = async (opts: BoxOptions = {}): Promise<Box> => {
  const [el, setEl] = createSignal<HTMLElement>()
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "absolute", top: "400px", left: "40px" }}>
        <wardic.div
          ref={(n: HTMLElement) => setEl(n)}
          drag={opts.axis ?? true}
          {...(opts.constraints !== undefined ? { dragConstraints: opts.constraints } : {})}
          {...(opts.elastic !== undefined ? { dragElastic: opts.elastic } : {})}
          {...(opts.momentum !== undefined ? { dragMomentum: opts.momentum } : {})}
          {...(opts.snapToOrigin !== undefined ? { dragSnapToOrigin: opts.snapToOrigin } : {})}
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

/** How far right of its slot the box paints: its x. */
const dxOf = (b: Box): number => b.el.getBoundingClientRect().left - b.slot.left

/** How far below its slot the box paints: its y. */
const dyOf = (b: Box): number => b.el.getBoundingClientRect().top - b.slot.top

/** Where a grab of the box lands, `from` px right of its slot's left edge. */
const grabOf = (b: Box, from = 0): Pt => ({ x: b.slot.left + 20 + from, y: b.slot.top + 40 })

/**
 * Grab the box (`from` px right of its slot), glide `slow` px right, then flick: 4 moves of `step` px,
 * 35 ms apart. Returns where the pointer is, not yet let go.
 */
const flick = async (b: Box, slow: number, step: number, from = 0): Promise<Pt> => {
  const g = grabOf(b, from)
  await mouse.down(g)
  await glide(g, add(g, slow, 0), 10, 20)
  for (let k = 1; k <= 4; k++) {
    await mouse.move(add(g, slow + step * k, 0))
    if (k < 4) await wait(35)
  }
  return add(g, slow + 4 * step, 0)
}

/** Grab the box (`from` px right of its slot), glide `by` px right, and pause, so it lets go with no velocity. */
const dragSlowly = async (b: Box, by: number, from = 0): Promise<Pt> => {
  const g = grabOf(b, from)
  await mouse.down(g)
  await glide(g, add(g, by, 0), 12, 20)
  await wait(200)
  return add(g, by, 0)
}

/** Let go at `at` and sample the box's x each frame for `ms`. */
const releaseAndSample = async (b: Box, at: Pt, ms: number) => {
  const sampling = sampleFrames(() => dxOf(b))
  await mouse.up(at)
  await wait(ms)
  return sampling.stop()
}

/** The sampled value at the frame nearest `t` ms after `start`. */
const at = (frames: ReadonlyArray<{ readonly frameAt: number; readonly v: number }>, start: number, t: number): number =>
  frames.reduce((best, f) => (Math.abs(f.frameAt - start - t) < Math.abs(best.frameAt - start - t) ? f : best)).v

describe("a drag's release runs on its drag transition (#140)", () => {
  it("DT1: a free flick glides on Motion's curve, easing out over 0.75 s, still on its way at 1.5 s", async () => {
    const b = await mountBox()
    const pointer = await flick(b, 100, 50)
    const released = dxOf(b)
    const frames = await releaseAndSample(b, pointer, 1700)
    const first = frames.findIndex((f) => f.v > released + 0.5)
    expect(first, "it carries on").toBeGreaterThan(-1)
    const start = frames[first]!.frameAt
    // x(t) = target − A · e^(−t / τ): the steps over three spans 0.5 s apart shrink by e^(−0.5 / 0.75).
    const [a, m, z] = [at(frames, start, 200), at(frames, start, 700), at(frames, start, 1200)]
    expect((z - m) / (m - a), "its steps shrink on a 0.75 s time constant").toBeCloseTo(Math.exp(-0.5 / 0.75), 1)
    expect(frames.at(-1)!.v - at(frames, start, 1400), "still on its way at 1.5 s, px").toBeGreaterThan(1)
    expect(frames.at(-1)!.v - released, "carried far, px").toBeGreaterThan(150)
  })

  it("DT2: flung past a constraint with the default dragElastic, it springs back to the edge on the 200 / 40 bounce and rests on it", async () => {
    const b = await mountBox({ constraints: { x: { min: 0, max: 100 } } })
    const pointer = await flick(b, 100, 25)
    const released = dxOf(b)
    // 200 px of pointer travel, 100 past the edge: pulled back to 100 + 100 × 0.35.
    expect(released, "pulled back past the edge by 0.35").toBeCloseTo(135, -1)
    const frames = await releaseAndSample(b, pointer, 1200)
    expect(Math.max(...frames.map((f) => f.v)) - released, "it doesn't coast on past the edge, px").toBeLessThan(15)
    expect(frames.at(-1)!.v, "it rests on the edge").toBeCloseTo(100, 2)
  })

  it("DT3: with dragElastic={0}, the edge is a wall: held there while dragged, and the Fling stops on it", async () => {
    const b = await mountBox({ constraints: { x: { min: 0, max: 100 } }, elastic: 0 })
    const pointer = await flick(b, 100, 25)
    expect(dxOf(b), "held on the edge").toBeCloseTo(100, 1)
    const frames = await releaseAndSample(b, pointer, 400)
    // Motion's: one frame of glide past it (about 9 px at 60 Hz), then on it.
    expect(Math.max(...frames.map((f) => f.v)), "never more than a frame's glide past it, px").toBeLessThan(125)
    const onEdge = frames.findIndex((f) => f.v > 100.5)
    expect(frames.slice(onEdge + 1, onEdge + 3).some((f) => Math.abs(f.v - 100) < 0.01), "back on it within two frames").toBe(true)
    expect(frames.at(-1)!.v).toBeCloseTo(100, 2)
  })

  it("DT4: with dragMomentum={false}, let go past an edge, it springs back to the edge from rest", async () => {
    const b = await mountBox({ constraints: { x: { min: 0, max: 100 } }, momentum: false })
    const pointer = await dragSlowly(b, 200)
    const released = dxOf(b)
    expect(released, "past the edge").toBeGreaterThan(120)
    const frames = await releaseAndSample(b, pointer, 1200)
    expect(Math.max(...frames.map((f) => f.v)), "never on outward").toBeLessThanOrEqual(released + 0.5)
    expect(frames.at(-1)!.v, "on the edge").toBeCloseTo(100, 2)
  })

  it("DT5: a snap back to the origin with dragMomentum={false} returns directly, never carrying on outward", async () => {
    const b = await mountBox({ snapToOrigin: true, momentum: false })
    const pointer = await flick(b, 100, 50)
    const released = dxOf(b)
    const frames = await releaseAndSample(b, pointer, 1500)
    expect(Math.max(...frames.map((f) => f.v)), "never past where it was let go").toBeLessThanOrEqual(released + 0.5)
    expect(frames.at(-1)!.v, "at its origin").toBeCloseTo(0, 2)
  })

  it("DT6: dragTransition's power, timeConstant (in ms) and modifyTarget", async () => {
    // power 0: it rests where it's let go, whatever its velocity.
    const still = await mountBox({ dragTransition: { power: 0 } })
    const p1 = await flick(still, 100, 50)
    const r1 = dxOf(still)
    await releaseAndSample(still, p1, 500)
    expect(Math.abs(dxOf(still) - r1), "power 0 stays where it's let go").toBeLessThan(0.5)
    await resetScene()

    // A 100 ms time constant: it glides on and rests within about 0.7 s (at 100 s it'd barely move).
    const quick = await mountBox({ dragTransition: { timeConstant: 100 } })
    const p2 = await flick(quick, 100, 50)
    const r2 = dxOf(quick)
    const frames = await releaseAndSample(quick, p2, 1300)
    const start = frames.find((f) => f.v > r2 + 0.5)!.frameAt
    expect(at(frames, start, 900) - r2, "it glided on, px").toBeGreaterThan(30)
    expect(Math.abs(frames.at(-1)!.v - at(frames, start, 900)), "at rest by 0.9 s").toBeLessThan(0.01)
    await resetScene()

    // modifyTarget: a 100 px grid, so it rests on a multiple of 100.
    const grid = await mountBox({ dragTransition: { timeConstant: 100, modifyTarget: (ideal) => Math.round(ideal / 100) * 100 } })
    const p3 = await flick(grid, 100, 50)
    await releaseAndSample(grid, p3, 1300)
    const rest = dxOf(grid)
    expect(rest, "glided on to the grid").toBeGreaterThan(150)
    expect(Math.abs(rest - Math.round(rest / 100) * 100), "on the 100 px grid").toBeLessThan(0.01)
    await resetScene()

    // Let go at rest, the grid still moves it: Motion's target is modifyTarget(where it is).
    const still2 = await mountBox({ dragTransition: { timeConstant: 100, modifyTarget: (ideal) => Math.round(ideal / 100) * 100 } })
    const p4 = await dragSlowly(still2, 130)
    await releaseAndSample(still2, p4, 1000)
    expect(dxOf(still2), "on the nearest grid line, 100").toBeCloseTo(100, 2)
  })

  it("DT7: the constraints bound the element's x, whichever gesture moved it there", async () => {
    const b = await mountBox({ constraints: { x: { min: 0, max: 100 } }, elastic: 0, momentum: false })
    const p1 = await dragSlowly(b, 80)
    await mouse.up(p1)
    await wait(200)
    expect(dxOf(b), "rests where it was let go").toBeCloseTo(80, 0)
    // From 80, another 80: held on the edge at 100, not at 160 (a gesture's own 0..100).
    await dragSlowly(b, 80, 80)
    expect(dxOf(b), "held on the edge").toBeCloseTo(100, 0)
  })
})

describe("an x drag's release (#140)", () => {
  it("DT9: runs on x alone: x glides on from its velocity to its edge, and y, outside its own bounds, is never moved", async () => {
    const b = await mountBox({ axis: "x", constraints: { x: { min: 0, max: 300 }, y: { min: 50, max: 100 } } })
    const pointer = await flick(b, 100, 25)
    const released = dxOf(b)
    expect(released, "let go inside its edges").toBeLessThan(250)
    expect(dyOf(b), "y held where it was").toBeCloseTo(0, 2)
    const frames = await releaseAndSample(b, pointer, 1500)
    // About 500 px/s: 0.8 × that would carry it 400 px on, past its edge at 300.
    expect(frames.at(-1)!.v, "x glided on to its edge").toBeCloseTo(300, 2)
    expect(dyOf(b), "y still where it was, outside its bounds").toBeCloseTo(0, 2)
  })
})

describe("a <Reorder.Item>'s release runs on its drag transition (#140)", () => {
  /** Drag item b 20 px down, slowly (not past its neighbour), let go, and sample its offset from its slot. */
  const release = async (dragElastic: number | undefined) => {
    const scene = await mountReorder(dragElastic === undefined ? {} : { dragElastic })
    const item = scene.item("b")
    const slot = item.getBoundingClientRect()
    const g: Pt = { x: slot.left + 50, y: slot.top + 25 }
    await mouse.down(g)
    await glide(g, add(g, 0, 20), 10, 20)
    await wait(200)
    const sampling = sampleFrames(() => item.getBoundingClientRect().top - slot.top)
    await mouse.up(add(g, 0, 20))
    await wait(1300)
    const frames = sampling.stop()
    return frames.slice(frames.findIndex((f) => f.v < 19.5) - 1)
  }

  it("DT8: by default from rest on Motion's 200 / 40 bounce, about 0.55 s from 20 px; with dragElastic={0} on its slot at once", async () => {
    const soft = await release(undefined)
    const landed = soft.findIndex((f) => Math.abs(f.v) < 0.01)
    const took = soft[landed]!.frameAt - soft[0]!.frameAt
    // Overdamped, its slow rate 20 − √200 ≈ 5.86 per second, from rest: 24.1 · e^(−5.86 t) is within 1 px at about 0.54 s.
    expect(took, "lands on the bounce's time, ms").toBeGreaterThan(350)
    expect(took, "lands on the bounce's time, ms").toBeLessThan(800)
    for (let i = 1; i < landed; i++) expect(soft[i]!.v, `frame ${i}: never past its slot`).toBeGreaterThanOrEqual(-0.01)
    await resetScene()

    const wall = await release(0)
    expect(Math.abs(wall[2]!.v), "on its slot within two frames").toBeLessThan(0.01)
  })
})
