// #443's projection utilities on Solid 2: Solid 1's PU cases, the measure callbacks as props and as
// ward config keys (callback keys, read as they are).
//
// - PUV1: `onBeforeLayoutMeasure` and `onLayoutMeasure` on `wardic.div`, then on a ward's config: the
//   first, then the second with the box and the one before.
// - PUV2: `createInstantTransition`: a value and a layout change in `start(fn)` land at once.
// - PUV3: `createInstantLayoutTransition` and `createResetProjection`: a change lands at once; a
//   running layout animation reset ends on its slot.
// - PUV4: `WardicProvider`'s `scaleCorrectors`: an app's `borderRadius` replaces the built-in one.
import { DomLive } from "@wardic/dom"
import {
  createInstantLayoutTransition,
  createInstantTransition,
  createResetProjection,
  ward,
  wardic,
  type WardicLayoutBox,
  WardicProvider,
  type WardicScaleCorrector,
} from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { createSignal, flush } from "solid-js"
import { describe, expect, it } from "vitest"
import { leftOf, raf, until, widthOf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const FLY = { type: "tween", duration: 0.6, ease: "linear" } as const

/** A few frames. */
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const left = (moved: boolean): string => Bool.match(moved, { onTrue: () => "200px", onFalse: () => "0px" })

describe("the measure callbacks on Solid 2 (#443)", () => {
  it("PUV1: on wardic.div and on a ward's config, each measure calls the first, then the second with the box and the one before", async () => {
    const calls: Array<string> = []
    const boxes: Array<readonly [WardicLayoutBox, WardicLayoutBox | undefined]> = []
    const [moved, setMoved] = createSignal(false)
    const Card = () => {
      const card = ward({
        layout: true,
        layoutDependency: () => moved(),
        transition: FLY,
        onBeforeLayoutMeasure: () => calls.push("ward before"),
        onLayoutMeasure: (box: WardicLayoutBox) => calls.push(`ward ${Math.round(box.x.max - box.x.min)}`),
        style: () => ({ position: "absolute", top: "50px", left: left(moved()), width: "30px", height: "20px" }),
      })
      return <div {...card()} />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", width: "400px", height: "80px" }}>
          <wardic.div
            data-t
            layout
            layoutDependency={moved()}
            transition={FLY}
            onBeforeLayoutMeasure={() => calls.push("before")}
            onLayoutMeasure={(box, prev) => {
              calls.push("measure")
              boxes.push([box, prev])
            }}
            style={{ position: "absolute", top: "0px", left: left(moved()), width: "60px", height: "40px" }}
          />
          <Card />
        </div>
      </WardicProvider>
    ))
    await frames(4)
    expect(calls).toContain("before")
    expect(calls.indexOf("before"), "before, then measure").toBeLessThan(calls.indexOf("measure"))
    expect(calls).toContain("ward before")
    expect(calls).toContain("ward 30")
    expect(boxes[0]![1], "undefined at its first").toBeUndefined()
    const el = host.querySelector<HTMLElement>("[data-t]")!
    expect(boxes[0]![0].x.min).toBeCloseTo(el.getBoundingClientRect().left + window.scrollX, 0)
    const told = boxes.length
    setMoved(true)
    flush()
    await until(() => boxes.length > told, 2000)
    const [box, prev] = boxes.at(-1)!
    expect(box.x.min - prev!.x.min).toBeCloseTo(200, 0)
  })
})

describe("the Instant change and the Projection reset on Solid 2 (#443)", () => {
  /** A layout element moving from `left: 0` to `left: 200px`, with `x` from a signal, and the three functions. */
  const mountMover = () => {
    const [moved, setMoved] = createSignal(false)
    const [x, setX] = createSignal(0)
    const fns: { startLayout?: (fn?: () => void) => void; startInstant?: (fn: () => void) => void; reset?: () => void } = {}
    const Mover = () => {
      fns.startLayout = createInstantLayoutTransition()
      fns.startInstant = createInstantTransition()
      fns.reset = createResetProjection()
      return (
        <div data-root style={{ position: "relative", width: "400px", height: "60px" }}>
          <wardic.div data-t layout layoutDependency={moved()} animate={{ x: x() }} transition={FLY} style={{ position: "absolute", top: "0px", left: left(moved()), width: "60px", height: "40px" }} />
        </div>
      )
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Mover />
      </WardicProvider>
    ))
    const root = host.querySelector<HTMLElement>("[data-root]")!
    const el = host.querySelector<HTMLElement>("[data-t]")!
    return { at: () => leftOf(el) - leftOf(root), setMoved, setX, fns }
  }

  it("PUV2: createInstantTransition: a value and a layout change land at once", async () => {
    const m = mountMover()
    await frames(4)
    m.fns.startInstant!(() => {
      m.setX(50)
      m.setMoved(true)
    })
    flush()
    await raf()
    await raf()
    expect(m.at(), "both landed at once").toBeCloseTo(250, 0)
    await frames(3)
    m.setX(0)
    flush()
    await frames(6)
    expect(m.at(), "two frames on, x animates").toBeGreaterThan(205)
  })

  it("PUV3: createInstantLayoutTransition lands a change at once; createResetProjection ends a running one on its slot", async () => {
    const m = mountMover()
    await frames(4)
    m.fns.startLayout!(() => m.setMoved(true))
    flush()
    await raf()
    await raf()
    expect(m.at(), "landed at once").toBeCloseTo(200, 0)
    m.setMoved(false)
    flush()
    await frames(6)
    expect(m.at(), "animating back").toBeGreaterThan(5)
    m.fns.reset!()
    await raf()
    await raf()
    expect(m.at(), "reset: on its slot").toBeCloseTo(0, 0)
  })
})

describe("WardicProvider's scaleCorrectors on Solid 2 (#443)", () => {
  it("PUV4: an app's borderRadius replaces the built-in one", async () => {
    const radius: WardicScaleCorrector = { correct: (latest, { projectionDelta }) => `${Number.parseFloat(String(latest)) / projectionDelta.x.scale}px` }
    const [wide, setWide] = createSignal(false)
    const { host } = mount(() => (
      <WardicProvider env={DomLive} scaleCorrectors={{ borderRadius: radius }}>
        <wardic.div data-t layout layoutDependency={wide()} transition={FLY} style={{ width: Bool.match(wide(), { onTrue: () => "300px", onFalse: () => "100px" }), height: "40px", "border-radius": "20px" }} />
      </WardicProvider>
    ))
    const el = host.querySelector<HTMLElement>("[data-t]")!
    await frames(4)
    setWide(true)
    flush()
    await frames(8)
    const sx = widthOf(el) / 300
    expect(sx).toBeLessThan(0.9)
    expect(Number.parseFloat(el.style.borderRadius)).toBeCloseTo(20 / sx, -1)
    expect(el.style.borderRadius).not.toContain("/")
  })
})
