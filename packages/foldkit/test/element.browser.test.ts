// The Foldkit element (#791, PR 1): a `w.*` under a provider animates its `Animate` target from
// `Initial`, Retargets on a re-render that changes its target and holds through one that doesn't,
// is recreated where a plain element was (the identity stamp, P2), and lands at once in a replay.
import { DomLive } from "@wardic/dom"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { __setDevToolsOverlay, type DevToolsStore, INIT_INDEX } from "foldkit/devtools-host"
import { defineMessageUnion } from "foldkit/message"
import type { MountAction } from "foldkit/mount"
import { afterEach, describe, expect, it } from "vitest"
import * as Wardic from "@wardic/foldkit/Wardic"
import { over, until, waitAtMost } from "../../solid/test/browser-helpers.ts"
import { embed, type Embedded } from "./harness.ts"

const Model = Schema.Struct({ x: Schema.Number })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Set: { x: Schema.Number } })
type Message = typeof Message.Type

const update = (model: Model, message: Message) => Message.match(message, { Set: ({ x }) => ({ model: { ...model, x } }) })

const wardic = Wardic.make({ env: DomLive })

let app: Embedded<number> | undefined
afterEach(() => {
  app?.dispose()
  app = undefined
})

/** The box's inline opacity, as the gate writes it. */
const opacityOf = (el: HTMLElement): number => Number(el.style.opacity)

describe("a w.* element", () => {
  it("animates its Animate target from Initial", async () => {
    app = embed<Model, Message, number>({
      Model,
      Set: Schema.Number,
      init: { x: 0 },
      update,
      view: (_model, h) => {
        const w = wardic.html(h)
        return w.div([w.Provider(), h.Id("box"), w.Initial({ opacity: 0 }), w.Animate({ opacity: 1 }), w.Transition({ duration: 0.3, ease: "linear" }), h.Style({ width: "40px", height: "40px" })])
      },
      toMessage: (x) => Message.Set({ x }),
    })
    await until(() => app?.container.querySelector("#box") !== null, 2000, "the box renders")
    const box = app.container.querySelector<HTMLElement>("#box")!
    // Its Starting style: the view renders it at `initial`, before any frame.
    expect(box.style.opacity).toBe("0")
    const reads = await over(8, () => opacityOf(box))
    // It animates: each frame no less than the last, and well on its way after 8.
    expect(reads.every((o, i) => i === 0 || o >= reads[i - 1]!)).toBe(true)
    expect(reads[reads.length - 1]!).toBeGreaterThan(reads[0]!)
    await until(() => opacityOf(box) === 1, 2000, "it lands at 1")
  })
})

/** The box's left, inside its app. */
const xOf = (app: Pick<Embedded<never>, "container">, box: HTMLElement): number => box.getBoundingClientRect().left - app.container.getBoundingClientRect().left

describe("a re-render", () => {
  it("Retargets the element when its target changes, and holds through one that doesn't", async () => {
    app = embed<Model, Message, number>({
      Model,
      Set: Schema.Number,
      init: { x: 0 },
      update,
      view: (model, h) => {
        const w = wardic.html(h)
        return w.div([w.Provider(), h.Id("box"), w.Initial({ x: 0 }), w.Animate({ x: model.x }), w.Transition({ duration: 0.5, ease: "linear" }), h.Style({ width: "40px", height: "40px" })])
      },
      toMessage: (x) => Message.Set({ x }),
    })
    const held = app
    await until(() => held.container.querySelector("#box") !== null, 2000, "the box renders")
    const box = held.container.querySelector<HTMLElement>("#box")!
    // A render that changes the target Retargets: 0 → 300.
    held.send(300)
    await until(() => xOf(held, box) > 100, 2000, "it moves past 100")
    // One that doesn't (the same target, a fresh config) holds: the tween goes on at its pace, about
    // 600 px/s, where a restart from here would run at about 400 px/s.
    held.send(300)
    const t0 = performance.now()
    const x0 = xOf(held, box)
    const reads = await over(5, () => [performance.now(), xOf(held, box)] as const)
    const [t1, x1] = reads[reads.length - 1]!
    const speed = ((x1 - x0) / (t1 - t0)) * 1000
    expect(speed, "the tween's pace is kept").toBeGreaterThan(480)
    await until(() => xOf(held, box) === 300, 2000, "it lands at 300")
  })
})

