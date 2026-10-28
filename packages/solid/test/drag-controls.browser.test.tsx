// Drag controls (#431, Motion's `useDragControls`) on Solid 1, with real Playwright mouse input: a
// handle's `pointerdown` starts a drag on the elements given the controls, as if it had pressed them.
//
// The scene: a 40x40 handle H at (20,120), outside the dragged elements, whose `onPointerDown` calls
// `controls.start(e, options)`; each dragged element is 60x60, from (200,120) down.
//
// - DCS1: H's press drags the element given the controls, by the pointer's offset, with `whileDrag`
//   on and `onDragStart` / `onDragEnd` told; the release rests where it was let go. Each element given
//   them takes its Drag claim: a second on the same axis is refused, one with `dragPropagation` follows.
// - DCS2: `dragListener={false}`: a press on the element doesn't drag it, and it gets no drag defaults
//   (`touch-action`, `user-select`, `draggable`); H still drags it.
// - DCS3: `snapToCursor` puts the element's centre under the pointer at the press, before any move;
//   the drag goes on from there.
// - DCS4: `distanceThreshold: 30`: a 20 px move starts nothing; past 30 px the drag starts, at the
//   pointer's offset from the press.
// - DCS5: `stop()` mid-drag ends it as a release: `onDragEnd` told, the Fling carries it on to its
//   constraint, `whileDrag` off at its rest; the still-pressed pointer's moves move it no more.
// - DCS6: `cancel()` ends it where it is: no `onDragEnd`, no release (a `dragSnapToOrigin` element stays
//   put), `whileDrag` off.
// - DCS7: an element leaving an `<AnimatePresence>` starts none, and doesn't snap to the cursor.
// - DCS8: a layout node's snap: its centre under the pointer at the press; a press that ends with no
//   drag puts it back on its slot.
// - DCS9: a `Reorder.Item` dragged by its handle (`dragListener={false}`) reorders the list; a press on
//   its body doesn't, and it takes no `touch-action`, so the list scrolls by touch.
// - DCS10: with `dragListener={false}` a press on the element doesn't stop its running release, as
//   Motion's listener-less element hears no press.
// - DCS11: an unmounted element's track is let go by the controls it was given, which outlive it.
//
// An element with `dragListener={false}` keeps its text selectable, as Motion's does: a test that
// presses on one and moves clears the selection after, or the next press on it drags the selection
// natively, which cancels the pointer.
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, createDragControls, Reorder, wardic, type WardicDragControls, type WardicDragControlsOptions, WardicProvider } from "@wardic/solid"
import { createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { commands } from "vitest/browser"
import "./browser-commands.ts"
import { raf, until } from "./browser-helpers.ts"
import { add, centreOf, glide, mouse, type Pt, resetScene, settle, wait } from "./reorder-harness.tsx"

afterEach(resetScene)

const HANDLE: JSX.CSSProperties = { position: "absolute", left: "20px", top: "120px", width: "40px", height: "40px", background: "gray", "touch-action": "none" }
const boxAt = (top: number): JSX.CSSProperties => ({ position: "absolute", left: "200px", top: `${top}px`, width: "60px", height: "60px", background: "teal" })

/** `el`'s drawn translate, from its computed transform. */
const translateOf = (el: HTMLElement): Pt => {
  const m = new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
  return { x: m.m41, y: m.m42 }
}
const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)

/** A handle that starts `controls` with `options` at its press. */
const Handle = (props: { readonly controls: WardicDragControls; readonly options?: WardicDragControlsOptions; readonly ref: (el: HTMLElement) => void }): JSX.Element => (
  <div ref={props.ref} onPointerDown={(e) => props.controls.start(e, props.options)} style={HANDLE} />
)

