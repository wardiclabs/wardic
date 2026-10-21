// A ward's gesture events on Solid 2 (#257, ADR-0046): `next(name)` for Motion's hover, tap and
// drag events, each with the pointer's `point` in the viewport, and `wardRef`, which hands a
// component's ward to its user.
//
// - GX1: `next("hoverStart")` on a ward with no `whileHover` starts the hover recognizer, and
//   resolves at the enter with its point; `next("hoverEnd")` at the leave.
// - GX2: a press: `pressStart` at the down, `tap` at a release on a child of the element.
// - GX3: a release elsewhere on the page is a `tapCancel`, with where it landed.
// - GX4: a press a drag took over is neither a tap nor a cancel; the drag's end comes.
// - GX5: `dragStart` and `dragEnd`: the pointer's point in the viewport, the offset from the down.
// - GX6: a ward that doesn't drag never has a `dragEnd`: it rejects with an `AbortError` at unmount.
// - GX7: with `whileHover` too, one recognizer serves both: the layer applies and the event comes.
// - GX8: `wardRef` hands the component's ward over, on `wardic.div`, `wardic.create(Component)` and
//   `Reorder.Item`, and isn't an attribute of the element.
import { DomLive } from "@wardic/dom"
import { Reorder, type Ward, ward, type WardConfig, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import { createSignal, For } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

// Clear of the page's one mouse, parked at (5, 5) for every browser file.
const BOX = { width: "60px", height: "60px", "margin-top": "120px", "margin-left": "120px" } as const

/** Dispatch a mouse pointer event of `type` on `at`, at the viewport point (x, y). */
const pointer = (at: EventTarget, type: string, x: number, y: number, buttons = 0): void => {
  at.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: x, clientY: y, buttons, button: 0, bubbles: true }))
}

/** Mount `ui` with a ward made from `config` in a component under the provider. */
const mountCard = (config: WardConfig, ui: (card: Ward) => JSX.Element) => {
  let card!: Ward
  const Card = (): JSX.Element => {
    card = ward(config)
    return ui(card)
  }
  const mounted = mount(() => (
    <WardicProvider env={DomLive}>
      <Card />
    </WardicProvider>
  ))
  return { ...mounted, card }
}

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

/**
 * Wait for `promise`, re-dispatching `again` each frame until it resolves: a recognizer a `next`
 * starts attaches its listener asynchronously, so the first events can arrive before it listens.
 */
const retrying = async <A,>(promise: Promise<A>, again: () => void): Promise<A> => {
  let value: { readonly v: A } | undefined
  void promise.then((v) => (value = { v }))
  await until(() => {
    if (value === undefined) again()
    return value !== undefined
  }, 2000)
  expect(value, "it resolved").toBeDefined()
  return value!.v
}