describe("the identity stamp", () => {
  it("recreates a w.* element where a plain element was, so its Mount runs (P2)", async () => {
    const Model = Schema.Struct({ on: Schema.Boolean })
    type Model = typeof Model.Type
    const Message = defineMessageUnion({ Turn: { on: Schema.Boolean } })
    type Message = typeof Message.Type
    const app2 = embed<Model, Message, boolean>({
      Model,
      Set: Schema.Boolean,
      init: { on: false },
      update: (model, message) => Message.match(message, { Turn: ({ on }) => ({ model: { ...model, on } }) }),
      view: (model, h) => {
        const w = wardic.html(h)
        // Unkeyed, at the same place: without the stamp, snabbdom keeps the plain node and the `w.div`'s Mount never runs.
        const child = Bool.match(model.on, {
          onTrue: () => w.div([h.Id("box"), w.Initial({ opacity: 0 }), w.Animate({ opacity: 1 }), w.Transition({ duration: 0.3, ease: "linear" })], ["on"]),
          onFalse: () => h.div([h.Id("box")], ["off"]),
        })
        return w.div([w.Provider()], [child])
      },
      toMessage: (on) => Message.Turn({ on }),
    })
    try {
      await until(() => app2.container.querySelector("#box")?.textContent === "off", 2000, "the plain box renders")
      app2.send(true)
      await until(() => app2.container.querySelector("#box")?.textContent === "on", 2000, "the w.div renders")
      const box = app2.container.querySelector<HTMLElement>("#box")!
      await until(() => opacityOf(box) === 1, 2000, "it animates to 1")
    } finally {
      app2.dispose()
    }
  })
})

describe("the bundle", () => {
  it("animates an element w doesn't make, and fuses the element's own Mount", async () => {
    const Model = Schema.Struct({ seen: Schema.Boolean })
    type Model = typeof Model.Type
    const Message = defineMessageUnion({ Seen: {}, Nothing: {} })
    type Message = typeof Message.Type
    const seen: MountAction<Message> = { name: "Mine", f: () => Stream.make(Message.Seen()) }
    const app2 = embed<Model, Message, boolean>({
      Model,
      Set: Schema.Boolean,
      init: { seen: false },
      update: (model, message) => Message.match(message, { Seen: () => ({ model: { seen: true } }), Nothing: () => ({ model }) }),
      view: (model, h) => {
        const w = wardic.html(h)
        return w.div([w.Provider()], [
          h.div([h.Id("box"), ...w.attributes({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.3, ease: "linear" }, mount: seen })], [Bool.match(model.seen, { onTrue: () => "seen", onFalse: () => "unseen" })]),
        ])
      },
      toMessage: () => Message.Nothing(),
    })
    try {
      await until(() => app2.container.querySelector("#box") !== null, 2000, "the box renders")
      const box = app2.container.querySelector<HTMLElement>("#box")!
      await until(() => opacityOf(box) === 1, 2000, "it animates to 1")
      await until(() => box.textContent === "seen", 2000, "the user's Mount ran")
    } finally {
      app2.dispose()
    }
  })
})

describe("DevTools replay", () => {
  it("lands every animation at once (decision 34)", async () => {
    let store: DevToolsStore | undefined
    __setDevToolsOverlay((s) =>
      Effect.sync(() => {
        store = s
      }),
    )
    app = embed<Model, Message, number>({
      Model,
      Set: Schema.Number,
      init: { x: 0 },
      update,
      view: (model, h) => {
        const w = wardic.html(h)
        return w.div([w.Provider(), h.Id("box"), w.Initial({ x: 0 }), w.Animate({ x: model.x }), w.Transition({ duration: 0.5, ease: "linear" }), h.Style({ width: "40px", height: "40px" })])
      },
      toMessage: (x) => Message.Set({ x }),
      devTools: true,
    })
    const held = app
    await until(() => held.container.querySelector("#box") !== null, 2000, "the box renders")
    const box = held.container.querySelector<HTMLElement>("#box")!
    await until(() => store !== undefined, 2000, "the DevTools store is there")
    held.send(300)
    await until(() => xOf(held, box) > 100, 2000, "it moves past 100")
    // Back to the init entry: the view is paused, the historical target (0) is delivered, and the
    // element lands there at once, instead of animating back over 0.5 s.
    await Effect.runPromise(store!.jumpTo(INIT_INDEX))
    const landed = await waitAtMost(100, () => xOf(held, box) === 0)
    expect(landed, "it landed at 0 within 100 ms").toBe(true)
    // Resumed: the live target (300) comes back, animated again.
    await Effect.runPromise(store!.resume)
    await until(() => xOf(held, box) === 300, 2000, "it lands at 300")
    __setDevToolsOverlay(undefined)
  })
})
