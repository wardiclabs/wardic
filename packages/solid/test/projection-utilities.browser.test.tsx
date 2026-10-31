// #443's projection utilities on Solid 1, Motion's, in a real browser.
//
// - PU1: `onBeforeLayoutMeasure` and `onLayoutMeasure`: each layout measure calls the first, then the
//   second with the box (page pixels, its transform left out) and the box before, `undefined` at the
//   first; an Instant change's blocked measure calls them too.
// - PU2: a callback that throws is reported, and the layout animation runs as ever.
// - PU3: `createInstantLayoutTransition`: a layout change in `start(fn)` lands at once; one after it
//   animates. A running layout animation it meets ends on its slot. A start with nothing to change
//   leaves a later change animating.
// - PU4: `createInstantTransition`: a value change and a layout change in `start(fn)` both land at once;
//   two frames later a change animates again. `start.end()` ends it at once. PU4b: a later call
//   extends it.
// - PU5: `createResetProjection`: a running layout animation ends on its slot, and the next layout
//   change lands at once; the one after animates. PU7: a leaving twin goes at once.
// - PU6: `WardicProvider`'s `scaleCorrectors`: an app's `borderRadius` replaces the built-in, handed
//   the element's value with Motion's `{ target, treeScale, projectionDelta }`, written while the
//   projection scales it and put back once; a CSS variable's corrector writes the variable, from its
//   live value. Another provider keeps the built-in one. PU8: a replaced radius isn't blended across a
//   handover, nor written by the built-in: an app's corrector writing one corner leaves the others,
//   and its twin keeps its own at the end. PU9: a flight that doesn't scale writes nothing.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import {
  AnimatePresence,
  createInstantLayoutTransition,
  createInstantTransition,
  createResetProjection,
  type InstantTransition,
  wardic,
  type WardicLayoutBox,
  WardicProvider,
  type WardicScaleCorrector,
  type WardStyle,
} from "@wardic/solid"
import * as Bool from "effect/Boolean"
import * as UndefinedOr from "effect/UndefinedOr"
import { createSignal, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { leftOf, raf, until, widthOf } from "./browser-helpers.ts"
import { envWith, errorsNamed, type Logged } from "./report-env.ts"

afterEach(cleanup)

const FLY = { type: "tween", duration: 0.6, ease: "linear" } as const

/** A few frames. */
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

/** A row whose `data-t` box moves from `left: 0` to `left: 200px` when `moved` flips: a layout element. */
const mountMover = (
  options: {
    readonly env?: Parameters<typeof WardicProvider>[0]["env"]
    readonly onBefore?: () => void
    readonly onMeasure?: (box: WardicLayoutBox, prev: WardicLayoutBox | undefined) => void
    readonly x?: () => number
  } = {},
) => {
  const [moved, setMoved] = createSignal(false)
  const x = UndefinedOr.match(options.x, { onUndefined: () => () => 0, onDefined: (given) => given })
  let startLayout!: (fn?: () => void) => void
  let startInstant!: InstantTransition
  let reset!: () => void
  const Mover = () => {
    startLayout = createInstantLayoutTransition()
    startInstant = createInstantTransition()
    reset = createResetProjection()
    return (
      <div data-root style={{ position: "relative", width: "400px", height: "60px" }}>
        <wardic.div
          data-t
          layout
          layoutDependency={moved()}
          animate={{ x: x() }}
          transition={FLY}
          {...UndefinedOr.match(options.onBefore, { onUndefined: () => ({}), onDefined: (onBeforeLayoutMeasure) => ({ onBeforeLayoutMeasure }) })}
          {...UndefinedOr.match(options.onMeasure, { onUndefined: () => ({}), onDefined: (onLayoutMeasure) => ({ onLayoutMeasure }) })}
          style={{ position: "absolute", top: "0px", left: Bool.match(moved(), { onTrue: () => "200px", onFalse: () => "0px" }), width: "60px", height: "40px" }}
        />
      </div>
    )
  }
  const { container } = render(() => (
    <WardicProvider env={UndefinedOr.match(options.env, { onUndefined: () => DomLive, onDefined: (env) => env })}>
      <Mover />
    </WardicProvider>
  ))
  const root = container.querySelector<HTMLElement>("[data-root]")!
  const el = container.querySelector<HTMLElement>("[data-t]")!
  return {
    el,
    /** How far right of the row the element paints. */
    at: (): number => leftOf(el) - leftOf(root),
    setMoved,
    startLayout: (fn?: () => void) => startLayout(fn),
    startInstant: (fn: () => void) => startInstant(fn),
    endInstant: () => startInstant.end(),
    reset: () => reset(),
  }
}

describe("onBeforeLayoutMeasure and onLayoutMeasure on Solid 1 (#443)", () => {
  it("PU1: each measure calls the first, then the second with the box and the one before; blocked measures too", async () => {
    const calls: Array<string> = []
    const boxes: Array<readonly [WardicLayoutBox, WardicLayoutBox | undefined]> = []
    const m = mountMover({
      onBefore: () => calls.push("before"),
      onMeasure: (box, prev) => {
        calls.push("measure")
        boxes.push([box, prev])
      },
    })
    await frames(4)
    expect(calls.slice(0, 2), "before, then measure").toEqual(["before", "measure"])
    const [first, firstPrev] = boxes[0]!
    expect(firstPrev, "undefined at its first").toBeUndefined()
    const rect = m.el.getBoundingClientRect()
    expect(first.x.min).toBeCloseTo(rect.left + window.scrollX, 0)
    expect(first.x.max - first.x.min).toBeCloseTo(60, 0)
    expect(first.y.max - first.y.min).toBeCloseTo(40, 0)
    const told = boxes.length
    m.setMoved(true)
    await until(() => boxes.length > told, 2000)
    const [moved, prev] = boxes.at(-1)!
    expect(prev, "the box before").toEqual(boxes[told - 1]![0])
    expect(moved.x.min - prev!.x.min, "its new box, its transform left out").toBeCloseTo(200, 0)
    // An Instant change's blocked measure calls them too.
    const instantTold = boxes.length
    m.startLayout(() => m.setMoved(false))
    await until(() => boxes.length > instantTold, 2000)
    expect(boxes.at(-1)![0].x.min - moved.x.min).toBeCloseTo(-200, 0)
  })

  it("PU2: a callback that throws is reported, and the layout animation runs as ever", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const m = mountMover({
      env: envWith({ logs, reports }),
      onBefore: () => {
        throw new Error("before broke")
      },
      onMeasure: () => {
        throw new Error("measure broke")
      },
    })
    await frames(4)
    m.setMoved(true)
    await frames(6)
    expect(m.at(), "animating").toBeGreaterThan(5)
    expect(m.at()).toBeLessThan(195)
    await until(() => Math.abs(m.at() - 200) < 0.5, 3000)
    expect(errorsNamed(logs, "wardic.projection: an onBeforeLayoutMeasure failed").length).toBeGreaterThan(0)
    expect(errorsNamed(logs, "wardic.projection: an onLayoutMeasure failed").length).toBeGreaterThan(0)
  })
})

