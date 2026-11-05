/**
 * SVG: which elements are SVG's, and a style patch split into the CSS an SVG element takes and the
 * attributes it takes instead. An `<svg>` root is styled as HTML is; an element inside it takes most keys
 * as attributes, and a transform about its own centre, as an HTML element's is.
 *
 * @example
 * import * as Svg from "@wardic/dom/Svg"
 *
 * Svg.splitPatchForTag("circle", { r: 10, opacity: 0.5, transform: "scale(2)" })
 * // style: transform, transform-box and transform-origin; attrs: { r: "10", opacity: "0.5" }
 */
// `@wardic/dom/Svg` (#132, ADR-0041): ADR-0014.
export {
  isSvgRoot as isRoot,
  isSvgInner as isInner,
  isSvgInnerTag as isInnerTag,
  setSvgAttrs as setAttrs,
  splitPatch,
  splitPatchForTag,
  type SplitPatch,
} from "./internal/svg.ts"
