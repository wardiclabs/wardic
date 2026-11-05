// `layoutDependency` asks for a Measure pass only when its value changes, as Motion's
// `prevProps.layoutDependency !== layoutDependency` (#618, decision 1). Here something it reads changes
// while its value doesn't, and the element is moved by its class in the same update: with no Measure
// pass, the element is at its new place at once, with no layout animation from its old one.
//
// - LD1: an element's: its value unchanged, no Measure pass.
// - LD2: an element's: its value changed, the element animates from its old place.
// - LD3: a LayoutGroup's: its value unchanged, no Measure pass of the tree.
// - LD4: a LayoutGroup's: its value changed, the moved element animates.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { LayoutGroup, wardic, WardicProvider } from "@wardic/solid"
import { batch, createSignal } from "solid-js"
import { afterEach, expect, it } from "vitest"
import { leftOf, raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const CSS = `
  .ld-box{position:absolute;top:0;left:0;width:100px;height:100px}
  .ld-box.moved{left:200px}
`

/** The box's left over the next `count` frames. */
const leftsOver = async (box: Element, count: number): Promise<ReadonlyArray<number>> => {
  const lefts: Array<number> = []
  for (let i = 0; i < count; i++) {
    await raf()
    lefts.push(leftOf(box))
  }
  return lefts
}

/** A box moved by its class, and a `tick` its `layoutDependency` reads: `same` keeps the value, else it follows `tick`. */
const scene = (where: "element" | "group", same: boolean) => {
  const [moved, setMoved] = createSignal(false)
  const [tick, setTick] = createSignal(0)
  const dependency = (): unknown => {
    if (same) return tick() >= 0
    return tick()
  }
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <div style={{ position: "relative", width: "600px", height: "200px" }}>
        {where === "element" && <wardic.div data-box class="ld-box" classList={{ moved: moved() }} layout layoutDependency={dependency()} />}
        {where === "group" && (
          <LayoutGroup layoutDependency={dependency()}>
            <wardic.div data-box class="ld-box" classList={{ moved: moved() }} layout />
          </LayoutGroup>
        )}
      </div>
    </WardicProvider>
  ))
  const box = container.querySelector("[data-box]") as HTMLElement
  const change = (): void =>
    batch(() => {
      setMoved(true)
      setTick(1)
    })
  return { box, change }
}

it("LD1: an element's layoutDependency read again at the same value asks for no Measure pass", async () => {
  const { box, change } = scene("element", true)
  await raf()
  await raf()
  const base = leftOf(box)
  change()
  const lefts = await leftsOver(box, 4)
  expect(lefts.every((left) => Math.abs(left - (base + 200)) < 1), `at its new place at once: ${lefts}`).toBe(true)
})

it("LD2: an element's layoutDependency at a new value animates the move", async () => {
  const { box, change } = scene("element", false)
  await raf()
  await raf()
  const base = leftOf(box)
  change()
  await until(() => leftOf(box) < base + 100)
  await until(() => Math.abs(leftOf(box) - (base + 200)) < 1)
})

it("LD3: a LayoutGroup's layoutDependency read again at the same value asks for no Measure pass", async () => {
  const { box, change } = scene("group", true)
  await raf()
  await raf()
  const base = leftOf(box)
  change()
  const lefts = await leftsOver(box, 4)
  expect(lefts.every((left) => Math.abs(left - (base + 200)) < 1), `at its new place at once: ${lefts}`).toBe(true)
})

it("LD4: a LayoutGroup's layoutDependency at a new value animates the move", async () => {
  const { box, change } = scene("group", false)
  await raf()
  await raf()
  const base = leftOf(box)
  change()
  await until(() => leftOf(box) < base + 100)
  await until(() => Math.abs(leftOf(box) - (base + 200)) < 1)
})
