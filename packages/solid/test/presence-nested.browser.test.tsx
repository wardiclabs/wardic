// Exits inside a leaving `<AnimatePresence>` child on Solid 1 (#290, #277's PR 5a, ADR-0048): every
// Wardic element inside it runs its own exit, Variant children on the name their provider hands down
// in its exit orchestration, and the child goes once all have ended. Real frames.
//
// - NE1: an element inside the child runs its own exit (it stood still), and the child goes after.
// - NE2: a child with no exit of its own stays until the exit inside it ends.
// - NE3: Variant children exit on the parent's exit name, staggered by its exit variant's transition.
// - NE4: `when: "afterChildren"`: the parent's exit waits for its children's.
// - NE5: `when: "beforeChildren"`: the children's wait for the parent's.
// - NE6: an element's own `exit` wins over the name it would take.
// - NE7: a dynamic exit inside the child resolves with the presence's `custom`.
// - NE8: an element under a nested `<AnimatePresence>` is that presence's: the outer leave doesn't run it.
// - NE9: the child back and leaving again: its new inside elements exit as the first ones did.
// - NE10: a Variant child joins the nearest element that provides a context, through a Wardic element
//   between them that provides none.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider, type WardicVariants } from "@wardic/solid"
import { createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const xOf = (el: HTMLElement): number => new DOMMatrix(getComputedStyle(el).transform).m41
const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)

/** Wait until `seconds` have passed since `from` (performance.now() ms). */
const passed = async (from: number, seconds: number): Promise<void> => {
  while (performance.now() - from < seconds * 1000) await raf()
}

const TWEEN = { type: "tween", duration: 0.3 } as const

/** A presence around one child; `close` takes it out, `open` brings it back; `q` finds a `data-k`. */
const mountOne = (child: () => JSX.Element, presenceCustom?: number) => {
  const [open, setOpen] = createSignal(true)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <AnimatePresence custom={presenceCustom}>
        <Show when={open()}>{child()}</Show>
      </AnimatePresence>
    </WardicProvider>
  ))
  return {
    q: (k: string): HTMLElement => container.querySelector<HTMLElement>(`[data-k="${k}"]`)!,
    close: () => setOpen(false),
    open: () => setOpen(true),
  }
}

