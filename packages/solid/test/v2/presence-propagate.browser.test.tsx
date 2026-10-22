// `<AnimatePresence propagate>` on Solid 2 (#277's PR 5c, ADR-0048), as the Solid 1 binding's PG tests
// pin it. Real frames, under the diagnostics gate.
//
// - GV1: the inner child's exit runs, and the outer child stays until it ends.
// - GV2: the inner presence removed on its own, its outer child staying: torn down as before.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { createSignal, flush, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)

describe("AnimatePresence propagate on Solid 2 (#277)", () => {
  it("GV1: the inner child's exit runs, and the outer child stays until it ends", async () => {
    const [open, setOpen] = createSignal(true)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={open()}>
            <wardic.section data-k="outer" exit={{ opacity: 0.5 }} transition={{ type: "tween", duration: 0.1 }}>
              <AnimatePresence propagate>
                <wardic.div data-k="inner" exit={{ opacity: 0 }} transition={{ type: "tween", duration: 0.5 }} />
              </AnimatePresence>
            </wardic.section>
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await frames(3)
    const o = host.querySelector<HTMLElement>('[data-k="outer"]')!
    const i = host.querySelector<HTMLElement>('[data-k="inner"]')!
    setOpen(false)
    flush()
    const t0 = performance.now()
    let innerFaded = false
    await until(() => {
      if (o.isConnected && opacityOf(i) < 0.9) innerFaded = true
      return !o.isConnected
    }, 3000)
    expect(innerFaded, "the inner exit ran").toBe(true)
    expect(performance.now() - t0, "the outer child stayed for it").toBeGreaterThan(450)
    expect(o.isConnected, "and went after").toBe(false)
  })

  it("GV2: the inner presence removed on its own, its outer child staying: torn down as before", async () => {
    const [inner, setInner] = createSignal(true)
    const [shown, setShown] = createSignal(true)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <wardic.section data-k="outer">
            <Show when={inner()}>
              <AnimatePresence propagate>
                <Show when={shown()}>
                  <wardic.div data-k="inner" exit={{ opacity: 0 }} transition={{ type: "tween", duration: 0.5 }} />
                </Show>
              </AnimatePresence>
            </Show>
          </wardic.section>
        </AnimatePresence>
      </WardicProvider>
    ))
    await frames(3)
    const i = host.querySelector<HTMLElement>('[data-k="inner"]')!
    setShown(false)
    flush()
    await frames(2)
    expect(i.isConnected, "exiting in the inner presence").toBe(true)
    setInner(false)
    flush()
    await frames(2)
    expect(i.isConnected, "the inner presence's teardown removed it").toBe(false)
  })
})
