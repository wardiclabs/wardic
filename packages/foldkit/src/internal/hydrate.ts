/**
 * `wardic.hydrate(program, options)` (ADR-0071 *Amendment (#794)*, Q10 and Q17; ADR-0044): Foldkit's
 * `Runtime.hydrate` with the Appear animations' two steps before it. The chunk `<style>` the Provider
 * element rendered first among its children (PR 2) is moved into the head (dom's `adoptChunks`), since
 * Foldkit adopts the server's children against the view's one by one, and a child the view lacks would
 * have it rebuild the Provider element's subtree. And the Handle is told hydration's window opens: the
 * walk names each element's slot as the server did (Q9) at the hydration render and at any render before
 * the last Handoff has released, so hydration keeps the inline `animation` the CSS plays through, for each
 * Mount's Handoff (decision 6), rather than stripping it as a value the client didn't reassert (probe
 * P-C). Foldkit renders the hydration after this returns, on its own time (at once in production, after
 * a wait for its vite plugin under a dev server); the window waits for it.
 *
 * @module
 */
import * as Appear from "@wardic/dom/Appear"
import * as Predicate from "effect/Predicate"
import * as FoldkitRuntime from "foldkit/runtime"
import { hydrationStarts, type State } from "./services.ts"

/** The Handle's `hydrate` (above). */
export const hydrateOf =
  (state: State): typeof FoldkitRuntime.hydrate =>
  (program, options) => {
    // Opened with a chunk on the page alone: a page the server rendered with none (no Provider element,
    // `appear: false`, nothing that plays) names no slot, and its hydration render must name none either.
    hydrationStarts(state, Predicate.isNotNull(document.querySelector(`style[${Appear.CHUNK_ATTRIBUTE}]`)))
    Appear.adoptChunks(document)
    FoldkitRuntime.hydrate(program, options)
  }
