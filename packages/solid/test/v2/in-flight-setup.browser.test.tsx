// A ward made in the update that changed what its config reads (#335, ADR-0045 *Amendment (#335)*):
// its setup reads its config's in-flight values, the ones the update renders with, not those from
// before it. The setup reads with no reader (#257 item 1), and Solid 2 shows a read outside the
// update's owner tree the committed values. In a real browser.
//
// - IF1: a `wardic.<tag>` inside `<Show when={item()}>{(it) => …}` reading the narrowed accessor in
//   `layoutId` and `animate`: it mounts and animates to the item's target, and goes when the item
//   does. On `main` the setup read `it()` as `undefined`, so `it().id` threw, and the error halted
//   Solid's reactive system (`REACTIVITY_HALTED`).
// - IF2: the same under `<AnimatePresence>`: it enters, then exits on its retained node, and goes.
// - IF3: a `ward()` made in the `<Show>` child, its config's getters reading the accessor.
// - IF4: a `<For>` item added in the same flush as a value its `initial` and `animate` read: it
//   starts at the new value, with nothing to animate. On `main` it started at the old one, and
//   animated across.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, ward, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { createSignal, flush, For, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

interface Item {
  readonly id: string
  readonly opacity: number
}

const BOX = { width: "40px", height: "40px" } as const
const TWEEN = { type: "tween", duration: 0.2 } as const

const opacityOf = (el: Element | null): number => Number(getComputedStyle(el as Element).opacity)
const xOf = (el: Element): number => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41

describe("a ward's setup reads its config's in-flight values (#335)", () => {
  it("IF1: a wardic.<tag> reading a <Show>'s narrowed accessor mounts, animates to it, and goes", async () => {
    const [item, setItem] = createSignal<Item>()
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Show when={item()}>
          {(it) => <wardic.div data-detail layoutId={`detail-${it().id}`} initial={{ opacity: 0 }} animate={{ opacity: it().opacity }} transition={TWEEN} style={BOX} />}
        </Show>
      </WardicProvider>
    ))
    await raf()
    setItem({ id: "a", opacity: 0.5 })
    flush()
    const detail = host.querySelector("[data-detail]")
    expect(detail, "mounted").not.toBeNull()
    await until(() => Math.abs(opacityOf(detail) - 0.5) < 0.01, 2000)
    expect(opacityOf(detail), "animated to the item's opacity").toBeCloseTo(0.5, 2)
    setItem(undefined)
    flush()
    expect(host.querySelector("[data-detail]"), "gone with the item").toBeNull()
  })

  it("IF2: under <AnimatePresence>, it enters, then exits on its retained node, and goes", async () => {
    const [item, setItem] = createSignal<Item>()
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={item()}>
            {(it) => (
              <wardic.div data-detail layoutId={`detail-${it().id}`} initial={{ opacity: 0 }} animate={{ opacity: it().opacity }} exit={{ opacity: 0 }} transition={TWEEN} style={BOX} />
            )}
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await raf()
    setItem({ id: "a", opacity: 1 })
    flush()
    const detail = host.querySelector("[data-detail]")
    expect(detail, "mounted").not.toBeNull()
    await until(() => opacityOf(detail) >= 0.99, 2000)
    expect(opacityOf(detail), "entered").toBeGreaterThanOrEqual(0.99)
    setItem(undefined)
    flush()
    expect(detail!.isConnected, "retained for its exit").toBe(true)
    await until(() => !detail!.isConnected, 2000)
    expect(detail!.isConnected, "gone once it has exited").toBe(false)
  })

  it("IF3: a ward() made in the <Show> child reads the accessor through its config's getters", async () => {
    const [item, setItem] = createSignal<Item>()
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Show when={item()}>
          {(it) => {
            const card = ward({
              get layoutId() {
                return `card-${it().id}`
              },
              initial: { opacity: 0 },
              animate: () => ({ opacity: it().opacity }),
              transition: TWEEN,
            })
            return <div data-card {...card} style={BOX} />
          }}
        </Show>
      </WardicProvider>
    ))
    await raf()
    setItem({ id: "b", opacity: 0.4 })
    flush()
    const card = host.querySelector("[data-card]")
    expect(card, "mounted").not.toBeNull()
    await until(() => Math.abs(opacityOf(card) - 0.4) < 0.01, 2000)
    expect(opacityOf(card)).toBeCloseTo(0.4, 2)
  })

  it("IF4: a <For> item added in the same flush as a value it reads starts at the new value", async () => {
    const [items, setItems] = createSignal<ReadonlyArray<string>>([])
    const [x, setX] = createSignal(0)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <For each={items()}>{(id) => <wardic.div data-item={id} initial={{ x: x() }} animate={{ x: x() }} transition={TWEEN} style={BOX} />}</For>
      </WardicProvider>
    ))
    await raf()
    setItems(["a"])
    setX(100)
    flush()
    const el = host.querySelector("[data-item]")!
    const seen: Array<number> = []
    for (let i = 0; i < 6; i++) {
      await raf()
      seen.push(xOf(el))
    }
    expect(seen, "at the new value from its first frame, nothing to animate").toEqual([100, 100, 100, 100, 100, 100])
  })
})
