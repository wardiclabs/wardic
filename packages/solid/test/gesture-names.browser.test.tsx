// The gesture props taking a variant name on Solid 1 (#291, Motion's): `whileHover="hover"` and the
// rest, the name passing down to Variant children while the gesture is on, and a gesture target's own
// transition. Real frames.
//
// - GN1: `whileHover="hover"`: the element's own `hover` entry while hovered, back at its end.
// - GN2: a gesture's name naming a dynamic variant resolves with the element's `custom`.
// - GN3: a gesture target's own transition drives its keys.
// - GN4: the name passes to Variant children: each animates its own entry while the parent is hovered.
// - GN5: staggered by the parent's gesture variant's `staggerChildren`.
// - GN6: a child's own `while*` for the gesture wins over the name it would take: on with its
//   parent's gesture, as Motion's `setActive` turns it on in its Variant children.
// - GN7: `whileTap="pressed"` while pressed.
// - GN8: `onAnimationStart` is told the gesture's name.
// - GN9: two levels down: a grandchild takes the name through its parent.
// - GN10: `when: "beforeChildren"` in the gesture's variant: the children wait for the parent's animation.
// - GN11: a parent's gesture given as values turns a Variant child's own `while*` on too.
// - GN12: a gesture coming on retakes the stagger slots: an item added since the last trigger waits its own.
import { cleanup, render } from "@solidjs/testing-library"
import * as Easing from "@wardic/core/Easing"
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider, type WardicAnimationDefinition, type WardicVariants } from "@wardic/solid"
import { createSignal, For, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const matrixOf = (el: HTMLElement): DOMMatrix => new DOMMatrix(getComputedStyle(el).transform)
const scaleOf = (el: HTMLElement): number => matrixOf(el).a
const xOf = (el: HTMLElement): number => matrixOf(el).m41

/** Render `ui` inside a provider; `q` finds a `data-k`. */
const mount = (ui: () => JSX.Element) => {
  const { container } = render(() => <WardicProvider env={DomLive}>{ui()}</WardicProvider>)
  return (k: string): HTMLElement => container.querySelector<HTMLElement>(`[data-k="${k}"]`)!
}

/** Hover `el` until `held()` (the recognizer attaches its listener asynchronously); `leave` ends it. */
const hover = async (el: HTMLElement, held: () => boolean): Promise<void> => {
  await until(() => {
    el.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1, bubbles: true }))
    return held()
  }, 2000)
}
const leave = (el: HTMLElement): void => {
  el.dispatchEvent(new PointerEvent("pointerleave", { pointerId: 1, bubbles: true }))
}

const QUICK = { type: "tween", duration: 0.1 } as const
const BOX = { display: "inline-block", width: "40px", height: "40px" } as const

