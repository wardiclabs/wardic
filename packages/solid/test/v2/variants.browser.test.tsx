// Variant propagation on Solid 2 (#209, ADR-0007, #50), as the Solid 1 binding's variants and
// variant-inheritance tests pin it, over real frames:
//
// - V1–V3: by name, through a kept ward's `.Provider`: a child with no `animate` resolves the
//   parent's name against its own variants; one with an `animate` ignores it; siblings each resolve
//   their own.
// - VB1–VB5: through `wardic.*`: Variant children start from the ancestor's `initial` name and enter
//   staggered; an element without variants takes no slot; `inherit={false}` keeps a child still;
//   children follow back and forth; a plain element in between passes the names through.
import { DomLive } from "@wardic/dom"
import { ward, wardic, WardicProvider, type WardicTransition } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { createSignal, flush, For } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const opacityOf = (el: HTMLElement): number => Number(el.style.opacity)
const settled = (el: HTMLElement, target: number): Promise<void> => until(() => Math.abs(opacityOf(el) - target) <= 0.05)

const OPEN_CLOSED = { open: { opacity: 1 }, closed: { opacity: 0 } }
const nameOf = (open: boolean): string => Bool.match(open, { onTrue: () => "open", onFalse: () => "closed" })

/** A parent ward flipping between "open" and "closed", its Provider around `children`. */
const Parent = (props: { readonly open: () => boolean; readonly children: unknown }) => {
  const parent = ward({ variants: OPEN_CLOSED, animate: () => nameOf(props.open()) })
  return (
    <div {...parent}>
      <parent.Provider>{props.children as never}</parent.Provider>
    </div>
  )
}

describe("variant propagation: inheritance by name, through a ward's Provider", () => {
  it("V1: a child without its own animate inherits the parent's name, resolved against its own variants", async () => {
    const [open, setOpen] = createSignal(false)
    let childEl!: HTMLElement
    const Child = () => {
      const child = ward({ initial: { opacity: 0.3 }, variants: { open: { opacity: 1 }, closed: { opacity: 0.3 } } })
      return <div ref={[child, (node: HTMLElement) => (childEl = node)]}>child</div>
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Parent open={open}>
          <Child />
        </Parent>
      </WardicProvider>
    ))
    await raf()
    await raf()
    expect(childEl.style.opacity === "" || Math.abs(opacityOf(childEl) - 0.3) <= 0.05).toBe(true)
    setOpen(true)
    flush()
    let sawMid = false
    await until(() => {
      const v = opacityOf(childEl)
      if (v > 0.31 && v < 0.99) sawMid = true
      return v >= 0.99
    })
    expect(sawMid).toBe(true)
    expect(opacityOf(childEl)).toBeCloseTo(1, 1)
  })

  it("V2: a child with its own animate ignores the parent's name", async () => {
    const [open, setOpen] = createSignal(false)
    let childEl!: HTMLElement
    const Child = () => {
      const child = ward({ initial: { opacity: 0.5 }, animate: { opacity: 0.5 }, variants: OPEN_CLOSED })
      return <div {...child} ref={[child, (node: HTMLElement) => (childEl = node)]}>child</div>
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Parent open={open}>
          <Child />
        </Parent>
      </WardicProvider>
    ))
    expect(opacityOf(childEl)).toBe(0.5)
    setOpen(true)
    flush()
    await until(() => false, 600)
    expect(opacityOf(childEl)).toBeCloseTo(0.5, 2)
  })

  it("V3: siblings with different variant maps each resolve their own", async () => {
    const [open, setOpen] = createSignal(false)
    let aEl!: HTMLElement
    let bEl!: HTMLElement
    const ChildA = () => {
      const child = ward({ initial: { opacity: 0.2 }, variants: { open: { opacity: 0.8 }, closed: { opacity: 0.2 } } })
      return <div {...child} ref={[child, (node: HTMLElement) => (aEl = node)]}>a</div>
    }
    const ChildB = () => {
      const child = ward({ initial: { opacity: 0.1 }, variants: { open: { opacity: 0.6 }, closed: { opacity: 0.1 } } })
      return <div {...child} ref={[child, (node: HTMLElement) => (bEl = node)]}>b</div>
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Parent open={open}>
          <ChildA />
          <ChildB />
        </Parent>
      </WardicProvider>
    ))
    await settled(aEl, 0.2)
    await settled(bEl, 0.1)
    setOpen(true)
    flush()
    await settled(aEl, 0.8)
    await settled(bEl, 0.6)
    expect(opacityOf(aEl)).toBeCloseTo(0.8, 1)
    expect(opacityOf(bEl)).toBeCloseTo(0.6, 1)
  })
})

const VARIANTS = { hidden: { opacity: 0 }, shown: { opacity: 1 } }
const TWEEN: WardicTransition = { type: "tween", duration: 0.2 }
const shownOf = (shown: boolean): string => Bool.match(shown, { onTrue: () => "shown", onFalse: () => "hidden" })

const op = (el: HTMLElement): number => Number(el.style.opacity || "1")

