// The Foldkit fixtures' harness (#791, Q11): a program embedded in a container of its own, its Model
// changed through one inbound port (a Subscription turns each value into a Message) and disposed with
// the test. Interactions go through real clicks on the view's elements.
import * as Bool from "effect/Boolean"
import type * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import * as Port from "foldkit/port"
import * as Runtime from "foldkit/runtime"
import * as Subscription from "foldkit/subscription"
import type * as Update from "foldkit/update"

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
export interface Program<Model, Message extends Tagged, Value> {
  readonly Model: Schema.Codec<Model, any, unknown, unknown>
  readonly Set: Schema.Codec<Value, Value>
  readonly init: Model
  readonly update: (model: Model, message: Message) => Update.Return<Model, Message>
  readonly view: (model: Model, h: HtmlBuilder<Message>) => Html
  readonly toMessage: (value: Value) => Message
  /** Foldkit's DevTools on, in time-travel mode, for a replay test: the store comes through `__setDevToolsOverlay`. */
  readonly devTools?: boolean | undefined
}

// Each container's id, counted.
let embedded = 0

/** Embeds `program` in a fresh container appended to the body, run by Foldkit's own runtime (`Runtime.embed`). */
export const embed = <Model, Message extends Tagged, Value>(program: Program<Model, Message, Value>): Embedded<Value> => {
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
    subscriptions: Subscription.make<Model, Message>()(() => ({ set: Port.subscriptionEntry(set, program.toMessage) })),
    ...Bool.match(program.devTools === true, { onTrue: () => ({ devTools: { show: "Always", mode: "TimeTravel" } as const }), onFalse: () => ({}) }),
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
