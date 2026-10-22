// Variant name lists on Solid 2 (#297's PR 1), as the Solid 1 binding's VL tests pin them. Real frames,
// under the diagnostics gate.
//
// - LV1: a list merges in order, each key on the own transition of the last name that sets it.
// - LV2: each name orchestrates the Variant children's keys it sets: one name's stagger, another's none.
// - LV3: one landing per Retarget, its `definition` the list (Q5); a fresh list with the same names
//   starts no Retarget.
// - LV4 (#297's PR 2): a name's `beforeChildren` holds the children's keys of that name; another
//   name's start at once.
import { DomLive } from "@wardic/dom"
import { type Ward, ward, type WardConfig, wardic, WardicProvider, type WardicVariants } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import * as Bool from "effect/Boolean"
import { createSignal, flush, For } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)
const matrixOf = (el: HTMLElement): DOMMatrix => new DOMMatrix(getComputedStyle(el).transform)
const BOX = { display: "block", width: "20px", height: "20px" } as const
const FAST = { type: "tween", duration: 0.1 } as const
const SLOW = { type: "tween", duration: 1 } as const

const mountIn = (ui: () => JSX.Element) => {
  const { host } = mount(() => <WardicProvider env={DomLive}>{ui()}</WardicProvider>)
  return (k: string): HTMLElement => host.querySelector<HTMLElement>(`[data-k="${k}"]`)!
}

describe("variant name lists on Solid 2 (#297)", () => {
  it("LV1: a list merges in order, each key on the own transition of the last name that sets it", async () => {
    const variants: WardicVariants = { fade: { opacity: 0.2, transition: FAST }, slide: { x: 100, transition: SLOW } }
    const q = mountIn(() => <wardic.div data-k="el" variants={variants} initial={{ x: 0, opacity: 1 }} animate={["fade", "slide"]} style={BOX} />)
    await until(() => opacityOf(q("el")) < 0.21, 2000)
    expect(opacityOf(q("el")), "the fade's 0.1 s").toBeLessThan(0.21)
    expect(matrixOf(q("el")).m41, "the slide's 1 s").toBeLessThan(60)
  })

  it("LV2: each name orchestrates the children's keys it sets", async () => {
    const [selected, setSelected] = createSignal(false)
    const parent: WardicVariants = { visible: { opacity: 1, transition: { ...FAST, staggerChildren: 0.15 } }, hidden: { opacity: 0 }, active: {}, inactive: {} }
    const item: WardicVariants = { visible: { opacity: 1 }, hidden: { opacity: 0 }, active: { scale: 1.5 }, inactive: { scale: 1 } }
    const q = mountIn(() => (
      <wardic.ul
        data-k="list"
        variants={parent}
        initial={["hidden", "inactive"]}
        animate={["visible", Bool.match(selected(), { onTrue: () => "active", onFalse: () => "inactive" })]}
        transition={FAST}
      >
        <For each={[0, 1, 2]}>{(i) => <wardic.li data-k={`i${i}`} variants={item} transition={FAST} style={BOX} />}</For>
      </wardic.ul>
    ))
    await until(() => opacityOf(q("i0")) > 0.9, 2000)
    expect(opacityOf(q("i2")), "the last waits its slot").toBeLessThan(0.5)
    await until(() => opacityOf(q("i2")) > 0.99, 2000)
    setSelected(true)
    flush()
    await until(() => matrixOf(q("i0")).a > 1.25, 2000)
    expect(matrixOf(q("i2")).a, "together, no stagger").toBeGreaterThan(1.15)
  })

  it("LV3: one landing per Retarget, its definition the list; a fresh list with the same names starts none", async () => {
    const [tick, setTick] = createSignal(0)
    const variants: WardicVariants = { a: { x: 10 }, b: { opacity: 0.5 } }
    let card!: Ward
    const Card = (): JSX.Element => {
      const config: WardConfig = { variants, animate: () => Bool.match(tick() >= 0, { onTrue: () => ["a", "b"], onFalse: () => ["b"] }), transition: FAST }
      card = ward(config)
      return <div {...card} style={BOX} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    const landing = await card.next("settled")
    expect(landing.definition, "the list").toEqual(["a", "b"])
    await frames(3)
    let landed = false
    void card.next("settled").then(
      () => {
        landed = true
      },
      () => {},
    )
    setTick(1)
    flush()
    await frames(10)
    expect(landed, "no Retarget for the same names").toBe(false)
  })

  it("LV4: a name's beforeChildren holds the children's keys of that name; another name's start at once", async () => {
    const parent: WardicVariants = {
      visible: { opacity: 1, transition: { type: "tween", duration: 0.5, when: "beforeChildren" } },
      hidden: { opacity: 0 },
      active: {},
      inactive: {},
    }
    const child: WardicVariants = { visible: { x: 0 }, hidden: { x: -30 }, active: { scale: 1.5 }, inactive: { scale: 1 } }
    const q = mountIn(() => (
      <wardic.div data-k="parent" variants={parent} initial={["hidden", "inactive"]} animate={["visible", "active"]} style={BOX}>
        <wardic.span data-k="child" variants={child} transition={{ type: "tween", duration: 0.2 }} style={{ display: "inline-block" }} />
      </wardic.div>
    ))
    let scaledEarly = false
    let movedEarly = false
    await until(() => {
      if (opacityOf(q("parent")) < 0.8) {
        if (matrixOf(q("child")).a > 1.2) scaledEarly = true
        if (matrixOf(q("child")).m41 > -29) movedEarly = true
      }
      return Math.abs(matrixOf(q("child")).m41) < 0.5
    }, 3000)
    expect(scaledEarly, "active's keys at once").toBe(true)
    expect(movedEarly, "visible's keys waited for the parent's").toBe(false)
    expect(Math.abs(matrixOf(q("child")).m41), "and went once the parent's had").toBeLessThan(0.5)
  })
})
