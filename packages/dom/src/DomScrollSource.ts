/**
 * The DOM's scroll, core's `ScrollSource`: a container's scroll as an Atom, set inside the container's
 * `scroll` event, the window's `resize`, and a resize of the container or its content, so a value derived
 * from a scroll is written in the frame that shows it. `layer` needs the Environment's `AtomRegistry`,
 * which it writes through. A binding builds it where something reads a scroll: the Solid binding's
 * `scroll` Feature does, beside `DomLive`.
 *
 * @example
 * import * as DomScrollSource from "@wardic/dom/DomScrollSource"
 *
 * const scroll = DomScrollSource.layer.pipe(Layer.provide(AtomRegistry.layer))
 */
// `@wardic/dom/DomScrollSource` (#518, ADR-0041's names): the DOM Probe's `scroll` until then.
export { layer } from "./internal/scroll.ts"
