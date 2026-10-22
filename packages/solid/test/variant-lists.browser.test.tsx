// Variant props take a list of names on Solid 1 (#297's PR 1, ADR-0007, Motion's `VariantLabels`).
// Real frames.
//
// - VL1: `animate` with a list merges its names in order, a later name's winning a key both set.
// - VL2: each key animates on the own transition of the last name that sets it (Q2).
// - VL3: a fresh list with the same names isn't a change of names: none is told again, nothing moves.
// - VL4: one name of a list changed: only its keys animate.
// - VL5: the list passes to Variant children, each resolving the names it has (Q4).
// - VL6: each name orchestrates the children's keys it sets (Q3): a name's stagger, another's none.
// - VL7: `initial` with a list: the Starting style merged, drawn from the first frame.
// - VL8: `exit` with a list: merged, each key on its name's transition.
// - VL9: `whileHover` with a list.
// - VL10: `onAnimationStart` once per name, in order; `onAnimationComplete` per name, as its keys settle (Q5).
// - VL11: an unknown name is skipped; an empty list is no name.
// - VL12: a dynamic variant in a list resolves with `custom`.
// - VL13: a list's returns run on the element's transition.
// - VL14: `when` for a list as a whole (PR 1): the last name that sets it.
// - VL15: the same, set by a later name in the list.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, type WardicAnimationDefinition, wardic, WardicProvider, type WardicVariants } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)
const matrixOf = (el: HTMLElement): DOMMatrix => new DOMMatrix(getComputedStyle(el).transform)
const xOf = (el: HTMLElement): number => matrixOf(el).m41
const scaleOf = (el: HTMLElement): number => matrixOf(el).a

const BOX = { display: "block", width: "20px", height: "20px" } as const
const FAST = { type: "tween", duration: 0.1 } as const
const SLOW = { type: "tween", duration: 1 } as const

/** Render `ui` inside a provider; `q` finds a `data-k`. */
const mount = (ui: () => JSX.Element) => {
  const { container } = render(() => <WardicProvider env={DomLive}>{ui()}</WardicProvider>)
  return (k: string): HTMLElement => container.querySelector<HTMLElement>(`[data-k="${k}"]`)!
}

