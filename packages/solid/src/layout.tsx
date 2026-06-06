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
 * the {@link SharedLayoutContext} registry's prior-twin box is captured at mount
 * as the node's `seedOrigin` (the switch-gap — leaver already unmounted), and the
 * `layoutId` is passed so the engine's lead/follow stack can crossfade coexisting
 * twins. The flat delta-key Play (`playFlip`) is gone — one layout model.
 *
 * Idle = zero cost: nothing is measured until a trigger fires (CONTEXT.md
 * observability convention — hot path stays quiet).
 */
import { type Bounds, type Box, boundsToBox, type SpringOptions } from "@wardic/core"
import { measureLayoutBox } from "@wardic/dom"
import { createContext, createEffect, type JSX, on, onCleanup, useContext } from "solid-js"
import { useWardicProjection } from "./provider.tsx"
import type { WardicTransition } from "./use-wardic.tsx"

/**
 * A `layoutId` registry slot: the last box a live member with this id committed
 * (the geometry an entering twin reads to seed its shared-element FLIP), tagged
 * with the OWNER token of the member that wrote it. Held in a mutable cell so a
 * member can update its own box each pass without re-reading the registry, and an
 * entering member reads the LEAVER's box even across the same-frame swap (the
 * leaver writes its box on cleanup, the enterer reads it on mount).
 *
 * The `owner` token disambiguates the two same-frame swap orderings (MEDIUM-1 /
 * MEDIUM-2): a leaver only re-measures / clears the slot when it STILL owns it
 * (`owner === its token`); once a twin re-claims (`setBox` with its own token)
 * the leaver's cleanup is a no-op, so the twin's seed is never clobbered or
 * prematurely cleared. `box`/`owner` `undefined` until the first member measures.
 */
export interface SharedBox {
  box: Bounds | undefined
  /** The token of the member that last wrote `box` (ownership for deferred clear). */
  owner: object | undefined
}

/**
 * The shared-layout registry: matches elements that share a `layoutId` for
 * cross-element (shared-element) FLIP — the {@link Shared layout} from CONTEXT.md.
 * A single registry maps each `layoutId` to its last-known box; an entering
 * element seeds its FLIP from the box left by the leaving element with the same
 * id (framer-motion's `layoutId` shared-element animation).
 *
 * Provided AT THE `WardicProvider` ROOT by default — so `layoutId` works with NO
 * `<LayoutGroup>` (Motion parity). A `<LayoutGroup>` MAY re-provide a NESTED
 * `SharedLayoutContext` later to namespace ids per-group (out of scope now — a
 * future phase; an element always resolves the NEAREST registry).
 */
export interface SharedLayoutContextValue {
  /** Read the last box recorded for `layoutId` (the seed for an entering twin). */
  readonly getBox: (id: string) => Bounds | undefined
  /**
   * Record `layoutId`'s current box AND claim ownership of the slot with `owner`
   * (a per-member token). Writing makes `owner` the slot's owner — a later
   * {@link clearIfOwner} / {@link isOwner} by a DIFFERENT token is a no-op.
   */
  readonly setBox: (id: string, box: Bounds, owner: object) => void
  /** Whether `owner` currently owns `layoutId`'s slot (it wrote the live box). */
  readonly isOwner: (id: string, owner: object) => boolean
  /**
   * Drop `layoutId`'s slot ONLY IF `owner` still owns it (deferred-clear: a
   * leaver schedules this for next microtask so the slot is bounded UNLESS a twin
   * re-claims it first, in which case ownership has moved and this is a no-op).
   */
  readonly clearIfOwner: (id: string, owner: object) => void
}

/**
 * Context carrying the nearest {@link SharedLayoutContextValue}. Defaults to
 * `undefined`; `WardicProvider` provides a root registry so `layoutId` resolves
 * with no `<LayoutGroup>` (Motion parity). {@link useSharedLayout} reads it.
 */
export const SharedLayoutContext = createContext<SharedLayoutContextValue | undefined>(undefined)

/** Read the nearest {@link SharedLayoutContext}, or `undefined` outside a provider. */
export const useSharedLayout = (): SharedLayoutContextValue | undefined => useContext(SharedLayoutContext)

/**
 * Build a fresh shared-layout registry (a `Map<layoutId, SharedBox>`). Used by
 * `WardicProvider` to seed the root registry; a future `<LayoutGroup>` namespace
 * would build its own nested one.
 */
export const makeSharedLayoutRegistry = (): SharedLayoutContextValue => {
  const slots = new Map<string, SharedBox>()
  const slot = (id: string): SharedBox => {
    let s = slots.get(id)
    if (s === undefined) {
      s = { box: undefined, owner: undefined }
      slots.set(id, s)
    }
    return s
  }
  return {
    getBox: (id) => slots.get(id)?.box,
    setBox: (id, box, owner) => {
      const s = slot(id)
      s.box = box
      s.owner = owner
    },
    isOwner: (id, owner) => slots.get(id)?.owner === owner,
    clearIfOwner: (id, owner) => {
      // Only the current owner may clear: a twin that re-claimed the slot (its own
      // token is now the owner) makes a leaver's scheduled clear a no-op.
      if (slots.get(id)?.owner === owner) slots.delete(id)
    },
  }
}

