// The Foldkit gestures (#793, PR 1): hover, press, focus and in view on a `w.*` element, their
// `While*` entries in the Override stack and their callbacks as Messages (ADR-0071 decision 23,
// ADR-0047's `(event, info)`), with the browser's own mouse and keyboard. Each fixture pins what the
// binding owns; the recognizers are dom's, tested with Solid's.
//
// - G1: `OnHoverStart` and `OnHoverEnd` send a Message each, with the DOM's event and its viewport point.
// - G2: `WhileHover` applies while the pointer is over the element, and leaves when it leaves.
// - G3: `OnTapStart`, then `OnTap` at a release on a child; `OnTapCancel` at a release elsewhere, and
//   no `OnTap`: each with the DOM's event, its viewport point and the pointer as its input.
// - G4: a **Keyboard press** (#427): Enter held turns `WhileTap` on and its release off; `OnTapStart` at
//   the keydown and `OnTap` at the keyup, the keyboard as the input and the element's centre as the
//   point; a pressable `div` is made focusable, a `button` and a given `tabindex` left as they are.
// - G5: at the event (ADR-0047 decision 3): `OnTapStart`'s `stopPropagation()` keeps the down from a
//   parent's listener.
// - G6: `Propagate({ tap: false })` keeps a press to the inner element (a **Press claim**, #439): the
//   outer one's `WhileTap` stays off and it hears nothing; read at each press, so a render that drops
//   it presses both again.
// - G7: `WhileFocus` at a keyboard's focus (`:focus-visible`), not a pointer's click.
// - G8: `WhileInView` applies once the element scrolls into view, and leaves as it scrolls out.
// - G9: `Viewport`'s `root` as a selector, resolved under the view (#793, Q16), and `once`: in view of
//   a scrolling container, from its first entry on.
// - G10: `OnViewportEnter` and `OnViewportLeave` send a Message each with the browser's own entry;
//   an element that starts out of view sends nothing until it enters.
// - G11: a callback a later render adds starts its recognizer then (ADR-0047 decision 5, Motion's features).
// - G12: a parent's `WhileHover` name reaches its Variant children (#291): the child animates to its
//   own `lit` while the parent is hovered, and back.
// - G13: without `Features.hover`, `WhileHover` is a type error naming the Feature, and at runtime does
//   nothing, said once per provider in development.
// - G14: Features loaded lazily (#793, Q2 and Q15): nothing said while the load is on its way, and an
//   element mounted before it arrives hovers once it has.
// - G15: a `layout` load: a `w.Layout` element mounted before it arrives gets its node once it has,
//   and a reorder after that flies.
// - G16: `Viewport`'s `root` as `"parent"`, and `amount: "all"`: half in view isn't in.
// - G17: a load that fails is reported once; the element is inert, and the missing Feature said then.
// - G18: a handler that throws is reported by name, and the gesture goes on: `WhileHover` still applies.
// - G19 (#979 group I, row 26; ADR-0074 decision 3): one that throws at each hover is reported once a run,
//   again after a clean call.
import { DomLive } from "@wardic/dom"
import * as Bool from "effect/Boolean"
import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { afterEach, describe, expect, it } from "vitest"
import { commands, userEvent } from "vitest/browser"
import * as Features from "@wardic/foldkit/Features"
import * as Wardic from "@wardic/foldkit/Wardic"
import type * as Ward from "@wardic/foldkit/Ward"
import { raf, until, waitAtMost } from "../../solid/test/browser-helpers.ts"
import { at, BOX, capture, centreOf, embed, type Embedded, embedKeyedList, FAST, frames, landsAt, logged, mouse, opacityOf, PARK, said, saidTimes, settledBox } from "./harness.ts"

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

const wardic = Wardic.make({ env: DomLive, features: Features.domAnimation })

/** `el`'s scale, from its computed transform. */
const scaleOf = (el: HTMLElement): number => new DOMMatrix(getComputedStyle(el).transform).a