describe("variant name lists on Solid 1 (#297)", () => {
  it("VL1: animate with a list merges its names in order, a later name winning a key both set", async () => {
    const variants: WardicVariants = { a: { x: 10, opacity: 0.5 }, b: { x: 30 } }
    const q = mount(() => <wardic.div data-k="el" variants={variants} initial={{ x: 0, opacity: 1 }} animate={["a", "b"]} transition={FAST} style={BOX} />)
    await until(() => Math.abs(xOf(q("el")) - 30) < 0.5, 2000)
    expect(xOf(q("el")), "b's x").toBeCloseTo(30, 0)
    expect(opacityOf(q("el")), "a's opacity").toBeCloseTo(0.5, 1)
  })

  it("VL2: each key animates on the own transition of the last name that sets it", async () => {
    const variants: WardicVariants = { fade: { opacity: 0.2, transition: FAST }, slide: { x: 100, transition: SLOW } }
    const q = mount(() => <wardic.div data-k="el" variants={variants} initial={{ x: 0, opacity: 1 }} animate={["fade", "slide"]} style={BOX} />)
    await until(() => opacityOf(q("el")) < 0.21, 2000)
    expect(opacityOf(q("el")), "the fade's 0.1 s").toBeLessThan(0.21)
    expect(xOf(q("el")), "the slide's 1 s, far from done").toBeLessThan(60)
    await until(() => xOf(q("el")) > 99.5, 3000)
    expect(xOf(q("el"))).toBeGreaterThan(99.5)
  })

  it("VL3: a fresh list with the same names isn't a change of names: none is told again, nothing moves", async () => {
    const [tick, setTick] = createSignal(0)
    const starts: Array<WardicAnimationDefinition> = []
    const variants: WardicVariants = { a: { x: 10 }, b: { opacity: 0.5 } }
    const q = mount(() => (
      <wardic.div
        data-k="el"
        data-tick={tick()}
        variants={variants}
        animate={Bool.match(tick() >= 0, { onTrue: () => ["a", "b"], onFalse: () => ["b"] })}
        transition={FAST}
        onAnimationStart={(definition: WardicAnimationDefinition) => starts.push(definition)}
        style={BOX}
      />
    ))
    await until(() => Math.abs(xOf(q("el")) - 10) < 0.5, 2000)
    await frames(3)
    starts.length = 0
    setTick(1)
    setTick(2)
    let moved = false
    for (let i = 0; i < 5; i++) {
      await raf()
      if (Math.abs(xOf(q("el")) - 10) > 0.01) moved = true
    }
    // Solid 1 tells a re-read config's Retarget as its values, a single name's too: not as its names.
    expect(starts.filter((definition) => Array.isArray(definition) || typeof definition === "string"), "no name told again").toEqual([])
    expect(moved, "nothing moved").toBe(false)
  })

  it("VL4: one name of a list changed: only its keys animate", async () => {
    const [selected, setSelected] = createSignal(false)
    const variants: WardicVariants = { visible: { opacity: 1 }, hidden: { opacity: 0 }, active: { scale: 1.5 }, inactive: { scale: 1 } }
    const q = mount(() => (
      <wardic.div
        data-k="el"
        variants={variants}
        initial={["hidden", "inactive"]}
        animate={["visible", Bool.match(selected(), { onTrue: () => "active", onFalse: () => "inactive" })]}
        transition={FAST}
        style={BOX}
      />
    ))
    await until(() => opacityOf(q("el")) >= 0.99, 2000)
    expect(scaleOf(q("el"))).toBeCloseTo(1, 2)
    setSelected(true)
    await until(() => scaleOf(q("el")) > 1.49, 2000)
    expect(scaleOf(q("el"))).toBeCloseTo(1.5, 1)
    expect(opacityOf(q("el")), "visible stays").toBeGreaterThanOrEqual(0.99)
  })

  it("VL5: the list passes to Variant children, each resolving the names it has", async () => {
    const [selected, setSelected] = createSignal(false)
    const card: WardicVariants = { visible: { opacity: 1 }, hidden: { opacity: 0 }, active: {}, inactive: {} }
    const label: WardicVariants = { visible: { x: 0 }, hidden: { x: -20 } }
    const icon: WardicVariants = { active: { scale: 1.5 }, inactive: { scale: 1 } }
    const q = mount(() => (
      <wardic.div
        data-k="card"
        variants={card}
        initial={["hidden", "inactive"]}
        animate={["visible", Bool.match(selected(), { onTrue: () => "active", onFalse: () => "inactive" })]}
        transition={FAST}
        style={BOX}
      >
        <wardic.span data-k="label" variants={label} transition={FAST} style={{ display: "inline-block" }} />
        <wardic.i data-k="icon" variants={icon} transition={FAST} style={{ display: "inline-block" }} />
      </wardic.div>
    ))
    await until(() => Math.abs(xOf(q("label"))) < 0.5, 2000)
    expect(xOf(q("label")), "the label's visible").toBeCloseTo(0, 0)
    expect(scaleOf(q("icon")), "the icon's inactive").toBeCloseTo(1, 2)
    setSelected(true)
    await until(() => scaleOf(q("icon")) > 1.49, 2000)
    expect(scaleOf(q("icon")), "the icon's active").toBeCloseTo(1.5, 1)
    expect(xOf(q("label")), "the label has no active: it stays").toBeCloseTo(0, 0)
  })

  it("VL6: each name orchestrates the children's keys it sets: one name's stagger, another's none", async () => {
    const [selected, setSelected] = createSignal(false)
    const parent: WardicVariants = {
      visible: { opacity: 1, transition: { ...FAST, staggerChildren: 0.15 } },
      hidden: { opacity: 0 },
      active: {},
      inactive: {},
    }
    const item: WardicVariants = { visible: { opacity: 1 }, hidden: { opacity: 0 }, active: { scale: 1.5 }, inactive: { scale: 1 } }
    const q = mount(() => (
      <wardic.ul
        data-k="list"
        variants={parent}
        initial={["hidden", "inactive"]}
        animate={["visible", Bool.match(selected(), { onTrue: () => "active", onFalse: () => "inactive" })]}
        transition={FAST}
      >
        <For each={[0, 1, 2]}>{(i) => <wardic.li data-k={`i${i}`} variants={item} transition={FAST} style={BOX} />}</For>
      </wardic.ul>
    ))
    // The entrance: visible's stagger, the first before the last.
    await until(() => opacityOf(q("i0")) > 0.9, 2000)
    expect(opacityOf(q("i2")), "the last waits its slot").toBeLessThan(0.5)
    await until(() => opacityOf(q("i2")) > 0.99, 2000)
    // The selection: active has no stagger, so every item scales together.
    setSelected(true)
    await until(() => scaleOf(q("i0")) > 1.25, 2000)
    expect(scaleOf(q("i2")), "together, no stagger").toBeGreaterThan(1.15)
    await until(() => scaleOf(q("i2")) > 1.49, 2000)
    expect(scaleOf(q("i2"))).toBeCloseTo(1.5, 1)
  })

  it("VL7: initial with a list: the Starting style merged, drawn from the first frame", async () => {
    const variants: WardicVariants = { low: { opacity: 0.3, x: 5 }, left: { x: -40 } }
    const q = mount(() => <wardic.div data-k="el" variants={variants} initial={["low", "left"]} style={BOX} />)
    expect(q("el").style.opacity, "a's opacity in the Starting style").toBe("0.3")
    expect(q("el").style.transform, "b's x over a's").toContain("-40px")
  })

  it("VL8: exit with a list: merged, each key on its name's transition", async () => {
    const [shown, setShown] = createSignal(true)
    const variants: WardicVariants = { gone: { opacity: 0, transition: FAST }, away: { x: 100, transition: SLOW } }
    const q = mount(() => (
      <AnimatePresence>
        <Show when={shown()}>
          <wardic.div data-k="el" variants={variants} initial={{ opacity: 1, x: 0 }} animate={{ opacity: 1, x: 0 }} exit={["gone", "away"]} style={BOX} />
        </Show>
      </AnimatePresence>
    ))
    await frames(3)
    const el = q("el")
    setShown(false)
    await until(() => opacityOf(el) < 0.05, 2000)
    expect(el.isConnected, "still exiting").toBe(true)
    expect(xOf(el), "away's slower x").toBeLessThan(60)
    await until(() => !el.isConnected, 3000)
    expect(el.isConnected).toBe(false)
  })

  it("VL9: whileHover with a list", async () => {
    const variants: WardicVariants = { lift: { y: -10 }, glow: { opacity: 0.6 } }
    const q = mount(() => <wardic.div data-k="el" variants={variants} whileHover={["lift", "glow"]} transition={FAST} style={{ ...BOX, opacity: 1 }} />)
    await frames(3)
    const el = q("el")
    el.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse", bubbles: false }))
    el.dispatchEvent(new PointerEvent("pointerover", { pointerType: "mouse", bubbles: true }))
    await until(() => opacityOf(el) < 0.61 && matrixOf(el).m42 < -9.5, 2000)
    expect(matrixOf(el).m42, "lift's y").toBeLessThan(-9.5)
    expect(opacityOf(el), "glow's opacity").toBeLessThan(0.61)
  })

  it("VL10: onAnimationStart once per name, in order; onAnimationComplete per name, as its keys settle", async () => {
    const log: Array<string> = []
    const variants: WardicVariants = { fade: { opacity: 0.2, transition: FAST }, slide: { x: 60, transition: { type: "tween", duration: 0.6 } } }
    mount(() => (
      <wardic.div
        data-k="el"
        variants={variants}
        initial={{ opacity: 1, x: 0 }}
        animate={["fade", "slide"]}
        onAnimationStart={(definition: WardicAnimationDefinition) => log.push(`start ${String(definition)}`)}
        onAnimationComplete={(definition: WardicAnimationDefinition) => log.push(`complete ${String(definition)}`)}
        style={BOX}
      />
    ))
    await until(() => log.length >= 4, 3000)
    expect(log).toEqual(["start fade", "start slide", "complete fade", "complete slide"])
  })

  it("VL11: an unknown name is skipped; an empty list is no name", async () => {
    const [names, setNames] = createSignal<ReadonlyArray<string>>(["nope", "a"])
    const variants: WardicVariants = { a: { x: 20 } }
    const q = mount(() => <wardic.div data-k="el" variants={variants} initial={{ x: 0 }} animate={names()} transition={FAST} style={BOX} />)
    await until(() => Math.abs(xOf(q("el")) - 20) < 0.5, 2000)
    expect(xOf(q("el"))).toBeCloseTo(20, 0)
    setNames([])
    await until(() => Math.abs(xOf(q("el"))) < 0.5, 2000)
    expect(xOf(q("el")), "no name: back to its Base value").toBeCloseTo(0, 0)
  })

  it("VL12: a dynamic variant in a list resolves with custom", async () => {
    const variants: WardicVariants = { slide: (d: number) => ({ x: d * 25 }), dim: { opacity: 0.5 } }
    const q = mount(() => <wardic.div data-k="el" custom={2} variants={variants} initial={{ x: 0 }} animate={["dim", "slide"]} transition={FAST} style={BOX} />)
    await until(() => Math.abs(xOf(q("el")) - 50) < 0.5, 2000)
    expect(xOf(q("el"))).toBeCloseTo(50, 0)
    expect(opacityOf(q("el"))).toBeCloseTo(0.5, 1)
  })

  it("VL13: a list's returns run on the element's transition", async () => {
    const [names, setNames] = createSignal<ReadonlyArray<string>>(["a", "b"])
    const variants: WardicVariants = { a: { x: 50, transition: FAST }, b: { opacity: 0.5, transition: FAST } }
    const q = mount(() => <wardic.div data-k="el" variants={variants} initial={{ x: 0, opacity: 1 }} animate={names()} transition={SLOW} style={BOX} />)
    await until(() => Math.abs(xOf(q("el")) - 50) < 0.5, 2000)
    // a leaves the list: its x returns to its Base value on the element's slow transition.
    setNames(["b"])
    await frames(12)
    expect(xOf(q("el")), "not a's fast transition").toBeGreaterThan(30)
    await until(() => Math.abs(xOf(q("el"))) < 0.5, 3000)
    expect(xOf(q("el"))).toBeCloseTo(0, 0)
  })

  it("VL14: when for a list as a whole: the last name that sets it", async () => {
    const parent: WardicVariants = {
      shown: { opacity: 1, transition: { type: "tween", duration: 0.4, when: "beforeChildren" } },
      hidden: { opacity: 0 },
      // A later name with a transition of its own, without `when`: the list's `when` is still shown's.
      wide: { transition: { type: "tween", duration: 0.2 } },
    }
    const child: WardicVariants = { shown: { x: 0 }, hidden: { x: -30 }, wide: {} }
    const q = mount(() => (
      <wardic.div data-k="parent" variants={parent} initial={["hidden", "wide"]} animate={["shown", "wide"]} style={BOX}>
        <wardic.span data-k="child" variants={child} transition={FAST} style={{ display: "inline-block" }} />
      </wardic.div>
    ))
    let childMovedEarly = false
    await until(() => {
      if (Bool.and(opacityOf(q("parent")) < 0.9, xOf(q("child")) > -29)) childMovedEarly = true
      return Math.abs(xOf(q("child"))) < 0.5
    }, 3000)
    expect(childMovedEarly, "the child waited for the parent").toBe(false)
    expect(xOf(q("child"))).toBeCloseTo(0, 0)
  })

  it("VL15: when for a list as a whole, set by a later name in the list", async () => {
    const parent: WardicVariants = {
      wide: { transition: { type: "tween", duration: 0.2 } },
      shown: { opacity: 1, transition: { type: "tween", duration: 0.4, when: "beforeChildren" } },
      hidden: { opacity: 0 },
    }
    const child: WardicVariants = { shown: { x: 0 }, hidden: { x: -30 }, wide: {} }
    const q = mount(() => (
      <wardic.div data-k="parent" variants={parent} initial={["wide", "hidden"]} animate={["wide", "shown"]} style={BOX}>
        <wardic.span data-k="child" variants={child} transition={FAST} style={{ display: "inline-block" }} />
      </wardic.div>
    ))
    let childMovedEarly = false
    await until(() => {
      if (Bool.and(opacityOf(q("parent")) < 0.9, xOf(q("child")) > -29)) childMovedEarly = true
      return Math.abs(xOf(q("child"))) < 0.5
    }, 3000)
    expect(childMovedEarly, "the child waited for the parent").toBe(false)
    expect(xOf(q("child"))).toBeCloseTo(0, 0)
  })
})
