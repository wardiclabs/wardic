/**
 * DomLive is client-only, and says so (ADR-0021, decision 7). A server render builds no
 * runtime, so building a DomLive Layer on a server is always a mistake: each Layer that
 * needs a browser global checks for it as its build starts, and fails with one message
 * naming the Layer, the global and the rule, instead of a `ReferenceError` from deep
 * inside the build.
 *
 * Read when the Layer builds, never when `@wardic/dom` is imported. Once per build, so
 * no log or span (the cold path's message is the error itself).
 */
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"

/** The browser globals a DomLive Layer can need. */
export type BrowserGlobal = "requestAnimationFrame" | "document" | "window"

/** The DOM's Layers that need a browser global, by the names an app knows them by. */
export type ClientLayer = "DomClock.layer" | "DomInput.layer" | "DomProbe.layer" | "DomAnnouncer.layer"

/** Where an app gets each: three are `DomLive`'s, and a gesture builds the input. */
const FROM: Readonly<Record<ClientLayer, string>> = {
  "DomClock.layer": "DomLive's",
  "DomProbe.layer": "DomLive's",
  "DomAnnouncer.layer": "DomLive's",
  "DomInput.layer": "a gesture's",
}

/**
 * Fail the build of `layer` with ADR-0021's client-only error when `global` doesn't exist.
 * Make it the first step of the build: anything that reads the global must come after it.
 */
// #618 (D7): the error named the Layers ADR-0041 renamed (`ClockDomLive`…), and an ADR; `layer` is a
// union of today's names, so a rename can't leave it behind. Short, as every app ships it.
export const requireGlobal = (layer: ClientLayer, global: BrowserGlobal): Effect.Effect<void> =>
  Effect.suspend(() =>
    Bool.match(Predicate.isUndefined((globalThis as Record<string, unknown>)[global]), {
      onTrue: () =>
        Effect.die(
          new Error(
            `${layer} (${FROM[layer]}) needs ${global}: Wardic's runtime is client-only, never built during a server render.`,
          ),
        ),
      onFalse: () => Effect.void,
    })
  )