/** A call: its name, the event's type and whether the browser made it, and the info's point. */
const seen = (name: string, event: Event, info: Ward.PointInfo): string => `${name} ${event.type} ${event.isTrusted} ${at(info.point)}`

/** A press call: {@link seen}, with the info's input before its point. */
const pressed = (name: string, event: Event, info: Ward.PressInfo): string => `${name} ${event.type} ${event.isTrusted} ${info.input} ${at(info.point)}`

/** A program whose view is `box` at (100, 100) on the page, embedded. */
const embedBox = (box: (model: Model, w: Wardic.Html<Message, typeof Features.domAnimation>, h: HtmlBuilder<Message>) => Html): Embedded<boolean> =>
  embed<Model, Message, boolean>({
    Model,
    Set: Schema.Boolean,
    init: { on: false },
    update,
    view: (model, h) => h.div([h.Id("wrap"), h.Style({ position: "absolute", top: "100px", left: "100px", height: "3000px" })], [box(model, wardic.html(h), h)]),
    toMessage: (on) => Message.Set({ on }),
  })

/** Scroll the page so `top` (px down the page) sits `at` px down the window. */
const scrollToShow = (top: number, at: number): void => window.scrollTo(0, top - at)

/** A box 2000 px down its wrapper, which sits 100 px down the page: its top on the page. */
const FAR = 2100

/** A Handle with no Features: its `w.*` take the base attributes alone. */
const bare = Wardic.make({ env: DomLive })

let app: Pick<Embedded<never>, "dispose"> | undefined
afterEach(async () => {
  app?.dispose()
  app = undefined
  calls = []
  window.scrollTo(0, 0)
  await mouse.move(PARK)
})

