// `WardicConfig`'s transition on Solid 1 (#434, Motion's `MotionConfig` `transition`): the Config
// transition is each element's own when it gives none. Real frames: a 1 s linear tween is well short of
// its target while a 0.1 s one has landed.
//
// - WC1: an element with no transition runs on the config's; one with its own, on its own.
// - WC2: an inner config replaces an outer one's transition; `inherit: true` lays its fields over it;
//   one that gives none passes it on.
// - WC3: a Variant child runs on the config's, not its parent's (Q3); with no config, its parent's.
// - WC4: a variant's own transition with `inherit: true` lays its fields over the config's.
// - WC5: an exit, a gesture target and Animation controls' start run on the config's.
// - WC6: a layout animation runs on the config's `layout` entry.
// - WC7: a config's transition that defines none (a `delay` alone) keeps its delay over each key's
//   Default transition.
// - WC8: `createAnimate`'s `animate()` runs on its options alone, as Motion's: not on the config's.
// - WC9: a change to the config moves nothing and tells nothing, as a change to the element's own
//   `transition` (#470, Motion's); the next animation runs on the new one.
// - WC10: a config's `staggerChildren` staggers the Variant children of an element that gives none.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import {
  AnimatePresence,
  createAnimate,
  createAnimationControls,
  type WardicAnimate,
  wardic,
  WardicConfig,
  WardicProvider,
  type WardicTransition,
  type WardicVariants,
} from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const xOf = (el: HTMLElement): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41
const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)

const FAST: WardicTransition = { type: "tween", duration: 0.1 }
const SLOW: WardicTransition = { type: "tween", duration: 1, ease: "linear" }
const BOX = { display: "block", width: "20px", height: "20px" } as const

/** Render `ui` inside a provider; the returned function finds a `data-k`. */
const mount = (ui: () => JSX.Element) => {
  const { container } = render(() => <WardicProvider env={DomLive}>{ui()}</WardicProvider>)
  return (k: string): HTMLElement => container.querySelector<HTMLElement>(`[data-k="${k}"]`)!
}

/** Once `fast` has landed at 100, where `slow` is. */
const slowWhenFastLands = async (fast: HTMLElement, slow: HTMLElement): Promise<number> => {
  await until(() => xOf(fast) > 99.9, 2000)
  expect(xOf(fast), "the fast one landed").toBeGreaterThan(99.9)
  return xOf(slow)
}

const to100 = (on: () => boolean) => Bool.match(on(), { onTrue: () => ({ x: 100 }), onFalse: () => ({ x: 0 }) })

