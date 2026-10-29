// A change that resolves the same target starts no Retarget, on Solid 1 (#470, Motion's rule): its
// target is compared by value, as Solid 2's is, so nothing is told to `onAnimationStart` /
// `onAnimationComplete`. A gesture turning on or off counts when its layer sets something, as a
// Motion type turning active animates. Solid 2's are STV1–STV4. Real frames.
//
// - ST1: a `transition` change tells nothing; the next animation runs on the new one.
// - ST2: a new `animate` object with the same values (another signal read in it) tells nothing.
// - ST3: toggling `drag`, `layout` and `exit`, and a `custom` change that resolves the same values,
//   tell nothing.
// - ST4: a hover on an element with `onHoverStart` and no `whileHover`, and a press on one with
//   `onTap` and no `whileTap`, tell nothing.
// - ST5: a hover whose values are already drawn tells start and complete, on and off.
// - ST6: an orchestrating parent's `whileHover` name, with no values of its own, tells the parent and
//   its Variant child the name, and the child animates to it.
// - ST7: a hover's name changing while it's on, to the same values, tells the new name.
// - ST8: a new Transition end on a key the target also animates counts: the key animates to its
//   target again, from its last end, and rests at the new end.
// - ST9: a parent's hover whose own layer sets nothing still turns its Variant child's own
//   `whileHover` on: the hand-down reads the gesture, not the target.
// - ST10: a Transition end added for a key already at its target sets it once the Retarget lands.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { type WardicAnimationDefinition, wardic, WardicProvider, type WardicTransition, type WardicVariants } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const matrixOf = (el: HTMLElement): DOMMatrix => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
const xOf = (el: HTMLElement): number => matrixOf(el).m41
const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)

const FAST: WardicTransition = { type: "tween", duration: 0.1 }
const SLOW: WardicTransition = { type: "tween", duration: 1, ease: "linear" }
// Clear of the page's one mouse, parked at (5, 5) for every browser file.
const BOX = { display: "block", width: "40px", height: "40px", "margin-top": "120px", "margin-left": "120px" } as const

/** Render `ui` inside a provider; `q` finds a `data-k`. */
const mount = (ui: () => JSX.Element) => {
  const { container } = render(() => <WardicProvider env={DomLive}>{ui()}</WardicProvider>)
  return (k: string): HTMLElement => container.querySelector<HTMLElement>(`[data-k="${k}"]`)!
}

/** A log of the calls, each with its definition. */
const recorder = () => {
  const calls: Array<string> = []
  return {
    calls,
    start: (definition: WardicAnimationDefinition) => calls.push(`start ${JSON.stringify(definition)}`),
    complete: (definition: WardicAnimationDefinition) => calls.push(`complete ${JSON.stringify(definition)}`),
  }
}

const pointer = { pointerId: 1, pointerType: "mouse", isPrimary: true, bubbles: true } as const

/** Hover `el` until `held()` (the recognizer attaches its listener asynchronously). */
const hover = async (el: HTMLElement, held: () => boolean): Promise<void> => {
  await until(() => {
    el.dispatchEvent(new PointerEvent("pointerenter", pointer))
    return held()
  }, 2000)
  expect(held(), "the hover took").toBe(true)
}
const leave = (el: HTMLElement): void => {
  el.dispatchEvent(new PointerEvent("pointerleave", pointer))
}

