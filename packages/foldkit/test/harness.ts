// The Foldkit fixtures' harness (#791, Q11): a program embedded in a container of its own, its Model
// changed through one inbound port (a Subscription turns each value into a Message) and disposed with
// the test. Interactions go through real clicks on the view's elements.
import * as Bool from "effect/Boolean"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Layer from "effect/Layer"
import type { Html, HtmlBuilder } from "foldkit/html"
import * as Port from "foldkit/port"
import * as Runtime from "foldkit/runtime"
import * as Subscription from "foldkit/subscription"
import type * as Update from "foldkit/update"
import * as Arr from "effect/Array"
import * as Schema from "effect/Schema"
import { defineMessageUnion } from "foldkit/message"
import { expect, vi } from "vitest"
import type * as Features from "@wardic/foldkit/Features"
import type * as Wardic from "@wardic/foldkit/Wardic"
import { raf, until } from "../../solid/test/browser-helpers.ts"
import { type Pt } from "../../solid/test/real-mouse.ts"

/** An embedded program: the host its view renders in, its one inbound port and its disposal. */
export interface Embedded<Value> {
  /** What holds the view: Foldkit's patch replaces the container itself with the view's root, so queries go through this. */
  readonly container: HTMLElement
  /** Sends `value` in through the port: its Message runs `update`, and the next frame patches the view. */
  readonly send: (value: Value) => void
  readonly dispose: () => void
}

/** A Message, as Foldkit's runtime types them: tagged. */
export interface Tagged {
  readonly _tag: string
}

/** What {@link embed} takes: a program over `Model` and `Message`, and the port's `Set` Schema with its Message. */
export interface Program<Model, Message extends Tagged, Value, R = never> {
  readonly Model: Schema.Codec<Model, any, unknown, unknown>
  readonly Set: Schema.Codec<Value, Value>
  readonly init: Model
  readonly update: (model: Model, message: Message) => Update.Return<Model, Message, R>
  /** The program's `resources` (a Handle's `wardic.resources`), for its Commands. */
  readonly resources?: Layer.Layer<R> | undefined
  readonly view: (model: Model, h: HtmlBuilder<Message>) => Html
  readonly toMessage: (value: Value) => Message
  /** Foldkit's DevTools on, in time-travel mode, for a replay test: the store comes through `__setDevToolsOverlay`. */
  readonly devTools?: boolean | undefined
  /** The program's `viewTransition` predicate (a Handle's `wardic.viewTransition(…)` around the app's). */
  readonly viewTransition?: Runtime.ViewTransitionConfig<Model, Message> | undefined
}

// The browser's own mouse and its points: Solid's Solid-free module (#793), shared with its tests.
export { centreOf, mouse, type Pt } from "../../solid/test/real-mouse.ts"

/** Where the mouse rests between gestures: off every fixture's elements. */
export const PARK: Pt = { x: 5, y: 5 }

/** The console captured: every line logged from now until `stop`. */
export const capture = (): { readonly lines: ReadonlyArray<string>; readonly stop: () => void } => {
  const lines: Array<string> = []
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: Array<unknown>) => {
      lines.push(args.map(String).join(" "))
    }),
  )
  return { lines, stop: () => spies.forEach((spy) => spy.mockRestore()) }
}

/** Every line logged while `run` runs. */
export const logged = async (run: () => Promise<void>): Promise<ReadonlyArray<string>> => {
  const captured = capture()
  try {
    await run()
  } finally {
    captured.stop()
  }
  return captured.lines
}

/** Whether a logged line says `text`. */
export const said = (lines: ReadonlyArray<string>, text: string): boolean => lines.some((line) => line.includes(text))

/** How many logged lines say `text`. */
export const saidTimes = (lines: ReadonlyArray<string>, text: string): number => lines.filter((line) => line.includes(text)).length

/** `el`'s inline opacity, as the gate writes it. */
export const opacityOf = (el: HTMLElement): number => Number(el.style.opacity)

/** The `#id` element of `app`, once it renders. */
export const boxOf = async (app: Pick<Embedded<never>, "container">, id = "box"): Promise<HTMLElement> => {
  await until(() => app.container.querySelector(`#${id}`) !== null, 2000, `#${id} renders`)
  return app.container.querySelector<HTMLElement>(`#${id}`)!
}

