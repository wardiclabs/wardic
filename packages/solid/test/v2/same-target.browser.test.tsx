// A change that resolves the same target starts no Retarget on Solid 2 (#470, Motion's rule), and a
// gesture turning on or off counts when its layer sets something, as a Motion type turning active
// animates. Solid 1's are ST1–ST9.
//
// - STV1: a hover whose values are already drawn lands: `next("settled")` resolves, on and off.
// - STV2: an orchestrating ward's `whileHover` name, with no values of its own, lands as the name.
// - STV3: a hover on a ward whose recognizer runs for `next("hoverStart")` alone, and a `transition`
//   change, land nothing.
// - STV4: a new Transition end on a key the target also animates counts: the key animates to its
//   target again, from its last end, and rests at the new end.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { type Ward, ward, type WardConfig, WardicProvider, type WardicTransition } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { createSignal } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

// Clear of the page's one mouse, parked at (5, 5) for every browser file.
const BOX = { width: "40px", height: "40px", "margin-top": "120px", "margin-left": "120px" } as const
const FAST: WardicTransition = { type: "tween", duration: 0.1 }
const SLOW: WardicTransition = { type: "tween", duration: 1, ease: "linear" }

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const xOf = (el: HTMLElement): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41

const pointer = { pointerId: 1, pointerType: "mouse", isPrimary: true, bubbles: true } as const

/** Mount a `div` spread with a ward made from `config` in a component under the provider; the ward and its element. */
const mountCard = (config: WardConfig): { readonly card: Ward; readonly el: () => HTMLElement } => {
  let card!: Ward
  let el!: HTMLElement
  const Card = (): JSX.Element => {
    card = ward(config)
    return <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
  }
  mount(() => (
    <WardicProvider env={DomLive}>
      <Card />
    </WardicProvider>
  ))
  return { card, el: () => el }
}

/** Whether `promise` has settled, after `n` frames. */
const settledWithin = async (promise: Promise<unknown>, n: number): Promise<boolean> => {
  let done = false
  void promise.then(
    () => (done = true),
    () => (done = true),
  )
  await frames(n)
  return done
}

/** Dispatch `type` on `el` each frame until `promise` resolves (a recognizer attaches its listener asynchronously); its value. */
const retrying = async <A,>(promise: Promise<A>, el: () => HTMLElement, type: string): Promise<A> => {
  let value: { readonly v: A } | undefined
  void promise.then((v) => (value = { v }))
  await until(() => {
    if (value === undefined) el().dispatchEvent(new PointerEvent(type, pointer))
    return value !== undefined
  }, 2000)
  expect(value, "it resolved").toBeDefined()
  return value!.v
}

describe("a change that resolves the same target on Solid 2 (#470)", () => {
  it("STV1: a hover whose values are already drawn lands, on and off", async () => {
    const { card, el } = mountCard({ initial: false, animate: { opacity: 0.2 }, whileHover: { opacity: 0.2 }, transition: FAST, style: BOX })
    await frames(3)
    const on = await retrying(card.next("settled"), el, "pointerenter")
    expect(on.gestures.hover, "the hover's landing").toBe(true)
    const off = card.next("settled")
    el().dispatchEvent(new PointerEvent("pointerleave", pointer))
    expect((await off).gestures.hover, "and its end's").toBe(false)
  })

  it("STV2: an orchestrating ward's whileHover name lands as the name", async () => {
    const { card, el } = mountCard({ variants: { rest: {}, lift: {} }, initial: "rest", animate: "rest", whileHover: "lift", transition: FAST, style: BOX })
    await frames(3)
    const landing = await retrying(card.next("settled"), el, "pointerenter")
    expect(landing.definition, "nothing of its own to move").toBe("lift")
  })

  it("STV3: a hover with only next('hoverStart'), and a transition change, land nothing", async () => {
    const [transition, setTransition] = createSignal<WardicTransition>(FAST)
    const { card, el } = mountCard({ initial: false, animate: { opacity: 0.5 }, transition: () => transition(), style: BOX })
    await frames(3)
    const landed = card.next("settled")
    await retrying(card.next("hoverStart"), el, "pointerenter")
    expect(await settledWithin(landed, 6), "no layer for the hover").toBe(false)
    setTransition(SLOW)
    expect(await settledWithin(landed, 6), "a transition alone").toBe(false)
  })

  it("STV4: a new Transition end on a key the target also animates counts", async () => {
    const [end, setEnd] = createSignal(0)
    const { card, el } = mountCard({ initial: { x: 0 }, animate: () => ({ x: 100, transitionEnd: { x: end() } }), transition: FAST, style: BOX })
    await card.next("settled")
    await frames(2)
    expect(xOf(el()), "rests at its end").toBeCloseTo(0, 3)
    let landed = false
    void card.next("settled").then(() => (landed = true))
    setEnd(30)
    // The key animates to its target again, from its last end, as Motion's does; then takes the new end.
    let most = 0
    for (let i = 0; i < 60 && Bool.not(landed); i++) {
      await raf()
      most = Math.max(most, xOf(el()))
    }
    await frames(2)
    expect(landed, "a new end is a new target").toBe(true)
    expect(most, "x animated back toward 100").toBeGreaterThan(90)
    expect(xOf(el()), "rests at the new end").toBeCloseTo(30, 3)
  })
})
