/**
 * Point mappings for a provider's `transformPagePoint` (#443, Motion's `correctParentTransform` and
 * `transformViewBoxPoint`), for every DOM binding. Each takes its element as it is, an accessor of one
 * (a ref's, set at mount), or a selector, for a binding with no refs (Foldkit's), read at each point.
 * Wardic's points are in the viewport's coordinates, where Motion's are the page's, so neither adds the
 * page's scroll.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #795: solid's `page-point.ts`, moved to dom for the Foldkit binding (its storefront's room example).
import * as Predicate from "effect/Predicate"
import type * as WardConfig from "@wardic/dom/unstable/WardConfig"

/** An element given as it is, an accessor of one, or a selector (#795), looked up in the document at each point. */
export type ElementGiven<E extends Element> = E | (() => E | undefined) | string

/** The element now: an accessor's, the first its selector finds, or the one given. */
const elementOf = <E extends Element>(given: ElementGiven<E>): E | undefined => {
  if (Predicate.isFunction(given)) return given()
  if (Predicate.isString(given)) return foundBy<E>(given)
  return given
}

/** The first element `selector` finds in the document, if any. */
const foundBy = <E extends Element>(selector: string): E | undefined => {
  const found = document.querySelector<E>(selector)
  if (Predicate.isNull(found)) return undefined
  return found
}

/** Whether an element is an SVG root: a selector may find any element. */
const isSvg = (element: Element): element is SVGSVGElement => Predicate.hasProperty(element, "viewBox")

/** The SVG `given` names now, if it names one. */
const svgOf = (given: ElementGiven<SVGSVGElement>): SVGSVGElement | undefined => {
  const element = elementOf(given)
  if (Predicate.isUndefined(element)) return undefined
  if (isSvg(element)) return element
  return undefined
}

/** A 2D linear map's coefficients: the inverse of an element's transform, as Motion's `getInverseMatrix`. */
interface Linear {
  readonly a: number
  readonly b: number
  readonly c: number
  readonly d: number
}

/** The inverse of `element`'s computed transform's linear part, or `undefined` for none, or one that can't be inverted. */
const inverseOf = (element: Element): Linear | undefined => {
  const transform = getComputedStyle(element).transform
  if (Predicate.isUndefined(transform) || transform === "" || transform === "none") return undefined
  const { a, b, c, d } = new DOMMatrixReadOnly(transform)
  const det = a * d - b * c
  if (Math.abs(det) < 1e-10) return undefined
  return { a: d / det, b: -b / det, c: -c / det, d: a / det }
}

/**
 * A `transformPagePoint` for a drag or a pan inside a parent with a CSS transform, rotated, scaled or
 * skewed: each pointer point is turned through the inverse of the parent's transform, read at each
 * point, so the element stays under the pointer at any zoom, and a parent that animates is followed.
 * The parent is an element, an accessor of a ref, or a selector looked up in the document at each
 * point. Motion's `correctParentTransform`.
 *
 * @example
 * // On Solid: a ref's accessor.
 * let plan!: HTMLDivElement
 * <div ref={plan} style={{ transform: `scale(${zoom()})` }}>
 *   <WardicConfig transformPagePoint={correctParentTransform(() => plan)}>
 *     <w.div drag />
 *   </WardicConfig>
 * </div>
 * // On Foldkit, which has no refs: a selector.
 * w.div([w.Drag(), w.Config({ transformPagePoint: correctParentTransform("#plan") })])
 * @see https://wardic.dev/reference/solid/utilities/page-points
 */
// #443. Points pass as they are while the parent is gone or has no transform.
export const correctParentTransform =
  (parent: ElementGiven<Element>): WardConfig.WardicTransformPoint =>
  (point) => {
    const element = elementOf(parent)
    if (Predicate.isUndefined(element)) return point
    const inverse = inverseOf(element)
    if (Predicate.isUndefined(inverse)) return point
    const box = element.getBoundingClientRect()
    const cx = box.left + box.width / 2
    const cy = box.top + box.height / 2
    const dx = point.x - cx
    const dy = point.y - cy
    return { x: cx + inverse.a * dx + inverse.c * dy, y: cy + inverse.b * dx + inverse.d * dy }
  }

/**
 * A `transformPagePoint` for a drag or a pan inside an SVG whose `viewBox` differs from the size it
 * renders at: each pointer point is scaled into the viewBox's units, so a dragged shape stays under
 * the pointer. The SVG is an element, an accessor of a ref, or a selector looked up in the document at
 * each point; a selector that finds no SVG maps nothing. Motion's `transformViewBoxPoint`.
 *
 * @example
 * // On Solid: a ref's accessor.
 * let svg!: SVGSVGElement
 * <WardicConfig transformPagePoint={transformViewBoxPoint(() => svg)}>
 *   <svg ref={svg} viewBox="0 0 100 100" width="500" height="500">
 *     <w.rect drag width="10" height="10" />
 *   </svg>
 * </WardicConfig>
 * // On Foldkit: a selector.
 * w.rect([w.Drag(), w.Config({ transformPagePoint: transformViewBoxPoint("#plan") })])
 * @see https://wardic.dev/reference/solid/utilities/page-points
 */
// #443. Points pass as they are while the SVG is gone, has no viewBox, or renders at no size.
export const transformViewBoxPoint =
  (svg: ElementGiven<SVGSVGElement>): WardConfig.WardicTransformPoint =>
  (point) => {
    const element = svgOf(svg)
    if (Predicate.isUndefined(element)) return point
    const viewBox = element.viewBox.baseVal
    if (Predicate.isNullish(viewBox) || (viewBox.width === 0 && viewBox.height === 0)) return point
    const box = element.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return point
    return {
      x: (point.x - box.left) * (viewBox.width / box.width) + box.left,
      y: (point.y - box.top) * (viewBox.height / box.height) + box.top,
    }
  }
