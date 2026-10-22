// Exits inside a leaving `<AnimatePresence>` child on Solid 2 (#290, #277's PR 5a, ADR-0048), as the
// Solid 1 binding's NE tests pin them. Real frames, under the diagnostics gate.
//
// - NV1: an element inside the child runs its own exit, and the child goes after.
// - NV2: Variant children exit on the parent's exit name, staggered by its exit variant's transition.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider, type WardicVariants } from "@wardic/solid/unstable/v2"
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

/** A presence around one child; `close` takes it out; `q` finds a `data-k`. */
const mountOne = (child: () => JSX.Element) => {
  const [open, setOpen] = createSignal(true)
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
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

describe("exits inside a leaving child on Solid 2 (#290)", () => {
  it("NV1: an element inside the child runs its own exit, and the child goes after", async () => {
    const one = mountOne(() => (
      <wardic.div data-k="outer" exit={{ opacity: 0.5 }} transition={{ type: "tween", duration: 0.2 }}>
        <wardic.span data-k="inner" style={{ display: "inline-block" }} exit={{ x: 60 }} transition={{ type: "tween", duration: 0.5 }}>
          x
        </wardic.span>
      </wardic.div>
    ))
    await frames(3)
    const outer = one.q("outer")
    const inner = one.q("inner")
    one.close()
    let innerMoved = false
    const t0 = performance.now()
    await until(() => {
      if (outer.isConnected && xOf(inner) > 10) innerMoved = true
      return !outer.isConnected
    }, 3000)
    expect(innerMoved, "the inner element animated its own exit").toBe(true)
    expect(performance.now() - t0, "the child stayed for the inner exit").toBeGreaterThan(450)
  })

  it("NV2: Variant children exit on the parent's exit name, staggered", async () => {
    const list = { shown: {}, gone: { opacity: 1, transition: { staggerChildren: 0.3 } } } as const satisfies WardicVariants
    const item: WardicVariants = { shown: { opacity: 1 }, gone: { opacity: 0 } }
    const one = mountOne(() => (
      <wardic.ul data-k="list" variants={list} initial="shown" animate="shown" exit="gone" transition={{ type: "tween", duration: 0.1 }}>
        <For each={[0, 1, 2]}>{(i) => <wardic.li data-k={`i${i}`} variants={item} transition={{ type: "tween", duration: 0.1 }} />}</For>
      </wardic.ul>
    ))
    await frames(3)
    const [first, last] = [one.q("i0"), one.q("i2")]
    one.close()
    const t0 = performance.now()
    while (performance.now() - t0 < 250) await raf()
    expect(opacityOf(first), "the first gone").toBeLessThan(0.1)
    expect(opacityOf(last), "the third waits its 0.6 s").toBe(1)
  })
})
