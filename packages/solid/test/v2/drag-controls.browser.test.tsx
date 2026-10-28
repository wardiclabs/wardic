// Drag controls (#431, Motion's `useDragControls`) on Solid 2, with real Playwright mouse input: a
// handle's `pointerdown` starts a drag on the wards given the controls, in a ward's config or as a
// `wardic.*` element's prop.
//
// The scene: a 40x40 handle H at (20,120), outside the dragged elements, whose `onPointerDown` calls
// `controls.start(e, options)`; each dragged element is 60x60, from (200,120) down.
//
// - DV1: H's press drags a ward given the controls in its config: `dragStart` and `dragEnd` resolve,
//   `whileDrag` is on while it drags. A `wardic.div` given them as a prop, with `dragPropagation`,
//   follows too.
// - DV2: `dragListener: false`: a press on the element doesn't drag it, and it gets no drag defaults;
//   H still drags it.
// - DV3: `snapToCursor` puts the centre under the pointer at the press; `distanceThreshold` holds the
//   start back until the pointer passes it.
// - DV4: `stop()` ends it as a release: `dragEnd` resolves.
// - DV5: `cancel()` ends it where it is: `dragEnd` doesn't resolve, `whileDrag` goes off, and a
//   `dragSnapToOrigin` element stays put.
// - DV6: a `Reorder.Item` dragged by its handle (`dragListener: false`) reorders; a press on its body
//   doesn't, and it takes no `touch-action`.
import { DomLive } from "@wardic/dom"
import type { JSX } from "@solidjs/web"
import {
  createDragControls,
  Reorder,
  type Ward,
  ward,
  type WardConfig,
  wardic,
  type WardicDragControls,
  type WardicDragControlsOptions,
  WardicProvider,
} from "@wardic/solid/unstable/v2"
import { createSignal, For } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import "../browser-commands.ts"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"
import { add, centreOf, glide, mouse, type Pt, resetScene, settle, wait } from "./reorder-scene.tsx"

afterEach(resetScene)

const HANDLE: JSX.CSSProperties = { position: "absolute", left: "20px", top: "120px", width: "40px", height: "40px", background: "gray", "touch-action": "none" }
const boxAt = (top: number): JSX.CSSProperties => ({ position: "absolute", left: "200px", top: `${top}px`, width: "60px", height: "60px", background: "teal" })

const translateOf = (el: HTMLElement): Pt => {
  const m = new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
  return { x: m.m41, y: m.m42 }
}
const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)

/** Whether `promise` has settled, after `frames` frames. */
const settledWithin = async (promise: Promise<unknown>, frames: number): Promise<boolean> => {
  let done = false
  void promise.then(
    () => (done = true),
    () => (done = true),
  )
  for (let i = 0; i < frames; i++) await raf()
  return done
}

/** Mount a handle for `controls` and a ward made from `config`; the handle, the element and the ward. */
const mountScene = (controls: WardicDragControls, config: WardConfig, options?: WardicDragControlsOptions, extra?: () => JSX.Element) => {
  let handle!: HTMLElement
  let el!: HTMLElement
  let card!: Ward
  const Card = (): JSX.Element => {
    card = ward(config)
    return <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
  }
  mount(() => (
    <WardicProvider env={DomLive}>
      <div ref={(n: HTMLElement) => (handle = n)} onPointerDown={(e) => controls.start(e, options)} style={HANDLE} />
      <Card />
      {extra?.()}
    </WardicProvider>
  ))
  return { handle: () => handle, el: () => el, card: () => card }
}

