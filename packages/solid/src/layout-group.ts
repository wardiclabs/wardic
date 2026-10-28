/**
 * A **Layout group**'s namespace for `layoutId` (#432, CONTEXT.md; Motion's `LayoutGroup`,
 * `.reference/motion` at `16c6122`), Solid-free: both bindings' `<LayoutGroup>` make its id, and every
 * layout node's `layoutId` is put in it before it reaches the projection engine.
 *
 * @module
 */
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"

/**
 * Whether a group joins the id of the group it's in (Motion's `inherit`): `true` and `"id"` both do
 * (Motion's `true` also joins its node group, whose members re-measure together, which Wardic's
 * whole-tree Measure pass already does, ADR-0009); `false` starts a namespace of its own.
 */
export type LayoutGroupInherit = boolean | "id"

/**
 * A group's id (Motion's): with `inherit` and an outer group's id, that id joined with its own
 * (`outer-inner`), or the outer one's alone when it has none; else its own, or none.
 */
export const layoutGroupIdOf = (outer: string | undefined, id: string | undefined, inherit: LayoutGroupInherit = true): string | undefined => {
  if (inherit === false) return id
  if (Predicate.isUndefined(outer)) return id
  return UndefinedOr.match(id, { onUndefined: () => outer, onDefined: (own) => `${outer}-${own}` })
}

/** `layoutId` in the group `group` (Motion's `useLayoutId`): `${group}-${layoutId}`, or as it is outside any. */
export const layoutIdIn = (group: string | undefined, layoutId: string | undefined): string | undefined => {
  if (Predicate.isUndefined(group)) return layoutId
  return UndefinedOr.map(layoutId, (own) => `${group}-${own}`)
}