describe("gesture props taking a variant name on Solid 1 (#291)", () => {
  it("GN1: whileHover='hover': the element's own entry while hovered, back at its end", async () => {
    const card: WardicVariants = { rest: { scale: 1 }, hover: { scale: 1.5 } }
    const q = mount(() => <wardic.div data-k="a" variants={card} initial="rest" animate="rest" whileHover="hover" transition={QUICK} style={BOX} />)
    await frames(3)
    const a = q("a")
    await hover(a, () => scaleOf(a) > 1.45)
    expect(scaleOf(a)).toBeGreaterThan(1.45)
    leave(a)
    await until(() => scaleOf(a) < 1.05, 2000)
    expect(scaleOf(a)).toBeLessThan(1.05)
  })

  it("GN2: a gesture's name naming a dynamic variant resolves with custom", async () => {
    const card: WardicVariants = { rest: { x: 0 }, hover: (d: number) => ({ x: d * 30 }) }
    const q = mount(() => <wardic.div data-k="a" custom={-1} variants={card} initial="rest" animate="rest" whileHover="hover" transition={QUICK} style={BOX} />)
    await frames(3)
    const a = q("a")
    await hover(a, () => xOf(a) < -25)
    expect(xOf(a)).toBeLessThan(-25)
  })

  it("GN3: a gesture target's own transition drives its keys", async () => {
    const q = mount(() => (
      <wardic.div
        data-k="a"
        whileHover={{ x: 100, transition: { type: "tween", duration: 0.6, easing: Easing.linear } }}
        transition={{ type: "tween", duration: 0.05 }}
        style={BOX}
      />
    ))
    await frames(3)
    const a = q("a")
    await hover(a, () => xOf(a) > 1)
    const t0 = performance.now()
    while (performance.now() - t0 < 250) await raf()
    expect(xOf(a), "its own linear 0.6 s, not the element's 0.05 s").toBeLessThan(80)
    expect(xOf(a)).toBeGreaterThan(20)
  })

  it("GN4: the name passes to Variant children while the parent is hovered", async () => {
    const card: WardicVariants = { rest: {}, hover: {} }
    const icon: WardicVariants = { rest: { x: 0 }, hover: { x: 20 } }
    const q = mount(() => (
      <wardic.div data-k="card" variants={card} initial="rest" animate="rest" whileHover="hover" style={BOX}>
        <wardic.span data-k="icon" variants={icon} transition={QUICK} style={{ display: "inline-block" }} />
      </wardic.div>
    ))
    await frames(3)
    const cardEl = q("card")
    const iconEl = q("icon")
    await hover(cardEl, () => xOf(iconEl) > 19)
    expect(xOf(iconEl), "the icon's own hover entry").toBeGreaterThan(19)
    leave(cardEl)
    await until(() => xOf(iconEl) < 1, 2000)
    expect(xOf(iconEl), "back at the card's leave").toBeLessThan(1)
  })

  it("GN5: staggered by the parent's gesture variant's staggerChildren", async () => {
    const list = { rest: {}, hover: { opacity: 1, transition: { staggerChildren: 0.3 } } } as const satisfies WardicVariants
    const item: WardicVariants = { rest: { x: 0 }, hover: { x: 20 } }
    const q = mount(() => (
      <wardic.ul data-k="list" variants={list} initial="rest" animate="rest" whileHover="hover" style={{ display: "block", width: "200px", height: "60px" }}>
        <For each={[0, 1, 2]}>{(i) => <wardic.li data-k={`i${i}`} variants={item} transition={QUICK} style={{ display: "inline-block" }} />}</For>
      </wardic.ul>
    ))
    await frames(3)
    const listEl = q("list")
    await hover(listEl, () => xOf(q("i0")) > 1)
    const t0 = performance.now()
    while (performance.now() - t0 < 200) await raf()
    expect(xOf(q("i0")), "the first on its way").toBeGreaterThan(10)
    expect(xOf(q("i2")), "the third waits its 0.6 s").toBe(0)
    await until(() => xOf(q("i2")) > 19, 2000)
  })

  it("GN6: a child's own while* for the gesture wins over the name it would take", async () => {
    const card: WardicVariants = { rest: {}, hover: {} }
    const icon: WardicVariants = { rest: { x: 0 }, hover: { x: 20 } }
    const q = mount(() => (
      <wardic.div data-k="card" variants={card} initial="rest" animate="rest" whileHover="hover" style={BOX}>
        <wardic.span data-k="icon" variants={icon} whileHover={{ x: -20 }} transition={QUICK} style={{ display: "inline-block" }} />
      </wardic.div>
    ))
    await frames(3)
    const cardEl = q("card")
    const iconEl = q("icon")
    // Hovering the card: the icon's hover is on with it (Motion's `setActive`), on its own whileHover.
    await hover(cardEl, () => xOf(iconEl) < -19)
    expect(xOf(iconEl), "its own -20, not the card's name's 20").toBeLessThan(-19)
  })

  it("GN11: a parent's gesture given as values turns a Variant child's own while* on too", async () => {
    const card: WardicVariants = { rest: {} }
    const icon: WardicVariants = { rest: { x: 0 } }
    const q = mount(() => (
      <wardic.div data-k="card" variants={card} initial="rest" animate="rest" whileHover={{ scale: 1.1 }} transition={QUICK} style={BOX}>
        <wardic.span data-k="icon" variants={icon} whileHover={{ x: 15 }} transition={QUICK} style={{ display: "inline-block" }} />
      </wardic.div>
    ))
    await frames(3)
    const iconEl = q("icon")
    await hover(q("card"), () => xOf(iconEl) > 14)
    expect(xOf(iconEl), "the card's hover is the icon's").toBeGreaterThan(14)
  })

  it("GN7: whileTap='pressed' while pressed", async () => {
    const button: WardicVariants = { rest: { scale: 1 }, pressed: { scale: 0.8 } }
    const q = mount(() => <wardic.button data-k="b" variants={button} initial="rest" animate="rest" whileTap="pressed" transition={QUICK} style={BOX} />)
    await frames(3)
    const b = q("b")
    const down = (): void => {
      const r = b.getBoundingClientRect()
      b.dispatchEvent(new PointerEvent("pointerdown", { clientX: r.left + 5, clientY: r.top + 5, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true, bubbles: true }))
    }
    await until(() => {
      down()
      return scaleOf(b) < 0.82
    }, 2000)
    expect(scaleOf(b)).toBeLessThan(0.82)
  })

  it("GN8: onAnimationStart is told the gesture's name", async () => {
    const started: Array<WardicAnimationDefinition> = []
    const card: WardicVariants = { rest: { scale: 1 }, hover: { scale: 1.2 } }
    const q = mount(() => (
      <wardic.div data-k="a" variants={card} initial="rest" animate="rest" whileHover="hover" transition={QUICK} style={BOX} onAnimationStart={(d) => started.push(d)} />
    ))
    await frames(3)
    const a = q("a")
    await hover(a, () => started.includes("hover"))
    expect(started).toContain("hover")
  })

  it("GN9: two levels down: a grandchild takes the name through its parent", async () => {
    const outer: WardicVariants = { rest: {}, hover: {} }
    const middle: WardicVariants = { rest: {}, hover: {} }
    const inner: WardicVariants = { rest: { x: 0 }, hover: { x: 20 } }
    const q = mount(() => (
      <wardic.div data-k="outer" variants={outer} initial="rest" animate="rest" whileHover="hover" style={BOX}>
        <wardic.div data-k="middle" variants={middle}>
          <wardic.span data-k="inner" variants={inner} transition={QUICK} style={{ display: "inline-block" }} />
        </wardic.div>
      </wardic.div>
    ))
    await frames(3)
    const innerEl = q("inner")
    await hover(q("outer"), () => xOf(innerEl) > 19)
    expect(xOf(innerEl)).toBeGreaterThan(19)
  })

  it("GN10: when beforeChildren in the gesture's variant: the children wait for the parent's animation", async () => {
    const card = { rest: { scale: 1 }, hover: { scale: 1.2, transition: { type: "tween", duration: 0.4, when: "beforeChildren" } } } as const satisfies WardicVariants
    const icon: WardicVariants = { rest: { x: 0 }, hover: { x: 20 } }
    const q = mount(() => (
      <wardic.div data-k="card" variants={card} initial="rest" animate="rest" whileHover="hover" style={BOX}>
        <wardic.span data-k="icon" variants={icon} transition={QUICK} style={{ display: "inline-block" }} />
      </wardic.div>
    ))
    await frames(3)
    const cardEl = q("card")
    const iconEl = q("icon")
    await hover(cardEl, () => scaleOf(cardEl) > 1.01)
    const t0 = performance.now()
    while (performance.now() - t0 < 200) await raf()
    expect(scaleOf(cardEl), "the card on its way").toBeGreaterThan(1.01)
    expect(xOf(iconEl), "the icon waits").toBe(0)
    await until(() => xOf(iconEl) > 19, 2000)
    expect(xOf(iconEl)).toBeGreaterThan(19)
  })

  it("GN12: a gesture coming on retakes the stagger slots: an item added since waits its own", async () => {
    const [items, setItems] = createSignal([0, 1])
    const list = { rest: {}, hover: { opacity: 1, transition: { staggerChildren: 0.3 } } } as const satisfies WardicVariants
    const item: WardicVariants = { rest: { x: 0 }, hover: { x: 20 } }
    const q = mount(() => (
      <wardic.ul data-k="list" variants={list} initial="rest" animate="rest" whileHover="hover" style={{ display: "block", width: "200px", height: "60px" }}>
        <For each={items()}>{(i) => <wardic.li data-k={`i${i}`} variants={item} transition={QUICK} style={{ display: "inline-block" }} />}</For>
      </wardic.ul>
    ))
    await frames(3)
    // Added with no change of the list's variant: its slot is taken at the next trigger.
    setItems([0, 1, 2])
    await frames(3)
    await hover(q("list"), () => xOf(q("i0")) > 1)
    const t0 = performance.now()
    while (performance.now() - t0 < 200) await raf()
    expect(xOf(q("i2")), "the added third waits its 0.6 s").toBe(0)
    await until(() => xOf(q("i2")) > 19, 2000)
  })
})
