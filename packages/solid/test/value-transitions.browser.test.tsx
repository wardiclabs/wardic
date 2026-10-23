// Per-value transitions on Solid 1 (#301, Motion's `getValueTransition`): a transition's entry by a
// value's name drives that value, `default` every value without one, wherever a transition goes.
// Real frames: a fast entry lands while a slow transition's value is still on its way.
//
// - VT1: the element's transition: a value's entry drives it, the rest run on the own fields.
// - VT2: `default` drives a value without an entry, not the transition's own fields.
// - VT3: an entry with `inherit: true` takes the own fields' delay; without, its value starts at once.
// - VT4: a variant's own transition.
// - VT5: a gesture target's own transition.
// - VT6: a list's names: each name's entries drive the keys it sets.
// - VT7: an exit's own transition.
// - VT8: a stagger's delay holds each entry: the second child's fast entry waits its slot.
// - VT9: an exit's stagger inside a leaving child (#290) holds each entry too.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider, type WardicVariants } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)
const xOf = (el: HTMLElement): number => new DOMMatrix(getComputedStyle(el).transform).m41

const FAST = { type: "tween", duration: 0.1 } as const
const SLOW = { type: "tween", duration: 1 } as const
const BOX = { display: "block", width: "20px", height: "20px" } as const

