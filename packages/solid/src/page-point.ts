/**
 * Point mappings for `WardicConfig`'s `transformPagePoint` (#443, Motion's `correctParentTransform`
 * and `transformViewBoxPoint`), Solid-free, for both bindings. Each takes its element as it is, or an
 * accessor of one (a ref's, set at mount), read at each point. Wardic's points are in the viewport's
 * coordinates, where Motion's are the page's, so neither adds the page's scroll.
 *
 * @module
 */
import * as Predicate from "effect/Predicate"
import type { WardicTransformPoint } from "./config.ts"

/** An element given as it is, or an accessor of one. */
export type ElementGiven<E extends Element> = E | (() => E | undefined)

/** The element now: an accessor's, or the one given. */
const elementOf = <E extends Element>(given: ElementGiven<E>): E | undefined => {
  if (Predicate.isFunction(given)) return given()
  return given
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
 * A `transformPagePoint` for a drag or a pan inside a parent with a CSS transform: rotated, scaled
 * or skewed (#443, Motion's `correctParentTransform`). Each point is turned through the inverse of
 * the parent's transform about its centre, read at each point, so a parent that animates is
 * followed, and the drag moves its element in the parent's own pixels: inside a parent zoomed to 2×,
 * the element stays under the pointer. Points pass as they are while the parent is gone or has no
 * transform.
 *
 * ```tsx
 * let plan!: HTMLDivElement
 * <div ref={plan} style={{ transform: `scale(${zoom()})` }}>
 *   <WardicConfig transformPagePoint={correctParentTransform(() => plan)}>
 *     <wardic.div drag />
 *   </WardicConfig>
 * </div>
 * ```
 */
export const correctParentTransform =
  (parent: ElementGiven<Element>): WardicTransformPoint =>
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
 * renders at (#443, Motion's `transformViewBoxPoint`): each point is scaled about the SVG's top left
 * corner into its viewBox's units, read at each point. Points pass as they are while the SVG is gone,
 * has no viewBox, or renders at no size.
 *
 * ```tsx
 * let svg!: SVGSVGElement
 * <WardicConfig transformPagePoint={transformViewBoxPoint(() => svg)}>
 *   <svg ref={svg} viewBox="0 0 100 100" width="500" height="500">
 *     <wardic.rect drag width="10" height="10" />
 *   </svg>
 * </WardicConfig>
 * ```
 */
export const transformViewBoxPoint =
  (svg: ElementGiven<SVGSVGElement>): WardicTransformPoint =>
  (point) => {
    const element = elementOf(svg)
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
