// Animation controls on Solid 1 (#433's PR 3, Motion's `useAnimationControls`): `animate={controls}`
// on `wardic.*`, a ward's config and a `Reorder.Item`; `start`, `set` and `stop`.
//
// - AC1: an element given controls stays at its `initial` until a start; `start(target)` animates it and
//   resolves at its landing; every element given the controls follows.
// - AC2: `start(name)` names the element's variants: its Variant children follow, staggered by the
//   variant's own orchestration, and the promise waits for the last of them.
// - AC3: a transition override beats the variant's own transition on the element and its Variant
//   children, and is their orchestration: no stagger here.
// - AC4: the override is the change's alone: a later Retarget of the same entry (its variant's values
//   changing) runs on the variant's own transition.
// - AC5: `set(name)` lands the element and its Variant children at once, with no stagger.
// - AC6: `stop()` ends the animation where it is.
// - AC7: a function definition is called once per element with its `custom`, not again as the element
//   resolves again.
// - AC8: `createWard({ animate: controls })` and a `Reorder.Item` follow too; an element that unmounts
//   mid-start doesn't hold the promise; a start that changes nothing resolves.
// - AC9: an element given controls names its own variants with none of its own (Motion's
//   `isControllingVariants`): its Variant children follow the names it's started to.
// - AC10: `set` toward the target a running start heads for lands at once: the override starts every
//   key again, a running leg toward the same target too.
// - AC11: an override's `when` orchestrates the change: `beforeChildren` holds the Variant children
//   until the element lands.
// - AC12: a start made in the task of one that changed nothing waits for its own landing.
// - AC13: an unmounted element is let go by the controls, which outlive it.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { createAnimationControls, createWard, Reorder, wardic, WardicProvider, type WardicVariants } from "@wardic/solid"
import { createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { commands } from "vitest/browser"
import "./browser-commands.ts"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const BOX: JSX.CSSProperties = { width: "40px", height: "40px", background: "teal" }

const matrixOf = (el: Element): DOMMatrix => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
const xOf = (el: Element): number => matrixOf(el).m41
const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement

const mount = (children: () => JSX.Element): void => {
  render(() => <WardicProvider env={DomLive}>{children()}</WardicProvider>)
}

/** A list's variants: its own opacity, its children staggered by 0.15 s. */
const LIST: WardicVariants = {
  hidden: { opacity: 0.2 },
  visible: { opacity: 1, transition: { duration: 0.1, staggerChildren: 0.15 } },
}

/** An item's variants: sliding in over 0.2 s. */
const ITEM: WardicVariants = {
  hidden: { x: -40 },
  visible: { x: 0, transition: { duration: 0.2, ease: "linear" } },
}

describe("Animation controls on Solid 1 (#433)", () => {
  it("AC1: it stays at initial until a start; start(target) animates and resolves at the landing; all given it follow", async () => {
    const controls = createAnimationControls()
    mount(() => (
      <>
        <wardic.div id="a" initial={{ x: 10 }} animate={controls} style={BOX} />
        <wardic.div id="b" initial={{ x: 10 }} animate={controls} style={BOX} />
      </>
    ))
    await frames(4)
    expect(xOf(byId("a")), "at its initial").toBeCloseTo(10, 3)
    let done = false
    const started = controls.start({ x: 100 }, { duration: 0.3, ease: "linear" })
    void started.then(() => (done = true))
    await until(() => xOf(byId("a")) > 30)
    expect(done, "under way").toBe(false)
    expect(xOf(byId("b")), "the other too").toBeGreaterThan(30)
    await started
    expect(xOf(byId("a"))).toBeCloseTo(100, 0)
    expect(xOf(byId("b"))).toBeCloseTo(100, 0)
  })

  it("AC2: start(name) names its variants: its Variant children follow, staggered, and the promise waits for them", async () => {
    const controls = createAnimationControls()
    mount(() => (
      <wardic.ul id="list" initial="hidden" animate={controls} variants={LIST} style={{ "list-style": "none" }}>
        <wardic.li id="i0" variants={ITEM} style={BOX} />
        <wardic.li id="i1" variants={ITEM} style={BOX} />
      </wardic.ul>
    ))
    await frames(4)
    expect(xOf(byId("i0")), "hidden").toBeCloseTo(-40, 1)
    const began = performance.now()
    const started = controls.start("visible")
    await until(() => xOf(byId("i0")) > -30)
    expect(xOf(byId("i1")), "the second waits its stagger").toBeCloseTo(-40, 1)
    await until(() => xOf(byId("i1")) > -39)
    expect(xOf(byId("i0")), "the first ahead").toBeGreaterThan(xOf(byId("i1")))
    await started
    expect(performance.now() - began, "the last child's landing: 0.15 s + 0.2 s").toBeGreaterThan(300)
    expect(xOf(byId("i0"))).toBeCloseTo(0, 1)
    expect(xOf(byId("i1"))).toBeCloseTo(0, 1)
    expect(opacityOf(byId("list"))).toBeCloseTo(1, 2)
  })

  it("AC3: an override beats the variant's own transition, on the element and its Variant children, and is their orchestration", async () => {
    const controls = createAnimationControls()
    mount(() => (
      <wardic.ul id="list" initial="hidden" animate={controls} variants={LIST} style={{ "list-style": "none" }}>
        <wardic.li id="i0" variants={ITEM} style={BOX} />
        <wardic.li id="i1" variants={ITEM} style={BOX} />
      </wardic.ul>
    ))
    await frames(4)
    const started = controls.start("visible", { duration: 0.6, ease: "linear" })
    await until(() => xOf(byId("i0")) > -30)
    await frames(2)
    // No stagger: they move together, on the override's 0.6 s, not the item's 0.2 s.
    expect(Math.abs(xOf(byId("i0")) - xOf(byId("i1"))), "together").toBeLessThan(3)
    await wait(150)
    expect(xOf(byId("i0")), "still under way at the item's own 0.2 s").toBeLessThan(-8)
    expect(opacityOf(byId("list")), "the list on it too").toBeLessThan(0.9)
    await started
    expect(xOf(byId("i1"))).toBeCloseTo(0, 1)
  })

  it("AC4: the override is the change's alone: a later Retarget of the same entry runs on its own transition", async () => {
    const controls = createAnimationControls()
    const [to, setTo] = createSignal(100)
    mount(() => <wardic.div id="a" initial="rest" animate={controls} variants={{ rest: { x: 0 }, moved: { x: to(), transition: { duration: 0.1, ease: "linear" } } }} style={BOX} />)
    await frames(4)
    await controls.start("moved", { duration: 0.5, ease: "linear" })
    expect(xOf(byId("a"))).toBeCloseTo(100, 0)
    const began = performance.now()
    setTo(200)
    await until(() => Math.abs(xOf(byId("a")) - 200) < 0.5)
    expect(performance.now() - began, "the variant's 0.1 s, not the override's 0.5 s").toBeLessThan(350)
  })

  it("AC5: set(name) lands the element and its Variant children at once, with no stagger", async () => {
    const controls = createAnimationControls()
    mount(() => (
      <wardic.ul id="list" initial="hidden" animate={controls} variants={LIST} style={{ "list-style": "none" }}>
        <wardic.li id="i0" variants={ITEM} style={BOX} />
        <wardic.li id="i1" variants={ITEM} style={BOX} />
      </wardic.ul>
    ))
    await frames(4)
    controls.set("visible")
    await frames(3)
    expect(xOf(byId("i0"))).toBeCloseTo(0, 1)
    expect(xOf(byId("i1")), "no stagger").toBeCloseTo(0, 1)
    expect(opacityOf(byId("list"))).toBeCloseTo(1, 2)
    controls.set("hidden")
    await frames(3)
    expect(xOf(byId("i1"))).toBeCloseTo(-40, 1)
    expect(opacityOf(byId("list"))).toBeCloseTo(0.2, 2)
  })

  it("AC6: stop() ends the animation where it is", async () => {
    const controls = createAnimationControls()
    mount(() => <wardic.div id="a" initial={{ x: 0 }} animate={controls} style={BOX} />)
    await frames(4)
    void controls.start({ x: 200 }, { duration: 1, ease: "linear" })
    await until(() => xOf(byId("a")) > 20)
    controls.stop()
    await raf()
    const at = xOf(byId("a"))
    await frames(8)
    expect(xOf(byId("a")), "stopped where it was").toBeCloseTo(at, 3)
    expect(at).toBeLessThan(150)
  })

  it("AC7: a function definition is called once per element with its custom", async () => {
    const controls = createAnimationControls()
    const [opacity, setOpacity] = createSignal(1)
    let calls = 0
    mount(() => (
      <For each={[0, 1, 2]}>{(i) => <wardic.div id={`c${i}`} custom={i} initial={{ x: 0 }} animate={controls} whileHover={{ opacity: opacity() }} style={BOX} />}</For>
    ))
    await frames(4)
    await controls.start(
      (i: number, current: Readonly<Record<string, number | string>>) => {
        calls++
        return { x: Number(current["x"] ?? 0) + i * 50 }
      },
      { duration: 0.1 },
    )
    expect(calls, "once per element").toBe(3)
    expect(xOf(byId("c0"))).toBeCloseTo(0, 0)
    expect(xOf(byId("c1"))).toBeCloseTo(50, 0)
    expect(xOf(byId("c2"))).toBeCloseTo(100, 0)
    // Resolved again (another prop changed): the target it was started to, not the resolver's again.
    setOpacity(0.5)
    await frames(6)
    expect(calls, "not called again").toBe(3)
    expect(xOf(byId("c2"))).toBeCloseTo(100, 0)
  })

  it("AC8: a ward's config and a Reorder.Item follow; an unmount mid-start doesn't hold it; a start that changes nothing resolves", async () => {
    const controls = createAnimationControls()
    const [shown, setShown] = createSignal(true)
    const Card = (): JSX.Element => {
      const ward = createWard({ initial: { x: 0 }, animate: controls })
      return <div id="w" {...ward({ style: BOX })} />
    }
    mount(() => (
      <>
        <Card />
        <Reorder.Group values={["r"]} onReorder={() => undefined}>
          <Reorder.Item id="r" value="r" initial={{ opacity: 1 }} animate={controls} style={BOX} />
        </Reorder.Group>
        <Show when={shown()}>
          <wardic.div id="gone" initial={{ x: 0 }} animate={controls} style={BOX} />
        </Show>
      </>
    ))
    await frames(4)
    const started = controls.start({ x: 60, opacity: 0.5 }, { duration: 0.3 })
    await frames(3)
    setShown(false)
    await started
    expect(xOf(byId("w"))).toBeCloseTo(60, 0)
    expect(opacityOf(byId("r"))).toBeCloseTo(0.5, 2)
    // The same again: nothing to animate, it resolves.
    let again = false
    void controls.start({ x: 60, opacity: 0.5 }).then(() => (again = true))
    await until(() => again, 1000)
    expect(again).toBe(true)
  })

  it("AC9: with no variants of its own, it names its own: its Variant children follow its names", async () => {
    const controls = createAnimationControls()
    mount(() => (
      <wardic.ul id="list" animate={controls} style={{ "list-style": "none" }}>
        <wardic.li id="i0" variants={ITEM} style={BOX} />
      </wardic.ul>
    ))
    await frames(4)
    await controls.start("hidden", { duration: 0.1 })
    expect(xOf(byId("i0"))).toBeCloseTo(-40, 1)
    await controls.start("visible", { duration: 0.1 })
    expect(xOf(byId("i0"))).toBeCloseTo(0, 1)
  })

  it("AC10: set toward the target a running start heads for lands at once", async () => {
    const controls = createAnimationControls()
    mount(() => <wardic.div id="a" initial={{ x: 0 }} animate={controls} style={BOX} />)
    await frames(4)
    void controls.start({ x: 100 }, { duration: 2, ease: "linear" })
    await until(() => xOf(byId("a")) > 2)
    controls.set({ x: 100 })
    await frames(3)
    expect(xOf(byId("a")), "landed, not still on its 2 s").toBeCloseTo(100, 0)
  })

  it("AC11: an override's when orchestrates the change: beforeChildren holds the children until the element lands", async () => {
    const controls = createAnimationControls()
    mount(() => (
      <wardic.ul id="list" initial="hidden" animate={controls} variants={LIST} style={{ "list-style": "none" }}>
        <wardic.li id="i0" variants={ITEM} style={BOX} />
      </wardic.ul>
    ))
    await frames(4)
    const started = controls.start("visible", { duration: 0.3, ease: "linear", when: "beforeChildren" })
    await until(() => opacityOf(byId("list")) > 0.5)
    expect(opacityOf(byId("list")), "the list under way").toBeLessThan(0.95)
    expect(xOf(byId("i0")), "its child waits").toBeCloseTo(-40, 1)
    await started
    expect(xOf(byId("i0"))).toBeCloseTo(0, 1)
  })

  it("AC12: a start in the task of one that changed nothing waits for its own landing", async () => {
    const controls = createAnimationControls()
    mount(() => <wardic.div id="a" initial={{ x: 0 }} animate={controls} style={BOX} />)
    await frames(4)
    void controls.start({ x: 0 })
    await controls.start({ x: 100 }, { duration: 0.3, ease: "linear" })
    expect(xOf(byId("a")), "landed").toBeCloseTo(100, 0)
  })

  it("AC13: an unmounted element is let go by the controls, which outlive it", async () => {
    const controls = createAnimationControls()
    const refs: Array<WeakRef<HTMLElement>> = []
    const { unmount } = render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => refs.push(new WeakRef(n))} initial={{ x: 0 }} animate={controls} style={BOX} />
      </WardicProvider>
    ))
    await frames(4)
    await controls.start({ x: 20 }, { duration: 0.05 })
    unmount()
    await frames(4)
    await wait(0)
    await commands.collectGarbage()
    expect(refs.filter((ref) => ref.deref() !== undefined), "collected").toHaveLength(0)
    // The controls live on: here, past the collection.
    controls.stop()
  })
})
