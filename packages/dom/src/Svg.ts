/**
 * SVG: which elements take attributes, and a style patch split into the style and the attributes an SVG element takes (ADR-0014).
 *
 * `@wardic/dom/Svg` (#132, ADR-0041).
 */
export {
  isSvgRoot as isRoot,
  isSvgInner as isInner,
  isSvgInnerTag as isInnerTag,
  setSvgAttrs as setAttrs,
  splitPatch,
  splitPatchForTag,
  type SplitPatch,
} from "./internal/svg.ts"
