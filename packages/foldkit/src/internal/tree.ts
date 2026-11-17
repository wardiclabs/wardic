/**
 * The tree, by DOM ancestry (ADR-0071 decisions 21 and 22, *Amendment (#791)* item 7): a `w.*`
 * element's variant parent and its nearest `w.Config` are the nearest Wardic ancestors', found by
 * walking `parentElement` to an element carrying a delivered config, which Foldkit's props module
 * wrote at `create`, before the children exist. Foldkit runs a child's Mount before its parent's, so
 * an element's node and config value are made by whichever first asks, cached by the element, and
 * adopted by its own Mount when that runs.
 *
 * @module
 */
import * as WardicConfigValue from "@wardic/core/unstable/WardicConfigValue"
import type * as VariantTree from "@wardic/core/unstable/VariantTree"
import { constUndefined } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Ward from "../Ward.ts"
import { deliveredTo } from "./delivery.ts"
import { configOf } from "./element.ts"
import { recheck } from "./reactivity.ts"
import { type VariantNode, variantNodeOf } from "./variant-node.ts"

// Module state (#460, Q7): each element's node, held weakly by the element.
const nodes = new WeakMap<Element, VariantNode>()
// Module state (#460, Q7): each element's config value, held weakly by the element.
const values = new WeakMap<Element, WardicConfigValue.WardicConfigValue>()

/** The nearest Wardic ancestor of `element`: one carrying a delivered config. Per element at mount, up the tree. */
const nearestWard = (element: Element): Element | undefined => {
  const ancestor = element.parentElement
  if (Predicate.isNull(ancestor)) return undefined
  if (Predicate.isNotUndefined(deliveredTo(ancestor))) return ancestor
  return nearestWard(ancestor)
}

/**
 * The nearest `w.Presence` element above `element` (decision 29): the ancestor whose delivered config
 * carries `presence`, found as the variant parent is. Per element at mount, up the tree.
 */
export const nearestPresenceElement = (element: Element): HTMLElement | undefined => {
  const ancestor = element.parentElement
  if (Predicate.isNull(ancestor)) return undefined
  if (Predicate.isNotUndefined(configOf(deliveredTo(ancestor)).presence)) return ancestor
  return nearestPresenceElement(ancestor)
}

/** The variant context the nearest Wardic ancestor of `element` provides, or none at the top. */
const parentContextOf = (element: Element): VariantTree.WardicVariantContextValue | undefined =>
  UndefinedOr.match(nearestWard(element), { onUndefined: constUndefined, onDefined: (ancestor) => nodeOf(ancestor).provided })

/** `element`'s variant node: made at the first ask (a child's, or its own Mount's), over its latest delivered config. */
export const nodeOf = (element: Element): VariantNode => {
  const known = nodes.get(element)
  if (Predicate.isNotUndefined(known)) return known
  const node = variantNodeOf(() => configOf(deliveredTo(element)), parentContextOf(element), recheck)
  nodes.set(element, node)
  return node
}

/** Drop `element`'s node at its release: its registration with its ancestor given up. */
export const dropNode = (element: Element): void => {
  const node = nodes.get(element)
  if (Predicate.isUndefined(node)) return
  nodes.delete(element)
  node.dispose()
}

/**
 * The `WardicConfigValue` in effect for `element` (#434, ADR-0062): its own `w.Config` over the nearest
 * ancestor's, over the Handle's `config` (`root`). Each setting is read when an animation starts, so a
 * change moves nothing by itself. An element with no `w.Config` of its own shares its ancestor's.
 */
export const configValueOf = (element: Element, root: WardicConfigValue.WardicConfigValue | undefined): WardicConfigValue.WardicConfigValue | undefined => {
  const own = (): Ward.ConfigOptions | undefined => configOf(deliveredTo(element)).config
  const parent = UndefinedOr.match(nearestWard(element), { onUndefined: () => root, onDefined: (ancestor) => configValueOf(ancestor, root) })
  if (Predicate.isUndefined(own())) return parent
  const known = values.get(element)
  if (Predicate.isNotUndefined(known)) return known
  const value: WardicConfigValue.WardicConfigValue = {
    transition: () => WardicConfigValue.configTransitionOf(UndefinedOr.map(own(), (c) => c.transition), parent),
    reducedMotion: () => WardicConfigValue.configReducedMotionOf(UndefinedOr.map(own(), (c) => c.reducedMotion), parent),
    skipAnimations: () => WardicConfigValue.configSkipAnimationsOf(UndefinedOr.map(own(), (c) => c.skipAnimations), parent),
    isValidProp: () => WardicConfigValue.configIsValidPropOf(undefined, parent),
    transformPagePoint: () => WardicConfigValue.configTransformPagePointOf(undefined, parent),
  }
  values.set(element, value)
  return value
}

/** The Handle's app-wide config (`Wardic.make({ config })`), as the root of every element's chain; none without one. */
export const rootConfigValueOf = (options: Ward.ConfigOptions | undefined): WardicConfigValue.WardicConfigValue | undefined => {
  if (Predicate.isUndefined(options)) return undefined
  return {
    transition: () => WardicConfigValue.configTransitionOf(options.transition, undefined),
    reducedMotion: () => options.reducedMotion,
    skipAnimations: () => options.skipAnimations,
    isValidProp: constUndefined,
    transformPagePoint: constUndefined,
  }
}