describe("the Instant change and the Projection reset on Solid 1 (#443)", () => {
  it("PU3: createInstantLayoutTransition: a change in start lands at once; one after animates; a running one ends", async () => {
    const m = mountMover()
    await frames(4)
    m.startLayout(() => m.setMoved(true))
    await raf()
    await raf()
    expect(m.at(), "landed at once").toBeCloseTo(200, 0)
    // The next change animates.
    m.setMoved(false)
    await frames(6)
    expect(m.at(), "animating back").toBeGreaterThan(5)
    expect(m.at()).toBeLessThan(195)
    // A running one it meets ends on its slot, and the change lands at once.
    m.startLayout(() => m.setMoved(true))
    await raf()
    await raf()
    expect(m.at(), "landed at once, mid-flight").toBeCloseTo(200, 0)
    await frames(4)
    expect(m.at(), "and stays").toBeCloseTo(200, 0)
    // A start with nothing to change leaves a later change animating.
    m.startLayout()
    await frames(3)
    m.setMoved(false)
    await frames(6)
    expect(m.at(), "a later change animates").toBeGreaterThan(5)
  })

  it("PU4: createInstantTransition: a value and a layout change land at once; two frames later one animates; end() ends it", async () => {
    const [x, setX] = createSignal(0)
    const m = mountMover({ x })
    await frames(4)
    const transformX = (): number => new DOMMatrix(getComputedStyle(m.el).transform).m41
    m.startInstant(() => {
      setX(50)
      m.setMoved(true)
    })
    await raf()
    await raf()
    expect(m.at(), "its layout landed at once").toBeCloseTo(250, 0)
    expect(transformX(), "its x landed at once").toBeCloseTo(50, 0)
    await frames(3)
    setX(0)
    await frames(6)
    expect(m.at(), "two frames on, x animates").toBeGreaterThan(205)
    await until(() => Math.abs(m.at() - 200) < 0.5, 3000)
    // end() ends it at once: a change straight after animates.
    m.startInstant(() => setX(50))
    m.endInstant()
    setX(100)
    await frames(6)
    expect(m.at(), "ended: animating").toBeLessThan(295)
  })

  it("PU4b: a later call extends it: an animation two frames after the first call, one after the second, lands at once", async () => {
    const [x, setX] = createSignal(0)
    const m = mountMover({ x })
    await frames(4)
    m.startInstant(() => {})
    await raf()
    m.startInstant(() => {})
    await raf()
    setX(100)
    await raf()
    await raf()
    expect(m.at(), "still instant: landed").toBeCloseTo(100, 0)
  })

  it("PU7: createResetProjection: a leaving twin goes at once", async () => {
    let reset!: () => void
    const [open, setOpen] = createSignal(true)
    const Twins = () => {
      reset = createResetProjection()
      return (
        <div style={{ position: "relative", height: "160px" }}>
          <wardic.div layoutId="pair" transition={FLY} style={{ position: "absolute", top: "0px", left: "0px", width: "60px", height: "40px" }} />
          <AnimatePresence>
            <Show when={open()}>
              <wardic.div data-modal layoutId="pair" exit={{ opacity: 0 }} transition={FLY} style={{ position: "absolute", top: "0px", left: "200px", width: "120px", height: "80px" }} />
            </Show>
          </AnimatePresence>
        </div>
      )
    }
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <Twins />
      </WardicProvider>
    ))
    await frames(4)
    const modal = container.querySelector<HTMLElement>("[data-modal]")!
    await until(() => Math.abs(widthOf(modal) - 120) < 0.5, 3000)
    setOpen(false)
    await frames(6)
    expect(modal.isConnected, "leaving, crossfading back").toBe(true)
    reset()
    await frames(3)
    expect(modal.isConnected, "gone at once").toBe(false)
  })

  it("PU5: createResetProjection: a running layout animation ends on its slot; the next change lands at once, the one after animates", async () => {
    const m = mountMover()
    await frames(4)
    m.setMoved(true)
    await frames(6)
    expect(m.at(), "mid-flight").toBeLessThan(195)
    m.reset()
    await raf()
    await raf()
    expect(m.at(), "on its slot").toBeCloseTo(200, 0)
    m.setMoved(false)
    await frames(6)
    expect(m.at(), "animating, the reset's pass long done").toBeGreaterThan(5)
  })
})

