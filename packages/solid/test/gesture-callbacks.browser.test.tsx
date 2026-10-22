// Solid 1's gesture callbacks (#273, ADR-0047): Motion's `(event, info)`, the DOM's own PointerEvent
// first, called at the event, with `info.point` in the viewport. Real Playwright mouse input, so each
// event is the browser's own (`isTrusted`) and lands where the pointer is.
//
// - GC1: `onHoverStart` / `onHoverEnd`, with no `whileHover`: the hover recognizer runs for them.
// - GC2: `onTapStart`, then `onTap` at a release on a child of the element.
// - GC3: `onTapCancel` at a release elsewhere on the page; no `onTap`. A scroll during the press
//   leaves `point` where the pointer is on the screen.
// - GC4: a press a drag took over calls neither `onTap` nor `onTapCancel`.
// - GC5: `onDragStart`, `onDrag` (its start and each move) and `onDragEnd`, with Motion's info.
// - GC6: a scroll during a drag: `onDrag` hears its move, `point` stays where the pointer is on the
//   screen and `offset` counts the scroll, as Motion's does.
// - GC7: `onDragTransitionEnd` with no momentum: once, at the release.
// - GC8: `onDragTransitionEnd` once the spring back rests, with the rest value on the element; a
//   release a grab-and-drag stopped tells nothing.
// - GC9: a layout node's drag: `onDragTransitionEnd` once its Release offset rests, on its slot; once
//   for one a grab with no drag paused, which goes on; and for one released in place.
// - GC10: a callback set after mount starts its recognizer then (Motion's features), through
//   `createWard`'s config or a reactive spread on `wardic.div` (whose keys can change).
// - GC11: at the event: `onTapStart`'s `event.stopPropagation()` keeps the down from a parent's
//   listener.
// - GC12: a `Reorder.Item`'s drag callbacks, beside its group's, and its `onDragTransitionEnd` once
//   it lands on its new slot.
// - GC13 (pan): `onPanSessionStart` at the down, `onPanStart`, `onPan` (its start and each move) and
//   `onPanEnd`, with Motion's info; the element doesn't move.
// - GC14: a press that never passed the threshold: its session only, no `onPanEnd`.
// - GC15: a pan that started is a drag for the press it took over (Wardic's rule, ADR-0047): neither
//   `onTap` nor `onTapCancel`, on the panned element or a card inside it; a wobble still taps.
// - GC16: no hover starts while a pan is on.
// - GC17: a pan callback set after mount starts the pan recognizer then, once.
// - GC18 (direction lock): nothing before the lock; then `onDirectionLock`, `onDragStart` and `onDrag`
//   at the lock, the element moving on that axis alone.
// - GC19: a card that drags sideways in a sheet that drags down, both locked: each takes its own swipe,
//   and the card's drag doesn't start on a vertical one (no `onDragStart`, no `whileDrag`).
// - GC20: a locked drag leaves the axis it doesn't move where it is, even outside its constraints
//   (ADR-0016, *Amendment (#140)*): it moves on its lock's axis alone.
//
// A callback that throws: error-reporting.browser.test.tsx.
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { createWard, Reorder, wardic, type WardConfig, type WardicDragInfo, type WardicPointInfo, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, For, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"
import { add, centreOf, glide, mouse, type Pt, resetScene, settle, wait } from "./reorder-harness.tsx"

afterEach(resetScene)

const PARK: Pt = { x: 5, y: 5 }
const BOX = { width: "80px", height: "80px", background: "teal", "user-select": "none" } as const

/** `box`, at (100, 100) on the page, settled; its element. */
const mount = async (box: (ref: (n: HTMLElement) => void) => JSX.Element): Promise<HTMLElement> => {
  const [el, setEl] = createSignal<HTMLElement>()
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "absolute", top: "100px", left: "100px", height: "3000px" }}>{box((n) => setEl(n))}</div>
    </WardicProvider>
  ))
  await settle()
  return el()!
}

