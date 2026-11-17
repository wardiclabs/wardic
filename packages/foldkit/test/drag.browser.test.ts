// The Foldkit drag and pan (#793, PR 2): `w.Drag` on a `w.*` element, dom's drag track driven by the
// binding, its options read as the track starts (Q6), its callbacks as Messages (ADR-0071 decision 23,
// ADR-0047's `(event, info)`), `w.DragConstraints` in Foldkit's forms (Q7), `DragControls.make()` and
// the `StartsDrag` element (Q8), the pan callbacks (Q9) and the drag defaults (Q10). Each fixture pins
// what the binding owns; the track and the recognizers are dom's, tested with Solid's. Drags are pushed
// with their own timestamps (Solid's pushed pointer), the first with the browser's own mouse.
//
// - D1: `OnDragStart`, `OnDrag` at each move and `OnDragEnd` send a Message each, in order, with the
//   DOM's event and the drag's info (its offset from the down, its point in the viewport), and the
//   element follows the pointer on its axis; `DragMomentum(false)` rests it where it was dropped.
// - D2: a press a drag takes over is neither a tap nor a cancel (ADR-0047): `OnTapStart` at the down,
//   then the drag's Messages alone; `WhileTap` stays on through the drag and goes off at the release.
// - D3: `WhileDrag` applies from the drag's start to the end of its release, and its name reaches the
//   element's Variant children (#291); pushed input, with the gesture's own timestamps.
// - D4: `DragConstraints` in each form (Q7): a box of pixels, `"parent"`, a selector resolved under the
//   view at each measure, and `false`; a hard clamp with `DragElastic(0)`.
// - D5: `OnMeasureDragConstraints` adjusts the bounds measured against the container, a plain function.
// - D6: the rubber band past an edge, Motion's 0.35 by default, and the spring back to it on release;
//   `DragSnapToOrigin` springs back to where it started.
// - D7: `DragControls.make()`, `w.DragControls` and the `StartsDrag` element (Q8): with
//   `DragListener(false)` a press on the element itself drags nothing; a press on the `StartsDrag`
//   element drags it, `OnDragStart` sent; `snapToCursor` puts its centre under the pointer at the press.
// - D10: the pan (Q9): `OnPanSessionStart` at the down with its point, `OnPanStart` past the threshold,
//   `OnPan` at its start and each move, `OnPanEnd` at the release, with the pan's info; nothing moves.
// - D12: `transformPagePoint` (Q9) on `w.Config` and on the Handle's `config`: the drag's points are
//   mapped, so the element moves half as far.
// - D8: the controls' `stop()` ends the drag as a release would (`OnDragEnd`, `WhileDrag` off, the
//   spring back to the origin); `cancel()` ends it where it is, with no `OnDragEnd` and no release.
// - D9: `DragDirectionLock`: nothing before 10 px on one axis, then `OnDirectionLock` with that axis
//   before `OnDragStart`, and the element moves on that axis alone.
// - D11: the drag defaults (Q10; ADR-0019 *Amendment (Reorder)*) at the track's start: `touch-action`
//   for the axis, `user-select: none` and `draggable="false"`, under the element's own `h.Style`; none
//   with `DragListener(false)`.
// - D13: of nested draggables the innermost drags (a **Drag claim**); with `DragPropagation` both do.
// - D14: a render that gives `x` a new target mid-release takes it over (#340): the release stops,
//   untold, and the spring goes on to the target.
// - D15: `OnDragTransitionEnd` once at the release with no momentum; once a Fling comes to rest,
//   past where it was dropped, with momentum.
// - D16: `Layout` and `Drag` (ADR-0016): the drag moves the projection, and the element returns to
//   its slot on release.
// - D17: without `Features.drag`, `w.Drag` is a type error naming the Feature and does nothing, said
//   once in development; a `drag` load arriving starts the track, driving the layout node a `layout`
//   from the same load made.
// - D18: an `OnDrag` that throws at every move is reported at its run's first (#257 item 4), and the
//   drag goes on to its end.
import { DomLive } from "@wardic/dom"
import * as Bool from "effect/Boolean"
import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { afterEach, describe, expect, it } from "vitest"
import * as DragControls from "@wardic/foldkit/DragControls"
import * as Features from "@wardic/foldkit/Features"
import * as Wardic from "@wardic/foldkit/Wardic"
import type * as Ward from "@wardic/foldkit/Ward"
import { leftOf, raf, until, waitAtMost } from "../../solid/test/browser-helpers.ts"
import { pushedFling, pushedPointer, type PushedPointer } from "../../solid/test/pushed-pointer.ts"
import { add, glide, wait } from "../../solid/test/real-mouse.ts"
import { boxOf, capture, centreOf, embed, type Embedded, logged, mouse, opacityOf, PARK, type Pt, said, saidTimes } from "./harness.ts"