/**
 * Resolve a layout transition to the progress spring's options: a tween-typed
 * transition (or none) falls back to spring defaults `{}` — layout animation is
 * spring-shaped (framer-motion parity), so the box-mix progress is always sprung.
 */
const toSpringOptions = (t: WardicTransition | undefined): SpringOptions =>
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
   * lead/follow stack (crossfade for coexisting twins) AND seeds its switch-gap
   * origin from the {@link SharedLayoutContext} registry's prior-twin box.
   */
  readonly layoutId?: string
  /**
   * Mark this element a scroll container (ADR-0012): its scroll offset is sampled at
   * measure and folded out of its descendants' boxes, so a scroll change between
   * triggers doesn't leak into their FLIP delta.
   */
  readonly layoutScroll?: boolean
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
 * SHARED-ELEMENT (`layoutId`, ADR-0010). When `layoutId` is set and a
 * {@link SharedLayoutContext} is in scope (the provider root by default):
 *   - SWITCH-GAP seed: read the registry's prior-twin box SYNCHRONOUSLY at mount
 *     and capture it as the node's `seedOrigin` — the engine FLIPs the node from
 *     that box to its own on first measure (when no live twin is in the stack). We
 *     capture NOW, not lazily: the registry slot may be cleared by the time the
 *     measure pass runs.
 *   - CROSSFADE: passing `layoutId` enrols the node in the engine's lead/follow
 *     stack, so a coexisting live twin crossfades (engine-side).
 *
 * OWNERSHIP MODEL (MEDIUM-1 / MEDIUM-2), unchanged from the flat path. This member
 * holds a unique `token`; on mount `setBox(layoutId, myBox, token)` claims the slot.
 * On cleanup, ONLY if it still owns the slot (no twin re-claimed):
 *   (a) MEDIUM-2 — if still connected, re-measure + `setBox(final)` so a same-frame
 *       switch twin seeds from the leaver's FINAL box.
 *   (b) MEDIUM-1 — `queueMicrotask(clearIfOwner)` bounds a lone unmount's slot.
 *
 * Must be called within a Solid owner (registers `createEffect` / `onCleanup`).
 */
export const useLayoutMember = (opts: UseLayoutMemberOptions): void => {
  const { element, id, layoutDependency, layoutId, layoutScroll, transition } = opts
  const projection = useWardicProjection()
  const shared = useSharedLayout()

  // Shared-element switch-gap handoff (ADR-0010 + MEDIUM-1/2). Capture the prior
  // twin's box NOW as the seed origin, claim the slot, and hand off the final box
  // (if still owner) + bounded clear on cleanup. `seedOrigin` returns the captured
  // box (a live registry read at measure time could see a cleared slot).
  let seedOrigin: (() => Box | undefined) | undefined
  if (layoutId !== undefined && shared !== undefined) {
    const token: object = {}
    const prior = shared.getBox(layoutId)
    const seedBox = prior !== undefined ? boundsToBox(prior) : undefined
    seedOrigin = () => seedBox
    shared.setBox(layoutId, measureLayoutBox(element), token)
    onCleanup(() => {
      // A twin re-claimed the slot (mount-before-cleanup) — leave it untouched.
      if (!shared.isOwner(layoutId, token)) return
      // Still owner (cleanup-before-mount, or a lone unmount):
      if (element.isConnected) shared.setBox(layoutId, measureLayoutBox(element), token) // MEDIUM-2
      queueMicrotask(() => shared.clearIfOwner(layoutId, token)) // MEDIUM-1
    })
  }

  const handle = projection.register({
    id,
    element,
    springOptions: () => toSpringOptions(transition()),
    ...(layoutId !== undefined ? { layoutId } : {}),
    ...(seedOrigin !== undefined ? { seedOrigin } : {}),
    ...(layoutScroll === true ? { layoutScroll: true } : {}),
  })
  onCleanup(handle.dispose)
  createEffect(on(() => layoutDependency(), () => handle.notify(), { defer: true }))
}

/**
 * `<LayoutGroup>` — a grouping boundary for `layout` elements (ADR-0009). With the
 * box-based projection system the FLIP itself is handled by the provider-owned
 * projection tree (built by DOM ancestry; a measure re-reads the WHOLE tree, so
 * sibling reflow and nesting work WITHOUT a group). So `<LayoutGroup>` no longer
 * drives FLIP — it is a thin wrapper whose `layoutDependency` triggers a full
 * re-measure (a convenience for "re-measure my subtree when this value changes").
 *
 * A future phase repurposes `<LayoutGroup>` for `layoutId` namespacing (a nested
 * shared-layout registry) and as a measure-scope boundary (`layoutRoot`).
 */
export function LayoutGroup(props: {
  readonly children: JSX.Element
  /** A value/signal whose change requests a full projection re-measure (sibling reflow falls out). */
  readonly layoutDependency?: unknown
}): JSX.Element {
  const projection = useWardicProjection()
  // A group-level dependency change re-measures the whole tree (Q5). `defer: true`
  // skips the mount read (nodes seed themselves on registration).
  createEffect(on(() => props.layoutDependency, () => projection.notify(), { defer: true }))
  return props.children
}
