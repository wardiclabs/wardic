/**
 * `<LayoutGroup>` on Solid 2 (#209, ADR-0009), as the Solid 1 binding's: a **Layout group** whose
 * `id` is a namespace for the `layoutId`s made under it (#432), and whose `layoutDependency`
 * re-measures the whole projection tree. A ward's own layout node is registered at its mount
 * (`ward.tsx`, through `layout-member.ts`).
 *
 * @module
 */
import { isServer, type JSX } from "@solidjs/web"
import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
import { createContext, createEffect, untrack, useContext } from "solid-js"
import { layoutGroupIdOf, type LayoutGroupInherit } from "../../layout-group.ts"
import { useWardicProjection } from "./layout-projection.ts"
import { CLIENT_ONLY_DEFERRED } from "./solid-reactivity.ts"

/**
 * The id of the **Layout group** around (#432): the namespace a `layoutId` made here goes in. `null`
 * for none: Solid 2 reads a context made with `undefined` as having no value, and throws outside a provider.
 */
const LayoutGroupContext = createContext<string | null>(null)

/** The id of the **Layout group** a ward made here is in (#432), or none. Internal. */
export const useLayoutGroupId = (): string | undefined => Option.getOrUndefined(Option.fromNullishOr(useContext(LayoutGroupContext)))

/** `<LayoutGroup>`'s props, as Solid 1's. */
export interface LayoutGroupProps {
  readonly children?: JSX.Element
  /**
   * An id put before every `layoutId` made under it: under `<LayoutGroup id="tabs">`, a
   * `layoutId="underline"` is `tabs-underline`, so two copies of a component that uses a `layoutId`
   * keep their own. Read once, as it mounts.
   */
  readonly id?: string | undefined
  /**
   * Whether it joins the id of the group it's in: `true` (the default) and `"id"` both do, making
   * `outer-inner`, or taking the outer id when it has none of its own; `false` starts afresh. Read
   * once, as it mounts.
   */
  // Motion's `true` also joins the outer group's re-measure, which every Measure pass here already is:
  // it reads the whole tree.
  readonly inherit?: LayoutGroupInherit | undefined
  /** A value whose change has every layout element measured again, for a change nothing else sees. */
  readonly layoutDependency?: unknown
}

/**
 * Puts an id before every `layoutId` made under it, so two copies of a component that uses a
 * `layoutId` keep their own: under `<LayoutGroup id="tabs">`, `layoutId="underline"` is
 * `tabs-underline`. Its `layoutDependency` has every layout element measured again when it changes.
 * Motion's `LayoutGroup`.
 *
 * A ward is in the group it's made under: one made in a component body, and given to an element
 * inside a `<LayoutGroup>` there, is outside it. Make it in a component under the group.
 *
 * @example
 * <LayoutGroup id="tabs">
 *   <Tabs />
 * </LayoutGroup>
 * @see https://wardic.dev/reference/solid/layout/layout-group
 */
// #432, as Solid 1's: a ward is under the group it's made under, as it's under its presence and its
// variant parent. Its `layoutDependency` is read in an effect.
export function LayoutGroup(props: LayoutGroupProps): JSX.Element {
  // Its id, from the group around and its own, once (Motion's).
  const outer = useLayoutGroupId()
  const id = untrack(() => layoutGroupIdOf(outer, props.id, props.inherit))
  // A server render has no projection system to re-measure (ADR-0021). Not at mount: nodes measure
  // themselves as they register.
  if (Bool.not(isServer)) {
    const projection = useWardicProjection()
    createEffect(
      () => props.layoutDependency,
      () => {
        projection.notify()
      },
      CLIENT_ONLY_DEFERRED,
    )
  }
  // Its children in JSX, so they're read where they track: returned from the body, they were read
  // once, and `<LayoutGroup>{open() ? a : b}</LayoutGroup>` never switched (#257's audit). A group that
  // keeps the id around provides none, so its markup and hydration keys are as they were (#432).
  return Bool.match(id === outer, {
    onTrue: () => <>{props.children}</>,
    onFalse: () => <LayoutGroupContext value={Option.getOrNull(Option.fromUndefinedOr(id))}>{props.children}</LayoutGroupContext>,
  })
}