const Model = Schema.Struct({ on: Schema.Boolean })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Set: { on: Schema.Boolean }, Seen: { call: Schema.String } })
type Message = typeof Message.Type

// What the fixtures' callbacks sent, as `update` heard them.
let calls: Array<string> = []

const update = (model: Model, message: Message) =>
  Message.match(message, {
    Set: ({ on }) => ({ model: { ...model, on } }),
    Seen: ({ call }) => {
      calls.push(call)
      return { model }
    },
  })

/** The builder of a Handle with every DOM Feature: `domMax` has `drag`, `pan` and `layout`. */
type W = Wardic.Html<Message, typeof Features.domMax>

const BOX = { width: "80px", height: "80px", background: "teal", "user-select": "none" } as const

const r = (n: number): number => Math.round(n)
const at = (p: Pt): string => `${r(p.x)},${r(p.y)}`

/** A drag call: its name, the event's type and whether the browser made it, and the info's offset and point. */
const dragged = (name: string, event: Event, info: Ward.DragInfo): string => `${name} ${event.type} ${event.isTrusted} ${at(info.offset)} ${at(info.point)}`

/** `el`'s translate, from its computed transform. */
const translateOf = (el: HTMLElement): Pt => {
  const m = new DOMMatrix(getComputedStyle(el).transform)
  return { x: m.e, y: m.f }
}

const FAST = { type: "tween", duration: 0.05 } as const

/** Wait for `el`'s opacity to land on `value`, then check it did. */
const landsAt = async (el: HTMLElement, value: number, what: string): Promise<void> => {
  await until(() => opacityOf(el) === value, 2000, what)
  expect(opacityOf(el), what).toBe(value)
}

/** Where a pushed drag presses: any point, since a pushed event reaches the element whatever its target. */
const DOWN: Pt = { x: 140, y: 140 }

/** A pushed drag along x from {@link DOWN}: the down, `moves` of `by` px 20 ms apart, each painted; the pointer stays down. */
const pushDrag = async (pointer: PushedPointer, moves: number, by: number): Promise<Pt> => {
  pointer.push("down", DOWN, 0)
  for (let k = 1; k <= moves; k++) {
    pointer.push("move", add(DOWN, by * k, 0), 20)
    await raf()
  }
  return add(DOWN, by * moves, 0)
}

/** A pushed drag of `px` along x in 4 moves, let go 5 ms after the last, with two frames painted after. */
const dragBy = async (pointer: PushedPointer, px: number): Promise<void> => {
  const end = await pushDrag(pointer, 4, px / 4)
  pointer.push("up", end, 5)
  await raf()
  await raf()
}

/** A Handle on a pushed pointer of its own, and `box` embedded with it: one per drag, since the drag's options are read as its track starts. */
const pushedBox = async (box: (w: W, h: HtmlBuilder<Message>) => Html): Promise<{ readonly pointer: PushedPointer; readonly box: HTMLElement }> => {
  const pointer = pushedPointer()
  const wardic = Wardic.make({ env: pointer.env, features: Features.domMax })
  const app = mounted(embedBox(wardic, (_, w, h) => box(w, h)))
  return { pointer, box: await settledBox(app) }
}

/** A box that drags on x with no momentum and a hard clamp, with `attributes` more. */
const clamped = (w: W, h: HtmlBuilder<Message>, attributes: ReadonlyArray<Ward.Attribute>): Html =>
  w.div([h.Id("box"), h.Style(BOX), w.Drag("x"), w.DragMomentum(false), w.DragElastic(0), ...attributes], [])

/** A wrapper 200 px wide around `box`, with a 150 px `#frame` over its left part: what `"parent"` and `"#frame"` constrain to. */
const framed = (h: HtmlBuilder<Message>, box: Html): Html =>
  h.div([h.Id("parent"), h.Style({ position: "relative", width: "200px", height: "80px" })], [
    h.div([h.Id("frame"), h.Style({ position: "absolute", top: "0", left: "0", width: "150px", height: "80px" })], []),
    box,
  ])

