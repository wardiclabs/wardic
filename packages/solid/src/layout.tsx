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
import type * as Point from "@wardic/core/Point"
import type * as Projection from "@wardic/core/Projection"
import type * as Machine from "@wardic/core/Machine"
import type { ProjectionNodeHandle } from "@wardic/dom"
import { constTrue } from "effect/Function"
import * as UndefinedOr from "effect/UndefinedOr"
import { createEffect, type JSX, on, onCleanup } from "solid-js"
import { useWardicProjection } from "./provider.tsx"
import { isServer } from "./server.ts"
import type { WardicTransition } from "./use-wardic.tsx"

/**
 * Resolve a layout transition to the progress spring's options: a tween-typed
 * transition (or none) falls back to spring defaults `{}` — layout animation is
 * spring-shaped (framer-motion parity), so the box-mix progress is always sprung.
 */
const toSpringOptions = (t: WardicTransition | undefined): Machine.SpringOptions =>
  t !== undefined && t.type !== "tween" ? t : {}

/** Options for {@link useLayoutMember}. */
export interface UseLayoutMemberOptions {
  /** The element's gate id (the spine's entry — `@projection` writes merge here). */
  readonly id: string
  /** The live DOM element to measure + project. */
  readonly element: HTMLElement
  /** The element's `layoutDependency` accessor (a re-measure trigger). */
  readonly layoutDependency: () => unknown
  /** The element's effective transition (drives the projection progress spring). */
  readonly transition: () => WardicTransition | undefined
  /**
   * The element's `layoutId` (shared-element key, ADR-0010), or omitted for a plain
   * `layout` element. When set, the one node joins the engine's per-`layoutId`
   * lead/follow stack (crossfade for coexisting twins) and takes a Switch seed from
   * a twin disposed in the same task — both engine-side (*Amendment (#13)*).
   */
  readonly layoutId?: string
  /**
   * Mark this element a scroll container (ADR-0012): its scroll offset is sampled at
   * measure and folded out of its descendants' boxes, so a scroll change between
   * triggers doesn't leak into their FLIP delta.
   */
  readonly layoutScroll?: boolean
  /** Mark this element a stable projection sub-root (ADR-0013): self-snap + boundary + persistent relative anchor. */
  readonly layoutRoot?: boolean
  /** This element's relative-projection anchor (ADR-0013): a 0–1 Point, or `false` to force absolute. */
  readonly layoutAnchor?: Point.Point | false
  /** Raise the node while it's dragged (ADR-0016 *Amendment (Reorder)*; internal, a `<Reorder>` item's). */
  readonly raiseWhileDragged?: boolean
  /** The element's Layout mode, read at each layout animation's start (ADR-0009, *Amendment (#42)*). Default `true`. */
  readonly layoutMode?: () => Projection.LayoutMode
  /** The element's own scale, read at each handover and each frame it follows (ADR-0010 *Amendment (#8)*). */
  readonly ownScale?: () => Point.Point
  /** The element's own `rotate` and opacity, which a handover blends into (ADR-0010 *Amendment (#166)*). */
  readonly ownRotate?: () => number
  readonly ownOpacity?: () => number
}

/**
 * Wire an element into layout projection (ADR-0009 + ADR-0010) — exactly ONE
 * projection node per element, whether it has `layout`, `layoutId`, or both. Called
 * from the `useWardic` spine once the element + gate id exist.
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
export const useLayoutMember = (opts: UseLayoutMemberOptions): ProjectionNodeHandle => {
  const { element, id, layoutAnchor, layoutDependency, layoutId, layoutMode, layoutRoot, layoutScroll, ownOpacity, ownRotate, ownScale, raiseWhileDragged, transition } = opts
  const projection = useWardicProjection()

  const handle = projection.register({
    id,
    element,
    springOptions: () => toSpringOptions(transition()),
    // The transition's reduced-motion opt-out (ADR-0029), read at each layout animation's start.
    respectReducedMotion: () =>
      UndefinedOr.match(transition(), { onUndefined: constTrue, onDefined: (t) => t.respectReducedMotion !== false }),
    ...(layoutId !== undefined ? { layoutId } : {}),
    ...(layoutScroll === true ? { layoutScroll: true } : {}),
    ...(layoutRoot === true ? { layoutRoot: true } : {}),
    ...(layoutAnchor !== undefined ? { layoutAnchor } : {}),
    ...(raiseWhileDragged === true ? { raiseWhileDragged: true } : {}),
    ...UndefinedOr.match(layoutMode, { onUndefined: () => ({}), onDefined: (mode) => ({ layoutMode: mode }) }),
    ...UndefinedOr.match(ownScale, { onUndefined: () => ({}), onDefined: (scale) => ({ ownScale: scale }) }),
    ...UndefinedOr.match(ownRotate, { onUndefined: () => ({}), onDefined: (rotate) => ({ ownRotate: rotate }) }),
    ...UndefinedOr.match(ownOpacity, { onUndefined: () => ({}), onDefined: (opacity) => ({ ownOpacity: opacity }) }),
  })
  onCleanup(handle.dispose)
  createEffect(on(() => layoutDependency(), () => handle.notify(), { defer: true }))
  return handle // ADR-0016: the spine forwards the drag methods to runDragTrack
}

/**
 * `<LayoutGroup>` — a grouping boundary for `layout` elements (ADR-0009). With the
 * box-based projection system the FLIP itself is handled by the provider-owned
 * projection tree (built by DOM ancestry; a measure re-reads the WHOLE tree, so
 * sibling reflow and nesting work WITHOUT a group). So `<LayoutGroup>` no longer
 * drives FLIP — it is a thin wrapper whose `layoutDependency` triggers a full
 * re-measure (a convenience for "re-measure my subtree when this value changes").
 *
 * A future phase repurposes `<LayoutGroup>` for `layoutId` namespacing (prefixing
 * its members' ids before they reach the engine, as Motion's `LayoutGroup` does)
 * and as a measure-scope boundary (`layoutRoot`).
 */
export function LayoutGroup(props: {
  readonly children: JSX.Element
  /** A value/signal whose change requests a full projection re-measure (sibling reflow falls out). */
  readonly layoutDependency?: unknown
}): JSX.Element {
  // A server render has no projection system to re-measure (ADR-0021).
  if (isServer) return props.children
  const projection = useWardicProjection()
  // A group-level dependency change re-measures the whole tree (Q5). `defer: true`
  // skips the mount read (nodes seed themselves on registration).
  createEffect(on(() => props.layoutDependency, () => projection.notify(), { defer: true }))
  return props.children
}
