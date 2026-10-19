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
// - HA6: a delay holds the first stop, and counts toward the elapsed time.
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
    const spec = { key: "HA1", tag: "div", machine: rise() }
    const element = appear(spec)
    await wait(120)
    const reads: Array<{ readonly elapsed: number; readonly y: number; readonly opacity: number }> = []
    for (let i = 0; i < 12; i++) {
      await raf()
      reads.push({ elapsed: Appear.elapsedOf(found(element)), ...drawn(element) })
    }
    expect(reads[0]!.elapsed).toBeGreaterThan(0.08)
    for (const read of reads) {
      const frame = at(spec.machine, read.elapsed)
      expect(Math.abs(read.y - (frame.y as number)), `y at ${read.elapsed}`).toBeLessThanOrEqual(0.11)
      expect(Math.abs(read.opacity - (frame.opacity as number)), `opacity at ${read.elapsed}`).toBeLessThanOrEqual(0.0025)
    }
  })

  it("HA2: find gets the element's wardic- animation, and only it; matches tells its spec", async () => {
    const spec = { key: "HA2", tag: "div", machine: rise() }
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
    const spec = { key: "HA3", tag: "div", machine: rise() }
    const element = appear(spec)
    await wait(150)
    const handoff = await new Promise<{ readonly before: ReturnType<typeof drawn>; readonly after: ReturnType<typeof drawn> }>((resolve) =>
      requestAnimationFrame(() => {
        const animation = found(element)
        const before = drawn(element)
        const frame = at(spec.machine, Appear.elapsedOf(animation))
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

  it("HA4: a finished animation still fills, and is still found, past its end", async () => {
    const spec = { key: "HA4", tag: "div", machine: Machine.springValues({ y: 0, opacity: 1 }, { stiffness: 900, damping: 60 }, { y: 40, opacity: 0 }) }
    const rule = Result.getOrThrow(Appear.keyframes(spec))
    const element = appear(spec)
    await wait(rule.duration * 1000 + 150)
    await raf()
    const animation = found(element)
    expect(Appear.elapsedOf(animation)).toBeGreaterThan(rule.duration)
    expect(drawn(element)).toEqual({ y: 0, opacity: 1 })
  })

  it("HA5: an undefined custom property plays nothing; the element keeps its inline Starting style", async () => {
    const element = appear({ key: "HA5", tag: "div", machine: rise() }, 0, "var(--wardic-never-defined)")
    await raf()
    await raf()
    expect(Option.isNone(Appear.find(element))).toBe(true)
    expect(drawn(element)).toEqual({ y: 40, opacity: 0 })
  })

  it("HA6: a delay holds the first stop, and counts toward the elapsed time", async () => {
    const element = appear({ key: "HA6", tag: "div", machine: rise() }, 10)
    await wait(100)
    await raf()
    const animation = found(element)
    expect(drawn(element)).toEqual({ y: 40, opacity: 0 })
    expect(Appear.elapsedOf(animation)).toBeGreaterThan(0.05)
    expect(Appear.elapsedOf(animation)).toBeLessThan(1)
  })
})