/** A program whose view is `box` at (100, 100) on the page, embedded; `wardic` is the test's Handle, with Features `F`. */
const embedBox = <F>(wardic: Wardic.Handle<F>, box: (model: Model, w: Wardic.Html<Message, F>, h: HtmlBuilder<Message>) => Html): Embedded<boolean> =>
  embed<Model, Message, boolean>({
    Model,
    Set: Schema.Boolean,
    init: { on: false },
    update,
    view: (model, h) => h.div([h.Id("wrap"), h.Style({ position: "absolute", top: "100px", left: "100px" })], [box(model, wardic.html(h), h)]),
    toMessage: (on) => Message.Set({ on }),
  })

/** The `#box` of `app`, once it renders and two frames have passed: what mounts with it (the track's listeners) is in place. */
const settledBox = async (app: Pick<Embedded<never>, "container">): Promise<HTMLElement> => {
  const box = await boxOf(app)
  await raf()
  await raf()
  return box
}

let apps: Array<Embedded<boolean>> = []
const mounted = (app: Embedded<boolean>): Embedded<boolean> => {
  apps.push(app)
  return app
}

afterEach(async () => {
  apps.forEach((app) => app.dispose())
  apps = []
  calls = []
  await mouse.move(PARK)
})

describe("a w.* element's drag (#793, PR 2; ADR-0004)", () => {
  it("D1: OnDragStart, OnDrag and OnDragEnd send a Message each with the DOM's event and the drag's info, and the element follows the pointer on its axis", async () => {
    const wardic = Wardic.make({ env: DomLive, features: Features.domMax })
    const app = mounted(
      embedBox(wardic, (_, w, h) =>
        w.div(
          [
            h.Id("box"),
            h.Style(BOX),
            w.Drag("x"),
            w.DragMomentum(false),
            w.OnDragStart((event, info) => Message.Seen({ call: dragged("start", event, info) })),
            w.OnDrag((event, info) => Message.Seen({ call: dragged("drag", event, info) })),
            w.OnDragEnd((event, info) => Message.Seen({ call: dragged("end", event, info) })),
          ],
          [],
        )),
    )
    const box = await settledBox(app)
    const c = centreOf(box)
    await mouse.down(c)
    // Four moves of 15 px: the first starts the drag (past the 3 px threshold), the rest move it.
    await glide(c, add(c, 60, 0), 4)
    await mouse.up(add(c, 60, 0))
    await until(() => calls.some((call) => call.startsWith("end")), 2000, "the end's Message")
    // The browser's `up` moves the pointer to its point first, a move the drag hears again: one of a pair.
    const distinct = calls.filter((call, i) => i === 0 || call !== calls[i - 1])
    expect(distinct, "a Message per callback, in order, with the browser's event and the offset from the down").toEqual([
      `start pointermove true 15,0 ${at(add(c, 15, 0))}`,
      `drag pointermove true 15,0 ${at(add(c, 15, 0))}`,
      `drag pointermove true 30,0 ${at(add(c, 30, 0))}`,
      `drag pointermove true 45,0 ${at(add(c, 45, 0))}`,
      `drag pointermove true 60,0 ${at(add(c, 60, 0))}`,
      `end pointerup true 60,0 ${at(add(c, 60, 0))}`,
    ])
    await raf()
    await raf()
    expect(translateOf(box).x, "rests where it was dropped, with no momentum").toBeCloseTo(60, 0)
    expect(translateOf(box).y, "on its axis alone").toBe(0)
  })

  it("D2: a press a drag takes over is neither a tap nor a cancel: OnTapStart, then the drag's Messages, and WhileTap off", async () => {
    const wardic = Wardic.make({ env: DomLive, features: Features.domMax })
    const app = mounted(
      embedBox(wardic, (_, w, h) =>
        w.div(
          [
            h.Id("box"),
            h.Style(BOX),
            w.Transition(FAST),
            w.Animate({ opacity: 1 }),
            w.WhileTap({ opacity: 0.5 }),
            w.OnTapStart(Message.Seen({ call: "tapStart" })),
            w.OnTap(Message.Seen({ call: "tap" })),
            w.OnTapCancel(Message.Seen({ call: "tapCancel" })),
            w.Drag("x"),
            w.DragMomentum(false),
            w.OnDragStart(Message.Seen({ call: "dragStart" })),
            w.OnDragEnd(Message.Seen({ call: "dragEnd" })),
          ],
          [],
        )),
    )
    const box = await settledBox(app)
    const c = centreOf(box)
    await mouse.down(c)
    await landsAt(box, 0.5, "pressed")
    await glide(c, add(c, 40, 0), 2)
    await until(() => calls.includes("dragStart"), 2000, "the drag's start")
    expect(opacityOf(box), "still pressed while dragged, as Motion's whileTap is").toBe(0.5)
    await mouse.up(add(c, 40, 0))
    await until(() => calls.includes("dragEnd"), 2000, "the drag's end")
    await landsAt(box, 1, "the press ended with the release, as taken: WhileTap off")
    await wait(50)
    expect(calls, "no tap and no cancel for the press the drag took").toEqual(["tapStart", "dragStart", "dragEnd"])
  })

  it("D3: WhileDrag applies while the element is dragged, and its name reaches a Variant child", async () => {
    const pointer = pushedPointer()
    const wardic = Wardic.make({ env: pointer.env, features: Features.domMax })
    const app = mounted(
      embedBox(wardic, (_, w, h) =>
        w.div(
          [
            h.Id("box"),
            h.Style(BOX),
            w.Transition(FAST),
            w.Variants({ idle: { opacity: 1 }, lifted: { opacity: 0.5 } }),
            w.Animate("idle"),
            w.Drag("x"),
            w.DragMomentum(false),
            w.WhileDrag("lifted"),
          ],
          [w.span([h.Id("child"), w.Transition(FAST), w.Variants({ idle: { opacity: 1 }, lifted: { opacity: 0.2 } })], ["child"])],
        )),
    )
    const box = await settledBox(app)
    const child = await boxOf(app, "child")
    const end = await pushDrag(pointer, 3, 20)
    await landsAt(box, 0.5, "lifted while dragged")
    await landsAt(child, 0.2, "the child's own lifted, from the parent's name")
    expect(translateOf(box).x, "followed the pushed pointer").toBeCloseTo(60, 0)
    pointer.push("up", end, 5)
    await landsAt(box, 1, "idle again once let go")
    await landsAt(child, 1, "the child back too")
    expect(translateOf(box).x, "rests where it was dropped").toBeCloseTo(60, 0)
  })

  it("D4: DragConstraints as a box, as the parent, as a selector resolved under the view, and off", async () => {
    const box = await pushedBox((w, h) => clamped(w, h, [w.DragConstraints({ left: -20, right: 30 })]))
    await dragBy(box.pointer, 60)
    expect(translateOf(box.box).x, "a box of pixels: clamped at its right edge").toBeCloseTo(30, 0)

    const parent = await pushedBox((w, h) => framed(h, clamped(w, h, [w.DragConstraints("parent")])))
    await dragBy(parent.pointer, 200)
    expect(translateOf(parent.box).x, "inside its 200 px parent: 120 px of room").toBeCloseTo(120, 0)

    const selected = await pushedBox((w, h) => framed(h, clamped(w, h, [w.DragConstraints("#frame")])))
    await dragBy(selected.pointer, 200)
    expect(translateOf(selected.box).x, "inside the 150 px #frame: 70 px of room").toBeCloseTo(70, 0)

    const free = await pushedBox((w, h) => framed(h, clamped(w, h, [w.DragConstraints(false)])))
    await dragBy(free.pointer, 200)
    expect(translateOf(free.box).x, "none: wherever the pointer went").toBeCloseTo(200, 0)
  })

  it("D5: OnMeasureDragConstraints adjusts the bounds measured against the container", async () => {
    const measured: Array<string> = []
    const { pointer, box } = await pushedBox((w, h) =>
      framed(
        h,
        clamped(w, h, [
          w.DragConstraints("parent"),
          w.OnMeasureDragConstraints((bounds) => {
            measured.push(`${bounds.left}..${bounds.right}`)
            return { ...bounds, right: bounds.right - 20 }
          }),
        ]),
      ))
    await dragBy(pointer, 200)
    expect(measured, "measured at the drag's start, with the parent's 120 px of room").toContain("0..120")
    expect(translateOf(box).x, "20 px less, as the function said").toBeCloseTo(100, 0)
  })

  it("D6: the rubber band past an edge, and the spring back to it; DragSnapToOrigin springs back to the start", async () => {
    const banded = await pushedBox((w, h) => w.div([h.Id("box"), h.Style(BOX), w.Drag("x"), w.DragMomentum(false), w.DragConstraints({ left: 0, right: 0 })], []))
    const end = await pushDrag(banded.pointer, 4, 25)
    expect(translateOf(banded.box).x, "100 px past the edge, pulled back by 0.35: Motion's dragElastic").toBeCloseTo(35, 0)
    banded.pointer.push("up", end, 5)
    await until(() => Math.abs(translateOf(banded.box).x) < 0.5, 2000, "springs back to the edge")

    const snapped = await pushedBox((w, h) => w.div([h.Id("box"), h.Style(BOX), w.Drag("x"), w.DragMomentum(false), w.DragSnapToOrigin()], []))
    const dropped = await pushDrag(snapped.pointer, 4, 15)
    expect(translateOf(snapped.box).x, "followed").toBeCloseTo(60, 0)
    snapped.pointer.push("up", dropped, 5)
    await until(() => Math.abs(translateOf(snapped.box).x) < 0.5, 2000, "springs back to where it started")
  })

  it("D7: the StartsDrag element starts the controls' drag; with DragListener(false) the element's own press drags nothing; snapToCursor", async () => {
    const GRIP = { position: "absolute", top: "100px", left: "0", width: "40px", height: "40px", background: "gray", "touch-action": "none" } as const
    const controlled = (options?: Ward.StartOptions) => {
      const controls = DragControls.make()
      const wardic = Wardic.make({ env: DomLive, features: Features.domMax })
      const app = mounted(
        embedBox(wardic, (_, w, h) =>
          h.div([], [
            w.div([h.Id("grip"), h.Style(GRIP), w.StartsDrag(controls, options)], []),
            w.div([h.Id("box"), h.Style(BOX), w.Drag(), w.DragMomentum(false), w.DragControls(controls), w.DragListener(false), w.OnDragStart(Message.Seen({ call: "dragStart" }))], []),
          ])),
      )
      return app
    }
    const app = controlled()
    const box = await settledBox(app)
    const grip = await boxOf(app, "grip")
    const c = centreOf(box)
    await mouse.down(c)
    await glide(c, add(c, 40, 0), 4)
    await mouse.up(add(c, 40, 0))
    await wait(100)
    expect(calls, "its own press, with DragListener(false): no drag").toEqual([])
    expect(translateOf(box).x).toBe(0)
    const g = centreOf(grip)
    await mouse.down(g)
    await glide(g, add(g, 40, 20), 4)
    await until(() => calls.includes("dragStart"), 2000, "the grip's press started the drag")
    await mouse.up(add(g, 40, 20))
    await raf()
    await raf()
    expect(translateOf(box), "followed the pointer from the grip, on both axes").toEqual({ x: 40, y: 20 })
    app.dispose()

    const snapping = controlled({ snapToCursor: true })
    const snapBox = await settledBox(snapping)
    const snapGrip = await boxOf(snapping, "grip")
    const s = centreOf(snapGrip)
    await mouse.down(s)
    await raf()
    await raf()
    const centre = centreOf(snapBox)
    expect(centre.x, "its centre under the pointer at the press, before any move").toBeCloseTo(s.x, 0)
    expect(centre.y).toBeCloseTo(s.y, 0)
    await mouse.up(s)
  })

  it("D10: the pan's Messages: the session at the down, the start past the threshold, each move, the end; the element stays", async () => {
    const panned = (name: string, _: Event, info: Ward.DragInfo): string => `${name} ${at(info.offset)}`
    const { pointer, box } = await pushedBox((w, h) =>
      w.div(
        [
          h.Id("box"),
          h.Style(BOX),
          w.OnPanSessionStart((_, info) => Message.Seen({ call: `session ${at(info.point)}` })),
          w.OnPanStart((event, info) => Message.Seen({ call: panned("panStart", event, info) })),
          w.OnPan((event, info) => Message.Seen({ call: panned("pan", event, info) })),
          w.OnPanEnd((event, info) => Message.Seen({ call: panned("panEnd", event, info) })),
        ],
        [],
      ))
    pointer.push("down", DOWN, 0)
    pointer.push("move", add(DOWN, 2, 0), 20)
    pointer.push("move", add(DOWN, 20, 0), 20)
    pointer.push("move", add(DOWN, 40, 0), 20)
    pointer.push("up", add(DOWN, 40, 0), 20)
    await until(() => calls.some((call) => call.startsWith("panEnd")), 2000, "the end's Message")
    expect(calls, "the session with its point, then the start past 3 px and each move with the offset, then the end").toEqual([
      `session ${at(DOWN)}`,
      "panStart 20,0",
      "pan 20,0",
      "pan 40,0",
      "panEnd 40,0",
    ])
    expect(translateOf(box).x, "a pan moves nothing").toBe(0)
  })

  it("D12: transformPagePoint on w.Config, and on the Handle's config, maps the drag's points", async () => {
    const halved = (p: Pt): Pt => ({ x: p.x / 2, y: p.y / 2 })
    const configured = await pushedBox((w, h) => w.div([h.Id("box"), h.Style(BOX), w.Drag("x"), w.DragMomentum(false), w.Config({ transformPagePoint: halved })], []))
    await dragBy(configured.pointer, 60)
    expect(translateOf(configured.box).x, "half as far, through w.Config's mapping").toBeCloseTo(30, 0)

    const pointer = pushedPointer()
    const wardic = Wardic.make({ env: pointer.env, features: Features.domMax, config: { transformPagePoint: halved } })
    const app = mounted(embedBox(wardic, (_, w, h) => w.div([h.Id("box"), h.Style(BOX), w.Drag("x"), w.DragMomentum(false)], [])))
    const box = await settledBox(app)
    await dragBy(pointer, 60)
    expect(translateOf(box).x, "half as far, through the Handle's mapping").toBeCloseTo(30, 0)
  })

  it("D8: stop() ends the drag as a release, cancel() where it is", async () => {
    const lifted = (controls: Ward.DragControls) => (w: W, h: HtmlBuilder<Message>): Html =>
      w.div(
        [
          h.Id("box"),
          h.Style(BOX),
          w.Transition(FAST),
          w.Animate({ opacity: 1 }),
          w.Drag("x"),
          w.DragControls(controls),
          w.DragMomentum(false),
          w.DragSnapToOrigin(),
          w.WhileDrag({ opacity: 0.5 }),
          w.OnDragStart(Message.Seen({ call: "dragStart" })),
          w.OnDragEnd(Message.Seen({ call: "dragEnd" })),
        ],
        [],
      )
    const cancelling = DragControls.make()
    const cancelled = await pushedBox(lifted(cancelling))
    const held = await pushDrag(cancelled.pointer, 3, 20)
    await landsAt(cancelled.box, 0.5, "dragged")
    cancelling.cancel()
    await landsAt(cancelled.box, 1, "WhileDrag off at the cancel")
    await wait(200)
    expect(translateOf(cancelled.box).x, "where it was: no spring back to the origin").toBeCloseTo(60, 0)
    cancelled.pointer.push("up", held, 5)
    await wait(50)
    expect(calls, "no OnDragEnd for a cancelled drag").toEqual(["dragStart"])
    calls = []

    const stopping = DragControls.make()
    const stopped = await pushedBox(lifted(stopping))
    const still = await pushDrag(stopped.pointer, 3, 20)
    await landsAt(stopped.box, 0.5, "dragged")
    stopping.stop()
    await until(() => calls.includes("dragEnd"), 2000, "OnDragEnd at the stop, as a release's")
    await landsAt(stopped.box, 1, "WhileDrag off")
    await until(() => Math.abs(translateOf(stopped.box).x) < 0.5, 2000, "the release's spring back to the origin")
    stopped.pointer.push("move", add(still, 40, 0), 20)
    await raf()
    expect(translateOf(stopped.box).x, "the pointer moves it no more").toBeCloseTo(0, 0)
    stopped.pointer.push("up", add(still, 40, 0), 5)
  })

  it("D9: DragDirectionLock: OnDirectionLock with the axis before OnDragStart, and the element moves on that axis alone", async () => {
    const { pointer, box } = await pushedBox((w, h) =>
      w.div(
        [
          h.Id("box"),
          h.Style(BOX),
          w.Drag(),
          w.DragMomentum(false),
          w.DragDirectionLock(),
          w.OnDirectionLock((axis) => Message.Seen({ call: `lock ${axis}` })),
          w.OnDragStart(Message.Seen({ call: "dragStart" })),
        ],
        [],
      ))
    pointer.push("down", DOWN, 0)
    pointer.push("move", add(DOWN, 6, 2), 20)
    await raf()
    expect(calls, "nothing before 10 px").toEqual([])
    pointer.push("move", add(DOWN, 14, 2), 20)
    await until(() => calls.includes("dragStart"), 2000, "the start at the lock")
    expect(calls, "the lock first, then the start").toEqual(["lock x", "dragStart"])
    pointer.push("move", add(DOWN, 40, 50), 20)
    await raf()
    await raf()
    expect(translateOf(box).x, "moves on x").toBeCloseTo(40, 0)
    expect(translateOf(box).y, "never on y").toBe(0)
    pointer.push("up", add(DOWN, 40, 50), 5)
  })

  it("D11: the drag defaults at the track's start, under the element's own style; none with DragListener(false)", async () => {
    const PLAIN = { width: "80px", height: "80px", background: "teal" } as const
    const styled = (h: HtmlBuilder<Message>, w: W, attributes: ReadonlyArray<Ward.Attribute>, style: Record<string, string> = {}) =>
      w.div([h.Id("box"), h.Style({ ...PLAIN, ...style }), w.Drag("x"), ...attributes], [])
    const wardic = Wardic.make({ env: DomLive, features: Features.domMax })
    const dragged = await settledBox(mounted(embedBox(wardic, (_, w, h) => styled(h, w, []))))
    expect(dragged.style.touchAction, "pan-y for a drag on x").toBe("pan-y")
    expect(dragged.style.userSelect).toBe("none")
    expect(dragged.getAttribute("draggable")).toBe("false")

    const own = await settledBox(mounted(embedBox(wardic, (_, w, h) => styled(h, w, [], { "touch-action": "manipulation" }))))
    expect(own.style.touchAction, "the element's own h.Style wins").toBe("manipulation")
    expect(own.style.userSelect, "the rest still set").toBe("none")

    const unlistening = await settledBox(mounted(embedBox(wardic, (_, w, h) => styled(h, w, [w.DragListener(false)]))))
    expect(unlistening.style.touchAction, "no defaults for an element its own presses don't drag").toBe("")
    expect(unlistening.hasAttribute("draggable")).toBe(false)
  })

  it("D13: of nested draggables the innermost drags; with DragPropagation both do", async () => {
    const OUTER = { position: "absolute", top: "0", left: "0", width: "200px", height: "200px", background: "lavender" } as const
    const nested = (inner: (w: W) => ReadonlyArray<Ward.Attribute>) => {
      const wardic = Wardic.make({ env: DomLive, features: Features.domMax })
      return mounted(
        embedBox(wardic, (_, w, h) =>
          w.div([h.Id("outer"), h.Style(OUTER), w.Drag("x"), w.DragMomentum(false)], [
            w.div([h.Id("box"), h.Style(BOX), w.Drag("x"), w.DragMomentum(false), ...inner(w)], []),
          ])),
      )
    }
    /** A real drag of 40 px from the inner box's centre: the translate of each box after. */
    const dragInner = async (app: Embedded<boolean>): Promise<{ readonly inner: number; readonly outer: number }> => {
      const inner = await settledBox(app)
      const outer = await boxOf(app, "outer")
      const c = centreOf(inner)
      await mouse.down(c)
      await glide(c, add(c, 40, 0), 4)
      await mouse.up(add(c, 40, 0))
      await raf()
      await raf()
      return { inner: translateOf(inner).x, outer: translateOf(outer).x }
    }
    const claimed = await dragInner(nested(() => []))
    expect(claimed.inner, "the innermost drags").toBeCloseTo(40, 0)
    expect(claimed.outer, "its claim keeps the outer one still").toBe(0)
    await mouse.move(PARK)

    const shared = await dragInner(nested((w) => [w.DragPropagation()]))
    expect(shared.inner, "the inner one drags").toBeCloseTo(40, 0)
    expect(shared.outer, "and the outer one with it: no claim taken").toBeCloseTo(40, 0)
  })

  it("D14: a render that gives x a new target mid-release takes it over: the release stops untold, and the spring goes on to the target", async () => {
    const pointer = pushedPointer()
    const wardic = Wardic.make({ env: pointer.env, features: Features.domMax })
    const app = mounted(
      embedBox(wardic, (model, w, h) =>
        w.div(
          [
            h.Id("box"),
            h.Style(BOX),
            w.Transition(FAST),
            w.Animate(Bool.match(model.on, { onTrue: () => ({ x: 0 }), onFalse: () => ({}) })),
            w.Drag("x"),
            w.OnDragTransitionEnd(Message.Seen({ call: "rest" })),
          ],
          [],
        )),
    )
    const box = await settledBox(app)
    const end = await pushedFling(pointer, { from: DOWN })
    pointer.push("up", end, 5)
    await wait(100)
    expect(translateOf(box).x, "the Fling carries on past the drop").toBeGreaterThan(220)
    app.send(true)
    await until(() => Math.abs(translateOf(box).x) < 0.5, 2000, "the spring to the render's x: 0")
    await wait(200)
    expect(calls, "the release was taken over: its end untold").toEqual([])
  })

  it("D15: OnDragTransitionEnd once at the release with no momentum, and once a Fling comes to rest with it", async () => {
    const resting = (momentum: boolean) => (w: W, h: HtmlBuilder<Message>): Html =>
      w.div([h.Id("box"), h.Style(BOX), w.Drag("x"), w.DragMomentum(momentum), w.DragTransition({ timeConstant: 200 }), w.OnDragTransitionEnd(Message.Seen({ call: "rest" }))], [])
    const still = await pushedBox(resting(false))
    await dragBy(still.pointer, 60)
    await until(() => calls.includes("rest"), 2000, "at the release")
    await wait(100)
    expect(calls, "once").toEqual(["rest"])
    expect(translateOf(still.box).x, "where it was dropped").toBeCloseTo(60, 0)
    calls = []

    const flung = await pushedBox(resting(true))
    const end = await pushedFling(flung.pointer, { from: DOWN })
    flung.pointer.push("up", end, 5)
    await until(() => calls.includes("rest"), 3000, "once the Fling rests")
    expect(translateOf(flung.box).x, "past where it was dropped").toBeGreaterThan(220)
    await wait(100)
    expect(calls, "once").toEqual(["rest"])
  })

  it("D16: Layout and Drag: the drag moves the projection, and the element returns to its slot on release", async () => {
    const { pointer, box } = await pushedBox((w, h) => w.div([h.Id("box"), h.Style(BOX), w.Layout(), w.Drag("x"), w.DragMomentum(false)], []))
    const slot = leftOf(box)
    const end = await pushDrag(pointer, 3, 20)
    expect(leftOf(box) - slot, "moved with the pointer, through its projection").toBeCloseTo(60, 0)
    pointer.push("up", end, 5)
    await until(() => Math.abs(leftOf(box) - slot) < 0.5, 2000, "back on its slot")
  })

  it("D17: without Features.drag, w.Drag is a type error and does nothing, said once; a drag load arriving starts the track on the layout node it brought", async () => {
    const bare = Wardic.make({ env: DomLive })
    const lines = await logged(async () => {
      const app = mounted(
        embedBox(bare, (_, w, h) =>
          // @ts-expect-error `Drag` needs the `drag` Feature, which this Handle wasn't given: `NeedsFeature<"drag">`
          w.div([h.Id("box"), h.Style(BOX), w.Drag("x")], [])),
      )
      const box = await settledBox(app)
      const c = centreOf(box)
      await mouse.down(c)
      await glide(c, add(c, 40, 0), 4)
      await mouse.up(add(c, 40, 0))
      await raf()
      await raf()
      expect(translateOf(box).x, "inert without the Feature").toBe(0)
    })
    expect(saidTimes(lines, "needs the `drag` Feature"), "said once").toBe(1)
    expect(said(lines, "Wardic.make({ env, features: [Features.drag] })"), "in Foldkit's words").toBe(true)
    await mouse.move(PARK)

    const arrival = { resolve: (_: typeof Features.domMax): void => {} }
    const pointer = pushedPointer()
    const lazy = Wardic.make({
      env: pointer.env,
      features: () =>
        new Promise<typeof Features.domMax>((resolve) => {
          arrival.resolve = resolve
        }),
    })
    const captured = capture()
    try {
      const app = mounted(embedBox(lazy, (_, w, h) => w.div([h.Id("box"), h.Style(BOX), w.Layout(), w.Drag("x"), w.DragMomentum(false)], [])))
      const box = await settledBox(app)
      const slot = leftOf(box)
      await dragBy(pointer, 60)
      expect(leftOf(box) - slot, "nothing while the load is on its way").toBe(0)
      expect(said(captured.lines, "needs the `drag` Feature"), "and nothing said").toBe(false)
      arrival.resolve(Features.domMax)
      await waitAtMost(100)
      const end = await pushDrag(pointer, 3, 20)
      expect(leftOf(box) - slot, "drags once the load is here, through the layout node it brought").toBeCloseTo(60, 0)
      pointer.push("up", end, 5)
      await until(() => Math.abs(leftOf(box) - slot) < 0.5, 2000, "back on its slot: the node's release")
    } finally {
      captured.stop()
    }
  })

  it("D18: an OnDrag that throws at every move is reported at its run's first, and the drag goes on to its end", async () => {
    const captured = capture()
    try {
      const { pointer, box } = await pushedBox((w, h) =>
        w.div(
          [
            h.Id("box"),
            h.Style(BOX),
            w.Drag("x"),
            w.DragMomentum(false),
            w.OnDrag(() => {
              throw new Error("boom")
            }),
            w.OnDragEnd(Message.Seen({ call: "dragEnd" })),
          ],
          [],
        ))
      await dragBy(pointer, 80)
      await until(() => calls.includes("dragEnd"), 2000, "the drag's end")
      expect(translateOf(box).x, "the drag went on").toBeCloseTo(80, 0)
      await wait(50)
      expect(saidTimes(captured.lines, "wardic.gesture: onDrag failed"), "one report for the run of throws").toBe(1)
    } finally {
      captured.stop()
    }
  })
})
