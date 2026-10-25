// A plain (non-Wardic) `<AnimatePresence>` child on Solid 2 (#392, ADR-0048 Amendment (#392)), as
// the Solid 1 binding's PN tests pin it. Real frames, under the diagnostics gate.
//
// - PN10: a Wardic element inside it runs its exit; the child stays until it ends.
// - PN11: a `layoutId` twin inside it hands back (a crossfade with its other twin); the child stays for it.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import { createSignal, flush, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)

/** A presence around one child, beside `outside`; `close` takes it out; `q` finds a `data-k`. */
const mountOne = (child: () => JSX.Element, outside: () => JSX.Element = () => null) => {
  const [open, setOpen] = createSignal(true)
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      {outside()}
      <AnimatePresence>
        <Show when={open()}>{child()}</Show>
      </AnimatePresence>
    </WardicProvider>
  ))
  return {
    q: (k: string): HTMLElement => host.querySelector<HTMLElement>(`[data-k="${k}"]`)!,
    close: () => {
      setOpen(false)
      flush()
    },
  }
}

describe("a plain presence child on Solid 2 (#392)", () => {
  it("PN10: a Wardic element inside it runs its exit; the child stays until it ends", async () => {
    const one = mountOne(() => (
      <div data-k="frame">
        <wardic.article data-k="panel" exit={{ opacity: 0 }} transition={{ type: "tween", duration: 0.3 }}>
          x
        </wardic.article>
      </div>
    ))
    await frames(3)
    const frame = one.q("frame")
    const panel = one.q("panel")
    one.close()
    await raf()
    expect(frame.isConnected, "the plain child stays").toBe(true)
    let mid = false
    await until(() => {
      const o = opacityOf(panel)
      if (Math.min(o, 1 - o) > 0.1 && frame.isConnected) mid = true
      return !frame.isConnected
    }, 3000)
    expect(mid, "the panel faded while the child stayed").toBe(true)
    expect(frame.isConnected, "gone once the exit ended").toBe(false)
  })

  it("PN11: a layoutId twin inside it hands back; the child stays for the crossfade", async () => {
    const box = (size: number): JSX.CSSProperties => ({ width: `${size}px`, height: `${size}px` })
    const one = mountOne(
      () => (
        <div data-k="frame" style={{ position: "fixed", left: "300px", top: "200px" }}>
          <wardic.div data-k="detail" layoutId="twin" style={box(200)} />
        </div>
      ),
      () => <wardic.div data-k="card" layoutId="twin" style={box(50)} />,
    )
    await frames(60)
    const frame = one.q("frame")
    const detail = one.q("detail")
    const card = one.q("card")
    one.close()
    const start = performance.now()
    let detailFading = false
    let cardFading = false
    await until(() => {
      const d = opacityOf(detail)
      const c = opacityOf(card)
      if (Math.min(d, 1 - d) > 0.1 && frame.isConnected) detailFading = true
      if (Math.min(c, 1 - c) > 0.1) cardFading = true
      return !frame.isConnected
    }, 3000)
    expect(detailFading, "the leaving twin faded out").toBe(true)
    expect(cardFading, "its other twin faded in").toBe(true)
    expect(performance.now() - start, "the child stayed for the handover").toBeGreaterThan(200)
    expect(frame.isConnected).toBe(false)
  })
})