describe("WardicConfig's transition on Solid 1 (#434)", () => {
  it("WC1: an element with no transition runs on the config's; one with its own, on its own", async () => {
    const [on, setOn] = createSignal(false)
    const q = mount(() => (
      <WardicConfig transition={SLOW}>
        <wardic.div data-k="config" initial={{ x: 0 }} animate={to100(on)} style={BOX} />
        <wardic.div data-k="own" initial={{ x: 0 }} animate={to100(on)} transition={FAST} style={BOX} />
      </WardicConfig>
    ))
    await frames(3)
    setOn(true)
    expect(await slowWhenFastLands(q("own"), q("config")), "on the config's 1 s").toBeLessThan(60)
  })

  it("WC2: an inner config replaces an outer one's transition; inherit: true lays its fields over it", async () => {
    const [on, setOn] = createSignal(false)
    const q = mount(() => (
      <WardicConfig transition={SLOW}>
        <WardicConfig transition={FAST}>
          <wardic.div data-k="replaced" initial={{ x: 0 }} animate={to100(on)} style={BOX} />
        </WardicConfig>
        <WardicConfig transition={{ inherit: true, delay: 0.3 }}>
          <wardic.div data-k="inherits" initial={{ x: 0 }} animate={to100(on)} style={BOX} />
        </WardicConfig>
        <WardicConfig>
          <wardic.div data-k="passed" initial={{ x: 0 }} animate={to100(on)} style={BOX} />
        </WardicConfig>
      </WardicConfig>
    ))
    await frames(3)
    setOn(true)
    expect(await slowWhenFastLands(q("replaced"), q("inherits")), "still waiting its 0.3 s").toBeCloseTo(0, 3)
    expect(xOf(q("passed")), "a config with none passes the outer 1 s on").toBeLessThan(60)
    await until(() => xOf(q("inherits")) > 0.01, 2000)
    await wait(200)
    expect(xOf(q("inherits")), "then on the outer 1 s").toBeLessThan(45)
  })

  it("WC3: a Variant child runs on the config's, not its parent's; with no config, its parent's", async () => {
    const [on, setOn] = createSignal(false)
    const LIST: WardicVariants = { hidden: { opacity: 0.5 }, shown: { opacity: 1 } }
    const ITEM: WardicVariants = { hidden: { x: 0 }, shown: { x: 100 } }
    const names = () => Bool.match(on(), { onTrue: () => "shown", onFalse: () => "hidden" })
    const q = mount(() => (
      <>
        <WardicConfig transition={SLOW}>
          <wardic.ul initial="hidden" animate={names()} variants={LIST} transition={FAST} style={{ "list-style": "none" }}>
            <wardic.li data-k="config" variants={ITEM} style={BOX} />
          </wardic.ul>
        </WardicConfig>
        <wardic.ul initial="hidden" animate={names()} variants={LIST} transition={FAST} style={{ "list-style": "none" }}>
          <wardic.li data-k="parent" variants={ITEM} style={BOX} />
        </wardic.ul>
      </>
    ))
    await frames(3)
    setOn(true)
    expect(await slowWhenFastLands(q("parent"), q("config")), "on the config's 1 s, not the list's 0.1 s").toBeLessThan(60)
  })

  it("WC4: a variant's own transition with inherit: true lays its fields over the config's", async () => {
    const [on, setOn] = createSignal(false)
    const BOXES: WardicVariants = { hidden: { x: 0 }, shown: { x: 100, transition: { inherit: true, delay: 0.3 } } }
    const q = mount(() => (
      <WardicConfig transition={SLOW}>
        <wardic.div data-k="el" initial="hidden" animate={Bool.match(on(), { onTrue: () => "shown", onFalse: () => "hidden" })} variants={BOXES} style={BOX} />
      </WardicConfig>
    ))
    await frames(3)
    setOn(true)
    await wait(200)
    expect(xOf(q("el")), "its own delay").toBeCloseTo(0, 3)
    await until(() => xOf(q("el")) > 0.01, 2000)
    await wait(200)
    expect(xOf(q("el")), "on the config's 1 s").toBeLessThan(45)
  })

  it("WC5: an exit, a gesture target and Animation controls' start run on the config's", async () => {
    const [shown, setShown] = createSignal(true)
    const controls = createAnimationControls()
    const q = mount(() => (
      <WardicConfig transition={SLOW}>
        <AnimatePresence>
          <Show when={shown()}>
            <wardic.div data-k="exit" initial={{ x: 0 }} animate={{ x: 0 }} exit={{ x: 100 }} style={BOX} />
          </Show>
        </AnimatePresence>
        <wardic.div data-k="hover" initial={{ x: 0 }} whileHover={{ x: 100 }} style={BOX} />
        <wardic.div data-k="controls" initial={{ x: 0 }} animate={controls} style={BOX} />
        <wardic.div data-k="fast" initial={{ x: 0 }} animate={controls} transition={FAST} style={BOX} />
      </WardicConfig>
    ))
    await frames(3)
    const exiting = q("exit")
    const hovered = q("hover")
    setShown(false)
    await until(() => {
      hovered.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1, bubbles: true }))
      return xOf(hovered) > 0.01
    }, 2000)
    void controls.start({ x: 100 })
    expect(await slowWhenFastLands(q("fast"), q("controls")), "a start on the config's 1 s").toBeLessThan(60)
    expect(xOf(exiting), "the exit on the config's 1 s").toBeLessThan(80)
    expect(exiting.isConnected, "still leaving").toBe(true)
    expect(xOf(hovered), "the hover on the config's 1 s").toBeLessThan(80)
  })

  it("WC6: a layout animation runs on the config's layout entry", async () => {
    const [moved, setMoved] = createSignal(false)
    const left = () => Bool.match(moved(), { onTrue: () => "200px", onFalse: () => "0px" })
    const q = mount(() => (
      <div style={{ position: "relative", height: "120px" }}>
        <WardicConfig transition={{ layout: { type: "tween", duration: 1, ease: "linear" } }}>
          <wardic.div data-k="config" layout layoutDependency={moved()} style={{ position: "absolute", top: "0px", left: left(), width: "40px", height: "40px" }} />
        </WardicConfig>
        <wardic.div data-k="default" layout layoutDependency={moved()} style={{ position: "absolute", top: "60px", left: left(), width: "40px", height: "40px" }} />
      </div>
    ))
    await frames(5)
    const origin = q("config").getBoundingClientRect().left
    setMoved(true)
    await wait(300)
    expect(q("default").getBoundingClientRect().left - origin, "Motion's 0.45 s tween, nearly there").toBeGreaterThan(140)
    expect(q("config").getBoundingClientRect().left - origin, "the config's 1 s").toBeLessThan(120)
  })

  it("WC7: a config's transition that defines none keeps its delay over each key's Default transition", async () => {
    const [on, setOn] = createSignal(false)
    const q = mount(() => (
      <WardicConfig transition={{ delay: 0.3 }}>
        <wardic.div data-k="el" initial={{ x: 0 }} animate={to100(on)} style={BOX} />
      </WardicConfig>
    ))
    await frames(3)
    setOn(true)
    await wait(200)
    expect(xOf(q("el")), "its delay").toBeCloseTo(0, 3)
    await until(() => Math.abs(xOf(q("el")) - 100) < 0.5, 1500)
    expect(xOf(q("el")), "then a transform's spring, quick").toBeCloseTo(100, 0)
  })

  it("WC8: createAnimate's animate() runs on its options alone, not on the config's", async () => {
    let animate!: WardicAnimate
    const Scene = (): JSX.Element => {
      const [scope, made] = createAnimate()
      animate = made
      return <div ref={scope}><div data-k="p" style={BOX} /></div>
    }
    const q = mount(() => (
      <WardicConfig transition={SLOW}>
        <Scene />
      </WardicConfig>
    ))
    await frames(3)
    void animate(q("p"), { x: 100 })
    await wait(400)
    expect(xOf(q("p")), "a transform's spring, past the config's 40").toBeGreaterThan(80)
  })

  it("WC9: a change to the config moves nothing and tells nothing, as the element's own; the next animation runs on the new one", async () => {
    const [transition, setTransition] = createSignal<WardicTransition>(SLOW)
    const [on, setOn] = createSignal(false)
    let configStarts = 0
    let ownStarts = 0
    const q = mount(() => (
      <>
        <WardicConfig transition={transition()}>
          <wardic.div data-k="el" initial={{ x: 0 }} animate={to100(on)} onAnimationStart={() => configStarts++} style={BOX} />
        </WardicConfig>
        <wardic.div data-k="own" initial={{ x: 0 }} animate={to100(on)} transition={transition()} onAnimationStart={() => ownStarts++} style={BOX} />
        <wardic.div data-k="fast" initial={{ x: 0 }} animate={to100(on)} transition={FAST} style={BOX} />
      </>
    ))
    await frames(3)
    const mounted = { config: configStarts, own: ownStarts }
    setTransition(() => FAST)
    await frames(4)
    // #470: no Retarget, so nothing told.
    expect(configStarts, "the config's change tells nothing").toBe(mounted.config)
    expect(ownStarts, "nor does the element's own").toBe(mounted.own)
    expect(xOf(q("el")), "nothing moved").toBeCloseTo(0, 3)
    setOn(true)
    await until(() => xOf(q("fast")) > 99.9, 2000)
    await frames(2)
    expect(xOf(q("el")), "on the new 0.1 s").toBeGreaterThan(99.9)
  })

  it("WC10: a config's staggerChildren staggers the Variant children of an element that gives none", async () => {
    const [on, setOn] = createSignal(false)
    const ITEM: WardicVariants = { hidden: { x: 0 }, shown: { x: 100 } }
    const q = mount(() => (
      <WardicConfig transition={{ ...FAST, staggerChildren: 0.4 }}>
        <wardic.ul initial="hidden" animate={Bool.match(on(), { onTrue: () => "shown", onFalse: () => "hidden" })} variants={{ hidden: {}, shown: {} }} style={{ "list-style": "none" }}>
          <wardic.li data-k="first" variants={ITEM} style={BOX} />
          <wardic.li data-k="second" variants={ITEM} style={BOX} />
        </wardic.ul>
      </WardicConfig>
    ))
    await frames(3)
    setOn(true)
    expect(await slowWhenFastLands(q("first"), q("second")), "the second waits its 0.4 s slot").toBeCloseTo(0, 3)
    expect(opacityOf(q("second"))).toBe(1)
  })
})
