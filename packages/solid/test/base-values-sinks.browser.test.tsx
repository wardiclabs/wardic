// Base values on the commit-sink paths and the presence exit (#47, ADR-0022): the same
// chain as base-values.browser.test.tsx, through `wardic.create(Component)`, `use:ward`,
// `use:reorderItem` and `<AnimatePresence>`'s exit. A commit sink has no style prop of its
// own; `wardic.create(Component)` keeps the user's `style` as its style link, the directives
// have none, so their base is the element's own value (its inline style included, read once).
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, createReorderGroup, reorderItem, ward, wardic, WardicProvider } from "@wardic/solid"
import { createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { until } from "./browser-helpers.ts"
import { BOX, hoverAndLeave, inlineTransformAtRest, last, max, min, opacityOf, recorder, scaleOf, valuesIn } from "./base-values-harness.ts"
import { centreOf, glide, mouse, resetScene, sampleFrames, settle, wait } from "./reorder-harness.tsx"

// The directives compile to bare calls: the imports must stay.
void ward
void reorderItem

afterEach(async () => {
  await resetScene()
  cleanup()
})

/** A component that forwards its ref and applies `props.style` to its root. */
const Card = (props: { ref?: (el: HTMLElement) => void; style?: JSX.CSSProperties | string; class?: string }): JSX.Element => (
  <div ref={props.ref} class={props.class} style={props.style}>
    card
  </div>
)
const WCard = wardic.create(Card)

describe("a key with no base value (#47): the commit-sink paths", () => {
  it("K1: wardic.create(Component): a class's opacity is the start and the return", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <WCard ref={(n: HTMLElement) => (el = n)} class="bv-half" style={BOX} whileHover={{ opacity: 1 }} />
      </WardicProvider>
    ))
    const frames = await hoverAndLeave(el, opacityOf, (v) => v > 0.99, 0.5)
    expect(min(valuesIn(frames, "hover"))).toBeGreaterThan(0.49)
    expect(last(valuesIn(frames, "leave"))).toBeCloseTo(0.5, 2)
  })

  it("K2: wardic.create(Component): the user's style is the style link, and a later change shows at rest", async () => {
    let el!: HTMLElement
    const [o, setO] = createSignal(0.5)
    render(() => (
      <WardicProvider env={DomLive}>
        <WCard ref={(n: HTMLElement) => (el = n)} style={{ ...BOX, opacity: o() }} whileHover={{ opacity: 1 }} />
      </WardicProvider>
    ))
    const frames = await hoverAndLeave(el, opacityOf, (v) => v > 0.99, 0.5)
    expect(min(valuesIn(frames, "hover"))).toBeGreaterThan(0.49)
    expect(last(valuesIn(frames, "leave"))).toBeCloseTo(0.5, 2)
    setO(0.8)
    await until(() => Math.abs(opacityOf(el) - 0.8) < 0.004, 1000)
    expect(opacityOf(el)).toBeCloseTo(0.8, 2)
    const again = await hoverAndLeave(el, opacityOf, (v) => v > 0.99, 0.8)
    expect(min(valuesIn(again, "hover"))).toBeGreaterThan(0.79)
    expect(last(valuesIn(again, "leave"))).toBeCloseTo(0.8, 2)
  })

  it("K6: wardic.create(Component): a style key gone from the user's style by the time its return settles is removed, not restored stale", async () => {
    let el!: HTMLElement
    const [style, setStyle] = createSignal<JSX.CSSProperties>({ ...BOX, opacity: 0.5 })
    render(() => (
      <WardicProvider env={DomLive}>
        <WCard ref={(n: HTMLElement) => (el = n)} style={style()} whileHover={{ opacity: 1 }} />
      </WardicProvider>
    ))
    await settle()
    await mouse.move(centreOf(el))
    await until(() => opacityOf(el) > 0.99, 3000)
    await mouse.move({ x: 5, y: 5 })
    await wait(60)
    setStyle({ ...BOX })
    await wait(1500)
    expect(el.style.opacity, "no stale inline 0.5 left behind").toBe("")
  })

  it("K3: use:ward: whileHover scale starts at 1 and returns to 1", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <div ref={(n) => (el = n)} use:ward={{ whileHover: { scale: 1.5 } }} style={BOX} />
      </WardicProvider>
    ))
    const frames = await hoverAndLeave(el, scaleOf, (v) => v > 1.49, 1)
    expect(min(valuesIn(frames, "hover"))).toBeGreaterThan(0.99)
    expect(last(valuesIn(frames, "leave"))).toBeCloseTo(1, 2)
  })

  it("K4: use:ward: the element's inline opacity is its own value, the start and the return", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <div ref={(n) => (el = n)} use:ward={{ whileHover: { opacity: 1 } }} style={{ ...BOX, opacity: 0.5 }} />
      </WardicProvider>
    ))
    const frames = await hoverAndLeave(el, opacityOf, (v) => v > 0.99, 0.5)
    expect(min(valuesIn(frames, "hover"))).toBeGreaterThan(0.49)
    expect(last(valuesIn(frames, "leave"))).toBeCloseTo(0.5, 2)
  })

  it("K5: use:reorderItem: whileDrag scale starts at 1 and lands back at 1", async () => {
    const ITEM: JSX.CSSProperties = { width: "200px", height: "40px", margin: "4px 0", background: "rgb(0, 128, 0)", "list-style": "none" }
    function List(): JSX.Element {
      const [order, setOrder] = createSignal(["a", "b", "c"])
      const group = createReorderGroup(() => ({ values: order(), onReorder: (values: Array<string>) => setOrder(values) }))
      return (
        <ul {...group({ style: { position: "absolute", left: "60px", top: "60px", padding: "0", margin: "0" } })}>
          <For each={order()}>
            {(value) => (
              <li use:reorderItem={{ group, value, whileDrag: { scale: 1.05 } }} data-value={value} style={ITEM}>
                {value}
              </li>
            )}
          </For>
        </ul>
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <List />
      </WardicProvider>
    ))
    const el = document.querySelector<HTMLElement>('[data-value="a"]')!
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
    expect(min(valuesIn(frames, "drag"))).toBeGreaterThan(0.99)
    expect(max(valuesIn(frames, "drag"))).toBeGreaterThan(1.045)
    expect(last(valuesIn(frames, "release"))).toBeCloseTo(1, 2)
  })
})

