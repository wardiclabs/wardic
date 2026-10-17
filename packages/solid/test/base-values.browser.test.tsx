// Base values on the signal-sink surfaces (#47, ADR-0022): a key with no value starts from
// its Base value and returns to it, as Motion does. Each case is one of the Motion probe's
// (motion/react 13.5.0, Chromium 147 and Firefox 148; docs/research/base-values.md), on
// `wardic.div`, a `useWardic` spread and a `Reorder.Item`, with Playwright's real mouse and
// the painted value read after every frame.
//
// The chain (D1): a key no layer sets returns to its `initial` value, else its `style` value,
// else its Own value; a key with no value yet starts from its `style` value, else its Own
// value. A transform key's Own value is its identity (1 for a scale, 0 otherwise): Motion
// never reads an element's transform (HTMLVisualElement.ts:51 at 16c6122 tests
// `isProjecting` uncalled), so a class's `scale(0.5)` doesn't count (C5).
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { useWardic, wardic, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { until } from "./browser-helpers.ts"
import { BOX, hover, hoverAndLeave, inlineTransformAtRest, last, leave, max, min, opacityOf, recorder, scaleOf, translateXOf, translateYOf, valuesIn } from "./base-values-harness.ts"
import { centreOf, glide, mountReorder, mouse, resetScene, sampleFrames, settle, wait } from "./reorder-harness.tsx"

afterEach(async () => {
  await resetScene()
  cleanup()
})

describe("a while* key with no base value (#47): wardic.div", () => {
  it("M1 (C1): whileHover scale starts at 1 and returns to 1", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} whileHover={{ scale: 1.5 }} />
      </WardicProvider>
    ))
    const frames = await hoverAndLeave(el, scaleOf, (v) => v > 1.49, 1)
    expect(min(valuesIn(frames, "hover")), "never below its own 1 while it grows").toBeGreaterThan(0.99)
    expect(max(valuesIn(frames, "hover"))).toBeGreaterThan(1.49)
    expect(last(valuesIn(frames, "leave")), "back at 1").toBeCloseTo(1, 2)
  })

  it("M2 (C2): whileTap scale starts at 1 and returns to 1", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} whileTap={{ scale: 0.8 }} />
      </WardicProvider>
    ))
    const rec = recorder(el, scaleOf)
    await settle()
    const c = centreOf(el)
    await mouse.move(c)
    rec.phase = "press"
    await mouse.down(c)
    await until(() => scaleOf(el) < 0.81, 3000)
    await wait(100)
    rec.phase = "release"
    await mouse.up(c)
    await until(() => Math.abs(scaleOf(el) - 1) < 0.004, 3000)
    await settle()
    const frames = rec.stop()
    expect(min(valuesIn(frames, "press")), "never past 0.8 from below: it shrinks from 1").toBeGreaterThan(0.79)
    expect(last(valuesIn(frames, "release"))).toBeCloseTo(1, 2)
  })

  it("M3 (C3): an opacity in the style prop is the start and the return", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={{ ...BOX, opacity: 0.5 }} whileHover={{ opacity: 1 }} />
      </WardicProvider>
    ))
    const frames = await hoverAndLeave(el, opacityOf, (v) => v > 0.99, 0.5)
    expect(min(valuesIn(frames, "hover"))).toBeGreaterThan(0.49)
    expect(last(valuesIn(frames, "leave"))).toBeCloseTo(0.5, 2)
  })

  it("M4 (C4): an opacity from a stylesheet (the computed style) is the start and the return", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} class="bv-half" style={BOX} whileHover={{ opacity: 1 }} />
      </WardicProvider>
    ))
    const frames = await hoverAndLeave(el, opacityOf, (v) => v > 0.99, 0.5)
    expect(min(valuesIn(frames, "hover"))).toBeGreaterThan(0.49)
    expect(last(valuesIn(frames, "leave"))).toBeCloseTo(0.5, 2)
  })

  it("M5 (C5): a class's transform isn't a scale's own value: it starts at 1 and returns to 1", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} class="bv-shrunk" style={BOX} whileHover={{ scale: 1.5 }} />
      </WardicProvider>
    ))
    const frames = await hoverAndLeave(el, scaleOf, (v) => v > 1.49, 1)
    const hovered = valuesIn(frames, "hover").filter((v) => Math.abs(v - 0.5) > 0.001)
    expect(min(hovered), "from 1 once the gesture writes it, never from 0").toBeGreaterThan(0.99)
    expect(last(valuesIn(frames, "leave"))).toBeCloseTo(1, 2)
  })

  it("M6 (C6): a key in initial but not animate returns to its initial value", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} initial={{ scale: 0.5 }} animate={{ opacity: 1 }} whileHover={{ scale: 1.2 }} />
      </WardicProvider>
    ))
    const frames = await hoverAndLeave(el, scaleOf, (v) => v > 1.19, 0.5)
    expect(min(valuesIn(frames, "hover"))).toBeGreaterThan(0.49)
    expect(last(valuesIn(frames, "leave")), "back at initial's 0.5").toBeCloseTo(0.5, 2)
  })

  it("M7 (C7): a key back at its style value follows a later style change, and the next gesture starts there", async () => {
    let el!: HTMLElement
    const [o, setO] = createSignal(0.5)
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={{ ...BOX, opacity: o() }} whileHover={{ opacity: 1 }} />
      </WardicProvider>
    ))
    const first = await hoverAndLeave(el, opacityOf, (v) => v > 0.99, 0.5)
    expect(last(valuesIn(first, "leave"))).toBeCloseTo(0.5, 2)
    setO(0.8)
    await until(() => Math.abs(opacityOf(el) - 0.8) < 0.004, 1000)
    expect(opacityOf(el), "the style change shows at rest").toBeCloseTo(0.8, 2)
    const second = await hoverAndLeave(el, opacityOf, (v) => v > 0.99, 0.8)
    expect(min(valuesIn(second, "hover")), "the next hover starts at 0.8").toBeGreaterThan(0.79)
    expect(last(valuesIn(second, "leave"))).toBeCloseTo(0.8, 2)
  })

  it("M8 (C12): an own value is read once, at first need: a later class change doesn't move the base", async () => {
    let el!: HTMLElement
    const [cls, setCls] = createSignal("bv-half")
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} class={cls()} style={BOX} whileHover={{ opacity: 1 }} />
      </WardicProvider>
    ))
    await settle()
    setCls("bv-third")
    const first = await hoverAndLeave(el, opacityOf, (v) => v > 0.99, 0.3)
    expect(min(valuesIn(first, "hover")), "read at the first hover: 0.3").toBeGreaterThan(0.29)
    expect(last(valuesIn(first, "leave"))).toBeCloseTo(0.3, 2)
    setCls("bv-fifth")
    const second = await hoverAndLeave(el, opacityOf, (v) => v > 0.99, 0.3)
    expect(last(valuesIn(second, "leave")), "still the first read").toBeCloseTo(0.3, 2)
  })

  it("M9 (C13): an animate key with no initial starts from its own value", async () => {
    let el!: HTMLElement
    const rec = { frames: [] as Array<number> }
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} animate={{ opacity: 0.5 }} />
      </WardicProvider>
    ))
    const s = sampleFrames(() => opacityOf(el))
    await until(() => Math.abs(opacityOf(el) - 0.5) < 0.004, 3000)
    await settle()
    rec.frames = s.stop().map((f) => f.v)
    expect(min(rec.frames), "it fades down from 1, never up from 0").toBeGreaterThan(0.49)
    expect(max(rec.frames)).toBeGreaterThan(0.9)
    expect(last(rec.frames)).toBeCloseTo(0.5, 2)
  })

  it("M10 (C14): an animate scale with no initial grows from 1", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} animate={{ scale: 1.5 }} />
      </WardicProvider>
    ))
    const s = sampleFrames(() => scaleOf(el))
    await until(() => Math.abs(scaleOf(el) - 1.5) < 0.004, 3000)
    await settle()
    const frames = s.stop().map((f) => f.v)
    expect(min(frames)).toBeGreaterThan(0.99)
    expect(last(frames)).toBeCloseTo(1.5, 2)
  })

  it("M11 (C15): a key dropped from animate returns to its own value, read at mount", async () => {
    let el!: HTMLElement
    const [a, setA] = createSignal<{ opacity?: number }>({ opacity: 0.2 })
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} class="bv-half" style={BOX} animate={a()} />
      </WardicProvider>
    ))
    const s = sampleFrames(() => opacityOf(el))
    await until(() => Math.abs(opacityOf(el) - 0.2) < 0.004, 3000)
    const mount = s.stop().map((f) => f.v)
    expect(max(mount), "it fades down from the class's 0.5").toBeLessThan(0.51)
    setA({})
    await until(() => Math.abs(opacityOf(el) - 0.5) < 0.004, 3000)
    expect(opacityOf(el), "back at its own 0.5").toBeCloseTo(0.5, 2)
  })

  it("M12 (C16): a key dropped from animate returns to its initial value", async () => {
    let el!: HTMLElement
    const [a, setA] = createSignal<{ opacity?: number }>({ opacity: 0.2 })
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} class="bv-half" style={BOX} initial={{ opacity: 0.8 }} animate={a()} />
      </WardicProvider>
    ))
    await until(() => Math.abs(opacityOf(el) - 0.2) < 0.004, 3000)
    setA({})
    await until(() => Math.abs(opacityOf(el) - 0.8) < 0.004, 3000)
    expect(opacityOf(el), "back at initial's 0.8").toBeCloseTo(0.8, 2)
  })

  it("M13: under a tween, a key with no value starts from its own value too", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} whileHover={{ scale: 1.5 }} transition={{ type: "tween", duration: 0.4 }} />
      </WardicProvider>
    ))
    const frames = await hoverAndLeave(el, scaleOf, (v) => v > 1.49, 1)
    const hovered = valuesIn(frames, "hover")
    expect(min(hovered)).toBeGreaterThan(0.99)
    expect(hovered.some((v) => v > 1.05 && v < 1.45), "it tweens through, no jump to the target").toBe(true)
    expect(last(valuesIn(frames, "leave"))).toBeCloseTo(1, 2)
  })

  it("M14: a returning key survives a Retarget mid-return", async () => {
    let el!: HTMLElement
    const [op, setOp] = createSignal(1)
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} animate={{ opacity: op() }} whileHover={{ scale: 1.5 }} />
      </WardicProvider>
    ))
    await settle()
    await hover(el)
    await until(() => scaleOf(el) > 1.49, 3000)
    await leave()
    await wait(60)
    setOp(0.6)
    await until(() => Math.abs(scaleOf(el) - 1) < 0.004 && Math.abs(opacityOf(el) - 0.6) < 0.004, 3000)
    expect(scaleOf(el), "the scale still lands at 1").toBeCloseTo(1, 2)
    expect(opacityOf(el)).toBeCloseTo(0.6, 2)
  })

  it("M15: a drag's x stays where it was dropped; whileDrag's scale starts at 1 and returns", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} drag dragMomentum={false} whileDrag={{ scale: 1.1 }} />
      </WardicProvider>
    ))
    const rec = recorder(el, scaleOf)
    await settle()
    const g = centreOf(el)
    rec.phase = "drag"
    await mouse.down(g)
    await glide(g, { x: g.x + 40, y: g.y }, 8)
    await until(() => scaleOf(el) > 1.09, 3000)
    rec.phase = "release"
    await mouse.up({ x: g.x + 40, y: g.y })
    await until(() => Math.abs(scaleOf(el) - 1) < 0.004, 3000)
    await settle()
    const frames = rec.stop()
    expect(min(valuesIn(frames, "drag"))).toBeGreaterThan(0.99)
    expect(last(valuesIn(frames, "release"))).toBeCloseTo(1, 2)
    expect(translateXOf(el), "x isn't sprung back").toBeCloseTo(40, 0)
  })

  it("M16 (guard): a key with initial and animate values behaves as before", async () => {
    // Both: `animate={{ scale: 1 }}` alone grows from 0 at mount before #47 (an `animate` key
    // with no `initial`, M10), so it can't be the guard.
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} initial={{ scale: 1 }} animate={{ scale: 1 }} whileHover={{ scale: 1.5 }} />
      </WardicProvider>
    ))
    const frames = await hoverAndLeave(el, scaleOf, (v) => v > 1.49, 1)
    expect(min(valuesIn(frames, "hover"))).toBeGreaterThan(0.99)
    expect(last(valuesIn(frames, "leave"))).toBeCloseTo(1, 2)
  })
})

