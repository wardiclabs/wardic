// Appear animations in a real browser (#48, ADR-0044): a sheet's CSS plays an element's mount
// animation from first paint, and the Handoff's reads find it, tell how far it has got, and remove
// it in the task that writes the engine's first frame.
//
// - HA1: the element plays the rule from its first frame: what it draws is the machine at the
//   animation's elapsed time, within the sampler's tolerances.
// - HA2: find gets the element's `wardic-…` animation, and only it; matches tells its spec.
// - HA3: the Handoff: in one frame, the machine started at the elapsed time, its Frame written
//   inline and the animation released, draws where the CSS was drawing; nothing is left running.
// - HA4: a finished animation still fills, and is still found, its elapsed time past its end.
// - HA5: an undefined custom property plays nothing: the element keeps its inline Starting style.
// - HA6: a delay holds the first stop, counts toward the elapsed time, and reads back (delayOf).
// - HA7 (#245): an svg-inner element's attributes, drawn as their CSS properties under `@supports`:
//   it plays the machine, and at the Handoff the engine's attributes take over value for value.
// - HA8 (#245): a late chunk's `<style>` adopted into the head: its node gone, its element's
//   animation the same one, running on; in a document still loading, one that lands later is
//   moved as it lands, and none after `DOMContentLoaded` (the observer is gone).
import * as Machine from "@wardic/core/Machine"
import type * as Frame from "@wardic/core/Frame"
import type * as Values from "@wardic/core/Values"
import * as Appear from "@wardic/dom/Appear"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import * as Renderer from "@wardic/core/Renderer"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { afterEach, describe, expect, it } from "vitest"

const project = Effect.runSync(Effect.provide(Effect.gen(function* () { return yield* Renderer.Renderer }), DomRenderer.layer)).project

const rise = (): Machine.Machine<Frame.Frame<Values.Values>> => Machine.springValues({ y: 0, opacity: 1 }, {}, { y: 40, opacity: 0 })

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const raf = () => new Promise<number>((resolve) => requestAnimationFrame(resolve))
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** A render's sheet in the head and an element using its slot, as a server render leaves them. */
const appear = (spec: Appear.Spec, delay = 0, slotAnimation?: string) => {
  const sheet = Appear.sheet()
  const slot = sheet.slot()
  const defined = slot.define({ spec, delay })
  if (Result.isFailure(defined)) throw new Error(defined.failure)
  const style = document.createElement("style")
  style.textContent = sheet.css()
  document.head.append(style)
  const element = document.createElement("div")
  element.style.cssText = `width: 40px; height: 40px; background: teal; transform: translateY(40px); opacity: 0; animation: ${slotAnimation ?? slot.animation}`
  document.body.append(element)
  cleanups.push(() => {
    element.remove()
    style.remove()
  })
  return element
}

/** What the element draws now: its translateY and opacity. */
const drawn = (element: Element) => {
  const computed = getComputedStyle(element)
  return { y: new DOMMatrix(computed.transform).m42, opacity: Number(computed.opacity) }
}

/** The machine's Frame `seconds` in, as `Machine.startAt` draws it on its first tick. */
const at = (machine: Machine.Machine<Frame.Frame<Values.Values>>, seconds: number): Values.Values =>
  Machine.startAt(machine, () => seconds).start()(1 / 60).value

const found = (element: Element): Animation => Option.getOrThrow(Appear.find(element))

