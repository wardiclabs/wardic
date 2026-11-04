// A layout element's own translate on the page (#363, ADR-0009 *Amendment (#363)*): drawn on its
// projection, as Motion draws a layout element's `x` and `y`. Painted values, read after each frame.
// Before #363 the renderer dropped a projected element's own `x`/`y`: the storefront's cart line
// (`layout`, `initial={{ x: 32 }}`) faded in but never slid.
//
// - OT1: mounted from `x: 32`, a layout element slides exactly as a plain one does.
// - OT2: at rest at `x: 32` it's drawn there; changed to 0, it slides there.
// - OT3: a `whileHover` x on a layout element comes back when the hover ends (ADR-0022).
// - OT4: an exit's `x` slides a leaving layout element as it fades (the cart line's exit).
// - OT5: a layout move under an own `x` keeps it on top: from its old box plus 20 to its new one
//   plus 20, never without it.
// - OT6: a layout child rides its layout parent's own `x` through CSS, once, not twice.
// - OT7: a dragged layout element keeps its own `x` on top of the drag, and on top of its release.
// - OT8: a `layoutId` twin at its own `x` taking over from one drawn at its own `x` starts drawn
//   where that one was, its own `x` taken back through the binding's `ownTranslate`, and lands home
//   at its own place plus its own `x`.
// - OT9 (#594): an own `x` in another unit than px (`-100%`, `-100vw`), mounted from it, to 0 or to
//   `0%`, slides a layout or a `layoutRoot` element exactly as it slides a plain one. Before, it was
//   drawn as 0: the projection's translate is in px, and the mixed pair read its start from the
//   transform the projection was holding.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider, type WardicTransition } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Easing from "@wardic/core/Easing"
import { createSignal, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"
import { centreOf, mouse, resetScene, sampleFrames, settle, wait } from "./reorder-harness.tsx"

afterEach(async () => {
  await resetScene()
  cleanup()
})

const LINEAR: WardicTransition = { type: "tween", duration: 0.25, ease: Easing.linear }
const BOX: JSX.CSSProperties = { width: "40px", height: "40px", background: "teal" }

/** An element's painted translateX. */
const xOf = (el: Element): number => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41
/** An element's painted left, relative to `origin`. */
const leftFrom = (el: Element, origin: number): number => el.getBoundingClientRect().left - origin
const round = (n: number): number => Math.round(n * 100) / 100

describe("a layout element's own translate (#363)", () => {
  it("OT1: mounted from x: 32, a layout element slides exactly as a plain one", async () => {
    const [shown, setShown] = createSignal(false)
    render(() => (
      <WardicProvider env={DomLive}>
        <Show when={shown()}>
          <wardic.div data-k="plain" initial={{ x: 32 }} animate={{ x: 0 }} transition={LINEAR} style={BOX} />
          <wardic.div data-k="layout" layout initial={{ x: 32 }} animate={{ x: 0 }} transition={LINEAR} style={BOX} />
        </Show>
      </WardicProvider>
    ))
    await settle()
    const s = sampleFrames(() => {
      const plain = document.querySelector('[data-k="plain"]')
      const layout = document.querySelector('[data-k="layout"]')
      return Bool.match(plain === null || layout === null, { onTrue: () => undefined, onFalse: () => ({ plain: xOf(plain!), layout: xOf(layout!) }) })
    })
    setShown(true)
    await wait(450)
    const frames = s.stop().flatMap((f) => UndefinedOr.match(f.v, { onUndefined: () => [], onDefined: (v) => [v] }))
    expect(frames[0]!.layout, "drawn at 32 on its first frame").toBeGreaterThan(25)
    expect(frames.filter((f) => f.layout > 1 && f.layout < 31).length, "mid-slide").toBeGreaterThanOrEqual(5)
    for (const [i, f] of frames.entries()) expect(round(f.layout), `frame ${i}: as the plain one`).toBe(round(f.plain))
    expect(frames.at(-1)!.layout).toBe(0)
  })

  it("OT9: an own x in % or vw, mounted from it, slides a layout and a layoutRoot element as a plain one (#594)", async () => {
    const PAIRS = [
      ["-100%", 0],
      ["-100%", "0%"],
      ["-100vw", "0vw"],
    ] as const
    for (const [from, to] of PAIRS) {
      const [shown, setShown] = createSignal(false)
      render(() => (
        <WardicProvider env={DomLive}>
          <Show when={shown()}>
            <wardic.div data-k="plain" initial={{ x: from }} animate={{ x: to }} transition={LINEAR} style={BOX} />
            <wardic.div data-k="layout" layout initial={{ x: from }} animate={{ x: to }} transition={LINEAR} style={BOX} />
            <wardic.div data-k="root" layoutRoot initial={{ x: from }} animate={{ x: to }} transition={LINEAR} style={BOX} />
          </Show>
        </WardicProvider>
      ))
      await settle()
      const s = sampleFrames(() => {
        const [plain, layout, root] = (["plain", "layout", "root"] as const).map((k) => document.querySelector(`[data-k="${k}"]`))
        return Bool.match(plain === null || layout === null || root === null, {
          onTrue: () => undefined,
          onFalse: () => ({ plain: xOf(plain!), layout: xOf(layout!), root: xOf(root!) }),
        })
      })
      setShown(true)
      await wait(450)
      const frames = s.stop().flatMap((f) => UndefinedOr.match(f.v, { onUndefined: () => [], onDefined: (v) => [v] }))
      const start = frames[0]!.plain
      expect(start, `${from}: the plain one starts off to the left`).toBeLessThan(-30)
      expect(frames.filter((f) => f.layout < -1 && f.layout > start + 1).length, `${from}: mid-slide`).toBeGreaterThanOrEqual(5)
      for (const [i, f] of frames.entries()) {
        expect(round(f.layout), `${from} frame ${i}: layout as the plain one`).toBe(round(f.plain))
        expect(round(f.root), `${from} frame ${i}: layoutRoot as the plain one`).toBe(round(f.plain))
      }
      expect(frames.at(-1)!.layout).toBe(0)
      cleanup()
    }
  })

  it("OT2: at rest at x: 32 it's drawn there; changed to 0, it slides there", async () => {
    const [x, setX] = createSignal(32)
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} layout initial={{ x: 32 }} animate={{ x: x() }} transition={LINEAR} style={BOX} />
      </WardicProvider>
    ))
    await settle()
    expect(xOf(el), "at rest at its own x").toBeCloseTo(32, 1)
    const s = sampleFrames(() => xOf(el))
    setX(0)
    await until(() => xOf(el) === 0, 2000)
    // The sampler reads after each paint: one more frame for the landing's.
    await raf()
    await raf()
    const xs = s.stop().map((f) => f.v)
    expect(xs.filter((v) => v > 1 && v < 31).length, "it slides").toBeGreaterThanOrEqual(5)
    expect(xs.at(-1)).toBe(0)
  })

  it("OT3: a whileHover x on a layout element comes back when the hover ends", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} layout whileHover={{ x: 8 }} transition={LINEAR} style={{ ...BOX, position: "absolute", left: "120px", top: "120px" }} />
      </WardicProvider>
    ))
    await settle()
    const c = centreOf(el)
    await mouse.move(c)
    await until(() => xOf(el) === 8, 2000)
    expect(xOf(el), "hovered: moved by its own x").toBe(8)
    await mouse.move({ x: 5, y: 5 })
    await until(() => xOf(el) === 0, 2000)
    expect(xOf(el), "back at its Base value").toBe(0)
  })

  it("OT4: an exit's x slides a leaving layout element as it fades", async () => {
    const [shown, setShown] = createSignal(true)
    render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={shown()}>
            <wardic.div data-leaving layout exit={{ opacity: 0, x: 32 }} transition={LINEAR} style={BOX} />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await settle()
    const leaving = document.querySelector<HTMLElement>("[data-leaving]")!
    const s = sampleFrames(() => Bool.match(leaving.isConnected, { onTrue: () => xOf(leaving), onFalse: () => undefined }))
    setShown(false)
    await until(() => !leaving.isConnected, 2000)
    const xs = s.stop().flatMap((f) => UndefinedOr.match(f.v, { onUndefined: (): Array<number> => [], onDefined: (v) => [v] }))
    expect(xs.filter((v) => v > 1 && v < 31).length, "it slides as it leaves").toBeGreaterThanOrEqual(4)
    expect(Math.max(...xs), "toward its exit's 32").toBeGreaterThan(20)
  })

  it("OT5: a layout move under an own x keeps it on top, from start to landing", async () => {
    const [moved, setMoved] = createSignal(false)
    let el!: HTMLElement
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", height: "60px" }}>
          <wardic.div
            ref={(n: HTMLElement) => (el = n)}
            layout
            layoutDependency={moved()}
            animate={{ x: 20 }}
            transition={{ ...LINEAR, layout: { type: "tween", duration: 0.3, ease: Easing.linear } }}
            style={{ ...BOX, position: "absolute", top: "0px", left: Bool.match(moved(), { onTrue: () => "200px", onFalse: () => "0px" }) }}
          />
        </div>
      </WardicProvider>
    ))
    await settle()
    // Its own x at 20, from mount.
    await wait(400)
    const origin = container.firstElementChild!.getBoundingClientRect().left
    expect(leftFrom(el, origin), "at rest: its box plus its own x").toBeCloseTo(20, 1)
    const s = sampleFrames(() => leftFrom(el, origin))
    setMoved(true)
    await wait(500)
    const lefts = s.stop().map((f) => f.v)
    const moving = lefts.findIndex((v) => v > 20.5)
    expect(lefts[moving]!, "its first step from 20, not from its new box").toBeLessThan(45)
    expect(Math.min(...lefts), "never drawn without its own x").toBeGreaterThan(19.5)
    expect(lefts.at(-1), "landed at its new box plus its own x").toBeCloseTo(220, 1)
  })

  it("OT6: a layout child rides its layout parent's own x, once", async () => {
    let parent!: HTMLElement
    let child!: HTMLElement
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", height: "100px" }}>
          <wardic.div ref={(n: HTMLElement) => (parent = n)} layout animate={{ x: 40 }} transition={LINEAR} style={{ position: "absolute", left: "0px", top: "0px", width: "120px", height: "80px" }}>
            <wardic.div ref={(n: HTMLElement) => (child = n)} layout style={{ position: "absolute", left: "10px", top: "10px", width: "20px", height: "20px" }} />
          </wardic.div>
        </div>
      </WardicProvider>
    ))
    await settle()
    await wait(400)
    const origin = container.firstElementChild!.getBoundingClientRect().left
    expect(leftFrom(parent, origin), "the parent at its own x").toBeCloseTo(40, 1)
    expect(leftFrom(child, origin), "the child at its place in the parent, moved once").toBeCloseTo(50, 1)
  })

  it("OT7: a dragged layout element keeps its own x on top of the drag and of its release", async () => {
    let el!: HTMLElement
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", height: "100px", "margin-top": "300px" }}>
          <wardic.div ref={(n: HTMLElement) => (el = n)} layout drag="x" dragSnapToOrigin animate={{ x: 30 }} transition={LINEAR} style={{ ...BOX, position: "absolute", left: "100px", top: "20px" }} />
        </div>
      </WardicProvider>
    ))
    await settle()
    await wait(400)
    const origin = container.firstElementChild!.getBoundingClientRect().left
    expect(leftFrom(el, origin), "at rest: its slot plus its own x").toBeCloseTo(130, 1)
    const c = centreOf(el)
    await mouse.move(c)
    await mouse.down(c)
    for (const k of [1, 2, 3, 4, 5]) {
      await mouse.move({ x: c.x + k * 12, y: c.y })
      await raf()
    }
    await raf()
    expect(leftFrom(el, origin), "dragged 60 px, its own x on top").toBeCloseTo(190, 0)
    await mouse.up({ x: c.x + 60, y: c.y })
    await until(() => Math.abs(leftFrom(el, origin) - 130) < 0.5, 3000)
    expect(leftFrom(el, origin), "released home, its own x on top").toBeCloseTo(130, 0)
  })

  it("OT8: a layoutId twin at its own x taking over from one at its own x starts where that one was drawn", async () => {
    const [which, setWhich] = createSignal<"a" | "b">("a")
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", height: "80px" }}>
          <Show when={which() === "a"}>
            <wardic.div data-twin="a" layoutId="pair" animate={{ x: 40 }} transition={{ ...LINEAR, layout: LINEAR }} style={{ ...BOX, position: "absolute", left: "0px", top: "0px" }} />
          </Show>
          <Show when={which() === "b"}>
            <wardic.div data-twin="b" layoutId="pair" initial={{ x: 20 }} animate={{ x: 20 }} transition={{ ...LINEAR, layout: LINEAR }} style={{ ...BOX, position: "absolute", left: "300px", top: "0px" }} />
          </Show>
        </div>
      </WardicProvider>
    ))
    await settle()
    await wait(400)
    const origin = container.firstElementChild!.getBoundingClientRect().left
    const a = container.querySelector('[data-twin="a"]')!
    expect(leftFrom(a, origin), "A drawn at its own x").toBeCloseTo(40, 1)
    const s = sampleFrames(() => {
      const b = container.querySelector('[data-twin="b"]')
      return Bool.match(b === null, { onTrue: () => undefined, onFalse: () => leftFrom(b!, origin) })
    })
    setWhich("b")
    await wait(400)
    const lefts = s.stop().flatMap((f) => UndefinedOr.match(f.v, { onUndefined: (): Array<number> => [], onDefined: (v) => [v] }))
    // B is drawn at its projection plus its own 20: it starts there with its own 20 taken back.
    expect(lefts[0]!, "B's first frame: from where A was drawn, 40, not from A's box at 0").toBeGreaterThan(38)
    expect(lefts[0]!, "a step on (18.7 px a frame), its own x not counted twice (78.7)").toBeLessThan(70)
    expect(lefts.at(-1), "B home, at its own x").toBeCloseTo(320, 1)
  })
})
