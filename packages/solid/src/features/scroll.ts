/**
 * The **`scroll` Feature** (#518, ADR-0067 *Amendment (#518)*, decision 5), in a module of its own: a
 * container's scroll, which `createScroll` brings, so an app that reads no scroll ships none of the
 * Environment's scroll code. Its top-level calls are marked pure, as every Feature module's are.
 *
 * @module
 */
import * as ScrollSource from "@wardic/core/ScrollSource"
import * as DomScrollSource from "@wardic/dom/DomScrollSource"
import { type Feature, fromEnvironmentOr } from "../feature.ts"

/**
 * A container's scroll, live, for the scroll-linked values. `createScroll` brings it, so an app doesn't
 * give it. The Environment's `ScrollSource` when it gives one (`@wardic/test`'s `TestLive`), else the
 * DOM's, built once per provider.
 */
export const scroll: Feature<ScrollSource.ScrollSource> = {
  name: "scroll",
  key: ScrollSource.ScrollSource,
  layer: /*#__PURE__*/ fromEnvironmentOr(ScrollSource.ScrollSource, DomScrollSource.layer),
}
