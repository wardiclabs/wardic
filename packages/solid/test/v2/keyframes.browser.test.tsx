// Keyframes in targets (#429, ADR-0058), on Solid 2: a ward's waits see their landing, and their
// failure. Solid 1's are KS1–KS11.
//
// - KW1: Keyframes play through their stops; `next("settled")` resolves at the last, its `target`.
// - KW2: a spring given three stops is Motion's error: `next("settled")` rejects with it, naming the
//   key and the fix, and the key lands on its last stop.
// - KW3: `initial: false` starts at `animate`'s last stop: `settled()` stays `undefined`, nothing
//   played.
// - KW4: new stops with the same last one are a new target (`sameResolution` compares them): they
//   play again, and `next("settled")` resolves at their landing.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { type Ward, ward, type WardConfig, WardicProvider } from "@wardic/solid/unstable/v2"
import { createSignal, flush, isPending } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

// Clear of the page's one mouse, parked at (5, 5) for every browser file.
const BOX = { width: "40px", height: "40px", "margin-top": "120px", "margin-left": "120px" } as const
const LINEAR = { type: "tween", ease: "linear", duration: 0.3 } as const

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const xOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41

/** Mount a `div` spread with a ward made from `config` under the provider; the ward and its element. */
const mountCard = (config: WardConfig): { readonly card: Ward; readonly el: () => HTMLElement } => {
  let card!: Ward
  const Card = (): JSX.Element => {
    card = ward(config)
    return <div data-card {...card} />
  }
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      <Card />
    </WardicProvider>
  ))
  return { card, el: () => host.querySelector<HTMLElement>("[data-card]")! }
}

const messageOf = (e: unknown): string => String((e as { readonly message?: unknown }).message ?? e)

describe("Keyframes on Solid 2 (#429)", () => {
  it("KW1: Keyframes play through their stops; next('settled') resolves at the last", async () => {
    const { card, el } = mountCard({ animate: { x: [0, 100, 40] }, transition: LINEAR, style: BOX })
    const landed = card.next("settled")
    let peak = 0
    for (let i = 0; i < 40; i++) {
      await raf()
      peak = Math.max(peak, xOf(el()))
    }
    expect(peak, "through its middle stop").toBeGreaterThan(95)
    expect((await landed).target).toEqual({ x: 40 })
    expect(xOf(el())).toBe(40)
  })

  it("KW2: a spring given three stops is Motion's error: next('settled') rejects with it", async () => {
    const [to, setTo] = createSignal<number | ReadonlyArray<number>>(0)
    const { card, el } = mountCard({ animate: () => ({ x: to() }), transition: { type: "spring" }, style: BOX })
    await frames(4)
    const failed = card.next("settled").then(() => "resolved", messageOf)
    setTo([0, 100, 40])
    flush()
    const message = await failed
    expect(message).toContain('"x" has 3 keyframes, and a spring takes two')
    expect(message).toContain('transition: { "x": { type: "tween" } }')
    await frames(3)
    expect(xOf(el()), "on its last stop").toBe(40)
  })

  it("KW3: initial: false starts at animate's last stop: settled() stays undefined, nothing played", async () => {
    const { card, el } = mountCard({ initial: false, animate: { x: [0, 100, 40] }, transition: LINEAR, style: BOX })
    const seen: Array<number> = []
    for (let i = 0; i < 20; i++) {
      await raf()
      seen.push(xOf(el()))
    }
    expect(seen.every((x) => x === 40), "drawn at its last stop, never moved").toBe(true)
    expect(card.settled(), "nothing landed").toBeUndefined()
    expect(isPending(() => card.settled())).toBe(false)
  })

  it("KW4: new stops with the same last one play again", async () => {
    const [stops, setStops] = createSignal<ReadonlyArray<number>>([0, 100, 0])
    const { card, el } = mountCard({ animate: () => ({ x: stops() }), transition: LINEAR, style: BOX })
    await card.next("settled")
    const landed = card.next("settled")
    setStops([0, 50, 0])
    flush()
    let peak = 0
    for (let i = 0; i < 40; i++) {
      await raf()
      peak = Math.max(peak, xOf(el()))
    }
    expect(peak, "through the new middle stop").toBeGreaterThan(30)
    expect(peak).toBeLessThan(55)
    expect((await landed).target).toEqual({ x: 0 })
  })
})