describe("drag controls on Solid 1 (#431)", () => {
  it("DCS1: a handle's press drags the element given the controls, with whileDrag and the drag callbacks; each takes its claim", async () => {
    const controls = createDragControls()
    const calls: Array<string> = []
    let handle!: HTMLElement
    let a!: HTMLElement
    let b!: HTMLElement
    let c!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <Handle controls={controls} ref={(el) => (handle = el)} />
        <wardic.div
          ref={(el: HTMLElement) => (a = el)}
          drag="x"
          dragControls={controls}
          dragMomentum={false}
          whileDrag={{ opacity: 0.5 }}
          transition={{ duration: 0.05 }}
          onDragStart={(_, info) => calls.push(`start ${Math.round(info.offset.x)}`)}
          onDragEnd={(_, info) => calls.push(`end ${Math.round(info.offset.x)}`)}
          style={boxAt(120)}
        />
        <wardic.div ref={(el: HTMLElement) => (b = el)} drag="x" dragControls={controls} dragMomentum={false} style={boxAt(200)} />
        <wardic.div ref={(el: HTMLElement) => (c = el)} drag="x" dragControls={controls} dragMomentum={false} dragPropagation style={boxAt(280)} />
      </WardicProvider>
    ))
    await settle()
    const h = centreOf(handle)
    await mouse.down(h)
    await glide(h, add(h, 60, 0), 6)
    await until(() => opacityOf(a) < 0.6)
    expect(translateOf(a).x, "follows the pointer's offset").toBeCloseTo(60, 0)
    expect(translateOf(b).x, "refused: the first holds the x claim").toBe(0)
    expect(translateOf(c).x, "with dragPropagation, no claim to be refused").toBeCloseTo(60, 0)
    expect(opacityOf(a), "whileDrag on").toBeLessThan(0.6)
    await mouse.up(add(h, 60, 0))
    await until(() => opacityOf(a) > 0.99)
    await settle()
    expect(calls).toEqual(["start 10", "end 60"])
    expect(translateOf(a).x, "rests where it was let go").toBeCloseTo(60, 0)
  })

  it("DCS2: dragListener false: its own press doesn't drag it and it has no drag defaults; the handle does", async () => {
    const controls = createDragControls()
    let handle!: HTMLElement
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <Handle controls={controls} ref={(n) => (handle = n)} />
        <wardic.div ref={(n: HTMLElement) => (el = n)} drag dragControls={controls} dragListener={false} dragMomentum={false} style={boxAt(120)} />
      </WardicProvider>
    ))
    await settle()
    expect(el.style.getPropertyValue("touch-action"), "no touch-action").toBe("")
    expect(el.style.getPropertyValue("user-select"), "no user-select").toBe("")
    expect(el.hasAttribute("draggable"), "no draggable").toBe(false)
    const c = centreOf(el)
    await mouse.down(c)
    await glide(c, add(c, 50, 0), 5)
    await mouse.up(add(c, 50, 0))
    await settle()
    expect(translateOf(el).x, "its own press drags nothing").toBe(0)
    window.getSelection()?.removeAllRanges()
    const h = centreOf(handle)
    await mouse.down(h)
    await glide(h, add(h, 50, 0), 5)
    await mouse.up(add(h, 50, 0))
    await settle()
    expect(translateOf(el).x, "the handle drags it").toBeCloseTo(50, 0)
  })

  it("DCS3: snapToCursor puts its centre under the pointer at the press, and the drag goes on from there", async () => {
    const controls = createDragControls()
    let handle!: HTMLElement
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <Handle controls={controls} options={{ snapToCursor: true }} ref={(n) => (handle = n)} />
        <wardic.div ref={(n: HTMLElement) => (el = n)} drag dragControls={controls} dragMomentum={false} style={boxAt(120)} />
      </WardicProvider>
    ))
    await settle()
    const h = centreOf(handle)
    await mouse.down(h)
    await raf()
    await raf()
    const snapped = centreOf(el)
    expect(snapped.x, "centre under the pointer, before any move").toBeCloseTo(h.x, 0)
    expect(snapped.y).toBeCloseTo(h.y, 0)
    await glide(h, add(h, 40, 20), 4)
    await mouse.up(add(h, 40, 20))
    await settle()
    expect(centreOf(el).x, "followed from the snap").toBeCloseTo(h.x + 40, 0)
    expect(centreOf(el).y).toBeCloseTo(h.y + 20, 0)
  })

  it("DCS4: distanceThreshold 30: a 20 px move starts nothing; past 30 px the drag starts", async () => {
    const controls = createDragControls()
    const calls: Array<string> = []
    let handle!: HTMLElement
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <Handle controls={controls} options={{ distanceThreshold: 30 }} ref={(n) => (handle = n)} />
        <wardic.div
          ref={(n: HTMLElement) => (el = n)}
          drag="x"
          dragControls={controls}
          dragMomentum={false}
          onDragStart={(_, info) => calls.push(`start ${Math.round(info.offset.x)}`)}
          style={boxAt(120)}
        />
      </WardicProvider>
    ))
    await settle()
    const h = centreOf(handle)
    await mouse.down(h)
    await glide(h, add(h, 20, 0), 4)
    await settle()
    expect(translateOf(el).x, "not past 30 px").toBe(0)
    expect(calls).toEqual([])
    await glide(add(h, 20, 0), add(h, 50, 0), 3)
    await mouse.up(add(h, 50, 0))
    await settle()
    expect(calls).toEqual(["start 40"])
    expect(translateOf(el).x, "at the pointer's offset from the press").toBeCloseTo(50, 0)
  })

  it("DCS5: stop() ends it as a release: onDragEnd told, whileDrag off, the Fling carries on; the pointer moves it no more", async () => {
    const controls = createDragControls()
    const calls: Array<string> = []
    let handle!: HTMLElement
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <Handle controls={controls} ref={(n) => (handle = n)} />
        <wardic.div
          ref={(n: HTMLElement) => (el = n)}
          drag="x"
          dragControls={controls}
          dragConstraints={{ left: 0, right: 80 }}
          whileDrag={{ opacity: 0.5 }}
          transition={{ duration: 0.05 }}
          onDragStart={() => calls.push("start")}
          onDragEnd={(_, info) => calls.push(`end ${String(info.velocity.x > 100)}`)}
          style={boxAt(120)}
        />
      </WardicProvider>
    ))
    await settle()
    const h = centreOf(handle)
    await mouse.down(h)
    await glide(h, add(h, 60, 0), 6, 16)
    const at = translateOf(el).x
    controls.stop()
    await settle()
    expect(calls, "a release, with the moves' velocity").toEqual(["start", "end true"])
    await until(() => opacityOf(el) > 0.99)
    expect(opacityOf(el), "whileDrag off at its rest").toBeGreaterThan(0.99)
    expect(at, "stopped short of the constraint").toBeLessThan(70)
    expect(translateOf(el).x, "the Fling carried it on, to its constraint").toBeCloseTo(80, 0)
    await glide(add(h, 60, 0), add(h, 0, 0), 4)
    await mouse.up(h)
    await settle()
    expect(translateOf(el).x, "the pointer moves it no more").toBeCloseTo(80, 0)
    expect(calls).toHaveLength(2)
  })

  it("DCS6: cancel() ends it where it is: no onDragEnd, no release, whileDrag off", async () => {
    const controls = createDragControls()
    const calls: Array<string> = []
    let handle!: HTMLElement
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <Handle controls={controls} ref={(n) => (handle = n)} />
        <wardic.div
          ref={(n: HTMLElement) => (el = n)}
          drag="x"
          dragControls={controls}
          dragSnapToOrigin
          whileDrag={{ opacity: 0.5 }}
          transition={{ duration: 0.05 }}
          onDragStart={() => calls.push("start")}
          onDragEnd={() => calls.push("end")}
          style={boxAt(120)}
        />
      </WardicProvider>
    ))
    await settle()
    const h = centreOf(handle)
    await mouse.down(h)
    await glide(h, add(h, 60, 0), 6)
    await settle()
    controls.cancel()
    await until(() => opacityOf(el) > 0.99)
    await wait(300)
    expect(translateOf(el).x, "where it was: no spring to its origin").toBeCloseTo(60, 0)
    expect(opacityOf(el), "whileDrag off").toBeGreaterThan(0.99)
    await mouse.up(add(h, 60, 0))
    await settle()
    expect(calls).toEqual(["start"])
    expect(translateOf(el).x).toBeCloseTo(60, 0)
  })

  it("DCS7: an element leaving an AnimatePresence starts none, and doesn't snap", async () => {
    const controls = createDragControls()
    const [shown, setShown] = createSignal(true)
    let handle!: HTMLElement
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <Handle controls={controls} options={{ snapToCursor: true }} ref={(n) => (handle = n)} />
        <AnimatePresence>
          <Show when={shown()}>
            <wardic.div
              ref={(n: HTMLElement) => (el = n)}
              drag="x"
              dragControls={controls}
              dragMomentum={false}
              exit={{ opacity: 0 }}
              transition={{ duration: 2 }}
              style={boxAt(120)}
            />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await settle()
    setShown(false)
    await settle()
    expect(el.isConnected, "still leaving").toBe(true)
    const h = centreOf(handle)
    await mouse.down(h)
    await raf()
    await raf()
    expect(translateOf(el), "no snap").toEqual({ x: 0, y: 0 })
    await glide(h, add(h, 50, 0), 5)
    await mouse.up(add(h, 50, 0))
    await settle()
    expect(translateOf(el).x, "no drag").toBe(0)
  })

  it("DCS8: a layout node's snap puts its centre under the pointer; a press with no drag puts it back on its slot", async () => {
    const controls = createDragControls()
    let handle!: HTMLElement
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <Handle controls={controls} options={{ snapToCursor: true }} ref={(n) => (handle = n)} />
        <wardic.div ref={(n: HTMLElement) => (el = n)} layout drag dragControls={controls} style={boxAt(120)} />
      </WardicProvider>
    ))
    await settle()
    const slot = el.getBoundingClientRect()
    const h = centreOf(handle)
    await mouse.down(h)
    await raf()
    await raf()
    expect(centreOf(el).x, "centre under the pointer").toBeCloseTo(h.x, 0)
    expect(centreOf(el).y).toBeCloseTo(h.y, 0)
    await mouse.up(h)
    await until(() => Math.abs(el.getBoundingClientRect().left - slot.left) < 0.5)
    expect(el.getBoundingClientRect().left, "back on its slot").toBeCloseTo(slot.left, 0)
    // A drag from the snap follows from it.
    await mouse.down(h)
    await glide(h, add(h, 30, 0), 3)
    await raf()
    await raf()
    expect(centreOf(el).x).toBeCloseTo(h.x + 30, 0)
    await mouse.up(add(h, 30, 0))
  })

  it("DCS9: a Reorder.Item dragged by its handle reorders; a press on its body doesn't, and it takes no touch-action", async () => {
    const [order, setOrder] = createSignal<ReadonlyArray<string>>(["a", "b", "c"])
    const handles = new Map<string, HTMLElement>()
    const items = new Map<string, HTMLElement>()
    render(() => (
      <WardicProvider env={DomLive}>
        <Reorder.Group values={order() as Array<string>} onReorder={setOrder} axis="y" style={{ position: "absolute", left: "40px", top: "120px", margin: "0", padding: "0" }}>
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
                  <div ref={(el) => handles.set(value, el)} onPointerDown={(e) => controls.start(e)} style={{ width: "40px", height: "50px", background: "gray", "touch-action": "none" }} />
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
    // Its body: no reorder.
    const body = add(centreOf(a), 60, 0)
    await mouse.down(body)
    await glide(body, add(body, 0, 70), 7)
    await mouse.up(add(body, 0, 70))
    await settle()
    expect(order()).toEqual(["a", "b", "c"])
    window.getSelection()?.removeAllRanges()
    // Its handle: a over b.
    const h = centreOf(handles.get("a")!)
    await mouse.down(h)
    await glide(h, add(h, 0, 70), 7)
    await wait(100)
    await mouse.up(add(h, 0, 70))
    await settle()
    expect(order()).toEqual(["b", "a", "c"])
  })

  it("DCS10: with dragListener false a press on the element doesn't stop its running release", async () => {
    const controls = createDragControls()
    let handle!: HTMLElement
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <Handle controls={controls} ref={(n) => (handle = n)} />
        <wardic.div
          ref={(n: HTMLElement) => (el = n)}
          drag="x"
          dragControls={controls}
          dragListener={false}
          dragMomentum={false}
          dragSnapToOrigin
          style={{ ...boxAt(120), left: "120px", "user-select": "none" }}
        />
      </WardicProvider>
    ))
    await settle()
    const h = centreOf(handle)
    await mouse.down(h)
    await glide(h, add(h, 80, 0), 4)
    await mouse.up(add(h, 80, 0))
    await raf()
    await raf()
    // Its release springs it back to its origin: a press on it there, mid-release.
    const p = centreOf(el)
    expect(document.elementFromPoint(p.x, p.y), "the press lands on it").toBe(el)
    expect(translateOf(el).x, "mid-release").toBeGreaterThan(20)
    // Read from a frame after the press lands: the release moves on while the press is on its way.
    await mouse.down(p)
    await raf()
    const pressed = translateOf(el).x
    await raf()
    await raf()
    await raf()
    const after = translateOf(el).x
    await mouse.up(p)
    expect(after, "the release goes on through the press").toBeLessThan(pressed - 1)
  })

  it("DCS11: an unmounted element's track is let go by the controls, which outlive it", async () => {
    const controls = createDragControls()
    const refs: Array<WeakRef<HTMLElement>> = []
    const { unmount } = render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => refs.push(new WeakRef(n))} drag dragControls={controls} style={boxAt(120)} />
      </WardicProvider>
    ))
    await settle()
    unmount()
    await settle()
    await wait(0)
    await commands.collectGarbage()
    expect(refs.filter((ref) => ref.deref() !== undefined), "collected").toHaveLength(0)
    // The controls live on: here, past the collection.
    controls.stop()
  })
})