describe("Appear animations in a browser (#48, ADR-0044)", () => {
  it("HA1: the element plays the rule from its first frame, the machine at its elapsed time", async () => {
    const spec = { key: "HA1", tag: "div", machine: () => rise() }
    const element = appear(spec)
    await wait(120)
    const reads: Array<{ readonly elapsed: number; readonly y: number; readonly opacity: number }> = []
    for (let i = 0; i < 12; i++) {
      await raf()
      reads.push({ elapsed: Appear.elapsedOf(found(element)), ...drawn(element) })
    }
    expect(reads[0]!.elapsed).toBeGreaterThan(0.08)
    for (const read of reads) {
      const frame = at(spec.machine(), read.elapsed)
      expect(Math.abs(read.y - (frame.y as number)), `y at ${read.elapsed}`).toBeLessThanOrEqual(0.11)
      expect(Math.abs(read.opacity - (frame.opacity as number)), `opacity at ${read.elapsed}`).toBeLessThanOrEqual(0.0025)
    }
  })

  it("HA2: find gets the element's wardic- animation, and only it; matches tells its spec", async () => {
    const spec = { key: "HA2", tag: "div", machine: () => rise() }
    const element = appear(spec)
    await raf()
    const animation = found(element)
    expect(Appear.matches(animation, spec)).toBe(true)
    expect(Appear.matches(animation, { ...spec, key: "HA2 other" })).toBe(false)
    expect(Appear.matches(animation, { ...spec, tag: "span" })).toBe(false)
    const own = document.createElement("div")
    const keyframes = document.createElement("style")
    keyframes.textContent = "@keyframes spin{to{transform:rotate(1turn)}}"
    document.head.append(keyframes)
    own.style.animation = "spin 1s linear infinite"
    document.body.append(own)
    cleanups.push(() => {
      own.remove()
      keyframes.remove()
    })
    await raf()
    expect(own.getAnimations()).toHaveLength(1)
    expect(Option.isNone(Appear.find(own)), "an app's own animation isn't an Appear").toBe(true)
  })

  it("HA3: the Handoff draws where the CSS was drawing, and leaves nothing running", async () => {
    const spec = { key: "HA3", tag: "div", machine: () => rise() }
    const element = appear(spec)
    await wait(150)
    const handoff = await new Promise<{ readonly before: ReturnType<typeof drawn>; readonly after: ReturnType<typeof drawn> }>((resolve) =>
      requestAnimationFrame(() => {
        const animation = found(element)
        const before = drawn(element)
        const frame = at(spec.machine(), Appear.elapsedOf(animation))
        for (const [key, value] of Object.entries(project(frame))) element.style.setProperty(key, String(value))
        Appear.release(element)
        resolve({ before, after: drawn(element) })
      }))
    expect(Math.abs(handoff.after.y - handoff.before.y)).toBeLessThanOrEqual(0.11)
    expect(Math.abs(handoff.after.opacity - handoff.before.opacity)).toBeLessThanOrEqual(0.0025)
    expect(element.getAnimations()).toHaveLength(0)
    expect(element.style.getPropertyValue("animation")).toBe("")
    await raf()
    await raf()
    expect(element.getAnimations(), "not restarted by a later style change").toHaveLength(0)
    expect(drawn(element)).toEqual(handoff.after)
  })

  it("HA7: an svg-inner element plays its attributes as CSS, and hands them back to the attributes (#245)", async () => {
    // A circle growing and moving, its stroke widening and fading in; and a line drawing itself.
    const grow = (): Machine.Machine<Frame.Frame<Values.Values>> =>
      Machine.springValues({ cx: 60, r: 20, strokeWidth: 4, opacity: 1 }, {}, { cx: 10, r: 4, strokeWidth: 0, opacity: 0 })
    const draw = (): Machine.Machine<Frame.Frame<Values.Values>> => Machine.springValues({ pathLength: 1 }, {}, { pathLength: 0 })
    const circleSpec = { key: "HA7 circle", tag: "circle", machine: grow }
    const pathSpec = { key: "HA7 path", tag: "path", machine: draw }
    const sheet = Appear.sheet()
    const circleSlot = sheet.slot()
    const pathSlot = sheet.slot()
    expect(Result.isSuccess(circleSlot.define({ spec: circleSpec, delay: 0 }))).toBe(true)
    expect(Result.isSuccess(pathSlot.define({ spec: pathSpec, delay: 0 }))).toBe(true)
    const css = sheet.css()
    expect(css).toContain("@supports (cx:0px) and (r:0px){")
    const style = document.createElement("style")
    style.textContent = css
    document.head.append(style)
    // The server's markup: each Starting value an attribute, the slot inline.
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("width", "100")
    svg.setAttribute("height", "100")
    svg.innerHTML =
      `<circle cx="10" r="4" stroke-width="0" opacity="0" fill="teal" stroke="black" style="animation: ${circleSlot.animation}"/>` +
      `<path d="M0 50 L100 50" stroke="black" pathLength="1" stroke-dasharray="0 1" stroke-dashoffset="0" style="animation: ${pathSlot.animation}"/>`
    document.body.append(svg)
    cleanups.push(() => {
      svg.remove()
      style.remove()
    })
    const circle = svg.querySelector("circle")!
    const path = svg.querySelector("path")!
    const read = (element: Element, property: string): number => Number.parseFloat(getComputedStyle(element).getPropertyValue(property))
    const circleDrawn = () => ({ cx: read(circle, "cx"), r: read(circle, "r"), strokeWidth: read(circle, "stroke-width"), opacity: read(circle, "opacity") })
    const dash = () => Number.parseFloat(getComputedStyle(path).getPropertyValue("stroke-dasharray"))
    await wait(120)
    // It plays the machine at its elapsed time, each attribute within its tolerance.
    for (let i = 0; i < 6; i++) {
      await raf()
      const frame = at(grow(), Appear.elapsedOf(found(circle)))
      const now = circleDrawn()
      expect(Math.abs(now.cx - (frame.cx as number)), `cx at ${i}`).toBeLessThanOrEqual(0.11)
      expect(Math.abs(now.r - (frame.r as number)), `r at ${i}`).toBeLessThanOrEqual(0.11)
      expect(Math.abs(now.strokeWidth - (frame.strokeWidth as number)), `stroke-width at ${i}`).toBeLessThanOrEqual(0.11)
      expect(Math.abs(now.opacity - (frame.opacity as number)), `opacity at ${i}`).toBeLessThanOrEqual(0.0025)
      expect(Math.abs(dash() - (at(draw(), Appear.elapsedOf(found(path))).pathLength as number)), `dash at ${i}`).toBeLessThanOrEqual(0.0011)
    }
    expect(circleDrawn().cx, "mid-flight").toBeGreaterThan(11)
    expect(circleDrawn().cx, "mid-flight").toBeLessThan(59)
    // The Handoff: the engine's Frame written as attributes, the CSS released, in one frame.
    const handoff = await new Promise<{ readonly before: ReturnType<typeof circleDrawn>; readonly after: ReturnType<typeof circleDrawn>; readonly dash: readonly [number, number] }>((resolve) =>
      requestAnimationFrame(() => {
        const frame = at(grow(), Appear.elapsedOf(found(circle)))
        const drawFrame = at(draw(), Appear.elapsedOf(found(path)))
        const before = circleDrawn()
        const dashBefore = dash()
        for (const [key, name] of [["cx", "cx"], ["r", "r"], ["strokeWidth", "stroke-width"], ["opacity", "opacity"]] as const) circle.setAttribute(name, String(frame[key]))
        path.setAttribute("stroke-dasharray", `${drawFrame.pathLength} 1`)
        Appear.release(circle)
        Appear.release(path)
        resolve({ before, after: circleDrawn(), dash: [dashBefore, dash()] })
      }))
    expect(Math.abs(handoff.after.cx - handoff.before.cx)).toBeLessThanOrEqual(0.11)
    expect(Math.abs(handoff.after.r - handoff.before.r)).toBeLessThanOrEqual(0.11)
    expect(Math.abs(handoff.after.strokeWidth - handoff.before.strokeWidth)).toBeLessThanOrEqual(0.11)
    expect(Math.abs(handoff.after.opacity - handoff.before.opacity)).toBeLessThanOrEqual(0.0025)
    expect(Math.abs(handoff.dash[1] - handoff.dash[0])).toBeLessThanOrEqual(0.0011)
    expect(circle.getAnimations()).toHaveLength(0)
    expect(path.getAnimations()).toHaveLength(0)
  })

  it("HA8: a late chunk's style is adopted into the head, its animation running on (#245)", async () => {
    const spec = { key: "HA8", tag: "div", machine: () => rise() }
    const sheet = Appear.sheet()
    expect(sheet.css(), "the head: nothing yet").toBe("")
    const slot = sheet.slot()
    slot.define({ spec, delay: 0 })
    // The chunk as a stream lands it: its element, then its style, in the body.
    const host = document.createElement("div")
    host.innerHTML = `<div data-k="late" style="width: 40px; height: 40px; transform: translateY(40px); opacity: 0; animation: ${slot.animation}"></div>${Appear.chunkStyle(sheet.css())}`
    document.body.append(host)
    const element = host.querySelector<HTMLElement>("[data-k=late]")!
    cleanups.push(() => {
      host.remove()
      for (const style of document.head.querySelectorAll("style[data-wardic-appear]")) style.remove()
    })
    await wait(120)
    const animation = found(element)
    const before = Number(animation.currentTime)
    Appear.adoptChunks(document)
    expect(host.querySelector(`style[${Appear.CHUNK_ATTRIBUTE}]`), "the node is gone").toBeNull()
    expect(document.head.querySelector("style[data-wardic-appear]")?.textContent).toContain(`@keyframes ${Appear.nameOf(spec)}{`)
    await raf()
    expect(found(element), "the same animation").toBe(animation)
    expect(Number(animation.currentTime)).toBeGreaterThan(before)
    expect(drawn(element).opacity, "still drawn by it").toBeGreaterThan(0.05)
    // Another call, as a second provider hydrating makes: what's there now is moved too.
    host.insertAdjacentHTML("beforeend", Appear.chunkStyle("@keyframes ha8-second{to{opacity:1}}"))
    Appear.adoptChunks(document)
    expect(host.querySelector(`style[${Appear.CHUNK_ATTRIBUTE}]`), "moved on the second call").toBeNull()
    // A document still loading: a chunk landing later is moved as it lands; after DOMContentLoaded, none is.
    const frame = document.createElement("iframe")
    document.body.append(frame)
    cleanups.push(() => frame.remove())
    const doc = frame.contentDocument!
    doc.open()
    doc.write("<!doctype html><html><head></head><body>")
    expect(doc.readyState).toBe("loading")
    Appear.adoptChunks(doc)
    doc.write(`<p>later</p>${Appear.chunkStyle("@keyframes ha8-late{to{opacity:1}}")}`)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(doc.querySelector(`body style[${Appear.CHUNK_ATTRIBUTE}]`), "moved as it landed").toBeNull()
    expect(doc.head.textContent).toContain("ha8-late")
    doc.write("</body></html>")
    doc.close()
    await new Promise((resolve) => setTimeout(resolve, 0))
    doc.body.insertAdjacentHTML("beforeend", Appear.chunkStyle("@keyframes ha8-after{to{opacity:1}}"))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(doc.querySelector(`body style[${Appear.CHUNK_ATTRIBUTE}]`), "after DOMContentLoaded nothing watches").not.toBeNull()
  })

  it("HA4: a finished animation still fills, and is still found, past its end", async () => {
    const spec = { key: "HA4", tag: "div", machine: () => Machine.springValues({ y: 0, opacity: 1 }, { stiffness: 900, damping: 60 }, { y: 40, opacity: 0 }) }
    const rule = Result.getOrThrow(Appear.keyframes(spec))
    const element = appear(spec)
    await wait(rule.duration * 1000 + 150)
    await raf()
    const animation = found(element)
    expect(Appear.elapsedOf(animation)).toBeGreaterThan(rule.duration)
    expect(drawn(element)).toEqual({ y: 0, opacity: 1 })
  })

  it("HA5: an undefined custom property plays nothing; the element keeps its inline Starting style", async () => {
    const element = appear({ key: "HA5", tag: "div", machine: () => rise() }, 0, "var(--wardic-never-defined)")
    await raf()
    await raf()
    expect(Option.isNone(Appear.find(element))).toBe(true)
    expect(drawn(element)).toEqual({ y: 40, opacity: 0 })
  })

  it("HA6: a delay holds the first stop, and counts toward the elapsed time", async () => {
    const element = appear({ key: "HA6", tag: "div", machine: () => rise() }, 10)
    await wait(100)
    await raf()
    const animation = found(element)
    expect(drawn(element)).toEqual({ y: 40, opacity: 0 })
    expect(Appear.elapsedOf(animation)).toBeGreaterThan(0.05)
    expect(Appear.elapsedOf(animation)).toBeLessThan(1)
    expect(Appear.delayOf(animation), "its animation-delay, in seconds").toBe(10)
  })
})