describe("WardicProvider's scaleCorrectors on Solid 1 (#443)", () => {
  it("PU6: an app's borderRadius replaces the built-in one, handed Motion's fields; a variable's corrector writes it; another provider keeps the built-in", async () => {
    const seen: Array<{ readonly latest: string | number; readonly sx: number; readonly targetWidth: number; readonly treeScale: number }> = []
    const radius: WardicScaleCorrector = {
      correct: (latest, { target, treeScale, projectionDelta }) => {
        seen.push({ latest, sx: projectionDelta.x.scale, targetWidth: target.x.max - target.x.min, treeScale: treeScale.x })
        return `${Number.parseFloat(String(latest)) / projectionDelta.x.scale}px`
      },
    }
    const ring: WardicScaleCorrector = { correct: (latest, { projectionDelta }) => `${Number.parseFloat(String(latest)) / projectionDelta.x.scale}px` }
    const [wide, setWide] = createSignal(false)
    const [ringWidth, setRingWidth] = createSignal("6px")
    const Box = (props: { readonly name: string }) => (
      <wardic.div
        data-name={props.name}
        layout
        layoutDependency={wide()}
        transition={FLY}
        style={{ width: Bool.match(wide(), { onTrue: () => "300px", onFalse: () => "100px" }), height: "40px", "border-radius": "20px", "--ring": ringWidth } as WardStyle}
      />
    )
    const { container } = render(() => (
      <>
        <WardicProvider env={DomLive} scaleCorrectors={{ borderRadius: radius, "--ring": ring }}>
          <Box name="app" />
        </WardicProvider>
        <WardicProvider env={DomLive}>
          <Box name="plain" />
        </WardicProvider>
      </>
    ))
    const app = container.querySelector<HTMLElement>("[data-name=app]")!
    const plain = container.querySelector<HTMLElement>("[data-name=plain]")!
    await frames(4)
    // Its live value now, not its base from its first measure.
    setRingWidth("10px")
    await frames(2)
    setWide(true)
    await frames(8)
    const sx = widthOf(app) / 300
    expect(sx, "mid-flight, scaled").toBeLessThan(0.9)
    expect(Number.parseFloat(app.style.borderRadius), "its corrector's value").toBeCloseTo(20 / sx, -1)
    expect(app.style.borderRadius, "not the built-in's elliptical form").not.toContain("/")
    expect(Number.parseFloat(app.style.getPropertyValue("--ring")), "the variable's live value, corrected").toBeCloseTo(10 / sx, 0)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]!.latest, "its computed value at its first measure").toBe("20px")
    expect(seen.at(-1)!.targetWidth, "drawn into its target box").toBeGreaterThan(100)
    expect(seen.at(-1)!.treeScale).toBe(1)
    expect(plain.style.borderRadius, "another provider's: the built-in one").toContain("/")
    await until(() => Math.abs(widthOf(app) - 300) < 0.5, 3000)
    await frames(3)
    expect(app.style.borderRadius, "put back at rest").toBe("20px")
    const calls = seen.length
    await frames(5)
    expect(seen.length, "nothing at rest").toBe(calls)
  })

  it("PU8: a replaced radius isn't blended across a handover, nor written by the built-in: one corner's corrector leaves the others", async () => {
    const radius: WardicScaleCorrector = {
      correct: (latest, { projectionDelta }) => `${Number.parseFloat(String(latest)) / projectionDelta.x.scale}px`,
      applyTo: ["borderTopLeftRadius"],
    }
    const [open, setOpen] = createSignal(false)
    const { container } = render(() => (
      <WardicProvider env={DomLive} scaleCorrectors={{ borderRadius: radius }}>
        <style>{".round30{border-radius:30px}"}</style>
        <div style={{ position: "relative", height: "160px" }}>
          <wardic.div layoutId="card" transition={FLY} style={{ position: "absolute", top: "0px", left: "0px", width: "60px", height: "40px" }} />
          <Show when={open()}>
            <wardic.div data-big class="round30" layoutId="card" transition={FLY} style={{ position: "absolute", top: "0px", left: "100px", width: "200px", height: "120px" }} />
          </Show>
        </div>
      </WardicProvider>
    ))
    await frames(4)
    setOpen(true)
    const big = container.querySelector<HTMLElement>("[data-big]")!
    // On its way from its twin's box, then landed: it reads 200 px before its flight's first frame.
    await frames(3)
    expect(widthOf(big), "flying").toBeLessThan(150)
    expect(Number.parseFloat(big.style.borderTopLeftRadius), "its corner corrected").toBeGreaterThan(30)
    const others: Array<string> = []
    await until(() => {
      others.push(big.style.getPropertyValue("border-top-right-radius"))
      return Math.abs(widthOf(big) - 200) < 0.5
    }, 3000)
    expect(others.every((value) => value === ""), `the other corners never written: ${others.join(",")}`).toBe(true)
    await frames(4)
    expect(Number.parseFloat(getComputedStyle(big).borderTopLeftRadius), "its own radius").toBeCloseTo(30, 0)
  })

  it("PU9: a flight that doesn't scale writes nothing of an app's corrector", async () => {
    let calls = 0
    const radius: WardicScaleCorrector = {
      correct: (latest) => {
        calls++
        return latest
      },
    }
    const [moved, setMoved] = createSignal(false)
    const { container } = render(() => (
      <WardicProvider env={DomLive} scaleCorrectors={{ borderRadius: radius }}>
        <style>{".rounded{border-radius:20px}"}</style>
        <div style={{ position: "relative", height: "60px" }}>
          <wardic.div data-t class="rounded" layout layoutDependency={moved()} transition={FLY} style={{ position: "absolute", top: "0px", left: Bool.match(moved(), { onTrue: () => "200px", onFalse: () => "0px" }), width: "60px", height: "40px" }} />
        </div>
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-t]")!
    await frames(4)
    setMoved(true)
    await frames(10)
    expect(el.style.transform, "flying").toContain("translate")
    expect(el.style.borderRadius, "nothing written").toBe("")
    expect(calls).toBe(0)
  })
})
