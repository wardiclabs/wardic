// Per-value transitions on Solid 2 (#301, Motion's `getValueTransition`), as the Solid 1 binding's VT
// tests pin them. Real frames, under the diagnostics gate: a fast entry lands while a slow
// transition's value is still on its way.
//
// - TV1: the element's transition: a value's entry drives it, the rest run on the own fields.
// - TV2: `default` drives a value without an entry, not the transition's own fields.
// - TV3: a variant's own transition.
// - TV4: a gesture target's own transition.
// - TV5: a list's names: each name's entries drive the keys it sets.
// - TV6: an exit's own transition.
// - TV7: a stagger's delay holds each entry: the second child's fast entry waits its slot.
// - TV8: `default` drives layout with no `layout` entry.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider, type WardicTransition, type WardicVariants } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import * as Bool from "effect/Boolean"
import { createSignal, flush, For, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)
const xOf = (el: HTMLElement): number => new DOMMatrix(getComputedStyle(el).transform).m41
const leftOf = (el: Element): number => el.getBoundingClientRect().left

const FAST = { type: "tween", duration: 0.1 } as const
const SLOW = { type: "tween", duration: 1 } as const
const BOX = { display: "block", width: "20px", height: "20px" } as const

/** `set(value)`, applied now. */
const flushed = <A,>(set: (value: A) => unknown) => (value: A): void => {
  set(value)
  flush()
}

const mountIn = (ui: () => JSX.Element) => {
  const { host } = mount(() => <WardicProvider env={DomLive}>{ui()}</WardicProvider>)
  return (k: string): HTMLElement => host.querySelector<HTMLElement>(`[data-k="${k}"]`)!
}

/** Hover `el` until `held()` (the recognizer attaches its listener asynchronously). */
const hover = async (el: HTMLElement, held: () => boolean): Promise<void> => {
  await until(() => {
    el.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1, bubbles: true }))
    return held()
  }, 2000)
}

/** Once `el`'s opacity has reached 1 on its fast entry, where its `x` is on the slow transition. */
const xWhenFaded = async (el: HTMLElement): Promise<number> => {
  await until(() => opacityOf(el) > 0.99, 2000)
  expect(opacityOf(el), "faded in on its fast entry").toBeGreaterThan(0.99)
  return xOf(el)
}

