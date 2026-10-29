// Animation controls on Solid 2 (#433's PR 3, Motion's `useAnimationControls`): the Solid 1 binding's,
// given to a ward's config and to `wardic.*`.
//
// - ACV1: a ward and a `wardic.*` element given one controls stay at `initial` until a start, then
//   follow it, and the promise resolves at their landing.
// - ACV2: `start(name)` with Variant children: staggered by the variant's own orchestration, the
//   promise after the last; an override runs them together on it.
// - ACV3: `set(name)` lands the element and its Variant children at once; `stop()` ends a start where it is.
// - ACV4: a function definition is called once per element with its `custom`.
// - ACV5: `set` toward the target a running start heads for lands at once: a change is a new target
//   for Solid 2's memo, though it resolves to the same values.
//
// No GC test, as Solid 1's AC13: Solid 2's dev build keeps an unmounted element's node in this harness,
// a plain one's too, so a WeakRef never clears.
import { DomLive } from "@wardic/dom"
import type { JSX } from "@solidjs/web"
import { createAnimationControls, ward, wardic, WardicProvider, type WardicVariants } from "@wardic/solid/unstable/v2"
import { For } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const BOX: JSX.CSSProperties = { width: "40px", height: "40px", background: "teal" }

const xOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41
const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}
const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement

const LIST: WardicVariants = {
  hidden: { opacity: 0.2 },
  visible: { opacity: 1, transition: { duration: 0.1, staggerChildren: 0.15 } },
}
const ITEM: WardicVariants = {
  hidden: { x: -40 },
  visible: { x: 0, transition: { duration: 0.2, ease: "linear" } },
}

describe("Animation controls on Solid 2 (#433)", () => {
  it("ACV1: a ward and a wardic.* element stay at initial until a start, then follow it to its landing", async () => {
    const controls = createAnimationControls()
    const Card = (): JSX.Element => {
      const card = ward({ initial: { x: 10 }, animate: controls, style: BOX })
      return <div id="w" {...card} ref={card} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
        <wardic.div id="e" initial={{ x: 10 }} animate={controls} style={BOX} />
      </WardicProvider>
    ))
    await frames(4)
    expect(xOf(byId("w"))).toBeCloseTo(10, 3)
    expect(xOf(byId("e"))).toBeCloseTo(10, 3)
    let done = false
    const started = controls.start({ x: 100 }, { duration: 0.3, ease: "linear" })
    void started.then(() => (done = true))
    await until(() => xOf(byId("w")) > 30)
    expect(done).toBe(false)
    await started
    expect(xOf(byId("w"))).toBeCloseTo(100, 0)
    expect(xOf(byId("e"))).toBeCloseTo(100, 0)
  })

  it("ACV2: start(name) staggers its Variant children and waits for the last; an override runs them together", async () => {
    const controls = createAnimationControls()
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.ul id="list" initial="hidden" animate={controls} variants={LIST} style={{ "list-style": "none" }}>
          <wardic.li id="i0" variants={ITEM} style={BOX} />
          <wardic.li id="i1" variants={ITEM} style={BOX} />
        </wardic.ul>
      </WardicProvider>
    ))
    await frames(4)
    const began = performance.now()
    const started = controls.start("visible")
    await until(() => xOf(byId("i0")) > -30)
    expect(xOf(byId("i1")), "the second waits its stagger").toBeCloseTo(-40, 1)
    await started
    expect(performance.now() - began).toBeGreaterThan(300)
    expect(xOf(byId("i1"))).toBeCloseTo(0, 1)
    const back = controls.start("hidden", { duration: 0.4, ease: "linear" })
    await until(() => xOf(byId("i0")) < -5)
    await frames(2)
    expect(Math.abs(xOf(byId("i0")) - xOf(byId("i1"))), "together, on the override").toBeLessThan(3)
    await back
    expect(xOf(byId("i1"))).toBeCloseTo(-40, 1)
  })

  it("ACV3: set(name) lands the element and its Variant children at once; stop() ends a start where it is", async () => {
    const controls = createAnimationControls()
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.ul id="list" initial="hidden" animate={controls} variants={LIST} style={{ "list-style": "none" }}>
          <wardic.li id="i0" variants={ITEM} style={BOX} />
          <wardic.li id="i1" variants={ITEM} style={BOX} />
        </wardic.ul>
      </WardicProvider>
    ))
    await frames(4)
    controls.set("visible")
    await frames(3)
    expect(xOf(byId("i0"))).toBeCloseTo(0, 1)
    expect(xOf(byId("i1"))).toBeCloseTo(0, 1)
    expect(opacityOf(byId("list"))).toBeCloseTo(1, 2)
    void controls.start("hidden", { duration: 1, ease: "linear" })
    await until(() => opacityOf(byId("list")) < 0.9)
    controls.stop()
    await raf()
    const at = opacityOf(byId("list"))
    await frames(8)
    // The element given the controls stops, as Motion's; its Variant children run on.
    expect(opacityOf(byId("list")), "stopped where it was").toBeCloseTo(at, 3)
    expect(at).toBeGreaterThan(0.25)
  })

  it("ACV4: a function definition is called once per element with its custom", async () => {
    const controls = createAnimationControls()
    mount(() => (
      <WardicProvider env={DomLive}>
        <For each={[0, 1, 2]}>{(i) => <wardic.div id={`c${i}`} custom={i} initial={{ x: 0 }} animate={controls} style={BOX} />}</For>
      </WardicProvider>
    ))
    await frames(4)
    await controls.start((i: number) => ({ x: i * 50 }), { duration: 0.1 })
    expect(xOf(byId("c1"))).toBeCloseTo(50, 0)
    expect(xOf(byId("c2"))).toBeCloseTo(100, 0)
  })

  it("ACV5: set toward the target a running start heads for lands at once", async () => {
    const controls = createAnimationControls()
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div id="a" initial={{ x: 0 }} animate={controls} style={BOX} />
      </WardicProvider>
    ))
    await frames(4)
    void controls.start({ x: 100 }, { duration: 2, ease: "linear" })
    await until(() => xOf(byId("a")) > 2)
    controls.set({ x: 100 })
    await frames(3)
    expect(xOf(byId("a")), "landed, not still on its 2 s").toBeCloseTo(100, 0)
  })
})
