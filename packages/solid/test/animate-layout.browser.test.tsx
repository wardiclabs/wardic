// A **Declared layout change** in Solid (#4, ADR-0038): `useAnimateLayout()`, in real paint, on a
// keyed `<For>` of `layout` items with no `layoutDependency`. A reorder moves the items' DOM nodes
// without resizing any of them, so no trigger sees it.
//
// - AL1: reordered through `animateLayout`, the first item animates from where it was to its new
//   place; reordered plainly, it jumps there (the gap #4 closes).
// - AL2: the callback runs at once: its change is in the DOM inside it, and its result comes back.
// - AL3: outside a provider, `useAnimateLayout` throws a clear, named error.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { type AnimateLayout, useAnimateLayout, wardic, WardicProvider } from "@wardic/solid"
import { createRoot, createSignal, For } from "solid-js"
import { afterEach, expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"

afterEach(cleanup)

/** `read()` just after each of the next `n` frames' paints from `act`. */
const paintsAfter = <A,>(act: () => void, read: () => A, n: number): Promise<Array<A>> =>
  new Promise((resolve) => {
    const out: Array<A> = []
    let acted = false
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      if (acted) out.push(read())
      else act()
      acted = true
      if (out.length >= n) return resolve(out)
      requestAnimationFrame(() => ch.port2.postMessage(undefined))
    }
    requestAnimationFrame(() => ch.port2.postMessage(undefined))
  })

/** A column of three 40 px `layout` items, 10 px apart, keyed by value; `animateLayout` from inside the provider. */
const mount = async () => {
  const [items, setItems] = createSignal(["a", "b", "c"])
  let animateLayout: AnimateLayout | undefined
  const Grab = () => {
    animateLayout = useAnimateLayout()
    return null
  }
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <Grab />
      <div style={{ position: "relative", width: "100px" }}>
        <For each={items()}>
          {(value) => <wardic.div data-item={value} layout style={{ width: "100px", height: "40px", "margin-bottom": "10px", background: "teal" }} />}
        </For>
      </div>
    </WardicProvider>
  ))
  for (let i = 0; i < 5; i++) await raf()
  const item = (value: string): HTMLElement => container.querySelector<HTMLElement>(`[data-item="${value}"]`)!
  const top = item("a").getBoundingClientRect().top
  return { setItems, animateLayout: animateLayout!, container, aTop: () => item("a").getBoundingClientRect().top - top }
}

it("AL1: a keyed <For> reorder animates through animateLayout; a plain one jumps", async () => {
  const declared = await mount()
  const tops = await paintsAfter(() => declared.animateLayout(() => declared.setItems(["c", "b", "a"])), declared.aTop, 60)
  expect(tops[0]!, "the first frame: still near where it was").toBeLessThan(20)
  expect(tops.at(-1)!, "lands at its new place, 100 px down").toBeCloseTo(100, 1)
  for (let i = 1; i < tops.length; i++) expect(tops[i]!, `frame ${i}: on its way down`).toBeGreaterThanOrEqual(tops[i - 1]! - 1e-6)
  cleanup()

  const plain = await mount()
  const jumped = await paintsAfter(() => plain.setItems(["c", "b", "a"]), plain.aTop, 3)
  expect(jumped[0]!, "no trigger sees it: there at once").toBeCloseTo(100, 1)
})

it("AL2: the callback runs at once: its change is in the DOM inside it, and its result comes back", async () => {
  const m = await mount()
  const first = m.animateLayout(() => {
    m.setItems(["c", "b", "a"])
    return m.container.querySelector("[data-item]")?.getAttribute("data-item")
  })
  expect(first).toBe("c")
})

it("AL3: outside a provider, useAnimateLayout throws a clear, named error", () => {
  expect(() =>
    createRoot((dispose) => {
      try {
        useAnimateLayout()
      } finally {
        dispose()
      }
    }),
  ).toThrow("useAnimateLayout must be used within a <WardicProvider>")
})
