import * as Effect from "effect/Effect"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import * as Mount from "foldkit/mount"
import { LiveValue, Wardic } from "@wardic/foldkit"
import { wardic } from "~/lib/wardic.ts"

// The Live values the view binds, Atoms at module scope: where the dot sits. The field's Mount feeds them.
const x = Atom.make(0)
const y = Atom.make(0)

const Message = defineMessageUnion({ Following: {} })
type Message = typeof Message.Type

/** Each value of `from`, written into `into`, until the Scope ends. */
const feed = <A>(from: Atom.Atom<A>, into: Atom.Writable<A, A>) =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry
    const stop = registry.subscribe(from, (value) => registry.set(into, value), { immediate: true })
    yield* Effect.addFinalizer(() => Effect.sync(stop))
  })

/**
 * The field's Mount: the pointer over it as Live values (`Wardic.pointer`), set within the pointer's own
 * events, and two springs that follow it, run on the Handle's services (`Wardic.provide`) while the field
 * is on the page. Its Message tells `update` it has started; nothing listens.
 */
const Follow = Mount.define("Follow", {
  messages: [Message.Following],
  execute: ({ element }) =>
    Effect.provide(
      Wardic.provide(
        Effect.gen(function* () {
          const pointer = yield* Wardic.pointer(element)
          const springX = yield* LiveValue.spring(Atom.map(pointer.x, (at) => at - 20), { stiffness: 300, damping: 20 })
          const springY = yield* LiveValue.spring(Atom.map(pointer.y, (at) => at - 20), { stiffness: 300, damping: 20 })
          yield* feed(springX, x)
          yield* feed(springY, y)
          return Message.Following()
        }),
      ),
      wardic.resources,
    ),
})

/** A dot that follows the pointer: the pointer sets two Atoms, and two springs follow them. */
export const view = (h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  return h.div([h.Class("sample-field"), h.OnMount(Follow())], [w.div([h.Class("sample-dot"), w.Style({ x, y })])])
}
