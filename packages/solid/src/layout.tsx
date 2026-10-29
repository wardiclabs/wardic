/**
 * The `layout` / `layoutId` binding surface (ADR-0009 + ADR-0010).
 *
 * BOTH `layout` and `layoutId` now run on the one box-based **projection system**
 * (`@wardic/dom`): {@link useLayoutMember} registers the element as a single
 * projection node — the provider-owned system owns measurement (a shared
 * `ResizeObserver` + a `layoutDependency`/registration trigger) and the per-frame
 * box-projection derive (relative + `treeScale`, nested-correct).
 *
 * `layoutId` shared-element animation (ADR-0010) is wired through the SAME node:
 * the binding passes the `layoutId`, and the engine does the rest — its lead/follow
 * stack crossfades coexisting twins, and a twin disposed in the same task hands the
 * enterer its Switch seed, captured in the Root frame (ADR-0010 / ADR-0012
 * *Amendment (#13)*). The binding keeps no registry and makes no layout reads. The
 * flat delta-key Play (`playFlip`) is gone — one layout model.
 *
 * Idle = zero cost: nothing is measured until a trigger fires (CONTEXT.md
 * observability convention — hot path stays quiet).
 */
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Bool from "effect/Boolean"
import { createContext, createEffect, type JSX, on, onCleanup, untrack, useContext } from "solid-js"
import { layoutGroupIdOf, type LayoutGroupInherit } from "./layout-group.ts"
import { registrationOf, type UseLayoutMemberOptions } from "./layout-member.ts"
import { useWardicProjection } from "./provider.tsx"
import { isServer } from "./server.ts"

export type { UseLayoutMemberOptions } from "./layout-member.ts"

/**
 * Wire an element into layout projection (ADR-0009 + ADR-0010) — exactly ONE
 * projection node per element, whether it has `layout`, `layoutId`, or both. Called
 * from the `createWard` spine once the element + gate id exist.
 *
 * The provider-owned projection system (built by DOM ancestry) owns measurement
 * (one shared `ResizeObserver` + this node's `notify`) and the per-frame box derive;
 * a `layoutDependency` change requests a re-measure. No FLIP on first measure for a
 * plain `layout` node.
 *
 * SHARED-ELEMENT (`layoutId`, ADR-0010). Passing `layoutId` is all the binding
 * does: the engine enrols the node in its lead/follow stack (a coexisting live twin
 * crossfades) and, when a twin's node is disposed in the same task, seeds this
 * node's first measure from that twin's Root-frame box (a Switch). Both swap
 * orderings — the leaver's cleanup before this mount, or after it — resolve
 * engine-side (ADR-0010 *Amendment (#13)*), so there is no registry, ownership
 * token or layout read here.
 *
 * Must be called within a Solid owner (registers `createEffect` / `onCleanup`).
 */
export const useLayoutMember = (opts: UseLayoutMemberOptions): ProjectionSystem.NodeHandle => {
  const handle = useWardicProjection().register(registrationOf(opts))
  onCleanup(handle.dispose)
  createEffect(on(() => opts.layoutDependency(), () => handle.notify(), { defer: true }))
  return handle // ADR-0016: the spine forwards the drag methods to runDragTrack
}

/** The id of the **Layout group** around (#432): the namespace a `layoutId` made here goes in. */
const LayoutGroupContext = createContext<string | undefined>(undefined)

/** The id of the **Layout group** a ward made here is in (#432), or none. Internal. */
export const useLayoutGroupId = (): string | undefined => useContext(LayoutGroupContext)

/** `<LayoutGroup>`'s props. */
export interface LayoutGroupProps {
  readonly children: JSX.Element
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
  /** A value/signal whose change requests a full projection re-measure (sibling reflow falls out). */
  readonly layoutDependency?: unknown
}

/**
 * `<LayoutGroup>` — a **Layout group** (ADR-0009, #432). Its `id` is a namespace for the
 * `layoutId`s made under it, as Motion's (see {@link LayoutGroupProps}). A ward made outside it, in
 * a component body, and spread on an element inside it is outside it, as it is outside a presence
 * or a variant parent there: make it in a component under the group.
 *
 * With the box-based projection system the FLIP itself is handled by the provider-owned
 * projection tree (built by DOM ancestry; a measure re-reads the WHOLE tree, so
 * sibling reflow and nesting work WITHOUT a group). So `<LayoutGroup>` doesn't drive
 * FLIP: its `layoutDependency` triggers a full re-measure (a convenience for
 * "re-measure my subtree when this value changes").
 */
export function LayoutGroup(props: LayoutGroupProps): JSX.Element {
  // Its id, from the group around and its own, once (Motion's).
  const outer = useLayoutGroupId()
  const id = untrack(() => layoutGroupIdOf(outer, props.id, props.inherit))
  // A server render has no projection system to re-measure (ADR-0021).
  if (Bool.not(isServer)) {
    const projection = useWardicProjection()
    // A group-level dependency change re-measures the whole tree (Q5). `defer: true`
    // skips the mount read (nodes seed themselves on registration).
    createEffect(on(() => props.layoutDependency, () => projection.notify(), { defer: true }))
  }
  // Its children in JSX, so they're read where they track: returned from the body, they were read
  // once, and `<LayoutGroup>{open() ? a : b}</LayoutGroup>` never switched (#257's audit). A group that
  // keeps the id around provides none, so its markup and hydration keys are as they were (#432).
  return Bool.match(id === outer, {
    onTrue: () => <>{props.children}</>,
    onFalse: () => <LayoutGroupContext.Provider value={id}>{props.children}</LayoutGroupContext.Provider>,
  })
}
