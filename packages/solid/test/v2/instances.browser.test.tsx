// A Wardic instance at runtime on Solid 2 (#516, ADR-0067 *Amendment (#516)*): `createWardic(features)`'s
// elements and wards bring its Features wherever they render.
// - INV1: an instance of `hover`: its `w.div` hovers under a provider given no Features.
// - INV2: joined with its section's: under a `LazyWardic` giving `press`, an instance of `hover`'s element
//   taps too, a prop its types don't take, given untyped.
// - INV3: every form of its `w` brings them: `w.create(tag)`, `w.create(Component)` and `w.ward()`.
// - INV7: `strict` allows an instance's elements, an instance of `domMax`'s too; a `wardic.*` still throws.
// - INV4: a load in its list starts at its first element's mount, not as it's made, once for two elements
//   under two providers; nothing is said while it's on its way, and its Feature takes effect as it
//   arrives: a drag before then does nothing, one after drags.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { createWardic, domMax, drag, hover, LazyWardic, press, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { Errored, flush } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { opacityOf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"
import { pushedPointer } from "../pushed-pointer.ts"
import { settle, wait } from "./reorder-scene.tsx"

const BOX: JSX.CSSProperties = { width: "40px", height: "40px" }
const TWEEN = { type: "tween", duration: 0.2 } as const

/** Enters `el` with the pointer, then reads `done`: again and again, as the recognizer attaches asynchronously. */
const entering = (el: HTMLElement, done: () => boolean) => (): boolean => {
  el.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1, bubbles: true }))
  return done()
}

const word = (feature: string): string => `needs the \`${feature}\` Feature`

/** Every line logged while `run` runs. */
const logged = async (run: () => Promise<void>): Promise<ReadonlyArray<string>> => {
  const lines: Array<string> = []
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: Array<unknown>) => {
      lines.push(args.map(String).join(" "))
    }),
  )
  try {
    await run()
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
  return lines
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

  it("INV4: a load starts at the first element's mount, once for two providers; its Feature takes effect as it arrives", async () => {
    const pointer = pushedPointer()
    let calls = 0
    let arrive!: () => void
    const load = (): Promise<typeof drag> => {
      calls += 1
      return new Promise((resolve) => {
        arrive = () => resolve(drag)
      })
    }
    const { w } = createWardic([load])
    expect(calls, "nothing loads as the instance is made").toBe(0)
    let el!: HTMLElement
    const lines = await logged(async () => {
      mount(() => (
        <>
          <WardicProvider env={pointer.env}>
            <w.div ref={(n: HTMLElement) => (el = n)} style={BOX} drag="x" dragMomentum={false} />
          </WardicProvider>
          <WardicProvider env={DomLive}>
            <w.div style={BOX} drag="x" />
          </WardicProvider>
        </>
      ))
      await settle()
    })
    expect(calls, "one load, at the first mount").toBe(1)
    expect(lines.filter((l) => l.includes(word("drag"))), "nothing said while it's on its way").toEqual([])
    const x0 = el.getBoundingClientRect().left
    const fling = (): void => {
      pointer.push("down", 0)
      for (let k = 1; k <= 5; k++) pointer.push("move", 20 * k)
      pointer.push("up", 100)
    }
    fling()
    await wait(100)
    expect(el.getBoundingClientRect().left - x0, "a drag before it arrives does nothing").toBe(0)
    arrive()
    await wait(50)
    fling()
    await until(() => el.getBoundingClientRect().left - x0 > 90, 2000)
    expect(el.getBoundingClientRect().left - x0, "dragged once it's here").toBeGreaterThan(90)
    expect(calls, "still one load").toBe(1)
  })
})