describe("a ward's gesture events on Solid 2 (#257)", () => {
  it("GX1: hoverStart starts the hover recognizer and resolves at the enter; hoverEnd at the leave", async () => {
    let el!: HTMLElement
    const { card } = mountCard({ style: BOX }, (card) => <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />)
    await raf()
    const entered = await retrying(card.next("hoverStart"), () => pointer(el, "pointerenter", 130, 140))
    expect(entered).toEqual({ point: { x: 130, y: 140 } })
    const left = card.next("hoverEnd")
    pointer(el, "pointerleave", 300, 310)
    expect(await left).toEqual({ point: { x: 300, y: 310 } })
  })

  it("GX2: pressStart at the down, tap at a release on a child of the element", async () => {
    let el!: HTMLElement
    let child!: HTMLElement
    const { card } = mountCard({ style: BOX }, (card) => (
      <div {...card} ref={[card, (n: HTMLElement) => (el = n)]}>
        <span ref={(n: HTMLElement) => (child = n)}>x</span>
      </div>
    ))
    await raf()
    // The recognizer starts with the first press event asked for; release each attempt that doesn't take.
    const started = await retrying(card.next("pressStart"), () => {
      pointer(el, "pointerdown", 130, 140, 1)
    })
    expect(started).toEqual({ point: { x: 130, y: 140 } })
    const tapped = card.next("tap")
    pointer(child, "pointerup", 132, 142)
    expect(await tapped).toEqual({ point: { x: 132, y: 142 } })
  })

  it("GX3: a release elsewhere on the page is a tapCancel, with where it landed", async () => {
    let el!: HTMLElement
    const { card } = mountCard({ style: BOX }, (card) => <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />)
    await raf()
    await retrying(card.next("pressStart"), () => pointer(el, "pointerdown", 130, 140, 1))
    const tapped = card.next("tap")
    const cancelled = card.next("tapCancel")
    pointer(document.body, "pointerup", 400, 20)
    expect(await cancelled).toEqual({ point: { x: 400, y: 20 } })
    expect(await settledWithin(tapped, 2), "no tap").toBe(false)
  })

  it("GX4: a press a drag took over is neither a tap nor a cancel; the drag's end comes", async () => {
    let el!: HTMLElement
    const { card } = mountCard({ drag: true, style: BOX }, (card) => <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />)
    await raf()
    await retrying(card.next("pressStart"), () => pointer(el, "pointerdown", 130, 140, 1))
    const tapped = card.next("tap")
    const cancelled = card.next("tapCancel")
    const ended = card.next("dragEnd")
    pointer(el, "pointermove", 150, 140, 1)
    pointer(el, "pointermove", 170, 140, 1)
    pointer(el, "pointerup", 170, 140)
    await ended
    expect(await settledWithin(tapped, 3), "no tap").toBe(false)
    expect(await settledWithin(cancelled, 0), "no cancel").toBe(false)
  })

  it("GX5: dragStart and dragEnd: the pointer's point in the viewport, the offset from the down", async () => {
    let el!: HTMLElement
    const { card } = mountCard({ drag: true, style: BOX }, (card) => <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />)
    await raf()
    const started = card.next("dragStart")
    const ended = card.next("dragEnd")
    pointer(el, "pointerdown", 130, 140, 1)
    pointer(el, "pointermove", 140, 150, 1)
    pointer(el, "pointermove", 160, 165, 1)
    pointer(document.body, "pointerup", 170, 172)
    const start = await started
    expect(start.point).toEqual({ x: 140, y: 150 })
    expect(start.offset).toEqual({ x: 10, y: 10 })
    // At the release, past the last move: the end, not a move.
    const end = await ended
    expect(end.point).toEqual({ x: 170, y: 172 })
    expect(end.offset).toEqual({ x: 40, y: 32 })
    expect(Object.keys(end).sort()).toEqual(["delta", "offset", "point", "velocity"])
  })

  it("GX6: a ward that doesn't drag never has a dragEnd: it rejects with an AbortError at unmount", async () => {
    const { card, unmount } = mountCard({ style: BOX }, (card) => <div {...card} />)
    await raf()
    const ended = card.next("dragEnd")
    expect(await settledWithin(ended, 3)).toBe(false)
    unmount()
    const reason = await ended.then(
      () => "resolved",
      (error: unknown) => (error as DOMException).name,
    )
    expect(reason).toBe("AbortError")
  })

  it("GX7: with whileHover too, one recognizer serves both: the layer applies and the event comes", async () => {
    let el!: HTMLElement
    const { card } = mountCard({ initial: { opacity: 0.2 }, animate: { opacity: 0.2 }, whileHover: { opacity: 1 }, transition: { type: "tween", duration: 0.1 }, style: BOX }, (card) => (
      <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
    ))
    await raf()
    await retrying(card.next("hoverStart"), () => pointer(el, "pointerenter", 130, 140))
    expect((await card.next("settled")).gestures.hover).toBe(true)
    expect(Number(el.style.opacity)).toBe(1)
  })

  it("GX8: wardRef hands the component's ward over, on wardic.div, wardic.create and Reorder.Item", async () => {
    const wards: Record<string, Ward> = {}
    const Plain = (props: { readonly ref?: JSX.Ref<HTMLDivElement>; readonly style?: JSX.CSSProperties | string }): JSX.Element => <div ref={props.ref} style={props.style} />
    const Created = wardic.create(Plain)
    const [values, setValues] = createSignal<ReadonlyArray<string>>(["a"])
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div data-at="div" wardRef={(w) => (wards.div = w)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: "tween", duration: 0.1 }} style={BOX} />
        <Created wardRef={(w) => (wards.created = w)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: "tween", duration: 0.1 }} />
        <Reorder.Group values={values()} onReorder={setValues}>
          <For each={values()}>{(value) => <Reorder.Item value={value} data-at="item" wardRef={(w) => (wards.item = w)} />}</For>
        </Reorder.Group>
      </WardicProvider>
    ))
    expect(Object.keys(wards).sort()).toEqual(["created", "div", "item"])
    // Their entrances, landing through the wards handed over.
    const [div, created] = await Promise.all([wards.div!.next("settled"), wards.created!.next("settled")])
    expect(div.target).toEqual({ opacity: 1 })
    expect(created.target).toEqual({ opacity: 1 })
    expect(typeof wards.item!.settled).toBe("function")
    for (const at of ["div", "item"]) expect(host.querySelector(`[data-at="${at}"]`)!.hasAttribute("wardref"), at).toBe(false)
  })
})
