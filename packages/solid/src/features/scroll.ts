/**
 * The **`scroll` Feature** (#518, ADR-0067 *Amendment (#518)*, decision 5), in a module of its own: a
 * container's scroll, which `createScroll` brings, so an app that reads no scroll ships none of the
 * Environment's scroll code. With it, the Timeline values (#240): a value derived from the scroll by
 * ranges alone, drawn by the browser with the scroll. Its top-level calls are marked pure, as every
 * Feature module's are.
 *
 * @module
 */
import * as ScrollSource from "@wardic/core/ScrollSource"
import * as DomScrollSource from "@wardic/dom/DomScrollSource"
import * as Layer from "effect/Layer"
import { type Feature, fromEnvironmentOr } from "../feature.ts"
import { Timelines } from "../timelines.ts"
import { makeTimelines } from "./timeline-keys.ts"

/**
 * A container's scroll, live, for the scroll-linked values. `createScroll` brings it, so an app doesn't
 * give it. The Environment's `ScrollSource` when it gives one (`@wardic/test`'s `TestLive`), else the
 * DOM's, built once per provider. Its Timeline values run where the browser has native scroll timelines.
 */
// #240 (ADR-0043 *Amendment (#240)*, decision 4): the `Timelines` service, which an element's spine finds
// among the provider's built Features.
export const scroll: Feature<ScrollSource.ScrollSource> = {
  name: "scroll",
  key: ScrollSource.ScrollSource,
  layer: /*#__PURE__*/ Layer.merge(
    /*#__PURE__*/ fromEnvironmentOr(ScrollSource.ScrollSource, DomScrollSource.layer),
    /*#__PURE__*/ Layer.sync(Timelines)(makeTimelines),
  ),
}
