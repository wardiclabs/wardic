// `layoutDependency` asks for a Measure pass only when its value changes, as Motion's
// `prevProps.layoutDependency !== layoutDependency` (#618, decision 1): Solid 2's effects never compare.
// Here something it reads changes while its value doesn't, and the element is moved by its class in the
// same update: with no Measure pass, the element is at its new place at once.
//
// - LD1: an element's: its value unchanged, no Measure pass.
// - LD2: an element's: its value changed, the element animates from its old place.
// - LD3: a LayoutGroup's: its value unchanged, no Measure pass of the tree.
// - LD4: a LayoutGroup's: its value changed, the moved element animates.
import { DomLive } from "@wardic/dom"
import { LayoutGroup, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { createSignal, flush, Show } from "solid-js"
import { expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const CSS = `
  .ld-box{position:absolute;top:0;left:0;width:100px;height:100px}
  .ld-box.moved{left:200px}
`

const leftOf = (el: Element): number => el.getBoundingClientRect().left

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
  const Box = () => <wardic.div data-box class={{ "ld-box": true, moved: moved() }} layout layoutDependency={where === "element" && dependency()} />
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <div style={{ position: "relative", width: "600px", height: "200px" }}>
        <Show when={where === "group"} fallback={<Box />}>
          <LayoutGroup layoutDependency={dependency()}>
            <Box />
          </LayoutGroup>
        </Show>
      </div>
    </WardicProvider>
  ))
  const change = (): void => {
    setMoved(true)
    setTick(1)
    flush()
  }
  return { box: () => host.querySelector("[data-box]")!, change }
}

it("LD1: an element's layoutDependency read again at the same value asks for no Measure pass", async () => {
  const { box, change } = scene("element", true)
  await raf()
  await raf()
  const base = leftOf(box())
  change()
  const lefts = await leftsOver(box(), 4)
  expect(lefts.every((left) => Math.abs(left - (base + 200)) < 1), `at its new place at once: ${lefts}`).toBe(true)
})

it("LD2: an element's layoutDependency at a new value animates the move", async () => {
  const { box, change } = scene("element", false)
  await raf()
  await raf()
  const base = leftOf(box())
  change()
  await until(() => leftOf(box()) < base + 100)
  await until(() => Math.abs(leftOf(box()) - (base + 200)) < 1)
})

it("LD3: a LayoutGroup's layoutDependency read again at the same value asks for no Measure pass", async () => {
  const { box, change } = scene("group", true)
  await raf()
  await raf()
  const base = leftOf(box())
  change()
  const lefts = await leftsOver(box(), 4)
  expect(lefts.every((left) => Math.abs(left - (base + 200)) < 1), `at its new place at once: ${lefts}`).toBe(true)
})

it("LD4: a LayoutGroup's layoutDependency at a new value animates the move", async () => {
  const { box, change } = scene("group", false)
  await raf()
  await raf()
  const base = leftOf(box())
  change()
  await until(() => leftOf(box()) < base + 100)
  await until(() => Math.abs(leftOf(box()) - (base + 200)) < 1)
})
