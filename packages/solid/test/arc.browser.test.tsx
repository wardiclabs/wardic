// `transition.path` and `arc()` on Solid 1 (#438, Motion's): `x` and `y` along a curve together, on
// `x`'s transition, from rest. Real frames. Solid 2's are PAV1–.
//
// - PA1: `arc({ strength: 1 })` over 200 px bulges by half the distance midway, and lands on its target.
// - PA2: a per-key `x` entry times the path, over the element's own transition.
// - PA3: `rotate: true` turns it along the curve on its own channel: a `rotate` animation beside it
//   composes, and it ends on that rotate alone.
// - PA4: an interrupt starts the new curve from where it's drawn. (Its target names `y` too: an axis
//   a target leaves out ends where it starts, as Motion's `yTo = yRaw ?? yFrom`, off the line mid-curve.)
// - PA5: Keyframes on `x`: the path runs between their first and last stops.
// - PA6: reduced motion snaps `x` and `y`: no curve.
// - PA7: `{ path }` alone keeps `x`'s Default transition (the DOM's spring for `x`, which overshoots).
// - PA8: `createAnimate`'s target with `x` alone, on a Wardic element at `y: 50`: `y` curves around
//   where it is and ends there (an `animate` target keeps its own `y`, #325's coupling, PA4).
// - PA9 (#460): a Retarget of another key mid-curve leaves the path whole: its turn and the axis its
//   target leaves out ride on with it, and land.
// - PA10 (#460): `createAnimate`'s `stop` and `cancel` mid-curve take the turn back to 0.
// - PA11 (#460): so do a Retarget of `x` on a path that doesn't turn, and Animation controls' `stop`.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { arc, createAnimate, createAnimationControls, type WardicAnimate, wardic, WardicProvider, type WardicTransition } from "@wardic/solid"
import { batch, createSignal, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"

afterEach(cleanup)

const matrixOf = (el: Element): DOMMatrix => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
const xOf = (el: Element): number => matrixOf(el).m41
const yOf = (el: Element): number => matrixOf(el).m42
const angleOf = (el: Element): number => (Math.atan2(matrixOf(el).b, matrixOf(el).a) * 180) / Math.PI
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}
// Clear of the page's one mouse, parked at (5, 5).
const BOX: JSX.CSSProperties = { display: "block", width: "40px", height: "40px", "margin-top": "160px", "margin-left": "160px", background: "teal" }
const LINEAR: WardicTransition = { type: "tween", duration: 0.6, ease: "linear" }

/** A box at `start`, moved to `to()` on `transition`; frames sampled from the move until `n` are read. */
const mountMove = (transition: WardicTransition, initial: Record<string, number> = { x: 0, y: 0 }, reducedMotion: "always" | "user" = "user") => {
  const [target, setTarget] = createSignal<Record<string, number | ReadonlyArray<number>>>(initial)
  const { container } = render(() => (
    <WardicProvider env={DomLive} reducedMotion={reducedMotion}>
      <wardic.div data-k="box" initial={initial} animate={target()} transition={transition} style={BOX} />
    </WardicProvider>
  ))
  return { to: setTarget, box: container.querySelector<HTMLElement>("[data-k=box]")! }
}

/** A box at `x: 0` and `y`, under a `createAnimate` scope: its `animate`, and the box. */
const mountAnimate = (y: number) => {
  let animate!: WardicAnimate
  const Scene = (): JSX.Element => {
    const [scope, made] = createAnimate()
    animate = made
    return (
      <div ref={scope}>
        <wardic.div data-k="box" initial={{ x: 0, y }} animate={{ x: 0, y }} style={BOX} />
      </div>
    )
  }
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <Scene />
    </WardicProvider>
  ))
  return { animate, box: container.querySelector<HTMLElement>("[data-k=box]")! }
}

/** Each frame's x, y and drawn angle for `n` frames. */
const sample = async (box: HTMLElement, n: number) => {
  const seen: Array<{ x: number; y: number; angle: number; transform: string }> = []
  for (let i = 0; i < n; i++) {
    await raf()
    seen.push({ x: xOf(box), y: yOf(box), angle: angleOf(box), transform: box.style.transform })
  }
  return seen
}

