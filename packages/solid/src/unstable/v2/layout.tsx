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
import { useWardicProjection } from "./provider.tsx"
import { CLIENT_ONLY_DEFERRED } from "./solid-reactivity.ts"

/**
 * The id of the **Layout group** around (#432): the namespace a `layoutId` made here goes in. `null`
 * for none: Solid 2 reads a context made with `undefined` as having no value, and throws outside a provider.
 */
const LayoutGroupContext = createContext<string | null>(null)

/** The id of the **Layout group** a ward made here is in (#432), or none. Internal. */
export const useLayoutGroupId = (): string | undefined => Option.getOrUndefined(Option.fromNullishOr(useContext(LayoutGroupContext)))

/** `<LayoutGroup>`'s props on Solid 2: the Solid 1 binding's (#432). */
export interface LayoutGroupProps {
  readonly children?: JSX.Element
  /**
   * A namespace for the `layoutId`s made under it (#432, Motion's): `<LayoutGroup id="tabs">` makes a
   * `layoutId="underline"` pair as `tabs-underline`, so two copies of a component that uses a
   * `layoutId` keep their own. Read once, at its mount.
   */
  readonly id?: string | undefined
  /**
   * Whether it joins the id of the group it's in (#432, Motion's): `true` (the default) and `"id"`
   * both do, `outer-inner`, or take the outer one's when it has no `id`; `false` starts its own.
   * Motion's `true` also joins the outer group's re-measure, which every Measure pass here already
   * is: it reads the whole tree. Read once, at its mount.
   */
  readonly inherit?: LayoutGroupInherit | undefined
  /** A value whose change requests a re-measure of every layout node (sibling reflow falls out). */
  readonly layoutDependency?: unknown
}

/**
 * A **Layout group** (#432): its `id` is a namespace for the `layoutId`s made under it, as Motion's.
 * A ward is in the group it's made under, as it's under the presence and the variant parent it's
 * made under: one made in a component body and spread on an element inside a `<LayoutGroup>` there
 * is outside it, so make it in a component under the group. Its `layoutDependency`, a value whose
 * change requests a re-measure of every layout node (sibling reflow falls out), is read in an effect.
 */
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