describe("a change that resolves the same target on Solid 1 (#470)", () => {
  it("ST1: a transition change tells nothing; the next animation runs on the new one", async () => {
    const log = recorder()
    const [transition, setTransition] = createSignal<WardicTransition>(FAST)
    const [x, setX] = createSignal(100)
    const q = mount(() => (
      <wardic.div data-k="el" initial={{ x: 0 }} animate={{ x: x() }} transition={transition()} onAnimationStart={log.start} onAnimationComplete={log.complete} style={BOX} />
    ))
    await until(() => log.calls.length === 2, 2000)
    setTransition(SLOW)
    await frames(6)
    expect(log.calls, "no Retarget, nothing told").toEqual(['start {"x":100}', 'complete {"x":100}'])
    setX(0)
    await wait(300)
    expect(xOf(q("el")), "on the new 1 s tween").toBeGreaterThan(40)
  })

  it("ST2: a new animate object with the same values tells nothing", async () => {
    const log = recorder()
    const [pos, setPos] = createSignal({ x: 100, y: 0 })
    mount(() => <wardic.div initial={{ x: 0 }} animate={{ x: pos().x }} transition={FAST} onAnimationStart={log.start} onAnimationComplete={log.complete} style={BOX} />)
    await until(() => log.calls.length === 2, 2000)
    setPos({ x: 100, y: 5 })
    await frames(6)
    expect(log.calls, "only y changed").toHaveLength(2)
    setPos({ x: 50, y: 5 })
    await until(() => log.calls.length === 4, 2000)
    expect(log.calls.slice(2), "x did").toEqual(['start {"x":50}', 'complete {"x":50}'])
  })

  it("ST3: toggling drag, layout and exit, and a custom change to the same values, tell nothing", async () => {
    const log = recorder()
    const [drag, setDrag] = createSignal(false)
    const [layout, setLayout] = createSignal(false)
    const [exitTo, setExitTo] = createSignal(0)
    const [custom, setCustom] = createSignal(1)
    const variants: WardicVariants = { shown: (c: number) => ({ x: Math.min(c, 1) * 100 }) }
    mount(() => (
      <wardic.div
        initial={{ x: 0 }}
        animate="shown"
        variants={variants}
        custom={custom()}
        drag={drag()}
        layout={layout()}
        exit={{ opacity: exitTo() }}
        transition={FAST}
        onAnimationStart={log.start}
        onAnimationComplete={log.complete}
        style={BOX}
      />
    ))
    await until(() => log.calls.length === 2, 2000)
    setDrag(true)
    await frames(4)
    setLayout(true)
    await frames(4)
    setExitTo(0.5)
    await frames(4)
    setCustom(2)
    await frames(6)
    expect(log.calls, "none of them told").toEqual(['start "shown"', 'complete "shown"'])
  })

  it("ST4: a hover with only onHoverStart, and a press with only onTap, tell nothing", async () => {
    const log = recorder()
    let hovers = 0
    let taps = 0
    const q = mount(() => (
      <wardic.div
        data-k="el"
        initial={false}
        animate={{ opacity: 0.5 }}
        transition={FAST}
        onHoverStart={() => hovers++}
        onTap={() => taps++}
        onAnimationStart={log.start}
        onAnimationComplete={log.complete}
        style={BOX}
      />
    ))
    await frames(3)
    const el = q("el")
    await hover(el, () => hovers > 0)
    leave(el)
    await until(() => {
      const r = el.getBoundingClientRect()
      const at = { clientX: r.left + 5, clientY: r.top + 5 }
      el.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, ...at, button: 0, buttons: 1 }))
      el.dispatchEvent(new PointerEvent("pointerup", { ...pointer, ...at, button: 0, buttons: 0 }))
      return taps > 0
    }, 2000)
    expect(taps, "the tap took").toBeGreaterThan(0)
    await frames(6)
    expect(log.calls, "no layer for either: nothing told").toEqual([])
  })

  it("ST5: a hover whose values are already drawn tells start and complete, on and off", async () => {
    const log = recorder()
    const q = mount(() => (
      <wardic.div data-k="el" initial={false} animate={{ opacity: 0.2 }} whileHover={{ opacity: 0.2 }} transition={FAST} onAnimationStart={log.start} onAnimationComplete={log.complete} style={BOX} />
    ))
    await frames(3)
    const el = q("el")
    await hover(el, () => log.calls.length > 0)
    await until(() => log.calls.length === 2, 2000)
    leave(el)
    await until(() => log.calls.length === 4, 2000)
    expect(log.calls, "on, then off, as Motion's").toEqual(['start {"opacity":0.2}', 'complete {"opacity":0.2}', 'start {"opacity":0.2}', 'complete {"opacity":0.2}'])
    expect(opacityOf(el)).toBeCloseTo(0.2, 3)
  })

  it("ST6: an orchestrating parent's whileHover name tells the parent and its Variant child", async () => {
    const parent = recorder()
    const child = recorder()
    const card: WardicVariants = { rest: {}, lift: {} }
    const icon: WardicVariants = { rest: { opacity: 1 }, lift: { opacity: 0.5 } }
    const q = mount(() => (
      <wardic.div data-k="card" variants={card} initial="rest" animate="rest" whileHover="lift" onAnimationStart={parent.start} onAnimationComplete={parent.complete} style={BOX}>
        <wardic.span data-k="icon" variants={icon} transition={FAST} onAnimationStart={child.start} style={{ display: "inline-block", width: "10px", height: "10px" }} />
      </wardic.div>
    ))
    await frames(4)
    const before = parent.calls.length
    const icons = child.calls.length
    await hover(q("card"), () => parent.calls.length > before)
    await until(() => opacityOf(q("icon")) < 0.51, 2000)
    expect(parent.calls.slice(before), "the parent's name, nothing of its own to move").toEqual(['start "lift"', 'complete "lift"'])
    expect(child.calls.slice(icons), "the child's").toEqual(['start "lift"'])
    expect(opacityOf(q("icon"))).toBeCloseTo(0.5, 2)
  })

  it("ST7: a hover's name changing while it's on, to the same values, tells the new name", async () => {
    const log = recorder()
    const [name, setName] = createSignal("a")
    const card: WardicVariants = { a: { opacity: 0.4 }, b: { opacity: 0.4 } }
    const q = mount(() => (
      <wardic.div data-k="el" initial={false} animate={{ opacity: 1 }} variants={card} whileHover={name()} transition={FAST} onAnimationStart={log.start} onAnimationComplete={log.complete} style={BOX} />
    ))
    await frames(3)
    await hover(q("el"), () => log.calls.length > 0)
    await until(() => log.calls.length === 2, 2000)
    setName("b")
    await until(() => log.calls.length === 4, 2000)
    expect(log.calls, "a new name, as Motion's variantDidChange").toEqual(['start "a"', 'complete "a"', 'start "b"', 'complete "b"'])
  })

  it("ST8: a new Transition end on a key the target also animates counts", async () => {
    const log = recorder()
    const [end, setEnd] = createSignal(0)
    const q = mount(() => (
      <wardic.div data-k="el" initial={{ x: 0 }} animate={{ x: 100, transitionEnd: { x: end() } }} transition={FAST} onAnimationStart={log.start} onAnimationComplete={log.complete} style={BOX} />
    ))
    await until(() => log.calls.length === 2, 2000)
    await frames(2)
    expect(xOf(q("el")), "rests at its end").toBeCloseTo(0, 3)
    setEnd(30)
    // The key animates to its target again, from its last end, as Motion's does; then takes the new end.
    let most = 0
    for (let i = 0; i < 60 && log.calls.length < 4; i++) {
      await raf()
      most = Math.max(most, xOf(q("el")))
    }
    await frames(2)
    expect(log.calls, "a new end is a new target").toHaveLength(4)
    expect(most, "x animated back toward 100").toBeGreaterThan(90)
    expect(xOf(q("el")), "rests at the new end").toBeCloseTo(30, 3)
  })

  it("ST9: a parent's hover whose own layer sets nothing still turns its Variant child's own whileHover on", async () => {
    const card: WardicVariants = { rest: {} }
    const icon: WardicVariants = { rest: { x: 0 } }
    const q = mount(() => (
      <wardic.div data-k="card" variants={card} initial="rest" animate="rest" whileHover={{}} style={BOX}>
        <wardic.span data-k="icon" variants={icon} whileHover={{ x: 15 }} transition={FAST} style={{ display: "inline-block", width: "10px", height: "10px" }} />
      </wardic.div>
    ))
    await frames(3)
    const iconEl = q("icon")
    await hover(q("card"), () => xOf(iconEl) > 14)
    expect(xOf(iconEl), "the card's hover is the icon's").toBeGreaterThan(14)
  })

  it("ST10: a Transition end added for a key already at its target sets it", async () => {
    const log = recorder()
    const [ended, setEnded] = createSignal(false)
    const q = mount(() => (
      <wardic.div
        data-k="el"
        initial={{ x: 0 }}
        animate={Bool.match(ended(), { onTrue: () => ({ x: 100, transitionEnd: { x: 30 } }), onFalse: () => ({ x: 100 }) })}
        transition={FAST}
        onAnimationStart={log.start}
        onAnimationComplete={log.complete}
        style={BOX}
      />
    ))
    await until(() => log.calls.length === 2, 2000)
    await frames(2)
    expect(xOf(q("el")), "at its target").toBeCloseTo(100, 3)
    setEnded(true)
    await until(() => log.calls.length === 4, 2000)
    await frames(2)
    expect(log.calls, "an end is a new target").toHaveLength(4)
    expect(xOf(q("el")), "set at its end").toBeCloseTo(30, 3)
  })
})
