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

/**
 * Fail the build of `layer` with ADR-0021's client-only error when `global` doesn't exist.
 * Make it the first step of the build: anything that reads the global must come after it.
 */
export const requireGlobal = (layer: string, global: BrowserGlobal): Effect.Effect<void> =>
  Effect.suspend(() =>
    Bool.match(Predicate.isUndefined((globalThis as Record<string, unknown>)[global]), {
      onTrue: () =>
        Effect.die(
          new Error(
            `${layer} can't be built here: there is no ${global} (a server render?). ` +
              "Wardic's runtime is client-only (ADR-0003): use it on the client once the element has mounted, " +
              "never during a server render.",
          ),
        ),
      onFalse: () => Effect.void,
    })
  )