/** Render `ui` inside a provider; the returned function finds a `data-k`. */
const mount = (ui: () => JSX.Element) => {
  const { container } = render(() => <WardicProvider env={DomLive}>{ui()}</WardicProvider>)
  return (k: string): HTMLElement => container.querySelector<HTMLElement>(`[data-k="${k}"]`)!
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

describe("per-value transitions on Solid 1 (#301)", () => {
  it("VT1: the element's transition: a value's entry drives it, the rest run on the own fields", async () => {
    const [on, setOn] = createSignal(false)
    const q = mount(() => (
      <wardic.div
        data-k="el"
        initial={{ x: 0, opacity: 0 }}
        animate={Bool.match(on(), { onTrue: () => ({ x: 100, opacity: 1 }), onFalse: () => ({ x: 0, opacity: 0 }) })}
        transition={{ ...SLOW, opacity: FAST }}
        style={BOX}
      />
    ))
    await frames(3)
    setOn(true)
    expect(await xWhenFaded(q("el")), "x on the own fields' 1 s").toBeLessThan(60)
    await until(() => xOf(q("el")) > 99.9, 3000)
    expect(xOf(q("el"))).toBeGreaterThan(99.9)
  })

  it("VT2: default drives a value without an entry, not the transition's own fields", async () => {
    const q = mount(() => <wardic.div data-k="el" initial={{ x: 0, opacity: 1 }} animate={{ x: 100, opacity: 0 }} transition={{ ...FAST, default: SLOW, x: FAST }} style={BOX} />)
    await until(() => xOf(q("el")) > 99.9, 2000)
    expect(xOf(q("el")), "x on its entry").toBeGreaterThan(99.9)
    expect(opacityOf(q("el")), "opacity on default's 1 s, not the own 0.1 s").toBeGreaterThan(0.4)
  })

  it("VT3: an entry with inherit takes the own fields' delay; without, its value starts at once", async () => {
    const q = mount(() => (
      <>
        <wardic.div data-k="held" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...SLOW, delay: 0.4, opacity: { inherit: true, duration: 0.1 } }} style={BOX} />
        <wardic.div data-k="free" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...SLOW, delay: 0.4, opacity: FAST }} style={BOX} />
      </>
    ))
    await until(() => opacityOf(q("free")) > 0.99, 2000)
    expect(opacityOf(q("free")), "its own 0.1 s, no delay").toBeGreaterThan(0.99)
    expect(opacityOf(q("held")), "held through the own fields' 0.4 s delay").toBe(0)
    await until(() => opacityOf(q("held")) > 0.99, 2000)
    expect(opacityOf(q("held")), "then its own 0.1 s").toBeGreaterThan(0.99)
  })

  it("VT4: a variant's own transition", async () => {
    const variants: WardicVariants = { hidden: { x: 0, opacity: 0 }, shown: { x: 100, opacity: 1, transition: { ...SLOW, opacity: FAST } } }
    const q = mount(() => <wardic.div data-k="el" variants={variants} initial="hidden" animate="shown" style={BOX} />)
    expect(await xWhenFaded(q("el")), "x on the variant's own 1 s").toBeLessThan(60)
  })

  it("VT5: a gesture target's own transition", async () => {
    const q = mount(() => (
      <wardic.div data-k="el" initial={{ x: 0, opacity: 0 }} animate={{ x: 0, opacity: 0 }} whileHover={{ x: 100, opacity: 1, transition: { ...SLOW, opacity: FAST } }} style={BOX} />
    ))
    await frames(3)
    await hover(q("el"), () => opacityOf(q("el")) > 0)
    expect(await xWhenFaded(q("el")), "x on the hover target's own 1 s").toBeLessThan(60)
  })

  it("VT6: a list's names: each name's entries drive the keys it sets", async () => {
    const variants: WardicVariants = {
      hidden: { x: 0, opacity: 0 },
      fade: { opacity: 1, transition: { ...SLOW, opacity: FAST } },
      slide: { x: 100, transition: { ...FAST, default: SLOW } },
    }
    const q = mount(() => <wardic.div data-k="el" variants={variants} initial="hidden" animate={["fade", "slide"]} style={BOX} />)
    expect(await xWhenFaded(q("el")), "x on slide's default 1 s, not its own 0.1 s").toBeLessThan(60)
  })

  it("VT7: an exit's own transition", async () => {
    const [shown, setShown] = createSignal(true)
    const q = mount(() => (
      <AnimatePresence>
        <Show when={shown()}>
          <wardic.div data-k="el" initial={false} animate={{ x: 0, opacity: 1 }} exit={{ x: 100, opacity: 0, transition: { ...SLOW, opacity: FAST } }} style={BOX} />
        </Show>
      </AnimatePresence>
    ))
    await frames(3)
    const leaving = q("el")
    setShown(false)
    await until(() => opacityOf(leaving) < 0.01, 2000)
    expect(leaving.isConnected, "still leaving").toBe(true)
    expect(opacityOf(leaving), "faded out on its fast entry").toBeLessThan(0.01)
    expect(xOf(leaving), "x on the exit's own 1 s").toBeLessThan(60)
    await until(() => !leaving.isConnected, 3000)
    expect(leaving.isConnected, "removed once x lands").toBe(false)
  })

  it("VT8: a stagger's delay holds each entry: the second child's fast entry waits its slot", async () => {
    const parent: WardicVariants = { hidden: { opacity: 0 }, shown: { opacity: 1 } }
    const item: WardicVariants = { hidden: { opacity: 0 }, shown: { opacity: 1 } }
    const q = mount(() => (
      <wardic.ul variants={parent} initial="hidden" animate="shown" transition={{ ...SLOW, staggerChildren: 0.4, opacity: FAST }}>
        <For each={[0, 1]}>{(i) => <wardic.li data-k={`i${i}`} variants={item} style={BOX} />}</For>
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

  it("VT9: an exit's stagger inside a leaving child holds each entry too (#290)", async () => {
    const list: WardicVariants = { shown: {}, gone: { opacity: 1, transition: { staggerChildren: 0.4 } } }
    const item: WardicVariants = { shown: { opacity: 1 }, gone: { opacity: 0 } }
    const [open, setOpen] = createSignal(true)
    const q = mount(() => (
      <AnimatePresence>
        <Show when={open()}>
          <wardic.ul data-k="list" variants={list} initial="shown" animate="shown" exit="gone">
            <For each={[0, 1]}>{(i) => <wardic.li data-k={`i${i}`} variants={item} transition={{ ...SLOW, opacity: FAST }} style={BOX} />}</For>
          </wardic.ul>
        </Show>
      </AnimatePresence>
    ))
    await frames(3)
    const [first, second] = [q("i0"), q("i1")]
    setOpen(false)
    await until(() => opacityOf(first) < 0.01, 2000)
    expect(opacityOf(first), "the first on its fast entry").toBeLessThan(0.01)
    expect(opacityOf(second), "the second waits its 0.4 s slot").toBe(1)
    await until(() => opacityOf(second) < 0.01, 2000)
    expect(opacityOf(second), "then fades on its fast entry").toBeLessThan(0.01)
  })
})
