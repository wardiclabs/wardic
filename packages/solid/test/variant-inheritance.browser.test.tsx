// Variant inheritance on the client (#50, ADR-0007 *Amendment (#50)*): every Wardic element
// provides its variant context, and only a Variant child (CONTEXT.md) joins its nearest
// variant ancestor: it starts from the ancestor's `initial` name, follows its `animate` name,
// takes a stagger slot and counts for its `when`. Real frames, robust invariants (crossing order,
// gating windows, settle), as `stagger-when.browser.test.tsx` asserts them.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider, type WardicTransition } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, For } from "solid-js"
import { afterEach, expect, it } from "vitest"

afterEach(cleanup)

const VARIANTS = { hidden: { opacity: 0 }, shown: { opacity: 1 } }
const TWEEN: WardicTransition = { type: "tween", duration: 0.2 }

const op = (el: HTMLElement): number => Number(el.style.opacity || "1")
const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))

/** Poll every real frame until `done()` or timeout. */
const until = async (done: () => boolean, timeoutMs = 4000): Promise<void> => {
  const start = performance.now()
  while (!done() && performance.now() - start < timeoutMs) await raf()
}

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

it("VB1: a wardic.ul's Variant children start from its initial name and enter staggered", async () => {
  const items: Array<HTMLElement> = []
  const [shown, setShown] = createSignal(false)
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.ul initial="hidden" animate={Bool.match(shown(), { onTrue: () => "shown", onFalse: () => "hidden" })} variants={VARIANTS} transition={{ ...TWEEN, staggerChildren: 0.12 }}>
        <For each={[0, 1, 2]}>{(i) => <wardic.li ref={(el: HTMLElement) => (items[i] = el)} variants={VARIANTS} />}</For>
      </wardic.ul>
    </WardicProvider>
  ))
  // Each starts from the ancestor's `initial` name: hidden, before any frame.
  expect(items.map(op)).toEqual([0, 0, 0])
  await raf()
  await raf()
  expect(items.map(op)).toEqual([0, 0, 0])

  setShown(true)
  const cross = await crossings(items, 0.5, () => settledAt(items, 1))
  expect(cross.every((c) => c >= 0)).toBe(true)
  expect(cross[0]).toBeLessThan(cross[1]!)
  expect(cross[1]).toBeLessThan(cross[2]!)
  expect(settledAt(items, 1)).toBe(true)
})

it("VB2: an element without variants takes no stagger slot: the first Variant child starts at once", async () => {
  const items: Array<HTMLElement> = []
  const [shown, setShown] = createSignal(false)
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.ul initial="hidden" animate={Bool.match(shown(), { onTrue: () => "shown", onFalse: () => "hidden" })} variants={VARIANTS} transition={{ ...TWEEN, staggerChildren: 0.4 }}>
        <wardic.span animate={{ x: 0 }} />
        <For each={[0, 1]}>{(i) => <wardic.li ref={(el: HTMLElement) => (items[i] = el)} variants={VARIANTS} />}</For>
      </wardic.ul>
    </WardicProvider>
  ))
  await raf()
  setShown(true)
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
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.ul initial="hidden" animate={Bool.match(shown(), { onTrue: () => "shown", onFalse: () => "hidden" })} variants={VARIANTS} transition={TWEEN}>
        <wardic.li ref={(el: HTMLElement) => (item = el)} variants={VARIANTS} inherit={false} />
        <wardic.li ref={(el: HTMLElement) => (sibling = el)} variants={VARIANTS} />
      </wardic.ul>
    </WardicProvider>
  ))
  await raf()
  setShown(true)
  await until(() => op(sibling) >= 0.99)
  expect(op(sibling)).toBeGreaterThan(0.99)
  expect(item.style.opacity).toBe("")
})

it("VB4: Variant children follow their ancestor back and forth", async () => {
  const items: Array<HTMLElement> = []
  const [shown, setShown] = createSignal(false)
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.ul initial="hidden" animate={Bool.match(shown(), { onTrue: () => "shown", onFalse: () => "hidden" })} variants={VARIANTS} transition={TWEEN}>
        <For each={[0, 1]}>{(i) => <wardic.li ref={(el: HTMLElement) => (items[i] = el)} variants={VARIANTS} />}</For>
      </wardic.ul>
    </WardicProvider>
  ))
  await raf()
  setShown(true)
  await until(() => settledAt(items, 1))
  expect(settledAt(items, 1)).toBe(true)
  setShown(false)
  await until(() => settledAt(items, 0))
  expect(settledAt(items, 0)).toBe(true)
})

it("VB5: a plain wardic element in between passes the names through to a Variant child", async () => {
  let item!: HTMLElement
  const [shown, setShown] = createSignal(false)
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.ul initial="hidden" animate={Bool.match(shown(), { onTrue: () => "shown", onFalse: () => "hidden" })} variants={VARIANTS} transition={TWEEN}>
        <wardic.div animate={{ x: 0 }}>
          <wardic.li ref={(el: HTMLElement) => (item = el)} variants={VARIANTS} />
        </wardic.div>
      </wardic.ul>
    </WardicProvider>
  ))
  expect(op(item)).toBe(0)
  await raf()
  setShown(true)
  await until(() => op(item) >= 0.99)
  expect(op(item)).toBeGreaterThan(0.99)
})