describe("the gestures on a w.* element (#793)", () => {
  it("G1: OnHoverStart and OnHoverEnd send a Message each, with the DOM's event and its viewport point", async () => {
    const held = embedBox((_model, w, h) =>
      w.div([h.Id("box"), w.OnHoverStart((e, info) => Message.Seen({ call: seen("start", e, info) })), w.OnHoverEnd((e, info) => Message.Seen({ call: seen("end", e, info) })), h.Style(BOX)]),
    )
    app = held
    const box = await settledBox(held)
    const c = centreOf(box)
    await mouse.move(c)
    await until(() => calls.length > 0, 2000, "the start's Message")
    await mouse.move(PARK)
    await until(() => calls.length > 1, 2000, "the end's Message")
    expect(calls).toEqual([`start pointerenter true ${at(c)}`, `end pointerleave true ${at(PARK)}`])
  })

  it("G2: WhileHover applies while the pointer is over the element, and leaves when it leaves", async () => {
    const held = embedBox((_model, w, h) => w.div([h.Id("box"), w.Initial({ opacity: 0.2 }), w.Animate({ opacity: 0.2 }), w.WhileHover({ opacity: 1 }), w.Transition(FAST), h.Style(BOX)]))
    app = held
    const box = await settledBox(held)
    expect(opacityOf(box), "at rest").toBe(0.2)
    await mouse.move(centreOf(box))
    await landsAt(box, 1, "hovered")
    await mouse.move(PARK)
    await landsAt(box, 0.2, "left")
  })

  it("G3: OnTapStart, then OnTap at a release on a child; OnTapCancel at a release elsewhere", async () => {
    const held = embedBox((_model, w, h) =>
      w.div(
        [
          h.Id("box"),
          w.OnTapStart((e, info) => Message.Seen({ call: pressed("tapStart", e, info) })),
          w.OnTap((e, info) => Message.Seen({ call: pressed("tap", e, info) })),
          w.OnTapCancel((e, info) => Message.Seen({ call: pressed("cancel", e, info) })),
          h.Style(BOX),
        ],
        [h.span([h.Id("child"), h.Style({ display: "block", width: "20px", height: "20px", background: "white" })])],
      ),
    )
    app = held
    const box = await settledBox(held)
    const c = centreOf(box)
    const onChild = centreOf(box.querySelector("#child")!)
    await mouse.down(c)
    await mouse.up(onChild)
    await until(() => calls.length > 1, 2000, "the tap's Messages")
    expect(calls).toEqual([`tapStart pointerdown true pointer ${at(c)}`, `tap pointerup true pointer ${at(onChild)}`])
    calls = []
    const off = { x: 260, y: 60 }
    await mouse.down(c)
    await mouse.move(off)
    await mouse.up(off)
    await until(() => calls.length > 1, 2000, "the cancel's Messages")
    expect(calls).toEqual([`tapStart pointerdown true pointer ${at(c)}`, `cancel pointerup true pointer ${at(off)}`])
  })

  it("G4: a Keyboard press: Enter held turns WhileTap on, from the element's centre; a pressable div is made focusable", async () => {
    const held = embedBox((_model, w, h) =>
      h.div([], [
        w.div(
          [
            h.Id("box"),
            w.WhileTap({ scale: 0.8 }),
            w.Transition({ type: "tween", duration: 0.1 }),
            w.OnTapStart((e, info) => Message.Seen({ call: pressed("tapStart", e, info) })),
            w.OnTap((e, info) => Message.Seen({ call: pressed("tap", e, info) })),
            w.OnTapCancel((e, info) => Message.Seen({ call: pressed("cancel", e, info) })),
            h.Style(BOX),
          ],
        ),
        w.button([h.Id("button"), w.WhileTap({ scale: 0.9 })]),
        w.div([h.Id("given"), h.Tabindex(-1), w.WhileTap({ scale: 0.9 })]),
        w.div([h.Id("none"), w.WhileHover({ scale: 1.1 })]),
      ]),
    )
    app = held
    const box = await settledBox(held)
    const tabindex = (id: string): string | null => held.container.querySelector(`#${id}`)!.getAttribute("tabindex")
    expect(["box", "button", "given", "none"].map((id) => `${id} ${tabindex(id)}`)).toEqual(["box 0", "button null", "given -1", "none null"])
    box.focus()
    await userEvent.keyboard("{Enter>}")
    await until(() => scaleOf(box) < 0.81, 3000, "WhileTap on while Enter is held")
    await userEvent.keyboard("{/Enter}")
    await until(() => scaleOf(box) > 0.99, 3000, "off at its release")
    await until(() => calls.length > 1, 2000, "the press's Messages")
    const centre = at(centreOf(box))
    expect(calls).toEqual([`tapStart keydown true keyboard ${centre}`, `tap keyup true keyboard ${centre}`])
  })

  it("G5: at the event: OnTapStart's stopPropagation keeps the down from a parent's listener", async () => {
    const held = embedBox((model, w, h) =>
      w.div(
        [
          h.Id("box"),
          w.OnTapStart((e) => {
            if (model.on) e.stopPropagation()
            return Message.Seen({ call: "tapStart" })
          }),
          h.Style(BOX),
        ],
      ),
    )
    app = held
    const box = await settledBox(held)
    const parentSaw: Array<string> = []
    held.container.querySelector("#wrap")!.addEventListener("pointerdown", () => parentSaw.push("down"))
    const c = centreOf(box)
    held.send(true)
    await raf()
    await mouse.down(c)
    await mouse.up(c)
    await until(() => calls.length > 0, 2000, "the start's Message")
    expect(parentSaw, "stopped inside the dispatch").toEqual([])
    // The control: without the stop, the parent hears the same down.
    held.send(false)
    await raf()
    await mouse.down(c)
    await mouse.up(c)
    await until(() => calls.length > 1, 2000, "the second start's Message")
    expect(parentSaw).toEqual(["down"])
  })

  it("G6: Propagate({ tap: false }) keeps a press to the inner element, read at each press", async () => {
    const held = embedBox((model, w, h) =>
      w.div(
        [h.Id("box"), w.WhileTap({ scale: 0.8 }), w.Transition(FAST), w.OnTapStart(Message.Seen({ call: "outer start" })), w.OnTap(Message.Seen({ call: "outer tap" })), h.Style({ ...BOX, padding: "20px" })],
        [
          w.div([
            h.Id("inner"),
            ...Bool.match(model.on, { onTrue: () => [w.Propagate({ tap: false })], onFalse: () => [] }),
            w.OnTapStart(Message.Seen({ call: "inner start" })),
            w.OnTap(Message.Seen({ call: "inner tap" })),
            h.Style({ width: "40px", height: "40px", background: "white" }),
          ]),
        ],
      ),
    )
    app = held
    const box = await settledBox(held)
    const inner = centreOf(box.querySelector("#inner")!)
    held.send(true)
    await raf()
    await mouse.down(inner)
    await until(() => calls.length > 0, 2000, "the inner start")
    await raf()
    await raf()
    expect(scaleOf(box), "the outer one's WhileTap off").toBe(1)
    await mouse.up(inner)
    await until(() => calls.length > 1, 2000, "the inner tap")
    expect(calls).toEqual(["inner start", "inner tap"])
    // Without the claim, a press on the inner element presses both (Motion's default).
    calls = []
    held.send(false)
    await raf()
    await mouse.down(inner)
    await until(() => scaleOf(box) < 0.85, 2000, "the outer one's WhileTap on")
    await mouse.up(inner)
    await until(() => calls.length > 3, 2000, "both taps")
    expect(calls).toEqual(["inner start", "outer start", "inner tap", "outer tap"])
  })

  it("G7: WhileFocus at a keyboard's focus, not a pointer's click", async () => {
    const held = embedBox((_model, w, h) => w.button([h.Id("box"), w.Initial({ opacity: 0.2 }), w.Animate({ opacity: 0.2 }), w.WhileFocus({ opacity: 1 }), w.Transition(FAST), h.Style(BOX)]))
    app = held
    const box = await settledBox(held)
    // A click focuses the button without showing it.
    await mouse.down(centreOf(box))
    await mouse.up(centreOf(box))
    await until(() => document.activeElement === box, 2000, "focused by the click")
    expect(await waitAtMost(300, () => opacityOf(box) > 0.2), "not :focus-visible").toBe(false)
    box.blur()
    await mouse.move(PARK)
    // Tab until it's the button's turn (the first may land on the test frame itself).
    for (let i = 0; i < 5; i++) {
      if (document.activeElement === box) break
      await commands.realKey("press", "Tab")
    }
    expect(document.activeElement, "focused by the keyboard").toBe(box)
    await landsAt(box, 1, "focus-visible")
  })

  it("G8: WhileInView applies once the element scrolls into view, and leaves as it scrolls out", async () => {
    const held = embedBox((_model, w, h) =>
      w.div([h.Id("box"), w.Initial({ opacity: 0.2 }), w.Animate({ opacity: 0.2 }), w.WhileInView({ opacity: 1 }), w.Transition(FAST), h.Style({ ...BOX, position: "absolute", top: "2000px" })]),
    )
    app = held
    const box = await settledBox(held)
    expect(await waitAtMost(300, () => opacityOf(box) > 0.2), "out of view").toBe(false)
    scrollToShow(FAR, 100)
    await landsAt(box, 1, "in view")
    window.scrollTo(0, 0)
    await landsAt(box, 0.2, "out again")
  })

  it("G9: Viewport's root as a selector under the view, and once: in view of a scrolling container, from its first entry on", async () => {
    const held = embedBox((_model, w, h) =>
      h.div([h.Id("scroller"), h.Style({ position: "relative", width: "200px", height: "200px", overflow: "auto" })], [
        h.div([h.Style({ height: "2400px" })]),
        w.div([
          h.Id("box"),
          w.Initial({ opacity: 0.2 }),
          w.Animate({ opacity: 0.2 }),
          w.WhileInView({ opacity: 1 }),
          w.Viewport({ root: "#scroller", once: true }),
          w.Transition(FAST),
          h.Style({ ...BOX, position: "absolute", top: "2000px" }),
        ]),
      ]),
    )
    app = held
    const box = await settledBox(held)
    const scroller = held.container.querySelector<HTMLElement>("#scroller")!
    expect(await waitAtMost(300, () => opacityOf(box) > 0.2), "clipped by its container: out of its view").toBe(false)
    scroller.scrollTop = 1900
    await landsAt(box, 1, "in the container's view")
    scroller.scrollTop = 0
    expect(await waitAtMost(400, () => opacityOf(box) < 1), "once: stays in view").toBe(false)
  })

  it("G10: OnViewportEnter and OnViewportLeave send a Message each with the browser's entry; nothing until it first enters", async () => {
    const told = (name: string) => (entry: IntersectionObserverEntry) => Message.Seen({ call: `${name} ${entry.isIntersecting} ${entry instanceof IntersectionObserverEntry}` })
    const held = embedBox((_model, w, h) => w.div([h.Id("box"), w.OnViewportEnter(told("enter")), w.OnViewportLeave(told("leave")), h.Style({ ...BOX, position: "absolute", top: "2000px" })]))
    app = held
    await settledBox(held)
    expect(await waitAtMost(300, () => calls.length > 0), "out of view at the start: nothing").toBe(false)
    scrollToShow(FAR, 100)
    await until(() => calls.length > 0, 2000, "the entry's Message")
    window.scrollTo(0, 0)
    await until(() => calls.length > 1, 2000, "the leave's Message")
    expect(calls).toEqual(["enter true true", "leave false true"])
  })

  it("G11: a callback a later render adds starts its recognizer then", async () => {
    const held = embedBox((model, w, h) => w.div([h.Id("box"), ...Bool.match(model.on, { onTrue: () => [w.OnHoverStart(Message.Seen({ call: "start" }))], onFalse: () => [] }), h.Style(BOX)]))
    app = held
    const box = await settledBox(held)
    await mouse.move(centreOf(box))
    await mouse.move(PARK)
    expect(await waitAtMost(300, () => calls.length > 0), "no recognizer yet").toBe(false)
    held.send(true)
    await raf()
    await raf()
    await mouse.move(centreOf(box))
    await until(() => calls.length > 0, 2000, "the start's Message")
    expect(calls).toEqual(["start"])
  })

  it("G12: a parent's WhileHover name reaches its Variant children", async () => {
    const variants = { dim: { opacity: 0.2 }, lit: { opacity: 1 } }
    const held = embedBox((_model, w, h) =>
      w.div([h.Id("box"), w.Initial("dim"), w.Animate("dim"), w.WhileHover("lit"), w.Variants(variants), w.Transition(FAST), h.Style({ ...BOX, padding: "20px" })], [
        w.div([h.Id("child"), w.Variants(variants), w.Transition(FAST), h.Style({ width: "40px", height: "40px", background: "white" })]),
      ]),
    )
    app = held
    const box = await settledBox(held)
    const child = box.querySelector<HTMLElement>("#child")!
    await landsAt(child, 0.2, "dim at rest")
    await mouse.move(centreOf(box))
    await landsAt(child, 1, "lit while the parent is hovered")
    await mouse.move(PARK)
    await landsAt(child, 0.2, "dim again")
  })

  it("G13: without Features.hover, WhileHover is a type error and does nothing, said once per provider", async () => {
    const lines = await logged(async () => {
      const held = embed<Model, Message, boolean>({
        Model,
        Set: Schema.Boolean,
        init: { on: false },
        update,
        view: (_model, h) => {
          const w = bare.html(h)
          const box = (id: string): Html =>
            // @ts-expect-error WhileHover needs the Feature: `NeedsFeature<"hover">`
            w.div([h.Id(id), w.Initial({ opacity: 0.2 }), w.Animate({ opacity: 0.2 }), w.WhileHover({ opacity: 1 }), w.Transition(FAST), h.Style(BOX)])
          return h.div([h.Id("wrap"), h.Style({ position: "absolute", top: "100px", left: "100px" })], [box("box"), box("other")])
        },
        toMessage: (on) => Message.Set({ on }),
      })
      app = held
      const box = await settledBox(held)
      await mouse.move(centreOf(box))
      expect(await waitAtMost(400, () => opacityOf(box) > 0.2), "it never hovers").toBe(false)
    })
    const words = lines.filter((line) => line.includes("needs the `hover` Feature"))
    expect(words, "one word for two elements").toHaveLength(1)
    expect(words[0]).toContain("Wardic.make({ env, features: [Features.hover] })")
  })

  it("G14: Features loaded lazily: nothing said while the load is on its way, and an element mounted before it hovers once it's here", async () => {
    let arrive!: () => void
    const load = () =>
      new Promise<typeof Features.domAnimation>((resolve) => {
        arrive = () => resolve(Features.domAnimation)
      })
    const lazy = Wardic.make({ env: DomLive, features: load })
    const held = embed<Model, Message, boolean>({
      Model,
      Set: Schema.Boolean,
      init: { on: false },
      update,
      view: (_model, h) => {
        const w = lazy.html(h)
        return h.div([h.Id("wrap"), h.Style({ position: "absolute", top: "100px", left: "100px" })], [
          w.div([h.Id("box"), w.Initial({ opacity: 0.2 }), w.Animate({ opacity: 0.2 }), w.WhileHover({ opacity: 1 }), w.Transition(FAST), h.Style(BOX)]),
        ])
      },
      toMessage: (on) => Message.Set({ on }),
    })
    app = held
    const box = await settledBox(held)
    const lines = await logged(async () => {
      await mouse.move(centreOf(box))
      expect(await waitAtMost(300, () => opacityOf(box) > 0.2), "not here yet: no hover").toBe(false)
      await mouse.move(PARK)
    })
    expect(lines.filter((line) => line.includes("needs the `hover` Feature")), "nothing said while the load is on its way").toEqual([])
    arrive()
    await raf()
    await raf()
    await mouse.move(centreOf(box))
    await landsAt(box, 1, "hovered, once the Features are here")
  })

  it("G15: a layout load: a w.Layout element mounted before it arrives gets its node once it has, and a reorder after that flies", async () => {
    let arrive!: () => void
    const load = () =>
      new Promise<typeof Features.layout>((resolve) => {
        arrive = () => resolve(Features.layout)
      })
    const lazy = Wardic.make({ env: DomLive, features: load })
    const held = embedKeyedList(lazy, ["a", "b", "c"])
    app = held
    await until(() => held.container.querySelector("#item-c") !== null, 2000, "the list renders")
    const c = held.container.querySelector<HTMLElement>("#item-c")!
    const listTop = (): number => held.container.querySelector("#list")!.getBoundingClientRect().top
    const topOfC = (): number => c.getBoundingClientRect().top - listTop()
    arrive()
    await raf()
    await raf()
    // c to the top: with its node made on the load's arrival, the pass after the patch seeds it back and it flies.
    held.send(["c", "a", "b"])
    await until(() => topOfC() > 40 && topOfC() < 80, 2000, "c seeds back near its old slot and moves")
    await until(() => topOfC() < 0.5, 2000, "c lands at the top")
  })

  it("G16: Viewport's root as the parent, and amount all: half in view isn't in", async () => {
    const held = embedBox((_model, w, h) =>
      h.div([h.Id("scroller"), h.Style({ position: "relative", width: "200px", height: "200px", overflow: "auto" })], [
        h.div([h.Style({ height: "2400px" })]),
        w.div([
          h.Id("box"),
          w.Initial({ opacity: 0.2 }),
          w.Animate({ opacity: 0.2 }),
          w.WhileInView({ opacity: 1 }),
          w.Viewport({ root: "parent", amount: "all" }),
          w.Transition(FAST),
          h.Style({ ...BOX, position: "absolute", top: "2000px" }),
        ]),
      ]),
    )
    app = held
    const box = await settledBox(held)
    const scroller = held.container.querySelector<HTMLElement>("#scroller")!
    // The box's top 160 px down a 200 px root: half of it shows, which "all" doesn't count.
    scroller.scrollTop = 1840
    expect(await waitAtMost(400, () => opacityOf(box) > 0.2), "half in view: not all of it").toBe(false)
    scroller.scrollTop = 1900
    await landsAt(box, 1, "all of it in the parent's view")
  })

  it("G17: a load that fails is reported once; the element is inert, and the missing Feature said then", async () => {
    const load = (): Promise<typeof Features.domAnimation> => Promise.reject(new Error("no features here"))
    const failing = Wardic.make({ env: DomLive, features: load })
    const captured = capture()
    try {
      const held = embed<Model, Message, boolean>({
        Model,
        Set: Schema.Boolean,
        init: { on: false },
        update,
        view: (_model, h) => {
          const w = failing.html(h)
          return h.div([h.Id("wrap"), h.Style({ position: "absolute", top: "100px", left: "100px" })], [
            w.div([h.Id("box"), w.Initial({ opacity: 0.2 }), w.Animate({ opacity: 0.2 }), w.WhileHover({ opacity: 1 }), w.Transition(FAST), h.Style(BOX)]),
          ])
        },
        toMessage: (on) => Message.Set({ on }),
      })
      app = held
      const box = await settledBox(held)
      await until(() => said(captured.lines, "a load of the Handle's Features failed"), 2000, "the load's failure reported")
      await mouse.move(centreOf(box))
      expect(await waitAtMost(400, () => opacityOf(box) > 0.2), "inert").toBe(false)
      await mouse.move(PARK)
      // A later render still wants the hover, now with no load on its way: the missing Feature is said, once.
      held.send(true)
      await until(() => said(captured.lines, "needs the `hover` Feature"), 2000, "the missing Feature said")
    } finally {
      captured.stop()
    }
    expect(captured.lines.filter((line) => line.includes("a load of the Handle's Features failed")), "reported once").toHaveLength(1)
  })

  it("G18: a handler that throws is reported by name, and the gesture goes on", async () => {
    const held = embedBox((_model, w, h) =>
      w.div([
        h.Id("box"),
        w.Initial({ opacity: 0.2 }),
        w.Animate({ opacity: 0.2 }),
        w.WhileHover({ opacity: 1 }),
        w.OnHoverStart(() => {
          throw new Error("boom")
        }),
        w.Transition(FAST),
        h.Style(BOX),
      ]),
    )
    app = held
    const box = await settledBox(held)
    const captured = capture()
    try {
      await mouse.move(centreOf(box))
      await landsAt(box, 1, "hovered, the throw reported")
      await until(() => said(captured.lines, "wardic.gesture: onHoverStart failed"), 2000, "the report, named")
    } finally {
      captured.stop()
    }
  })

  it("G19 (#979 group I, row 26): a handler that throws at each hover is reported once a run, again after a clean call", async () => {
    let breaks = true
    const held = embedBox((_model, w, h) =>
      w.div([
        h.Id("box"),
        w.OnHoverStart(() => {
          if (breaks) throw new Error("boom")
          return Message.Seen({ call: "start" })
        }),
        h.Style(BOX),
      ]),
    )
    app = held
    const box = await settledBox(held)
    const captured = capture()
    const failed = (): number => saidTimes(captured.lines, "wardic.gesture: onHoverStart failed")
    /** The pointer onto the box, and off it. */
    const hover = async (): Promise<void> => {
      await mouse.move(centreOf(box))
      await frames(2)
      await mouse.move(PARK)
      await frames(2)
    }
    try {
      await hover()
      await hover()
      await hover()
      await until(() => failed() > 0, 2000, "the report")
      expect(failed(), "once a run").toBe(1)
      breaks = false
      await hover()
      await until(() => calls.includes("start"), 2000, "the clean start")
      breaks = true
      await hover()
      await until(() => failed() > 1, 2000, "the next run's report")
      expect(failed()).toBe(2)
    } finally {
      captured.stop()
    }
  })
})