describe("transition.path and arc() on Solid 1 (#438)", () => {
  it("PA1: arc({ strength: 1 }) over 200 px bulges by half the distance midway, and lands", async () => {
    const m = mountMove({ ...LINEAR, path: arc({ strength: 1 }) })
    await frames(3)
    m.to({ x: 200 })
    const seen = await sample(m.box, 50)
    const bulge = Math.max(...seen.map((s) => Math.abs(s.y)))
    expect(bulge, "half the distance, near the middle").toBeGreaterThan(90)
    expect(bulge).toBeLessThan(100.5)
    expect(xOf(m.box), "on its target").toBeCloseTo(200, 1)
    expect(yOf(m.box), "back on the line").toBeCloseTo(0, 1)
  })

  it("PA2: a per-key x entry times the path, over the element's own transition", async () => {
    const m = mountMove({ duration: 3, path: arc(), x: { type: "tween", duration: 0.3, ease: "linear" } })
    await frames(3)
    const t0 = performance.now()
    m.to({ x: 200 })
    let landed = Number.NaN
    for (let i = 0; i < 120 && Number.isNaN(landed); i++) {
      await raf()
      if (Math.abs(xOf(m.box) - 200) < 0.01) landed = (performance.now() - t0) / 1000
    }
    expect(landed, "on x's 0.3 s, not the transition's 3 s").toBeLessThan(0.5)
  })

  it("PA3: rotate: true turns it on its own channel; a rotate animation beside it composes, and it ends on that alone", async () => {
    const m = mountMove({ ...LINEAR, path: arc({ strength: 1, rotate: true }) }, { x: 0, y: 0, rotate: 0 })
    await frames(3)
    m.to({ x: 200, rotate: 90 })
    const seen = await sample(m.box, 50)
    expect(seen.some((s) => /rotate\([^)]*\) rotate\(/.test(s.transform)), "the path's turn drawn after the element's own").toBe(true)
    expect(angleOf(m.box), "its own 90° at the end, no turn left").toBeCloseTo(90, 1)
    expect(m.box.style.transform.match(/rotate\(/g)?.length, "one rotate at rest").toBe(1)
  })

  it("PA4: an interrupt starts the new curve from where it's drawn", async () => {
    const m = mountMove({ ...LINEAR, path: arc({ strength: 1 }) })
    await frames(3)
    m.to({ x: 200 })
    await frames(18)
    const was = { x: xOf(m.box), y: yOf(m.box) }
    expect(Math.abs(was.y), "mid-curve").toBeGreaterThan(20)
    m.to({ x: 0, y: 0 })
    await raf()
    expect(Math.hypot(xOf(m.box) - was.x, yOf(m.box) - was.y), "on from where it was, px").toBeLessThan(15)
    await frames(50)
    expect(xOf(m.box)).toBeCloseTo(0, 1)
    expect(yOf(m.box)).toBeCloseTo(0, 1)
  })

  it("PA5: Keyframes on x: the path runs between their first and last stops", async () => {
    const m = mountMove({ ...LINEAR, path: arc({ strength: 1 }) })
    await frames(3)
    m.to({ x: [0, 50, 200] })
    const seen = await sample(m.box, 50)
    expect(Math.max(...seen.map((s) => Math.abs(s.y))), "the arc over 0 to 200").toBeGreaterThan(90)
    expect(xOf(m.box)).toBeCloseTo(200, 1)
  })

  it("PA6: reduced motion snaps x and y: no curve", async () => {
    const m = mountMove({ ...LINEAR, path: arc({ strength: 1 }) }, { x: 0, y: 0 }, "always")
    await frames(3)
    m.to({ x: 200 })
    const seen = await sample(m.box, 10)
    expect(Math.max(...seen.map((s) => Math.abs(s.y))), "no bulge").toBeLessThan(0.01)
    expect(xOf(m.box)).toBeCloseTo(200, 1)
  })

  it("PA7: { path } alone keeps x's Default transition: the DOM's spring, which overshoots", async () => {
    const m = mountMove({ path: arc() })
    await frames(3)
    m.to({ x: 200 })
    const seen = await sample(m.box, 60)
    expect(Math.max(...seen.map((s) => s.x)), "past its target: a spring, not a tween").toBeGreaterThan(200.5)
    expect(xOf(m.box)).toBeCloseTo(200, 0)
  })

  it("PA8: createAnimate's target with x alone: y curves around where it is and ends there", async () => {
    const { animate, box } = mountAnimate(50)
    await frames(3)
    expect(yOf(box), "at 50").toBeCloseTo(50, 1)
    void animate(box, { x: 200 }, { ...LINEAR, path: arc({ strength: 1 }) })
    const seen = await sample(box, 50)
    expect(Math.abs(seen[0]!.y - 50), "from 50, not 0").toBeLessThan(15)
    expect(Math.max(...seen.map((s) => Math.abs(s.y - 50))), "bulging off 50").toBeGreaterThan(90)
    expect(yOf(box), "back on 50").toBeCloseTo(50, 1)
    expect(xOf(box)).toBeCloseTo(200, 1)
  })

  it("PA9 (#460): a Retarget of another key mid-curve leaves the path whole: its turn and the axis it leaves out land", async () => {
    const m = mountMove({ ...LINEAR, path: arc({ strength: 1, rotate: true }) }, { x: 0, y: 0, opacity: 1 })
    await frames(3)
    // Turned near 50° a quarter of the way: the arc's tangent is flat at its peak.
    m.to({ x: 200, opacity: 1 })
    await frames(8)
    expect(Math.abs(yOf(m.box)), "mid-curve").toBeGreaterThan(20)
    expect(Math.abs(angleOf(m.box)), "turned").toBeGreaterThan(5)
    m.to({ x: 200, opacity: 0.5 })
    await frames(50)
    expect(xOf(m.box)).toBeCloseTo(200, 1)
    expect(yOf(m.box), "back on the line").toBeCloseTo(0, 1)
    expect(angleOf(m.box), "no turn left").toBeCloseTo(0, 1)
  })

  it("PA10 (#460): createAnimate's stop and cancel mid-curve take the turn back to 0", async () => {
    const { animate, box } = mountAnimate(0)
    await frames(3)
    for (const end of ["stop", "cancel"] as const) {
      const controls = animate(box, { x: 200 }, { ...LINEAR, path: arc({ strength: 1, rotate: true }) })
      await frames(8)
      expect(Math.abs(angleOf(box)), `turned, before ${end}`).toBeGreaterThan(5)
      controls[end]()
      await frames(2)
      expect(angleOf(box), `no turn after ${end}`).toBeCloseTo(0, 1)
    }
  })

  it("PA11 (#460): a Retarget of x on a path that doesn't turn, and Animation controls' stop, take the turn back to 0", async () => {
    const TURNING: WardicTransition = { ...LINEAR, path: arc({ strength: 1, rotate: true }) }
    const [transition, setTransition] = createSignal<WardicTransition>(TURNING)
    const [target, setTarget] = createSignal<Record<string, number>>({ x: 0, y: 0 })
    const controls = createAnimationControls()
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div data-k="box" initial={{ x: 0, y: 0 }} animate={target()} transition={transition()} style={BOX} />
        <wardic.div data-k="held" initial={{ x: 0, y: 0 }} animate={controls} style={BOX} />
      </WardicProvider>
    ))
    await frames(3)
    const box = container.querySelector<HTMLElement>("[data-k=box]")!
    setTarget({ x: 200 })
    await frames(8)
    expect(Math.abs(angleOf(box)), "turned").toBeGreaterThan(5)
    batch(() => {
      setTransition(LINEAR)
      setTarget({ x: 0 })
    })
    await frames(2)
    expect(angleOf(box), "no turn once a straight leg takes x").toBeCloseTo(0, 1)
    const held = container.querySelector<HTMLElement>("[data-k=held]")!
    void controls.start({ x: 200 }, TURNING)
    await frames(8)
    expect(Math.abs(angleOf(held)), "turned, by its controls").toBeGreaterThan(5)
    controls.stop()
    await frames(2)
    expect(angleOf(held), "no turn after its controls' stop").toBeCloseTo(0, 1)
  })
})