describe("drag controls on Solid 2 (#431)", () => {
  it("DV1: a handle drags a ward given the controls: dragStart and dragEnd resolve; a wardic.div given them follows too", async () => {
    const controls = createDragControls()
    let other!: HTMLElement
    const s = mountScene(controls, { drag: "x", dragControls: controls, dragMomentum: false, whileDrag: { opacity: 0.5 }, transition: { duration: 0.05 }, style: boxAt(120) }, undefined, () => (
      <wardic.div ref={(n: HTMLElement) => (other = n)} drag="x" dragControls={controls} dragPropagation dragMomentum={false} style={boxAt(200)} />
    ))
    await settle()
    const started = s.card().next("dragStart")
    const ended = s.card().next("dragEnd")
    const h = centreOf(s.handle())
    await mouse.down(h)
    await glide(h, add(h, 60, 0), 6)
    expect((await started).offset.x).toBeCloseTo(10, 0)
    await until(() => opacityOf(s.el()) < 0.6)
    expect(opacityOf(s.el()), "whileDrag on").toBeLessThan(0.6)
    expect(translateOf(s.el()).x).toBeCloseTo(60, 0)
    expect(translateOf(other).x, "the wardic.div's prop").toBeCloseTo(60, 0)
    await mouse.up(add(h, 60, 0))
    expect((await ended).offset.x).toBeCloseTo(60, 0)
  })

  it("DV2: dragListener false: its own press doesn't drag it and it has no drag defaults; the handle does", async () => {
    const controls = createDragControls()
    const s = mountScene(controls, { drag: true, dragControls: controls, dragListener: false, dragMomentum: false, style: boxAt(120) })
    await settle()
    expect(s.el().style.getPropertyValue("touch-action"), "no touch-action").toBe("")
    expect(s.el().hasAttribute("draggable"), "no draggable").toBe(false)
    const c = centreOf(s.el())
    await mouse.down(c)
    await glide(c, add(c, 50, 0), 5)
    await mouse.up(add(c, 50, 0))
    await settle()
    expect(translateOf(s.el()).x, "its own press drags nothing").toBe(0)
    // Its text stays selectable, as Motion's: the selection that press made would be dragged natively.
    window.getSelection()?.removeAllRanges()
    const h = centreOf(s.handle())
    await mouse.down(h)
    await glide(h, add(h, 50, 0), 5)
    await mouse.up(add(h, 50, 0))
    await settle()
    expect(translateOf(s.el()).x, "the handle drags it").toBeCloseTo(50, 0)
  })

  it("DV3: snapToCursor puts its centre under the pointer at the press; distanceThreshold holds the start back", async () => {
    const controls = createDragControls()
    const s = mountScene(controls, { drag: true, dragControls: controls, dragMomentum: false, style: boxAt(120) }, { snapToCursor: true, distanceThreshold: 30 })
    await settle()
    const started = s.card().next("dragStart")
    const h = centreOf(s.handle())
    await mouse.down(h)
    await raf()
    await raf()
    expect(centreOf(s.el()).x, "centre under the pointer").toBeCloseTo(h.x, 0)
    expect(centreOf(s.el()).y).toBeCloseTo(h.y, 0)
    await glide(h, add(h, 20, 0), 4)
    expect(await settledWithin(started, 3), "not past 30 px").toBe(false)
    expect(centreOf(s.el()).x).toBeCloseTo(h.x, 0)
    await glide(add(h, 20, 0), add(h, 50, 0), 3)
    expect((await started).offset.x).toBeCloseTo(40, 0)
    await mouse.up(add(h, 50, 0))
    await settle()
    expect(centreOf(s.el()).x, "followed from the snap").toBeCloseTo(h.x + 50, 0)
  })

  it("DV4: stop() ends it as a release: dragEnd resolves", async () => {
    const controls = createDragControls()
    const s = mountScene(controls, { drag: "x", dragControls: controls, dragMomentum: false, style: boxAt(120) })
    await settle()
    const ended = s.card().next("dragEnd")
    const h = centreOf(s.handle())
    await mouse.down(h)
    await glide(h, add(h, 40, 0), 4)
    controls.stop()
    expect((await ended).offset.x).toBeCloseTo(40, 0)
    await glide(add(h, 40, 0), add(h, 100, 0), 3)
    await mouse.up(add(h, 100, 0))
    await settle()
    expect(translateOf(s.el()).x, "the pointer moves it no more").toBeCloseTo(40, 0)
  })

  it("DV5: cancel() ends it where it is: no dragEnd, whileDrag off, no spring to its origin", async () => {
    const controls = createDragControls()
    const s = mountScene(controls, { drag: "x", dragControls: controls, dragSnapToOrigin: true, whileDrag: { opacity: 0.5 }, transition: { duration: 0.05 }, style: boxAt(120) })
    await settle()
    const ended = s.card().next("dragEnd")
    const h = centreOf(s.handle())
    await mouse.down(h)
    await glide(h, add(h, 60, 0), 6)
    await settle()
    controls.cancel()
    await until(() => opacityOf(s.el()) > 0.99)
    expect(opacityOf(s.el()), "whileDrag off").toBeGreaterThan(0.99)
    await wait(300)
    expect(translateOf(s.el()).x, "where it was").toBeCloseTo(60, 0)
    await mouse.up(add(h, 60, 0))
    expect(await settledWithin(ended, 10), "no dragEnd").toBe(false)
  })

  it("DV6: a Reorder.Item dragged by its handle reorders; a press on its body doesn't, and it takes no touch-action", async () => {
    const [order, setOrder] = createSignal<ReadonlyArray<string>>(["a", "b", "c"])
    // The order as the group last told it, read by the expectations.
    let told: ReadonlyArray<string> = ["a", "b", "c"]
    const reordered = (values: Array<string>): void => {
      told = values
      setOrder(values)
    }
    const handles = new Map<string, HTMLElement>()
    const items = new Map<string, HTMLElement>()
    mount(() => (
      <WardicProvider env={DomLive}>
        <Reorder.Group values={order() as Array<string>} onReorder={reordered} axis="y" style={{ position: "absolute", left: "40px", top: "120px", margin: "0", padding: "0" }}>
          <For each={order()}>
            {(value) => {
              const controls = createDragControls()
              return (
                <Reorder.Item
                  value={value}
                  ref={(el: HTMLElement) => items.set(value, el)}
                  dragControls={controls}
                  dragListener={false}
                  style={{ display: "flex", width: "200px", height: "50px", "margin-bottom": "10px", background: "teal", "list-style": "none" }}
                >
                  <div ref={(el: HTMLElement) => handles.set(value, el)} onPointerDown={(e) => controls.start(e)} style={{ width: "40px", height: "50px", background: "gray", "touch-action": "none" }} />
                </Reorder.Item>
              )
            }}
          </For>
        </Reorder.Group>
      </WardicProvider>
    ))
    await settle()
    const a = items.get("a")!
    expect(a.style.getPropertyValue("touch-action"), "no touch-action of the group's").toBe("")
    const body = add(centreOf(a), 60, 0)
    await mouse.down(body)
    await glide(body, add(body, 0, 70), 7)
    await mouse.up(add(body, 0, 70))
    await settle()
    expect(told).toEqual(["a", "b", "c"])
    window.getSelection()?.removeAllRanges()
    const h = centreOf(handles.get("a")!)
    await mouse.down(h)
    await glide(h, add(h, 0, 70), 7)
    await wait(100)
    await mouse.up(add(h, 0, 70))
    await settle()
    expect(told).toEqual(["b", "a", "c"])
  })
})