describe("a while* key with no base value (#47): useWardic and Reorder.Item", () => {
  it("M17: a useWardic spread's style is its style link", async () => {
    let el!: HTMLElement
    function Box() {
      const w = useWardic({ whileHover: { opacity: 1 } })
      return <div {...w({ ref: (n) => (el = n), style: { ...BOX, opacity: 0.5 } })} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    const frames = await hoverAndLeave(el, opacityOf, (v) => v > 0.99, 0.5)
    expect(min(valuesIn(frames, "hover"))).toBeGreaterThan(0.49)
    expect(last(valuesIn(frames, "leave"))).toBeCloseTo(0.5, 2)
  })

  it("M18 (s14's lift): a Reorder.Item's whileDrag scale starts at 1 and lands back at 1", async () => {
    const s = await mountReorder({ whileDrag: { scale: 1.05 } })
    const el = s.item("a")
    // A projected item's painted scale: its painted width over its layout width.
    const ratio = (e: Element): number => e.getBoundingClientRect().width / (e as HTMLElement).offsetWidth
    const rec = recorder(el, ratio)
    await settle()
    const g = centreOf(el)
    rec.phase = "drag"
    await mouse.down(g)
    await glide(g, { x: g.x, y: g.y + 12 }, 6)
    await until(() => ratio(el) > 1.045, 3000)
    await wait(100)
    rec.phase = "release"
    await mouse.up({ x: g.x, y: g.y + 12 })
    await until(() => Math.abs(ratio(el) - 1) < 0.004, 3000)
    await settle()
    const frames = rec.stop()
    expect(min(valuesIn(frames, "drag")), "lifts from 1, never from 0").toBeGreaterThan(0.99)
    expect(max(valuesIn(frames, "drag"))).toBeGreaterThan(1.045)
    expect(last(valuesIn(frames, "release")), "lands at 1").toBeCloseTo(1, 2)
  })
})

describe("a key with no base value (#47): review cases", () => {
  it("M19 (C8): a string key from a class returns to the class's value, not to Wardic's own write", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} whileHover={{ "background-color": "rgb(255, 0, 0)" }} />
      </WardicProvider>
    ))
    const bg = (): string => getComputedStyle(el).backgroundColor
    await settle()
    const before = bg()
    await hover(el)
    await until(() => bg() === "rgb(255, 0, 0)", 3000)
    await leave()
    await until(() => bg() === before, 3000)
    await settle()
    // A string key animates both ways since #56 (string-keys SK5); it must land back on its own value.
    expect(bg()).toBe(before)
  })

  it("M20: a key that started from its style value, with that style entry gone at the return, returns to its own value", async () => {
    let el!: HTMLElement
    const [style, setStyle] = createSignal<JSX.CSSProperties>({ ...BOX, opacity: 0.5 })
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} class="bv-third" style={style()} whileHover={{ opacity: 1 }} />
      </WardicProvider>
    ))
    await settle()
    await hover(el)
    await until(() => opacityOf(el) > 0.99, 3000)
    setStyle({ ...BOX })
    await leave()
    await until(() => Math.abs(opacityOf(el) - 0.5) < 0.004, 3000)
    await settle()
    // Its own value was read at its first need, before Wardic wrote it: 0.5 (the inline
    // style then), never a mid-spring value of Wardic's.
    expect(opacityOf(el)).toBeCloseTo(0.5, 2)
  })

  it("M21: a transform key in the user's style isn't its style link (the CSS property composes with Wardic's transform)", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={{ ...BOX, scale: "0.8" } as JSX.CSSProperties} whileHover={{ scale: 1.5 }} />
      </WardicProvider>
    ))
    const ratio = (e: Element): number => e.getBoundingClientRect().width / (e as HTMLElement).offsetWidth
    const frames = await hoverAndLeave(el, ratio, (v) => v > 1.19, 0.8)
    expect(min(valuesIn(frames, "hover")), "no jump below its 0.8 at the start").toBeGreaterThan(0.79)
    expect(last(valuesIn(frames, "leave")), "back at 0.8, no snap at the release").toBeCloseTo(0.8, 2)
  })

  it("M22: a released key stays released when a `when` gate re-runs the same target", async () => {
    let parentEl!: HTMLElement
    const [o, setO] = createSignal(0.5)
    const [childOpen, setChildOpen] = createSignal(false)
    function Parent() {
      const w = useWardic(() => ({ whileHover: { opacity: 1 }, transition: { when: "afterChildren" } }))
      return (
        <div {...w({ ref: (n) => (parentEl = n), style: { ...BOX, opacity: o() } })}>
          <w.Provider>
            <Child />
          </w.Provider>
        </div>
      )
    }
    function Child() {
      const c = useWardic(() => ({ initial: { x: 0 }, animate: { x: Bool.match(childOpen(), { onTrue: () => 20, onFalse: () => 0 }) } }))
      return <div {...c({ style: { width: "10px", height: "10px" } })} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Parent />
      </WardicProvider>
    ))
    const frames = await hoverAndLeave(parentEl, opacityOf, (v) => v > 0.99, 0.5)
    expect(last(valuesIn(frames, "leave"))).toBeCloseTo(0.5, 2)
    // Let the return settle and release the key, so the gate below re-runs a target with
    // nothing returning.
    await wait(1200)
    // The child animates: the parent's afterChildren gate closes, then opens on the same target.
    setChildOpen(true)
    await wait(1500)
    setO(0.8)
    await until(() => Math.abs(opacityOf(parentEl) - 0.8) < 0.004, 1000)
    expect(opacityOf(parentEl), "the style change still shows at rest").toBeCloseTo(0.8, 2)
  })
})