/** The frame index at which each element first reaches `threshold` opacity, until `done()` (-1 if never). */
const crossings = async (els: ReadonlyArray<HTMLElement>, threshold: number, done: () => boolean): Promise<Array<number>> => {
  const cross = els.map(() => -1)
  let frame = 0
  const start = performance.now()
  const record = (): void => {
    els.forEach((el, i) => {
      if (cross[i]! < 0 && op(el) >= threshold) cross[i] = frame
    })
  }
  record()
  while (!done() && performance.now() - start < 4000) {
    await raf()
    frame++
    record()
  }
  return cross
}

const settledAt = (els: ReadonlyArray<HTMLElement>, v: number): boolean => els.every((el) => Math.abs(op(el) - v) < 0.02)

describe("variant inheritance through wardic.* (#50)", () => {
  it("VB1: a wardic.ul's Variant children start from its initial name and enter staggered", async () => {
    const items: Array<HTMLElement> = []
    const [shown, setShown] = createSignal(false)
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.ul initial="hidden" animate={shownOf(shown())} variants={VARIANTS} transition={{ ...TWEEN, staggerChildren: 0.12 }}>
          <For each={[0, 1, 2]}>{(i) => <wardic.li ref={(el: HTMLElement) => (items[i] = el)} variants={VARIANTS} />}</For>
        </wardic.ul>
      </WardicProvider>
    ))
    expect(items.map(op)).toEqual([0, 0, 0])
    await raf()
    await raf()
    expect(items.map(op)).toEqual([0, 0, 0])
    setShown(true)
    flush()
    const cross = await crossings(items, 0.5, () => settledAt(items, 1))
    expect(cross.every((c) => c >= 0)).toBe(true)
    expect(cross[0]).toBeLessThan(cross[1]!)
    expect(cross[1]).toBeLessThan(cross[2]!)
    expect(settledAt(items, 1)).toBe(true)
  })

  it("VB2: an element without variants takes no stagger slot: the first Variant child starts at once", async () => {
    const items: Array<HTMLElement> = []
    const [shown, setShown] = createSignal(false)
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.ul initial="hidden" animate={shownOf(shown())} variants={VARIANTS} transition={{ ...TWEEN, staggerChildren: 0.4 }}>
          <wardic.span animate={{ x: 0 }} />
          <For each={[0, 1]}>{(i) => <wardic.li ref={(el: HTMLElement) => (items[i] = el)} variants={VARIANTS} />}</For>
        </wardic.ul>
      </WardicProvider>
    ))
    await raf()
    setShown(true)
    flush()
    const start = performance.now()
    await until(() => op(items[0]!) >= 0.5, 2000)
    // With the span in slot 0, the first li would wait 400 ms; it starts in the first frames.
    expect(performance.now() - start).toBeLessThan(330)
    await until(() => settledAt(items, 1))
    expect(settledAt(items, 1)).toBe(true)
  })

  it("VB3: inherit={false} keeps a Variant child still when its ancestor's variant changes", async () => {
    let item!: HTMLElement
    let sibling!: HTMLElement
    const [shown, setShown] = createSignal(false)
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.ul initial="hidden" animate={shownOf(shown())} variants={VARIANTS} transition={TWEEN}>
          <wardic.li ref={(el: HTMLElement) => (item = el)} variants={VARIANTS} inherit={false} />
          <wardic.li ref={(el: HTMLElement) => (sibling = el)} variants={VARIANTS} />
        </wardic.ul>
      </WardicProvider>
    ))
    await raf()
    setShown(true)
    flush()
    await until(() => op(sibling) >= 0.99)
    expect(op(sibling)).toBeGreaterThan(0.99)
    expect(item.style.opacity).toBe("")
  })

  it("VB4: Variant children follow their ancestor back and forth", async () => {
    const items: Array<HTMLElement> = []
    const [shown, setShown] = createSignal(false)
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.ul initial="hidden" animate={shownOf(shown())} variants={VARIANTS} transition={TWEEN}>
          <For each={[0, 1]}>{(i) => <wardic.li ref={(el: HTMLElement) => (items[i] = el)} variants={VARIANTS} />}</For>
        </wardic.ul>
      </WardicProvider>
    ))
    await raf()
    setShown(true)
    flush()
    await until(() => settledAt(items, 1))
    expect(settledAt(items, 1)).toBe(true)
    setShown(false)
    flush()
    await until(() => settledAt(items, 0))
    expect(settledAt(items, 0)).toBe(true)
  })

  it("VB5: a plain wardic element in between passes the names through to a Variant child", async () => {
    let item!: HTMLElement
    const [shown, setShown] = createSignal(false)
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.ul initial="hidden" animate={shownOf(shown())} variants={VARIANTS} transition={TWEEN}>
          <wardic.div animate={{ x: 0 }}>
            <wardic.li ref={(el: HTMLElement) => (item = el)} variants={VARIANTS} />
          </wardic.div>
        </wardic.ul>
      </WardicProvider>
    ))
    expect(op(item)).toBe(0)
    await raf()
    setShown(true)
    flush()
    await until(() => op(item) >= 0.99)
    expect(op(item)).toBeGreaterThan(0.99)
  })
})