describe("exits inside a leaving child on Solid 1 (#290)", () => {
  it("NE1: an element inside the child runs its own exit, and the child goes after", async () => {
    const one = mountOne(() => (
      <wardic.div data-k="outer" exit={{ opacity: 0.5 }} transition={TWEEN}>
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
    let outerGoneEarly = false
    const t0 = performance.now()
    await until(() => {
      if (outer.isConnected && xOf(inner) > 10) innerMoved = true
      if (!outer.isConnected && performance.now() - t0 < 450) outerGoneEarly = true
      return !outer.isConnected
    }, 3000)
    expect(innerMoved, "the inner element animated its own exit").toBe(true)
    expect(outerGoneEarly, "the child stayed for the inner exit's 0.5 s").toBe(false)
  })

  it("NE2: a child with no exit of its own stays until the exit inside it ends", async () => {
    const one = mountOne(() => (
      <wardic.div data-k="wrap">
        <wardic.p data-k="card" exit={{ opacity: 0 }} transition={TWEEN} />
      </wardic.div>
    ))
    await frames(3)
    const wrap = one.q("wrap")
    const card = one.q("card")
    one.close()
    await frames(3)
    expect(wrap.isConnected, "the wrapper stays").toBe(true)
    expect(opacityOf(card), "the card fading").toBeLessThan(1)
    await until(() => !wrap.isConnected, 2000)
    expect(wrap.isConnected).toBe(false)
  })

  it("NE3: Variant children exit on the parent's exit name, staggered", async () => {
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
    await passed(t0, 0.25)
    expect(opacityOf(first), "the first gone").toBeLessThan(0.1)
    expect(opacityOf(last), "the third waits its 0.6 s").toBe(1)
    const list_ = one.q("list")
    await until(() => !list_.isConnected, 3000)
    expect(performance.now() - t0, "the list went after the last").toBeGreaterThan(600)
  })

  it("NE4: when afterChildren: the parent's exit waits for its children's", async () => {
    const parent = { shown: { opacity: 1 }, gone: { opacity: 0, transition: { type: "tween", duration: 0.1, when: "afterChildren" } } } as const satisfies WardicVariants
    const child: WardicVariants = { shown: { x: 0 }, gone: { x: 50 } }
    const one = mountOne(() => (
      <wardic.div data-k="parent" variants={parent} initial="shown" animate="shown" exit="gone">
        <wardic.span data-k="child" style={{ display: "inline-block" }} variants={child} transition={{ type: "tween", duration: 0.4 }} />
      </wardic.div>
    ))
    await frames(3)
    const parentEl = one.q("parent")
    const childEl = one.q("child")
    one.close()
    const t0 = performance.now()
    await passed(t0, 0.25)
    expect(xOf(childEl), "the child on its way").toBeGreaterThan(5)
    expect(opacityOf(parentEl), "the parent still waits").toBe(1)
    await until(() => !parentEl.isConnected, 3000)
  })

  it("NE5: when beforeChildren: the children's exit waits for the parent's", async () => {
    const parent = { shown: { opacity: 1 }, gone: { opacity: 0.5, transition: { type: "tween", duration: 0.4, when: "beforeChildren" } } } as const satisfies WardicVariants
    const child: WardicVariants = { shown: { x: 0 }, gone: { x: 50 } }
    const one = mountOne(() => (
      <wardic.div data-k="parent" variants={parent} initial="shown" animate="shown" exit="gone">
        <wardic.span data-k="child" style={{ display: "inline-block" }} variants={child} transition={{ type: "tween", duration: 0.1 }} />
      </wardic.div>
    ))
    await frames(3)
    const parentEl = one.q("parent")
    const childEl = one.q("child")
    one.close()
    const t0 = performance.now()
    await passed(t0, 0.25)
    expect(opacityOf(parentEl), "the parent on its way").toBeLessThan(1)
    expect(xOf(childEl), "the child still waits").toBe(0)
    await until(() => !parentEl.isConnected, 3000)
  })

  it("NE6: an element's own exit wins over the name it would take", async () => {
    const parent = { shown: {}, gone: { opacity: 1 } } as const satisfies WardicVariants
    const child: WardicVariants = { shown: { x: 0 }, gone: { x: 50 } }
    const one = mountOne(() => (
      <wardic.div data-k="parent" variants={parent} initial="shown" animate="shown" exit="gone" transition={TWEEN}>
        <wardic.span data-k="child" style={{ display: "inline-block" }} variants={child} exit={{ x: -50 }} transition={TWEEN} />
      </wardic.div>
    ))
    await frames(3)
    const childEl = one.q("child")
    one.close()
    await until(() => Math.abs(xOf(childEl)) > 10, 2000)
    expect(xOf(childEl), "its own -50").toBeLessThan(-10)
  })

  it("NE7: a dynamic exit inside the child resolves with the presence's custom", async () => {
    const one = mountOne(
      () => (
        <wardic.div data-k="outer">
          <wardic.span data-k="inner" style={{ display: "inline-block" }} custom={1} variants={{ off: (d: number) => ({ x: d * 40 }) }} exit="off" transition={TWEEN} />
        </wardic.div>
      ),
      -1,
    )
    await frames(3)
    const inner = one.q("inner")
    one.close()
    await until(() => Math.abs(xOf(inner)) > 10, 2000)
    expect(xOf(inner), "the presence's -1").toBeLessThan(-10)
  })

  it("NE8: an element under a nested AnimatePresence is that presence's: the outer leave doesn't run it", async () => {
    const one = mountOne(() => (
      <wardic.div data-k="outer" exit={{ opacity: 0 }} transition={TWEEN}>
        <AnimatePresence>
          <wardic.span data-k="inner" style={{ display: "inline-block" }} exit={{ x: 60 }} transition={TWEEN} />
        </AnimatePresence>
      </wardic.div>
    ))
    await frames(3)
    const outer = one.q("outer")
    const inner = one.q("inner")
    one.close()
    let innerMoved = false
    await until(() => {
      if (xOf(inner) > 1) innerMoved = true
      return !outer.isConnected
    }, 2000)
    expect(innerMoved, "propagate's job (#277's PR 5c)").toBe(false)
  })

  it("NE9: the child back and leaving again: its new inside elements exit as the first ones did", async () => {
    const one = mountOne(() => (
      <wardic.div data-k="outer">
        <wardic.span data-k="inner" style={{ display: "inline-block" }} exit={{ x: 60 }} transition={TWEEN} />
      </wardic.div>
    ))
    await frames(3)
    const first = one.q("outer")
    one.close()
    await until(() => !first.isConnected, 2000)
    one.open()
    await frames(3)
    const inner = one.q("inner")
    one.close()
    await until(() => xOf(inner) > 10, 2000)
    expect(xOf(inner)).toBeGreaterThan(10)
  })

  it("NE10: a Variant child joins its provider through a Wardic element that provides none", async () => {
    const list = { shown: {}, gone: {} } as const satisfies WardicVariants
    const item: WardicVariants = { shown: { x: 0 }, gone: { x: 50 } }
    const one = mountOne(() => (
      <wardic.ul data-k="list" variants={list} initial="shown" animate="shown" exit="gone" transition={TWEEN}>
        <wardic.div data-k="between" animate={{ opacity: 1 }}>
          <wardic.li data-k="item" style={{ display: "inline-block" }} variants={item} transition={TWEEN} />
        </wardic.div>
      </wardic.ul>
    ))
    await frames(3)
    const itemEl = one.q("item")
    one.close()
    await until(() => xOf(itemEl) > 10, 2000)
    expect(xOf(itemEl), "it exits on the list's name").toBeGreaterThan(10)
  })
})
