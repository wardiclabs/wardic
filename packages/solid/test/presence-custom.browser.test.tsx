// Exits by name, dynamic exits and `<AnimatePresence custom>` on Solid 1 (#277, ADR-0048), and exits
// on their transition. Real frames.
//
// - PC1: the slideshow: a leaver's dynamic exit resolves with the presence's latest `custom`, not
//   its own last one.
// - PC2: with no presence `custom`, it resolves with its own last one.
// - PC3: `exit` names a plain variant.
// - PC4: an exit runs on the element's `transition` (it ran on a default spring, whatever it said).
// - PC5: an exit's own transition, over the element's.
// - PC6: an exit's transition `delay` holds it before it moves.
// - PC7: with no presence `custom`, a `custom` changed while the child was alive is the one its exit
//   resolves with.
import { cleanup, render } from "@solidjs/testing-library"
import * as Easing from "@wardic/core/Easing"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider, type WardicTransition, type WardicVariants } from "@wardic/solid"
import { batch, createSignal, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const xOf = (el: HTMLElement): number => new DOMMatrix(getComputedStyle(el).transform).m41
const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)

/** Wait until `seconds` have passed since `from` (performance.now() ms). */
const passed = async (from: number, seconds: number): Promise<void> => {
  while (performance.now() - from < seconds * 1000) await raf()
}

const slides: WardicVariants = {
  enter: (d: number) => ({ x: d * 100, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (d: number) => ({ x: -d * 100, opacity: 0 }),
}

const QUICK = { type: "tween", duration: 0.1 } as const

/** A slideshow: one page at a time, entering and leaving the way `direction` says. */
const mountSlides = (presenceCustom: boolean) => {
  const [page, setPage] = createSignal(1)
  const [direction, setDirection] = createSignal(1)
  const custom = (): { custom?: number } => {
    if (presenceCustom) return { custom: direction() }
    return {}
  }
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <AnimatePresence initial={false} {...custom()}>
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
  const node = (p: number): HTMLElement => container.querySelector<HTMLElement>(`[data-page="${p}"]`)!
  const go = (to: number, d: number): void => batch(() => {
    setDirection(d)
    setPage(to)
  })
  return { node, go, turn: setDirection, show: setPage }
}

/** A presence around one Wardic child with `props`; `close` takes it out. */
const mountOne = (child: () => JSX.Element) => {
  const [open, setOpen] = createSignal(true)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <AnimatePresence>
        <Show when={open()}>{child()}</Show>
      </AnimatePresence>
    </WardicProvider>
  ))
  return { node: (): HTMLElement => container.querySelector<HTMLElement>("[data-one]")!, close: () => setOpen(false) }
}

describe("exits by name and custom on Solid 1 (#277)", () => {
  it("PC1: a leaver's dynamic exit resolves with the presence's latest custom", async () => {
    const show = mountSlides(true)
    await frames(3)
    const first = show.node(1)
    // Its own custom is 1 (it'd leave toward -100); the presence's is now -1: it leaves toward +100.
    show.go(2, -1)
    await until(() => Math.abs(xOf(first)) > 20, 2000)
    expect(xOf(first), "toward +100").toBeGreaterThan(20)
    expect(xOf(show.node(2)), "the new page enters from -100").toBeLessThan(0)
  })

  it("PC2: with no presence custom, it resolves with its own last one", async () => {
    const show = mountSlides(false)
    await frames(3)
    const first = show.node(1)
    show.go(2, -1)
    await until(() => Math.abs(xOf(first)) > 20, 2000)
    expect(xOf(first), "its own 1: toward -100").toBeLessThan(-20)
  })

  it("PC3: exit names a plain variant", async () => {
    const one = mountOne(() => <wardic.div data-one variants={{ gone: { x: 60 } }} exit="gone" transition={QUICK} />)
    await frames(3)
    const el = one.node()
    one.close()
    let reached = 0
    await until(() => {
      if (el.isConnected) reached = Math.max(reached, xOf(el))
      return !el.isConnected
    }, 2000)
    expect(reached, "it went toward 60").toBeGreaterThan(30)
  })

  it("PC4: an exit runs on the element's transition", async () => {
    const linear: WardicTransition = { type: "tween", duration: 0.6, easing: Easing.linear }
    const one = mountOne(() => <wardic.div data-one initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={linear} />)
    await frames(3)
    const el = one.node()
    one.close()
    const t0 = performance.now()
    await passed(t0, 0.3)
    expect(opacityOf(el), "a linear 0.6 s tween, half way").toBeGreaterThan(0.3)
    expect(opacityOf(el)).toBeLessThan(0.7)
    await until(() => !el.isConnected, 2000)
    expect(performance.now() - t0, "gone once it ends").toBeGreaterThan(550)
  })

  it("PC5: an exit's own transition, over the element's", async () => {
    const one = mountOne(() => (
      <wardic.div data-one initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: QUICK }} transition={{ type: "tween", duration: 3 }} />
    ))
    await frames(3)
    const el = one.node()
    one.close()
    const t0 = performance.now()
    await until(() => !el.isConnected, 2000)
    expect(performance.now() - t0, "its own 0.1 s, not the element's 3 s").toBeLessThan(600)
  })

  it("PC6: an exit's transition delay holds it before it moves", async () => {
    const one = mountOne(() => (
      <wardic.div data-one initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { type: "tween", duration: 0.1, delay: 0.4 } }} />
    ))
    await frames(3)
    const el = one.node()
    one.close()
    const t0 = performance.now()
    await passed(t0, 0.25)
    expect(opacityOf(el), "held").toBe(1)
    await until(() => !el.isConnected, 2000)
    expect(performance.now() - t0).toBeGreaterThan(400)
  })

  it("PC7: a custom changed while the child was alive is the one its exit resolves with", async () => {
    const show = mountSlides(false)
    await frames(3)
    const first = show.node(1)
    show.turn(-1)
    await frames(3)
    show.show(2)
    await until(() => Math.abs(xOf(first)) > 20, 2000)
    expect(xOf(first), "its own -1 by then: toward +100").toBeGreaterThan(20)
  })
})