describe("a translate key with no base value on a drag or layout element (#47, PR #58's review)", () => {
  it("M23: on a drag element, whileHover's y starts at 0 and returns to 0", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} drag whileHover={{ y: -4 }} />
      </WardicProvider>
    ))
    const frames = await hoverAndLeave(el, translateYOf, (v) => v < -3.99, 0)
    expect(max(valuesIn(frames, "hover")), "lifts from 0").toBeLessThan(0.01)
    expect(last(valuesIn(frames, "leave")), "back at 0, not left lifted").toBeCloseTo(0, 2)
  })

  it("M24: on a drag element, a whileTap y the drag then moves stays where it was dropped", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} drag dragMomentum={false} whileTap={{ y: 2 }} />
      </WardicProvider>
    ))
    await settle()
    const g = centreOf(el)
    await mouse.down(g)
    await wait(300)
    await glide(g, { x: g.x + 40, y: g.y + 30 }, 8)
    await mouse.up({ x: g.x + 40, y: g.y + 30 })
    await wait(800)
    expect(translateXOf(el), "x where dropped").toBeCloseTo(40, 0)
    expect(translateYOf(el), "y where dropped, not sprung back to 0").toBeGreaterThan(29)
  })

  it("M26: on an x drag, a whileHover y that ends mid-fling returns once the fling lets go, though the hover's scale settled first", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(n: HTMLElement) => (el = n)}
          style={BOX}
          drag="x"
          whileHover={{ y: -4, scale: 1.1 }}
          transition={{ type: "tween", duration: 0.05 }}
        />
      </WardicProvider>
    ))
    // Synthetic input: a real mouse's moves arrive coalesced per frame, and a flick's
    // release velocity (a 30 ms window) can miss them in a busy run.
    const pointer = (type: string, x: number, buttons: number): PointerEvent =>
      new PointerEvent(type, { clientX: x, clientY: 0, buttons, pointerId: 1, pointerType: "mouse", isPrimary: true })
    await settle()
    el.dispatchEvent(pointer("pointerenter", 0, 0))
    await until(() => translateYOf(el) < -3.99 && scaleOf(el) > 1.099, 3000)
    el.dispatchEvent(pointer("pointerdown", 0, 1))
    for (const x of [10, 30, 50, 70]) {
      el.dispatchEvent(pointer("pointermove", x, 1))
      await wait(8)
    }
    el.dispatchEvent(pointer("pointerup", 80, 0))
    // The hover ends mid-fling: its scale returns and settles while the fling holds the drag.
    el.dispatchEvent(pointer("pointerleave", 80, 0))
    await wait(300)
    expect(translateXOf(el), "flung on past the release").toBeGreaterThan(90)
    // The fling lets go once it all but stops (a decay rests below 0.1 px/s), seconds on.
    await until(() => Math.abs(translateYOf(el)) < 0.004, 10000)
    expect(scaleOf(el)).toBeCloseTo(1, 2)
    expect(translateYOf(el), "y back at 0 once the fling lets go, not left lifted").toBeCloseTo(0, 2)
  }, 15000)

  it("M25: on a layout element, whileHover's y returns to 0", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} layout whileHover={{ y: -4 }} />
      </WardicProvider>
    ))
    const rec = recorder(el, translateYOf)
    await settle()
    rec.phase = "hover"
    await hover(el)
    await wait(600)
    rec.phase = "leave"
    await leave()
    await wait(800)
    const frames = rec.stop()
    expect(last(valuesIn(frames, "leave")), "not left lifted").toBeCloseTo(0, 2)
  })
})

