// A Wardic instance at runtime on Solid 2 (#516, ADR-0067 *Amendment (#516)*): `createWardic(features)`'s
// elements and wards bring its Features wherever they render.
// - INV1: an instance of `hover`: its `w.div` hovers under a provider given no Features.
// - INV2: joined with its section's: under a `LazyWardic` giving `press`, an instance of `hover`'s element
//   taps too, a prop its types don't take, given untyped.
// - INV3: every form of its `w` brings them: `w.create(tag)`, `w.create(Component)` and `w.ward()`.
// - INV7: `strict` allows an instance's elements, an instance of `domMax`'s too; a `wardic.*` still throws.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { createWardic, domMax, hover, LazyWardic, press, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { Errored, flush } from "solid-js"
import { describe, expect, it } from "vitest"
import { opacityOf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"
import { settle } from "./reorder-scene.tsx"

const BOX: JSX.CSSProperties = { width: "40px", height: "40px" }
const TWEEN = { type: "tween", duration: 0.2 } as const

/** Enters `el` with the pointer, then reads `done`: again and again, as the recognizer attaches asynchronously. */
const entering = (el: HTMLElement, done: () => boolean) => (): boolean => {
  el.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1, bubbles: true }))
  return done()
}

/** Presses `el` with the primary pointer, then reads `done`: again and again, as the recognizer attaches asynchronously. */
const pressing = (el: HTMLElement, done: () => boolean) => (): boolean => {
  const r = el.getBoundingClientRect()
  el.dispatchEvent(new PointerEvent("pointerdown", { clientX: r.left + 5, clientY: r.top + 5, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true, bubbles: true }))
  return done()
}

/** Enters `el` until `done`, failing after `ms`. */
const hoverUntil = (el: HTMLElement, done: () => boolean, ms: number): Promise<void> => until(entering(el, done), ms)

describe("A Wardic instance (#516), Solid 2", () => {
  it("INV1: an instance of hover: its w.div hovers under a provider given no Features", async () => {
    const { w } = createWardic([hover])
    let el!: HTMLElement
    mount(() => (
      <WardicProvider env={DomLive}>
        <w.div ref={(n: HTMLElement) => (el = n)} style={BOX} initial={{ opacity: 0.2 }} animate={{ opacity: 0.2 }} whileHover={{ opacity: 1 }} transition={TWEEN} />
      </WardicProvider>
    ))
    await settle()
    await hoverUntil(el, () => opacityOf(el) > 0.5, 2000)
    await until(() => opacityOf(el) === 1, 2000)
    expect(opacityOf(el)).toBe(1)
  })

  it("INV3: every form brings them: w.create(tag), w.create(Component) and w.ward()", async () => {
    const { w } = createWardic([hover])
    const HOVERS = { initial: { opacity: 0.2 }, animate: { opacity: 0.2 }, whileHover: { opacity: 1 }, transition: TWEEN } as const
    const Span = w.create("span")
    const Section = w.create((props: { readonly ref?: JSX.Ref<HTMLElement> }) => <section {...props} />)
    const els: Array<HTMLElement> = []
    const Spread = (): JSX.Element => {
      const card = w.ward(HOVERS)
      return <div data-spread {...card.with({ style: BOX })} />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Span ref={(n: HTMLElement) => els.push(n)} style={BOX} {...HOVERS} />
        <Section ref={(n: HTMLElement) => els.push(n)} style={BOX} {...HOVERS} />
        <Spread />
      </WardicProvider>
    ))
    await settle()
    els.push(host.querySelector<HTMLElement>("[data-spread]")!)
    expect(els).toHaveLength(3)
    for (const el of els) await hoverUntil(el, () => opacityOf(el) > 0.5, 2000)
    await until(() => els.every((el) => opacityOf(el) === 1), 2000)
    expect(els.map(opacityOf)).toEqual([1, 1, 1])
  })

  it("INV2: joined with its section's: under a LazyWardic giving press, an instance of hover's element taps too", async () => {
    const { w } = createWardic([hover])
    // A prop its types don't take: the section's Feature works all the same.
    const taps = { whileTap: { opacity: 1 } } as {}
    let el!: HTMLElement
    mount(() => (
      <WardicProvider env={DomLive}>
        <LazyWardic features={[press]}>
          <w.div ref={(n: HTMLElement) => (el = n)} style={BOX} initial={{ opacity: 0.2 }} animate={{ opacity: 0.2 }} transition={TWEEN} {...taps} />
        </LazyWardic>
      </WardicProvider>
    ))
    await settle()
    await until(pressing(el, () => opacityOf(el) > 0.5), 2000)
    await until(() => opacityOf(el) === 1, 2000)
    expect(opacityOf(el)).toBe(1)
  })

  it("INV7: strict allows an instance's elements, an instance of domMax's too; a wardic.* still throws", async () => {
    const { w } = createWardic(domMax)
    let el!: HTMLElement
    mount(() => (
      <WardicProvider env={DomLive} strict>
        <w.div ref={(n: HTMLElement) => (el = n)} style={BOX} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={TWEEN} />
      </WardicProvider>
    ))
    await until(() => opacityOf(el) === 1, 2000)
    expect(opacityOf(el)).toBe(1)
    const { host } = mount(() => (
      <WardicProvider env={DomLive} strict>
        <Errored fallback={(error) => <p data-error>{String(error())}</p>}>
          <wardic.div />
        </Errored>
      </WardicProvider>
    ))
    flush()
    expect(host.querySelector("[data-error]")?.textContent).toMatch(/strict WardicProvider or LazyWardic/)
  })
})