/** The `#id` element of `app` (`#box` by default), once it renders and two frames have passed: what mounts with it (a recognizer's or a track's listeners) is in place. */
export const settledBox = async (app: Pick<Embedded<never>, "container">, id = "box"): Promise<HTMLElement> => {
  const box = await boxOf(app, id)
  await raf()
  await raf()
  return box
}

/** The gesture fixtures' box: 80 px square, nothing selectable. */
export const BOX = { width: "80px", height: "80px", background: "teal", "user-select": "none" } as const

/** A 50 ms tween: what a fixture's entries land with. */
export const FAST = { type: "tween", duration: 0.05 } as const

/** Wait for `el`'s opacity to land on `value`, then check it did. */
export const landsAt = async (el: HTMLElement, value: number, what: string): Promise<void> => {
  await until(() => opacityOf(el) === value, 2000, what)
  expect(opacityOf(el), what).toBe(value)
}

/** `p` as a call records it: its coordinates rounded, `"x,y"`. */
export const at = (p: Pt): string => `${Math.round(p.x)},${Math.round(p.y)}`

/** A keyed list's Model: its items, in order. */
export const ListModel = Schema.Struct({ items: Schema.Array(Schema.String) })
export type ListModel = typeof ListModel.Type
/** Its one Message: a new order. */
export const ListMessage = defineMessageUnion({ Items: { items: Schema.Array(Schema.String) } })
export type ListMessage = typeof ListMessage.Type

const ROW = { height: "40px", margin: "0", padding: "0", listStyle: "none" } as const

/**
 * A keyed `#list` whose `#item-<key>` rows are layout elements on `handle`, embedded with `items`: a
 * reorder sent in moves each to its new slot, over 0.3 s, linear.
 */
export const embedKeyedList = <F>(handle: Pick<Wardic.Handle<F>, "html">, items: ReadonlyArray<string>): Embedded<ReadonlyArray<string>> =>
  embed<ListModel, ListMessage, ReadonlyArray<string>>({
    Model: ListModel,
    Set: Schema.Array(Schema.String),
    init: { items },
    update: (model, message) => ListMessage.match(message, { Items: ({ items }) => ({ model: { ...model, items } }) }),
    view: (model, h) => {
      // The Handle has `layout`, given or on its way: its builder's `Layout` is callable.
      const w = handle.html(h) as Wardic.Html<ListMessage, typeof Features.layout>
      return h.ul([h.Id("list"), h.Style({ position: "relative", margin: "0", padding: "0" })], Arr.map(model.items, (key) =>
        w.keyed("li")(key, [h.Id(`item-${key}`), w.Layout(true), w.Transition({ duration: 0.3, ease: "linear" }), h.Style(ROW)], [key])))
    },
    toMessage: (items) => ListMessage.Items({ items }),
  })

// Each container's id, counted.
let embedded = 0

/** Embeds `program` in a fresh container appended to the body, run by Foldkit's own runtime (`Runtime.embed`). */
export const embed = <Model, Message extends Tagged, Value, R = never>(program: Program<Model, Message, Value, R>): Embedded<Value> => {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const container = document.createElement("div")
  // Foldkit's runtime wants an id on its container, for Model preservation across reloads.
  container.id = `app-${embedded++}`
  host.appendChild(container)
  const set = Port.inbound(program.Set)
  const ports = { inbound: { set } } as const
  const element = Runtime.makeElement({
    Model: program.Model,
    init: () => ({ model: program.init }),
    update: program.update,
    view: program.view,
    container,
    ports,
    subscriptions: Subscription.make<Model, Message, R>()(() => ({ set: Port.subscriptionEntry(set, program.toMessage) })),
    ...Bool.match(program.devTools === true, { onTrue: () => ({ devTools: { show: "Always", mode: "TimeTravel" } as const }), onFalse: () => ({}) }),
    ...UndefinedOr.match(program.resources, { onUndefined: () => ({}), onDefined: (resources) => ({ resources }) }),
    ...UndefinedOr.match(program.viewTransition, { onUndefined: () => ({}), onDefined: (viewTransition) => ({ viewTransition }) }),
  })
  const handle = Runtime.embed(element)
  return {
    container: host,
    send: (value) => {
      handle.ports.set.send(value)
    },
    dispose: () => {
      handle.dispose()
      host.remove()
    },
  }
}