const r = (n: number): number => Math.round(n)
const at = (p: Pt): string => `${r(p.x)},${r(p.y)}`

/** A call: its name, the event's type and whether the browser made it, and the info's point. */
const seen = (name: string, event: PointerEvent, info: WardicPointInfo): string => `${name} ${event.type} ${event.isTrusted} ${at(info.point)}`

/** A drag call: {@link seen}, and the info's offset and delta on x. */
const seenDrag = (name: string, event: PointerEvent, info: WardicDragInfo): string =>
  `${seen(name, event, info)} off ${r(info.offset.x)},${r(info.offset.y)} d ${r(info.delta.x)}`

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

/** A drag from `from` by `dx` to the right, in five moves, released there. */
const flick = async (from: Pt, dx: number): Promise<void> => {
  await mouse.down(from)
  await glide(from, add(from, dx, 0), 5)
  await mouse.up(add(from, dx, 0))
}

describe("Solid 1's gesture callbacks (#273)", () => {
  it("GC1: onHoverStart / onHoverEnd run the hover recognizer, with the DOM's event and its viewport point", async () => {
    const calls: Array<string> = []
    const el = await mount((ref) => (
      <wardic.div ref={ref} onHoverStart={(e, info) => calls.push(seen("start", e, info))} onHoverEnd={(e, info) => calls.push(seen("end", e, info))} style={BOX} />
    ))
    const c = centreOf(el)
    await mouse.move(c)
    await mouse.move(PARK)
    expect(calls).toEqual([`start pointerenter true ${at(c)}`, `end pointerleave true ${at(PARK)}`])
  })

  it("GC2: onTapStart, then onTap at a release on a child", async () => {
    const calls: Array<string> = []
    let child!: HTMLElement
    const el = await mount((ref) => (
      <wardic.div
        ref={ref}
        onTapStart={(e, info) => calls.push(seen("tapStart", e, info))}
        onTap={(e, info) => calls.push(seen("tap", e, info))}
        onTapCancel={(e, info) => calls.push(seen("cancel", e, info))}
        style={BOX}
      >
        <span ref={(n: HTMLElement) => (child = n)} style={{ display: "block", width: "20px", height: "20px", background: "white" }} />
      </wardic.div>
    ))
    const c = centreOf(el)
    const onChild = centreOf(child)
    await mouse.down(c)
    await mouse.up(onChild)
    expect(calls).toEqual([`tapStart pointerdown true ${at(c)}`, `tap pointerup true ${at(onChild)}`])
  })

  it("GC3: onTapCancel at a release elsewhere on the page; no onTap", async () => {
    const calls: Array<string> = []
    const el = await mount((ref) => (
      <wardic.div ref={ref} onTap={(e, info) => calls.push(seen("tap", e, info))} onTapCancel={(e, info) => calls.push(seen("cancel", e, info))} style={BOX} />
    ))
    const off = { x: 260, y: 60 }
    await mouse.down(centreOf(el))
    await mouse.move(off)
    await mouse.up(off)
    expect(calls).toEqual([`cancel pointerup true ${at(off)}`])
    // The page scrolled under a held press: its release, where it lands on the screen.
    await mouse.down(centreOf(el))
    await mouse.move(add(centreOf(el), 4, 0))
    window.scrollBy(0, 60)
    await frames(3)
    await mouse.move(off)
    await mouse.up(off)
    expect(calls).toEqual([`cancel pointerup true ${at(off)}`, `cancel pointerup true ${at(off)}`])
  })

  it("GC4: a press a drag took over calls neither onTap nor onTapCancel", async () => {
    const calls: Array<string> = []
    const el = await mount((ref) => (
      <wardic.div
        ref={ref}
        drag
        dragMomentum={false}
        onTapStart={() => calls.push("tapStart")}
        onTap={() => calls.push("tap")}
        onTapCancel={() => calls.push("cancel")}
        onDragStart={() => calls.push("dragStart")}
        onDragEnd={() => calls.push("dragEnd")}
        style={BOX}
      />
    ))
    const c = centreOf(el)
    await mouse.down(c)
    await glide(c, add(c, 60, 0), 6)
    await mouse.up(add(c, 60, 0))
    await frames(2)
    expect(calls).toEqual(["tapStart", "dragStart", "dragEnd"])
  })

  it("GC5: onDragStart, onDrag (its start and each move) and onDragEnd, with Motion's info", async () => {
    const calls: Array<string> = []
    const el = await mount((ref) => (
      <wardic.div
        ref={ref}
        drag="x"
        dragMomentum={false}
        onDirectionLock={(axis) => calls.push(`lock ${axis}`)}
        onDragStart={(e, info) => calls.push(seenDrag("start", e, info))}
        onDrag={(e, info) => calls.push(seenDrag("drag", e, info))}
        onDragEnd={(e, info) => calls.push(seenDrag("end", e, info))}
        style={BOX}
      />
    ))
    const c = centreOf(el)
    await mouse.down(c)
    await glide(c, add(c, 80, 0), 4)
    await mouse.up(add(c, 80, 0))
    await frames(2)
    expect(calls).toEqual([
      `start pointermove true ${at(add(c, 20, 0))} off 20,0 d 20`,
      `drag pointermove true ${at(add(c, 20, 0))} off 20,0 d 20`,
      `drag pointermove true ${at(add(c, 40, 0))} off 40,0 d 20`,
      `drag pointermove true ${at(add(c, 60, 0))} off 60,0 d 20`,
      `drag pointermove true ${at(add(c, 80, 0))} off 80,0 d 20`,
      // Playwright moves to the release's point first: a move that goes nowhere, told as Motion does.
      `drag pointermove true ${at(add(c, 80, 0))} off 80,0 d 0`,
      `end pointerup true ${at(add(c, 80, 0))} off 80,0 d 0`,
    ])
  })

  it("GC6: a scroll during a drag: onDrag hears it, point stays on the screen, offset counts the scroll", async () => {
    const calls: Array<string> = []
    const el = await mount((ref) => (
      <wardic.div ref={ref} drag dragMomentum={false} onDrag={(e, info) => calls.push(seenDrag("drag", e, info))} style={BOX} />
    ))
    const c = centreOf(el)
    await mouse.down(c)
    await glide(c, add(c, 0, 20), 2)
    await wait(50)
    calls.length = 0
    window.scrollBy(0, 60)
    await until(() => calls.length > 0, 1000)
    await mouse.up(add(c, 0, 20))
    // The scroll's move carries the pointer's last event (ADR-0019, *Amendment (Reorder)*).
    expect(calls[0]).toBe(`drag pointermove true ${at(add(c, 0, 20))} off 0,80 d 0`)
  })

  it("GC7: onDragTransitionEnd with no momentum: once, at the release", async () => {
    let ends = 0
    const el = await mount((ref) => <wardic.div ref={ref} drag dragMomentum={false} onDragTransitionEnd={() => ends++} style={BOX} />)
    const c = centreOf(el)
    await mouse.down(c)
    await glide(c, add(c, 60, 0), 6)
    await mouse.up(add(c, 60, 0))
    await frames(2)
    expect(ends).toBe(1)
    await frames(10)
    expect(ends, "once").toBe(1)
  })

  it("GC8: onDragTransitionEnd once the spring back rests, with the rest value on the element; not for a release a grab-and-drag stopped", async () => {
    const ends: Array<number> = []
    let el!: HTMLElement
    el = await mount((ref) => (
      <wardic.div ref={ref} drag dragSnapToOrigin onDragTransitionEnd={() => ends.push(r(el.getBoundingClientRect().left))} style={BOX} />
    ))
    const home = r(el.getBoundingClientRect().left)
    const c = centreOf(el)
    await flick(c, 100)
    await frames(3)
    expect(ends, "still flying").toEqual([])
    // Grabbed mid-flight and dragged again: only the second release tells.
    await flick(centreOf(el), 100)
    await until(() => ends.length > 0, 3000)
    await frames(10)
    expect(ends, "the second release, once, at home").toEqual([home])
  })

  it("GC9: a layout node's drag: onDragTransitionEnd once its Release offset rests, on its slot; once for one a grab paused; and released in place", async () => {
    const ends: Array<number> = []
    let el!: HTMLElement
    el = await mount((ref) => (
      <wardic.div ref={ref} layout drag dragSnapToOrigin onDragTransitionEnd={() => ends.push(r(el.getBoundingClientRect().left))} style={BOX} />
    ))
    const slot = r(el.getBoundingClientRect().left)
    const c = centreOf(el)
    await flick(c, 90)
    await frames(2)
    expect(ends, "still flying").toEqual([])
    await until(() => ends.length > 0, 3000)
    await frames(10)
    expect(ends, "once, on its slot").toEqual([slot])
    // Grabbed mid-flight with no drag: it goes on from rest (Motion's resumeAnimation), and tells once.
    await flick(c, 90)
    await frames(3)
    const mid = centreOf(el)
    await mouse.down(mid)
    await frames(3)
    expect(ends, "paused").toEqual([slot])
    await mouse.up(mid)
    await until(() => ends.length > 1, 3000)
    await frames(10)
    expect(ends, "the paused release, once, on its slot").toEqual([slot, slot])
    // Out and back, held still past the velocity window: released in place, told from a microtask.
    await mouse.down(c)
    await glide(c, add(c, 60, 0), 4)
    await glide(add(c, 60, 0), c, 4)
    await wait(200)
    await mouse.up(c)
    await until(() => ends.length > 2, 1000)
    await frames(4)
    expect(ends).toEqual([slot, slot, slot])
  })

  it("GC10: a callback set after mount starts its recognizer then", async () => {
    const calls: Array<string> = []
    const [listening, setListening] = createSignal(false)
    const config = (): WardConfig =>
      Bool.match(listening(), { onTrue: () => ({ onHoverStart: () => calls.push("start") }), onFalse: () => ({}) })
    const el = await mount((ref) => {
      function C() {
        const ward = createWard(config)
        return <div {...ward({ ref })} style={BOX} />
      }
      return <C />
    })
    await mouse.move(centreOf(el))
    await mouse.move(PARK)
    expect(calls, "no recognizer yet").toEqual([])
    setListening(true)
    await settle()
    await mouse.move(centreOf(el))
    expect(calls).toEqual(["start"])
  })

  it("GC10b: a callback a reactive spread adds after mount starts its recognizer then", async () => {
    const calls: Array<string> = []
    const [listening, setListening] = createSignal(false)
    const el = await mount((ref) => (
      <wardic.div
        ref={ref}
        {...Bool.match(listening(), { onTrue: () => ({ onHoverStart: () => calls.push("start") }), onFalse: () => ({}) })}
        style={BOX}
      />
    ))
    await mouse.move(centreOf(el))
    await mouse.move(PARK)
    expect(calls, "no callback yet").toEqual([])
    setListening(true)
    await settle()
    await mouse.move(centreOf(el))
    expect(calls).toEqual(["start"])
  })

  it("GC11: at the event: onTapStart's stopPropagation keeps the down from a parent's listener", async () => {
    const parentSaw: Array<string> = []
    const calls: Array<string> = []
    let parent!: HTMLElement
    const [stops, setStops] = createSignal(true)
    const el = await mount((ref) => (
      <div ref={(n: HTMLElement) => (parent = n)}>
        <wardic.div
          ref={ref}
          onTapStart={(event) => {
            calls.push("tapStart")
            if (stops()) event.stopPropagation()
          }}
          style={BOX}
        />
      </div>
    ))
    parent.addEventListener("pointerdown", () => parentSaw.push("down"))
    const c = centreOf(el)
    await mouse.down(c)
    await mouse.up(c)
    expect(calls).toEqual(["tapStart"])
    expect(parentSaw, "stopped inside the dispatch").toEqual([])
    // The control: without the stop, the parent hears the same down.
    setStops(false)
    await mouse.down(c)
    await mouse.up(c)
    expect(calls).toEqual(["tapStart", "tapStart"])
    expect(parentSaw).toEqual(["down"])
  })

  it("GC12: a Reorder.Item's drag callbacks, beside its group's, and its onDragTransitionEnd once it lands on its new slot", async () => {
    const calls: Array<string> = []
    const [order, setOrder] = createSignal<ReadonlyArray<string>>(["a", "b", "c"])
    const items: Record<string, HTMLElement> = {}
    render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "absolute", top: "100px", left: "100px", width: "120px" }}>
          <Reorder.Group values={order()} onReorder={setOrder} style={{ "list-style": "none", margin: "0", padding: "0" }}>
            <For each={order()}>
              {(value) => (
                <Reorder.Item
                  value={value}
                  ref={(n: HTMLElement) => (items[value] = n)}
                  onDragStart={(e, info) => calls.push(`start ${value} ${e.type} ${r(info.offset.y)}`)}
                  onDragEnd={(e) => calls.push(`end ${value} ${e.type}`)}
                  onDragTransitionEnd={() => calls.push(`rest ${value} ${r(items[value]!.getBoundingClientRect().top)}`)}
                  style={{ height: "40px", background: "teal", "user-select": "none" }}
                >
                  {value}
                </Reorder.Item>
              )}
            </For>
          </Reorder.Group>
        </div>
      </WardicProvider>
    ))
    await settle()
    const last = r(items.c!.getBoundingClientRect().top)
    const g = centreOf(items.a!)
    await mouse.down(g)
    await glide(g, add(g, 0, 90), 9)
    await mouse.up(add(g, 0, 90))
    await until(() => calls.length > 2, 3000)
    await frames(10)
    expect(order(), "the group reordered").toEqual(["b", "c", "a"])
    expect(calls).toEqual(["start a pointermove 10", "end a pointerup", `rest a ${last}`])
  })

  it("GC13: onPanSessionStart at the down, onPanStart, onPan (its start and each move) and onPanEnd; nothing moves", async () => {
    const calls: Array<string> = []
    const el = await mount((ref) => (
      <wardic.div
        ref={ref}
        onPanSessionStart={(e, info) => calls.push(seen("session", e, info))}
        onPanStart={(e, info) => calls.push(seenDrag("start", e, info))}
        onPan={(e, info) => calls.push(seenDrag("pan", e, info))}
        onPanEnd={(e, info) => calls.push(seenDrag("end", e, info))}
        style={BOX}
      />
    ))
    const box = el.getBoundingClientRect()
    const c = centreOf(el)
    await mouse.down(c)
    await glide(c, add(c, 0, 60), 3)
    await mouse.up(add(c, 0, 60))
    await frames(2)
    expect(calls).toEqual([
      `session pointerdown true ${at(c)}`,
      `start pointermove true ${at(add(c, 0, 20))} off 0,20 d 0`,
      `pan pointermove true ${at(add(c, 0, 20))} off 0,20 d 0`,
      `pan pointermove true ${at(add(c, 0, 40))} off 0,40 d 0`,
      `pan pointermove true ${at(add(c, 0, 60))} off 0,60 d 0`,
      // Playwright moves to the release's point first: a move that goes nowhere.
      `pan pointermove true ${at(add(c, 0, 60))} off 0,60 d 0`,
      `end pointerup true ${at(add(c, 0, 60))} off 0,60 d 0`,
    ])
    expect(el.getBoundingClientRect().top, "a pan moves nothing").toBe(box.top)
  })

  it("GC14: a press that never passed the threshold: its session only, no onPanEnd", async () => {
    const calls: Array<string> = []
    const el = await mount((ref) => (
      <wardic.div ref={ref} onPanSessionStart={() => calls.push("session")} onPanStart={() => calls.push("start")} onPanEnd={() => calls.push("end")} style={BOX} />
    ))
    const c = centreOf(el)
    await mouse.down(c)
    await mouse.move(add(c, 2, 0))
    await mouse.up(add(c, 2, 0))
    await frames(2)
    expect(calls).toEqual(["session"])
  })

  it("GC15: a pan that started is a drag for the press it took over: no tap, on the element or a card inside; a wobble taps", async () => {
    const calls: Array<string> = []
    let card!: HTMLElement
    const el = await mount((ref) => (
      <wardic.div ref={ref} onPan={() => {}} onTap={() => calls.push("row tap")} onTapCancel={() => calls.push("row cancel")} style={{ ...BOX, width: "200px" }}>
        <wardic.div
          ref={(n: HTMLElement) => (card = n)}
          onTap={() => calls.push("card tap")}
          onTapCancel={() => calls.push("card cancel")}
          style={{ width: "40px", height: "40px", background: "white" }}
        />
      </wardic.div>
    ))
    // A swipe on the row, let go over the row.
    const c = centreOf(el)
    await mouse.down(c)
    await glide(c, add(c, 60, 0), 4)
    await mouse.up(add(c, 60, 0))
    // A swipe that starts on a card and ends over it.
    const k = centreOf(card)
    await mouse.down(k)
    await glide(k, add(k, 12, 0), 3)
    await glide(add(k, 12, 0), k, 3)
    await mouse.up(k)
    await frames(2)
    expect(calls, "no tap after a pan").toEqual([])
    // A wobble under the threshold is still a tap.
    await mouse.down(k)
    await mouse.move(add(k, 2, 0))
    await mouse.up(add(k, 2, 0))
    expect(calls).toEqual(["card tap", "row tap"])
  })

  it("GC16: no hover starts while a pan is on", async () => {
    const calls: Array<string> = []
    let other!: HTMLElement
    const el = await mount((ref) => (
      <>
        <wardic.div ref={ref} onPan={() => {}} style={BOX} />
        <wardic.div ref={(n: HTMLElement) => (other = n)} onHoverStart={() => calls.push("hover")} style={{ ...BOX, "margin-top": "20px" }} />
      </>
    ))
    const c = centreOf(el)
    const o = centreOf(other)
    await mouse.down(c)
    await glide(c, o, 5)
    await frames(2)
    expect(calls, "mid-pan, over the other").toEqual([])
    await mouse.up(o)
    await mouse.move(PARK)
    await mouse.move(o)
    expect(calls, "after it").toEqual(["hover"])
  })

  it("GC17: a pan callback set after mount starts the pan recognizer then", async () => {
    const calls: Array<string> = []
    const [listening, setListening] = createSignal(false)
    const config = (): WardConfig =>
      Bool.match(listening(), { onTrue: () => ({ onPanSessionStart: () => calls.push("session") }), onFalse: () => ({}) })
    const el = await mount((ref) => {
      function C() {
        const ward = createWard(config)
        return <div {...ward({ ref })} style={BOX} />
      }
      return <C />
    })
    const c = centreOf(el)
    await mouse.down(c)
    await mouse.up(c)
    expect(calls, "no recognizer yet").toEqual([])
    setListening(true)
    await settle()
    await mouse.down(c)
    await mouse.up(c)
    expect(calls).toEqual(["session"])
    // Unset and set again: started once, so each down is one session.
    setListening(false)
    await settle()
    setListening(true)
    await settle()
    await mouse.down(c)
    await mouse.up(c)
    expect(calls).toEqual(["session", "session"])
  })

  it("GC18: nothing before the lock; then onDirectionLock, onDragStart and onDrag, on that axis alone", async () => {
    const calls: Array<string> = []
    const el = await mount((ref) => (
      <wardic.div
        ref={ref}
        drag
        dragDirectionLock
        dragMomentum={false}
        onDirectionLock={(axis) => calls.push(`lock ${axis}`)}
        onDragStart={(_e, info) => calls.push(`start ${r(info.offset.x)},${r(info.offset.y)}`)}
        onDrag={(_e, info) => calls.push(`drag ${r(info.offset.x)},${r(info.offset.y)}`)}
        style={BOX}
      />
    ))
    const box = el.getBoundingClientRect()
    const c = centreOf(el)
    await mouse.down(c)
    await mouse.move(add(c, 4, 10))
    await frames(2)
    expect(calls, "10 px down: not locked yet").toEqual([])
    expect(el.getBoundingClientRect().top, "unmoved").toBe(box.top)
    await glide(add(c, 4, 10), add(c, 12, 40), 3)
    await mouse.up(add(c, 12, 40))
    await frames(2)
    expect(calls.slice(0, 4)).toEqual(["lock y", "start 0,20", "drag 0,20", "drag 0,30"])
    const after = el.getBoundingClientRect()
    expect(r(after.top - box.top), "on y").toBe(40)
    expect(after.left, "not on x").toBe(box.left)
  })

  it("GC19: a card that drags sideways in a sheet that drags down, both locked: each takes its own swipe", async () => {
    const calls: Array<string> = []
    let card!: HTMLElement
    const sheet = await mount((ref) => (
      <wardic.div ref={ref} drag="y" dragDirectionLock dragMomentum={false} onDragStart={() => calls.push("sheet start")} style={{ ...BOX, width: "200px", height: "160px" }}>
        <wardic.div
          ref={(n: HTMLElement) => (card = n)}
          drag="x"
          dragDirectionLock
          dragMomentum={false}
          whileDrag={{ opacity: 0.5 }}
          onDragStart={() => calls.push("card start")}
          style={{ width: "60px", height: "60px", background: "white" }}
        />
      </wardic.div>
    ))
    const sheetTop = sheet.getBoundingClientRect().top
    const cardLeft = card.getBoundingClientRect().left
    // Sideways: the card.
    const k = centreOf(card)
    await mouse.down(k)
    await glide(k, add(k, 40, 3), 8)
    await mouse.up(add(k, 40, 3))
    await frames(4)
    expect(calls).toEqual(["card start"])
    expect(r(card.getBoundingClientRect().left - cardLeft)).toBe(40)
    expect(sheet.getBoundingClientRect().top, "the sheet stays").toBe(sheetTop)
    // Down, from the card: the sheet; the card's drag never starts, so no whileDrag either.
    await until(() => Number(getComputedStyle(card).opacity) === 1, 2000)
    expect(Number(getComputedStyle(card).opacity), "back from its own drag's whileDrag").toBe(1)
    const k2 = centreOf(card)
    const opacities: Array<number> = []
    await mouse.down(k2)
    for (const step of [1, 2, 3, 4, 5, 6, 7, 8]) {
      await mouse.move(add(k2, 2, step * 5))
      opacities.push(Number(getComputedStyle(card).opacity))
    }
    await mouse.up(add(k2, 2, 40))
    await frames(4)
    expect(calls).toEqual(["card start", "sheet start"])
    expect(r(sheet.getBoundingClientRect().top - sheetTop)).toBe(40)
    expect(Math.min(...opacities), "no whileDrag on the card").toBe(1)
  })

  it("GC20: a locked drag leaves the axis it doesn't move where it is, even outside its constraints", async () => {
    const el = await mount((ref) => (
      <wardic.div
        ref={ref}
        drag
        dragDirectionLock
        dragMomentum={false}
        dragConstraints={{ left: -100, right: 100, top: 0, bottom: 0 }}
        initial={{ y: 80 }}
        animate={{ y: 80 }}
        style={BOX}
      />
    ))
    const box = el.getBoundingClientRect()
    const c = centreOf(el)
    await mouse.down(c)
    await glide(c, add(c, 40, 2), 8)
    await mouse.up(add(c, 40, 2))
    await frames(4)
    const after = el.getBoundingClientRect()
    expect(r(after.left - box.left), "on x").toBe(40)
    expect(after.top, "y stays at 80, outside its constraints").toBe(box.top)
  })
})
