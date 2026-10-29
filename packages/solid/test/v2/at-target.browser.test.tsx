// A key already at its target starts no leg (#448), on Solid 2: a mount that starts at its `animate`
// lands nothing, and a Retarget whose every key is already there lands at once. Solid 1's are
// TH1–TH6.
//
// - TH7: `initial: false`: `settled()` stays `undefined` and isn't pending, and `next("settled")`
//   waits through the mount, until the first real animation lands.
// - TH8: a variant change to the same values, on a 1 s tween, lands at once: `next("settled")`
//   resolves within two frames, `settled()` never pending.
// - TH9 (#475): `initial: false` with a transition that gives a velocity, a spring's or an inertia's,
//   moves nothing and lands nothing at mount, as Motion's; the next change runs on it.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { type Ward, ward, type WardConfig, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { createSignal, isPending } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

// Clear of the page's one mouse, parked at (5, 5) for every browser file.
const BOX = { width: "40px", height: "40px", "margin-top": "120px", "margin-left": "120px" } as const

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

/** Mount a `div` spread with a ward made from `config` in a component under the provider; the ward. */
const mountCard = (config: WardConfig): Ward => {
  let card!: Ward
  const Card = (): JSX.Element => {
    card = ward(config)
    return <div {...card} />
  }
  mount(() => (
    <WardicProvider env={DomLive}>
      <Card />
    </WardicProvider>
  ))
  return card
}

describe("a key already at its target on Solid 2 (#448)", () => {
  it("TH7: initial: false lands nothing at mount; next waits for the first real animation", async () => {
    const [to, setTo] = createSignal(0.5)
    const card = mountCard({ initial: false, animate: () => ({ opacity: to() }), transition: { type: "tween", duration: 0.1 }, style: BOX })
    let landed = false
    const next = card.next("settled").then((landing) => {
      landed = true
      return landing
    })
    await frames(20)
    expect(card.settled(), "nothing landed").toBeUndefined()
    expect(isPending(() => card.settled()), "nor pending").toBe(false)
    expect(landed, "next waits through the mount").toBe(false)
    setTo(1)
    expect((await next).target).toEqual({ opacity: 1 })
  })

  it("TH8: a variant change to the same values lands at once", async () => {
    const [name, setName] = createSignal("a")
    const card = mountCard({
      variants: { a: { opacity: 0.5 }, b: { opacity: 0.5 } },
      initial: "a",
      animate: () => name(),
      transition: { type: "tween", duration: 1 },
      style: BOX,
    })
    await frames(4)
    let landed: string | undefined
    void card.next("settled").then((landing) => (landed = String(landing.definition)))
    setName("b")
    await frames(2)
    expect(landed, "within two frames, not after the second").toBe("b")
    expect(isPending(() => card.settled())).toBe(false)
    expect(Bool.match(card.settled() === undefined, { onTrue: () => "none", onFalse: () => String(card.settled()?.definition) })).toBe("b")
  })

  it("TH9: initial: false with a transition's velocity moves and lands nothing at mount; the next change runs on it (#475)", async () => {
    const [to, setTo] = createSignal(0)
    let spring!: Ward
    let inertia!: Ward
    const Cards = (): JSX.Element => {
      spring = ward({ initial: false, animate: () => ({ x: to() }), transition: { type: "spring", stiffness: 300, damping: 20, velocity: 800 }, style: BOX })
      inertia = ward({ initial: false, animate: () => ({ x: to() }), transition: { type: "inertia", velocity: 800, max: 50 }, style: BOX })
      return (
        <>
          <div id="th9-spring" {...spring} />
          <div id="th9-inertia" {...inertia} />
        </>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Cards />
      </WardicProvider>
    ))
    const els = [document.getElementById("th9-spring")!, document.getElementById("th9-inertia")!]
    const xOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41
    let farthest = 0
    for (let i = 0; i < 20; i++) {
      await raf()
      farthest = Math.max(farthest, ...els.map((el) => Math.abs(xOf(el))))
    }
    expect(farthest, "nothing moved at mount").toBeLessThan(0.01)
    expect(spring.settled(), "nothing landed").toBeUndefined()
    expect(inertia.settled()).toBeUndefined()
    expect(isPending(() => inertia.settled()), "nor pending").toBe(false)
    const landing = inertia.next("settled")
    setTo(200)
    expect((await landing).target, "the next change runs").toEqual({ x: 200 })
  })
})
