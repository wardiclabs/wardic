// Dynamic variants, `custom` and exits by name on Solid 2 (#277, ADR-0048), as the Solid 1 binding's
// DV and PC tests pin them. Real frames, under the diagnostics gate.
//
// - DW1: a function variant on a `wardic.*` element resolves with its `custom`.
// - DW2: a ward's `custom` given as an accessor: a change re-resolves it, and the value animates.
// - DW3: the slideshow: a leaver's dynamic exit resolves with the presence's latest `custom`.
// - DW4: an exit runs on the element's `transition`.
// - DW5: with no presence `custom`, a `custom` changed while the child was alive is its exit's.
// - DW6: `staggerChildren` in a parent variant's own transition staggers its Variant children.
import * as Easing from "@wardic/core/Easing"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, ward, wardic, WardicProvider, type WardicVariants } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import { createSignal, flush, For, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const xOf = (el: HTMLElement): number => new DOMMatrix(getComputedStyle(el).transform).m41
const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)
const SNAP = { type: "tween", duration: 0.05 } as const

describe("dynamic variants on Solid 2 (#277)", () => {
  it("DW1: a function variant resolves with the element's custom", async () => {
    const variants: WardicVariants = { at: (i: number) => ({ x: i * 10 }) }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div data-k="a" custom={3} variants={variants} initial={{ x: 0 }} animate="at" transition={SNAP} />
      </WardicProvider>
    ))
    const el = host.querySelector<HTMLElement>('[data-k="a"]')!
    await until(() => Math.abs(xOf(el) - 30) < 0.5, 2000)
    expect(xOf(el)).toBeCloseTo(30, 0)
  })

  it("DW2: a ward's custom as an accessor: a change re-resolves it", async () => {
    const [i, setI] = createSignal(2)
    const Box = (): JSX.Element => {
      const box = ward({ custom: i, variants: { at: (n: number) => ({ x: n * 10 }) }, initial: { x: 0 }, animate: "at", transition: SNAP })
      return <div data-k="a" {...box} />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    const el = host.querySelector<HTMLElement>('[data-k="a"]')!
    await until(() => Math.abs(xOf(el) - 20) < 0.5, 2000)
    setI(6)
    flush()
    await until(() => Math.abs(xOf(el) - 60) < 0.5, 2000)
    expect(xOf(el)).toBeCloseTo(60, 0)
  })

  it("DW3: a leaver's dynamic exit resolves with the presence's latest custom", async () => {
    const slides: WardicVariants = {
      enter: (d: number) => ({ x: d * 100 }),
      center: { x: 0 },
      exit: (d: number) => ({ x: -d * 100 }),
    }
    const [page, setPage] = createSignal(1)
    const [direction, setDirection] = createSignal(1)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence initial={false} custom={direction()}>
          <Show when={page()} keyed>
            {(p) => (
              <wardic.div
                data-page={p}
                custom={direction()}
                variants={slides}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: "tween", duration: 0.6, easing: Easing.linear }}
              />
            )}
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await frames(3)
    const first = host.querySelector<HTMLElement>('[data-page="1"]')!
    setDirection(-1)
    setPage(2)
    flush()
    await until(() => Math.abs(xOf(first)) > 20, 2000)
    expect(xOf(first), "toward +100, the presence's -1").toBeGreaterThan(20)
  })

  it("DW4: an exit runs on the element's transition", async () => {
    const [open, setOpen] = createSignal(true)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={open()}>
            <wardic.div data-k="a" initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ type: "tween", duration: 0.6, easing: Easing.linear }} />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await frames(3)
    const el = host.querySelector<HTMLElement>('[data-k="a"]')!
    setOpen(false)
    flush()
    const t0 = performance.now()
    while (performance.now() - t0 < 300) await raf()
    expect(opacityOf(el), "a linear 0.6 s tween, half way").toBeGreaterThan(0.3)
    expect(opacityOf(el)).toBeLessThan(0.7)
  })

  it("DW5: a custom changed while the child was alive is the one its exit resolves with", async () => {
    const slides: WardicVariants = { center: { x: 0 }, exit: (d: number) => ({ x: -d * 100 }) }
    const [open, setOpen] = createSignal(true)
    const [direction, setDirection] = createSignal(1)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={open()}>
            <wardic.div data-k="a" custom={direction()} variants={slides} initial={false} animate="center" exit="exit" transition={{ type: "tween", duration: 0.6 }} />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await frames(3)
    const el = host.querySelector<HTMLElement>('[data-k="a"]')!
    setDirection(-1)
    flush()
    await frames(3)
    setOpen(false)
    flush()
    await until(() => Math.abs(xOf(el)) > 20, 2000)
    expect(xOf(el), "its own -1 by then: toward +100").toBeGreaterThan(20)
  })

  it("DW6: staggerChildren in a parent variant's own transition staggers its children", async () => {
    const parent = { hidden: {}, show: { opacity: 1, transition: { staggerChildren: 0.3 } } } as const satisfies WardicVariants
    const child: WardicVariants = { hidden: { opacity: 0 }, show: { opacity: 1 } }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.ul variants={parent} initial="hidden" animate="show" transition={SNAP}>
          <For each={[0, 1, 2]}>{(i) => <wardic.li data-k={`c${i}`} variants={child} transition={SNAP} />}</For>
        </wardic.ul>
      </WardicProvider>
    ))
    const q = (k: string): HTMLElement => host.querySelector<HTMLElement>(`[data-k="${k}"]`)!
    const t0 = performance.now()
    while (performance.now() - t0 < 250) await raf()
    expect(opacityOf(q("c0")), "the first started").toBeGreaterThan(0.5)
    expect(opacityOf(q("c2")), "the third waits its 0.6 s").toBe(0)
    await until(() => opacityOf(q("c2")) > 0.99, 2000)
  })
})
