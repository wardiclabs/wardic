// A key's velocity from its frames on Solid 2 (#464): the Solid 1 binding's (`../tween-velocity.browser.test.tsx`).
//
// - VLV1: a spring that takes over a moving tween carries its speed on outward first.
// - VLV2: a spring after a tween that landed starts at rest: no older spring's velocity.
import { DomLive } from "@wardic/dom"
import type { JSX } from "@solidjs/web"
import { ward, WardicProvider, type WardicTransition } from "@wardic/solid/unstable/v2"
import { createSignal } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const BOX: JSX.CSSProperties = { width: "40px", height: "40px", background: "teal" }
const xOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41
const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement
const xs = async (el: Element, n: number): Promise<ReadonlyArray<number>> => {
  const out: Array<number> = []
  for (let i = 0; i < n; i++) {
    await raf()
    out.push(xOf(el))
  }
  return out
}

/** A ward animating `x` to a target on a transition, both signals, set together. */
const mountBox = (): ((x: number, t: WardicTransition) => void) => {
  const [x, setX] = createSignal(0)
  const [transition, setTransition] = createSignal<WardicTransition>({ duration: 0.1 }, { ownedWrite: true })
  const Box = (): JSX.Element => {
    const box = ward({ initial: { x: 0 }, animate: () => ({ x: x() }), transition: () => transition(), style: BOX })
    return <div id="box" {...box} ref={box} />
  }
  mount(() => (
    <WardicProvider env={DomLive}>
      <Box />
    </WardicProvider>
  ))
  return (to, t) => {
    setTransition(() => t)
    setX(to)
  }
}

describe("a key's velocity from its frames on Solid 2 (#464)", () => {
  it("VLV1: a spring that takes over a moving tween carries its speed on outward first", async () => {
    const set = mountBox()
    await xs(document.body, 3)
    set(300, { duration: 1, ease: "linear" })
    await until(() => xOf(byId("box")) > 100)
    const at = xOf(byId("box"))
    set(0, { type: "spring", stiffness: 100, damping: 10 })
    const after = await xs(byId("box"), 4)
    expect(Math.max(...after), "on outward first").toBeGreaterThan(at + 2)
  })

  it("VLV2: a spring after a tween that landed starts at rest", async () => {
    const set = mountBox()
    await xs(document.body, 3)
    set(300, { type: "spring", stiffness: 100, damping: 10 })
    await until(() => xOf(byId("box")) > 60)
    set(100, { duration: 0.2 })
    await until(() => Math.abs(xOf(byId("box")) - 100) < 0.01)
    await new Promise((resolve) => setTimeout(resolve, 100))
    set(110, { type: "spring", stiffness: 100, damping: 20 })
    const after = await xs(byId("box"), 40)
    expect(Math.max(...after), "a critically damped spring doesn't overshoot").toBeLessThan(110.5)
  })
})