describe("per-value transitions on Solid 2 (#301)", () => {
  it("TV1: the element's transition: a value's entry drives it, the rest run on the own fields", async () => {
    const [on, setOn] = createSignal(false)
    const q = mountIn(() => (
      <wardic.div
        data-k="el"
        initial={{ x: 0, opacity: 0 }}
        animate={Bool.match(on(), { onTrue: () => ({ x: 100, opacity: 1 }), onFalse: () => ({ x: 0, opacity: 0 }) })}
        transition={{ ...SLOW, opacity: FAST }}
        style={BOX}
      />
    ))
    await frames(3)
    flushed(setOn)(true)
    expect(await xWhenFaded(q("el")), "x on the own fields' 1 s").toBeLessThan(60)
    await until(() => xOf(q("el")) > 99.9, 3000)
    expect(xOf(q("el"))).toBeGreaterThan(99.9)
  })

  it("TV2: default drives a value without an entry, not the transition's own fields", async () => {
    const q = mountIn(() => <wardic.div data-k="el" initial={{ x: 0, opacity: 1 }} animate={{ x: 100, opacity: 0 }} transition={{ ...FAST, default: SLOW, x: FAST }} style={BOX} />)
    await until(() => xOf(q("el")) > 99.9, 2000)
    expect(xOf(q("el")), "x on its entry").toBeGreaterThan(99.9)
    expect(opacityOf(q("el")), "opacity on default's 1 s, not the own 0.1 s").toBeGreaterThan(0.4)
  })

  it("TV3: a variant's own transition", async () => {
    const variants: WardicVariants = { hidden: { x: 0, opacity: 0 }, shown: { x: 100, opacity: 1, transition: { ...SLOW, opacity: FAST } } }
    const q = mountIn(() => <wardic.div data-k="el" variants={variants} initial="hidden" animate="shown" style={BOX} />)
    expect(await xWhenFaded(q("el")), "x on the variant's own 1 s").toBeLessThan(60)
  })

  it("TV4: a gesture target's own transition", async () => {
    const q = mountIn(() => (
      <wardic.div data-k="el" initial={{ x: 0, opacity: 0 }} animate={{ x: 0, opacity: 0 }} whileHover={{ x: 100, opacity: 1, transition: { ...SLOW, opacity: FAST } }} style={BOX} />
    ))
    await frames(3)
    await hover(q("el"), () => opacityOf(q("el")) > 0)
    expect(await xWhenFaded(q("el")), "x on the hover target's own 1 s").toBeLessThan(60)
  })

  it("TV5: a list's names: each name's entries drive the keys it sets", async () => {
    const variants: WardicVariants = {
      hidden: { x: 0, opacity: 0 },
      fade: { opacity: 1, transition: { ...SLOW, opacity: FAST } },
      slide: { x: 100, transition: { ...FAST, default: SLOW } },
    }
    const q = mountIn(() => <wardic.div data-k="el" variants={variants} initial="hidden" animate={["fade", "slide"]} style={BOX} />)
    expect(await xWhenFaded(q("el")), "x on slide's default 1 s, not its own 0.1 s").toBeLessThan(60)
  })

  it("TV6: an exit's own transition", async () => {
    const [shown, setShown] = createSignal(true)
    const q = mountIn(() => (
      <AnimatePresence>
        <Show when={shown()}>
          <wardic.div data-k="el" initial={false} animate={{ x: 0, opacity: 1 }} exit={{ x: 100, opacity: 0, transition: { ...SLOW, opacity: FAST } }} style={BOX} />
        </Show>
      </AnimatePresence>
    ))
    await frames(3)
    const leaving = q("el")
    flushed(setShown)(false)
    await until(() => opacityOf(leaving) < 0.01, 2000)
    expect(leaving.isConnected, "still leaving").toBe(true)
    expect(opacityOf(leaving), "faded out on its fast entry").toBeLessThan(0.01)
    expect(xOf(leaving), "x on the exit's own 1 s").toBeLessThan(60)
    await until(() => !leaving.isConnected, 3000)
    expect(leaving.isConnected, "removed once x lands").toBe(false)
  })

  it("TV7: a stagger's delay holds each entry: the second child's fast entry waits its slot", async () => {
    const variants: WardicVariants = { hidden: { opacity: 0 }, shown: { opacity: 1 } }
    const q = mountIn(() => (
      <wardic.ul variants={variants} initial="hidden" animate="shown" transition={{ ...SLOW, staggerChildren: 0.4, opacity: FAST }}>
        <For each={[0, 1]}>{(i) => <wardic.li data-k={`i${i}`} variants={variants} style={BOX} />}</For>
      </wardic.ul>
    ))
    await until(() => opacityOf(q("i0")) > 0.99, 2000)
    expect(opacityOf(q("i0")), "the first on the inherited fast entry").toBeGreaterThan(0.99)
    expect(opacityOf(q("i1")), "the second waits its 0.4 s slot").toBe(0)
    await wait(150)
    expect(opacityOf(q("i1")), "still waiting").toBe(0)
    await until(() => opacityOf(q("i1")) > 0.99, 2000)
    expect(opacityOf(q("i1")), "then fades on the fast entry").toBeGreaterThan(0.99)
  })

  it("TV8: default drives layout with no layout entry", async () => {
    const [moved, setMoved] = createSignal(false)
    const slow: WardicTransition = { type: "spring", stiffness: 20, damping: 10 }
    const transitions: ReadonlyArray<WardicTransition> = [{ ...slow, default: { type: "tween", duration: 0.2 } }, { type: "tween", duration: 0.2, default: slow }]
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", height: "120px" }}>
          <For each={transitions}>
            {(transition, i) => (
              <wardic.div
                data-box
                layout
                layoutDependency={moved()}
                transition={transition}
                style={{ position: "absolute", top: `${i() * 60}px`, left: Bool.match(moved(), { onTrue: () => "200px", onFalse: () => "0px" }), width: "40px", height: "40px" }}
              />
            )}
          </For>
        </div>
      </WardicProvider>
    ))
    await frames(5)
    const boxes = Array.from(host.querySelectorAll("[data-box]"))
    const origin = leftOf(boxes[0]!)
    flushed(setMoved)(true)
    const lefts: Array<ReadonlyArray<number>> = []
    for (let i = 0; i < 30; i++) {
      await raf()
      lefts.push(boxes.map((b) => leftOf(b) - origin))
    }
    const landed = lefts.findIndex((l) => Math.abs(l[0]! - 200) < 0.01)
    expect(landed, "default's 0.2 s tween lands within 18 frames").toBeLessThan(18)
    expect(landed).toBeGreaterThan(0)
    expect(lefts[landed + 4]![1]!, "default's slow spring, not the own 0.2 s").toBeLessThan(195)
  })
})