// #57 (ADR-0023): a transform key back at its Identity rests as `transform: none`, as Motion's
// does (C1, C2, C10 leave `transform: none` inline), not as `scale(1)`: any other transform
// makes the element a stacking context and the containing block of its fixed descendants
// (CSS Transforms 1, §3).
describe("an identity transform at rest is none (#57, ADR-0023)", () => {
  /** The painted rotation in degrees (the computed matrix's angle), 0 for none. */
  const rotationOf = (el: Element): number => {
    const t = getComputedStyle(el).transform
    if (t === "" || t === "none") return 0
    const v = /\(([^)]+)\)/.exec(t)![1]!.split(",").map(Number)
    return (Math.atan2(v[1]!, v[0]!) * 180) / Math.PI
  }

  it("M27 (C1): a returned whileHover scale rests as none", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} whileHover={{ scale: 1.5 }} />
      </WardicProvider>
    ))
    await hoverAndLeave(el, scaleOf, (v) => v > 1.49, 1)
    expect(await inlineTransformAtRest(el), "none, not scale(1)").toBe("none")
  })

  it("M28 (C2): a returned whileTap scale rests as none", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} whileTap={{ scale: 0.8 }} />
      </WardicProvider>
    ))
    await settle()
    const c = centreOf(el)
    await mouse.move(c)
    await mouse.down(c)
    await until(() => scaleOf(el) < 0.81, 3000)
    await wait(100)
    await mouse.up(c)
    await until(() => Math.abs(scaleOf(el) - 1) < 0.004, 3000)
    expect(await inlineTransformAtRest(el), "none, not scale(1)").toBe("none")
  })

  it("M29 (C5): a class's transform shows until the first gesture, and stays overridden by none after it returns", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} class="bv-shrunk" style={BOX} whileHover={{ scale: 1.5 }} />
      </WardicProvider>
    ))
    await settle()
    expect(el.style.transform, "nothing inline before a gesture").toBe("")
    expect(scaleOf(el), "the class's scale(0.5) shows").toBeCloseTo(0.5, 3)
    await hoverAndLeave(el, scaleOf, (v) => v > 1.49, 1)
    expect(await inlineTransformAtRest(el), "none, written: the class stays overridden").toBe("none")
    expect(scaleOf(el)).toBe(1)
  })

  it("M30: the house entrance, initial x 10 to animate x 0, rests as none", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} />
      </WardicProvider>
    ))
    await until(() => opacityOf(el) > 0.996 && Math.abs(translateXOf(el)) < 0.004, 3000)
    expect(await inlineTransformAtRest(el), "none, not translateX(0px)").toBe("none")
  })

  it("M31: a position: fixed child is placed against the viewport again once its parent's hover returns", async () => {
    let el!: HTMLElement
    let child!: HTMLElement
    // Away from the mouse's park (5, 5) and the box, so the child never takes the hover.
    const FIXED: JSX.CSSProperties = { position: "fixed", left: "300px", top: "20px", width: "10px", height: "10px" }
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} whileHover={{ scale: 1.5 }}>
          <div ref={(n) => (child = n)} style={FIXED} />
        </wardic.div>
      </WardicProvider>
    ))
    await settle()
    const before = child.getBoundingClientRect()
    expect([before.left, before.top], "against the viewport before any hover").toEqual([300, 20])
    await hoverAndLeave(el, scaleOf, (v) => v > 1.49, 1)
    await inlineTransformAtRest(el)
    const after = child.getBoundingClientRect()
    expect([after.left, after.top], "against the viewport, not the box (a transform's containing block)").toEqual([300, 20])
  })

  it("M32 (C10, guard): a Reorder.Item rests as none once its whileDrag scale and its flight back land", async () => {
    // A projected item's transform comes from the projection path, which already wrote `none`
    // with nothing left (ADR-0009); the flight to its slot runs about 400 ms past the scale.
    const s = await mountReorder({ whileDrag: { scale: 1.05 } })
    const el = s.item("a")
    const ratio = (e: Element): number => e.getBoundingClientRect().width / (e as HTMLElement).offsetWidth
    await settle()
    const g = centreOf(el)
    await mouse.down(g)
    await glide(g, { x: g.x, y: g.y + 12 }, 6)
    await until(() => ratio(el) > 1.045, 3000)
    await wait(100)
    await mouse.up({ x: g.x, y: g.y + 12 })
    await until(() => Math.abs(ratio(el) - 1) < 0.004, 3000)
    await until(() => el.style.transform === "none", 3000)
    expect(el.style.transform, "none once the item lands").toBe("none")
  })

  it("M33: a layout element's returned whileHover rotate rests as none, not rotate(0deg)", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} layout whileHover={{ rotate: 10 }} />
      </WardicProvider>
    ))
    await hoverAndLeave(el, rotationOf, (v) => v > 9.9, 0)
    expect(await inlineTransformAtRest(el), "none, not rotate(0deg)").toBe("none")
  })
})
