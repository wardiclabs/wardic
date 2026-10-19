// A layout node mid Appear animation (#245, ADR-0044 *Amendment (#245)*): the mount's Measure pass
// runs at the end of the hydration task, a frame before the Handoff removes the CSS animation, and
// a CSS animation's transform beats the inline one the pass clears. The pass reads the box past it
// (an important `transform: none`), and the animation runs on, not restarted.
//
// - PA1: a node registered while its element's Appear animation moves it is measured at its box,
//   not where the CSS draws it; the animation runs on from where it was, and the inline transform
//   is back as it was, at its own priority.
// - PA2: `measureLayoutBox` reads past it too.
// - PA3: an app's own CSS animation isn't an Appear one: the pass leaves it be, as before.
import { describe, expect, it } from "@effect/vitest"
import * as Machine from "@wardic/core/Machine"
import * as Appear from "@wardic/dom/Appear"
import * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as DomInterpolators from "@wardic/dom/DomInterpolators"
import { afterEach, beforeEach } from "vitest"
import { clearStages, el, endOfTask, makeEngine, makeSink, stage, stubFrames, unstubFrames } from "./projection-harness.ts"

const styles: Array<HTMLStyleElement> = []
beforeEach(() => {
  stubFrames()
})
afterEach(() => {
  unstubFrames()
  clearStages()
  for (const style of styles.splice(0)) style.remove()
})

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** A head `<style>` with `css`, removed after the test. */
const sheetOf = (css: string): void => {
  const style = document.createElement("style")
  style.textContent = css
  document.head.append(style)
  styles.push(style)
}

/**
 * An element at 100 px in a stage, its inline Starting style a 0.5 scale, playing a layout node's
 * 2 s Appear tween from scale 0.5 to 1 (its own translate isn't drawn, ADR-0016).
 */
const appearing = (key: string): HTMLElement => {
  const sheet = Appear.sheet()
  const slot = sheet.slot()
  const machine = () => Effect.runSync(Effect.provide(Machine.animateValues({ scale: 0.5 }, { scale: 1 }, { duration: 2 }), DomInterpolators.layer))
  const defined = slot.define({ spec: { key, tag: "div", machine, projected: true }, delay: 0 })
  if (Result.isFailure(defined)) throw new Error(defined.failure)
  sheetOf(sheet.css())
  const s = stage("position:relative;width:400px;height:600px")
  const node = el(s, "position:absolute;left:0;top:100px;width:100px;height:50px")
  node.style.transform = "scale(0.5, 0.5)"
  node.style.setProperty("animation", slot.animation)
  return node
}

const appearAnimation = (element: Element): Animation => Option.getOrThrow(Appear.find(element))

describe("a layout node mid Appear animation (#245)", () => {
  it("PA1: measured at its box, not where the CSS draws it; the animation runs on, the inline transform back", async () => {
    const node = appearing("PA1")
    await wait(300)
    const drawnWidth = node.getBoundingClientRect().width
    const stageTop = node.parentElement!.getBoundingClientRect().top
    expect(drawnWidth, "the CSS draws it smaller than its box").toBeLessThan(90)
    expect(drawnWidth, "the CSS has moved it").toBeGreaterThan(51)
    const animation = appearAnimation(node)
    const before = Number(animation.currentTime)
    const e = makeEngine(makeSink().sink)
    const handle = e.system.register({ id: "n0", element: node, transition: () => Option.none() })
    await endOfTask()
    const box = Option.getOrThrow(handle.layoutBox())
    expect(box.y.min - stageTop, "its box, the CSS's transform left out").toBeCloseTo(100, 0)
    expect(box.y.max - box.y.min).toBeCloseTo(50, 0)
    expect(box.x.max - box.x.min).toBeCloseTo(100, 0)
    // The animation ran on through the pass: the same one, later, not restarted.
    expect(appearAnimation(node)).toBe(animation)
    expect(Number(animation.currentTime)).toBeGreaterThanOrEqual(before)
    expect(node.style.transform).toBe("scale(0.5, 0.5)")
    expect(node.style.getPropertyPriority("transform"), "its own priority").toBe("")
    expect(node.getBoundingClientRect().width, "still drawn by the CSS").toBeLessThan(95)
  })

  it("PA2: measureLayoutBox reads past it too", async () => {
    const node = appearing("PA2")
    await wait(300)
    const stageTop = node.parentElement!.getBoundingClientRect().top
    expect(node.getBoundingClientRect().width).toBeLessThan(90)
    const bounds = ProjectionSystem.measureLayoutBox(node)
    expect(bounds.top - stageTop).toBeCloseTo(100, 0)
    expect(bounds.width).toBeCloseTo(100, 0)
    expect(node.style.transform).toBe("scale(0.5, 0.5)")
    expect(node.style.getPropertyPriority("transform")).toBe("")
  })

  it("PA3: an app's own CSS animation is left be", async () => {
    sheetOf("@keyframes pa3-own{from{transform:translateY(60px)}to{transform:translateY(60px)}}")
    const s = stage("position:relative;width:400px;height:600px")
    const node = el(s, "position:absolute;left:0;top:100px;width:100px;height:50px")
    node.style.setProperty("animation", "pa3-own 10s linear infinite")
    await wait(50)
    const stageTop = s.getBoundingClientRect().top
    const handle = makeEngine(makeSink().sink).system.register({ id: "n0", element: node, transition: () => Option.none() })
    await endOfTask()
    expect(Option.getOrThrow(handle.layoutBox()).y.min - stageTop, "its own animation is in its box, as before").toBeCloseTo(160, 0)
  })
})