// #57 (ADR-0023): the commit sinks write only the keys a patch has, so `none` must be written
// over the last frame's transform once its keys are back at their Identity, or a stale
// `scale(1.00…)` would stay inline.
describe("an identity transform at rest is none (#57, ADR-0023): the commit sinks", () => {
  it("K7: wardic.create(Component): a returned whileHover scale rests as none", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <WCard ref={(n: HTMLElement) => (el = n)} style={BOX} whileHover={{ scale: 1.5 }} />
      </WardicProvider>
    ))
    await hoverAndLeave(el, scaleOf, (v) => v > 1.49, 1)
    expect(await inlineTransformAtRest(el), "none, not scale(1)").toBe("none")
  })

  it("K8: use:ward: a returned whileHover scale rests as none", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <div ref={(n) => (el = n)} use:ward={{ whileHover: { scale: 1.5 } }} style={BOX} />
      </WardicProvider>
    ))
    await hoverAndLeave(el, scaleOf, (v) => v > 1.49, 1)
    expect(await inlineTransformAtRest(el), "none, not scale(1)").toBe("none")
  })
})

describe("a key with no base value (#47): the presence exit", () => {
  const exitFrames = async (node: () => HTMLElement, hide: () => void, read: (el: Element) => number): Promise<Array<number>> => {
    const leaving = node()
    const s = sampleFrames(() => (leaving.isConnected ? read(leaving) : Number.NaN))
    hide()
    await until(() => !leaving.isConnected, 3000)
    return s.stop().map((f) => f.v).filter((v) => !Number.isNaN(v))
  }

  it("X1: an exit opacity with no value fades from the element's own value", async () => {
    const [visible, setVisible] = createSignal(true)
    render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={visible()}>
            <wardic.div data-exit class="bv-half" style={BOX} exit={{ opacity: 0 }} />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await settle()
    const frames = await exitFrames(() => document.querySelector<HTMLElement>("[data-exit]")!, () => setVisible(false), opacityOf)
    expect(max(frames), "from the class's 0.5, not from 0").toBeLessThan(0.51)
    expect(frames.some((v) => v > 0.1 && v < 0.45), "it fades through").toBe(true)
  })

  it("X2: an exit scale with no value shrinks from 1", async () => {
    const [visible, setVisible] = createSignal(true)
    render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={visible()}>
            <wardic.div data-exit style={BOX} exit={{ scale: 0 }} />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await settle()
    const frames = await exitFrames(() => document.querySelector<HTMLElement>("[data-exit]")!, () => setVisible(false), scaleOf)
    expect(frames.some((v) => v > 0.2 && v < 0.9), "it shrinks through, not from 0").toBe(true)
  })

  it("X3: an exit length in another unit than the element's own value starts at its target, and the rest of the exit still plays", async () => {
    const [visible, setVisible] = createSignal(true)
    render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={visible()}>
            <wardic.div data-exit style={BOX} exit={{ opacity: 0, height: "0%" }} />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await settle()
    const frames = await exitFrames(() => document.querySelector<HTMLElement>("[data-exit]")!, () => setVisible(false), opacityOf)
    expect(frames.some((v) => v > 0.1 && v < 0.9), "the opacity fades through, not cut short").toBe(true)
  })
})
