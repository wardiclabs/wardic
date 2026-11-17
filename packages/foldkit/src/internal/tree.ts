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
import * as LayoutGroup from "@wardic/dom/unstable/LayoutGroup"
import * as Bool from "effect/Boolean"
import { constUndefined, identity } from "effect/Function"
import * as Option from "effect/Option"
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
// Module state (#460, Q7): the elements whose Mount has run, held weakly: what a later render's `w.Presence` is told by.
const mounted = new WeakSet<Element>()

/** The nearest ancestor of `element` that `has` what's looked for, or none at the top. Per element at mount, up the tree. */
export const nearestAncestor = (element: Element, has: (ancestor: Element) => boolean): Element | undefined => {
  const ancestor = element.parentElement
  if (Predicate.isNull(ancestor)) return undefined
  if (has(ancestor)) return ancestor
  return nearestAncestor(ancestor, has)
}

/** Whether an element carries a delivered config: a `w.*` element, or one with the bundle. */
const isWard = (element: Element): boolean => Predicate.isNotUndefined(deliveredTo(element))

/** Whether an element carries `w.Presence`. */
const isPresence = (element: Element): boolean => Predicate.isNotUndefined(configOf(deliveredTo(element)).presence)

/** The nearest Wardic ancestor of `element`: one carrying a delivered config. */
const nearestWard = (element: Element): Element | undefined => nearestAncestor(element, isWard)

/** Whether `node` is a `w.*` element or under one: a change of the Handle's own, not another app's under the body (decision 33). */
export const underWard = (node: Node): boolean => {
  const element = Bool.match(node instanceof Element, { onTrue: () => node as Element, onFalse: () => node.parentElement })
  if (Predicate.isNull(element)) return false
  if (isWard(element)) return true
  return Predicate.isNotUndefined(nearestWard(element))
}

/** The nearest `w.Presence` element above `element` (decision 29), found as the variant parent is. */
export const nearestPresenceElement = (element: Element): Element | undefined => nearestAncestor(element, isPresence)

/** Whether an element carries `w.LayoutGroup`. */
const isLayoutGroup = (element: Element): boolean => Predicate.isNotUndefined(configOf(deliveredTo(element)).layoutGroup)

// Module state (#460, Q7): each `w.LayoutGroup` element's id, held weakly, read once as the first `layoutId` under it mounts.
const groupIds = new WeakMap<Element, Option.Option<string>>()

/**
 * The id of the **Layout group** `element` is in (#432, Motion's `LayoutGroup`): the nearest
 * `w.LayoutGroup` above it, its own id joined with the group's above as its `inherit` says
 * (`layoutGroupIdOf`), or none outside any. Read once, at mount, as Solid's is.
 */
export const layoutGroupOf = (element: Element): string | undefined => UndefinedOr.match(nearestAncestor(element, isLayoutGroup), { onUndefined: constUndefined, onDefined: groupIdOf })

/** A `w.LayoutGroup` element's id: made at the first ask, from the group above it and its own options. */
const groupIdOf = (group: Element): string | undefined =>
  UndefinedOr.match(groupIds.get(group), {
    onDefined: Option.getOrUndefined,
    onUndefined: () => {
      const options = UndefinedOr.match(configOf(deliveredTo(group)).layoutGroup, { onUndefined: (): Ward.LayoutGroupOptions => ({}), onDefined: identity })
      const id = LayoutGroup.layoutGroupIdOf(layoutGroupOf(group), options.id, options.inherit)
      groupIds.set(group, Option.fromUndefinedOr(id))
      return id
    },
  })

/** Mark `element`'s Mount as run: from now on, a `w.Presence` a render adds to it can't run (its Mount is made once). */
export const markMounted = (element: Element): void => {
  mounted.add(element)
}

/** Whether `element`'s Mount has run. */
export const isMounted = (element: Element): boolean => mounted.has(element)

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
    // Where a drag's and a pan's points are (#793, Q9): the nearest `transformPagePoint` up the chain.
    transformPagePoint: () => WardicConfigValue.configTransformPagePointOf(UndefinedOr.map(own(), (c) => c.transformPagePoint), parent),
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
    transformPagePoint: () => options.transformPagePoint,
  }
}
