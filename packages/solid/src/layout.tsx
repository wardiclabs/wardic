/**
 * The `layout` / `layoutId` binding surface (ADR-0009 + ADR-0010).
 *
 * BOTH `layout` and `layoutId` now run on the one box-based **projection system**
 * (`@wardic/dom`): {@link createProjectionNode} registers the element as a single
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
import { createContext, createEffect, createMemo, type JSX, on, onCleanup, untrack, useContext } from "solid-js"
import { layoutGroupIdOf, type LayoutGroupInherit } from "./layout-group.ts"
import { registrationOf, type CreateProjectionNodeOptions } from "./layout-member.ts"
import { useWardicProjection } from "./layout-projection.tsx"
import { isServer } from "./server.ts"

export type { CreateProjectionNodeOptions } from "./layout-member.ts"

/**
 * Registers an element with its provider's projection system as one layout node, as a `w.*` element
 * with `layout` or a `layoutId` is: for an element of your own built on Wardic's layout animations.
 * A `w.*` element or a ward does this itself. Returns the node's handle: `notify()` asks for a
 * Measure pass, and `dispose()` takes the node out, as the owner's cleanup does. It brings the `layout`
 * Feature. Solid 1 only. Call it within a Solid owner.
 *
 * @see https://wardic.dev/reference/solid/advanced/create-projection-node
 */
// ADR-0009 + ADR-0010: exactly one projection node per element, whether it has `layout`, `layoutId` or
// both; the `createWard` spine calls it once the element and its gate id exist. The provider's system
// (built by DOM ancestry) owns measurement (one shared ResizeObserver, and this node's `notify`) and the
// per-frame box derive; a `layoutDependency` change asks for a re-measure. A plain `layout` node doesn't
// FLIP on its first measure. A `layoutId` is all the binding passes: the engine enrols the node in its
// lead/follow stack, and seeds its first measure from a twin disposed in the same task (a Switch), in
// either swap order (ADR-0010 *Amendment (#13)*), so there's no registry here. It brings `layout`
// (#511), whatever its section has: a Slim element's own layout node is its section's.
export const createProjectionNode = (opts: CreateProjectionNodeOptions): ProjectionSystem.NodeHandle => projectionNodeOf(useWardicProjection(), opts)

/**
 * {@link createProjectionNode} on `projection`: an element's, its section's `layout` Feature's (#511), where
 * `createProjectionNode` brings it. Internal.
 */
export const projectionNodeOf = (projection: ProjectionSystem.Shape, opts: CreateProjectionNodeOptions): ProjectionSystem.NodeHandle => {
  const handle = projection.register(registrationOf(opts))
  onCleanup(handle.dispose)
  // Compared before it measures, as Motion's `prevProps.layoutDependency !== layoutDependency`: an
  // effect re-runs at any change of what it read, and the config is read again at any prop's (#618).
  const dependency = createMemo(() => opts.layoutDependency())
  createEffect(on(dependency, () => handle.notify(), { defer: true }))
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
 * A ward is in the group it's made under: one made in a component body, and spread on an element
 * inside a `<LayoutGroup>` there, is outside it. Make it in a component under the group.
 *
 * @example
 * <LayoutGroup id="tabs">
 *   <Tabs />
 * </LayoutGroup>
 * @see https://wardic.dev/reference/solid/layout/layout-group
 */
// ADR-0009, #432. The provider's projection tree (built by DOM ancestry, each Measure pass reading the
// whole tree) gets sibling reflow and nesting right without a group, so a group drives no FLIP: its
// `layoutDependency` is a convenience, a full re-measure.
export function LayoutGroup(props: LayoutGroupProps): JSX.Element {
  // Its id, from the group around and its own, once (Motion's).
  const outer = useLayoutGroupId()
  const id = untrack(() => layoutGroupIdOf(outer, props.id, props.inherit))
  // A server render has no projection system to re-measure (ADR-0021).
  if (!isServer) {
    const projection = useWardicProjection()
    // A group-level dependency change re-measures the whole tree (Q5), compared first as Motion's is
    // (#618). `defer: true` skips the mount read (nodes seed themselves on registration).
    const dependency = createMemo(() => props.layoutDependency)
    createEffect(on(dependency, () => projection.notify(), { defer: true }))
  }
  // Its children in JSX, so they're read where they track: returned from the body, they were read
  // once, and `<LayoutGroup>{open() ? a : b}</LayoutGroup>` never switched (#257's audit). A group that
  // keeps the id around provides none, so its markup and hydration keys are as they were (#432).
  return Bool.match(id === outer, {
    onTrue: () => <>{props.children}</>,
    onFalse: () => <LayoutGroupContext.Provider value={id}>{props.children}</LayoutGroupContext.Provider>,
  })
}
