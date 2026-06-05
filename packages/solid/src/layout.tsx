/**
 * The `layout` / `layoutId` binding surface (ADR-0009 + ADR-0005).
 *
 * `layout` FLIP runs on the box-based **projection system** (`./projection.ts`):
 * {@link useLayoutMember} just registers the element as a projection node — the
 * provider-owned system owns measurement (a shared `ResizeObserver` + a
 * `layoutDependency`/registration trigger) and the per-frame box-projection derive
 * (relative + `treeScale`, nested-correct). {@link LayoutGroup} is now a thin
 * grouping boundary (the tree handles nesting + sibling reflow without it).
 *
 * `layoutId` shared-element FLIP still uses the FLAT delta-key Play here
 * ({@link playFlip} over `x`/`y`/`scaleX`/`scaleY` toward {@link FLIP_IDENTITY},
 * seeded from the prior twin's box via the {@link SharedLayoutContext} registry).
 * Migrating `layoutId` onto the box tree is a later phase; until then `playFlip` +
 * {@link measureLayoutBox} remain for it.
 *
 * Idle = zero cost: nothing is measured until a trigger fires (CONTEXT.md
 * observability convention — hot path stays quiet).
 */
import { type Bounds, FLIP_IDENTITY, flip, type SpringOptions, springValues } from "@wardic/core"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import { createContext, createEffect, type JSX, on, onCleanup, useContext } from "solid-js"
import { measureLayoutBox } from "@wardic/dom"
import type { FlushGate } from "./gate.ts"
import { runScoped, useWardicProjection, type WardicRuntime } from "./provider.tsx"
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

/** Structural box equality on the geometry that drives a FLIP delta. */
const boxesEqual = (a: Bounds, b: Bounds): boolean =>
  a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height

/** Whether a FLIP delta is the resting identity (a no-op Play). */
const isIdentityDelta = (d: { x: number; y: number; scaleX: number; scaleY: number }): boolean =>
  d.x === FLIP_IDENTITY.x && d.y === FLIP_IDENTITY.y && d.scaleX === FLIP_IDENTITY.scaleX && d.scaleY === FLIP_IDENTITY.scaleY

/**
 * The Play half of FLIP for one member: spring the four FLIP keys from the
 * INVERTED `delta` toward {@link FLIP_IDENTITY}, writing each frame into `id`'s
 * gate entry so the keys merge with the element's other animated keys (project
 * once, ADR-0006). A `delta` already at identity is a no-op (no reflow).
 *
 * Returns the forked fiber so the caller can interrupt a superseded Play before
 * starting the next one (a fast re-trigger), or `undefined` for a no-op delta.
 */
const playFlip = (
  runtime: WardicRuntime,
  gate: FlushGate,
  id: string,
  delta: { x: number; y: number; scaleX: number; scaleY: number },
  transition: WardicTransition | undefined,
): Fiber.Fiber<void, never> | undefined => {
  if (isIdentityDelta(delta)) return undefined

  // Seed the gate at the inverted delta immediately (so the very first projected
  // frame shows the element back at its `from` box — no flash before frame 1),
  // then spring toward identity. A tween-typed transition still uses spring
  // defaults here (layout animation is spring-shaped in framer-motion parity).
  gate.write(id, { x: delta.x, y: delta.y, scaleX: delta.scaleX, scaleY: delta.scaleY })

  const springOpts = transition !== undefined && transition.type !== "tween" ? transition : {}
  return runScoped(
    runtime,
    Stream.runForEach(
      springValues(
        { x: FLIP_IDENTITY.x, y: FLIP_IDENTITY.y, scaleX: FLIP_IDENTITY.scaleX, scaleY: FLIP_IDENTITY.scaleY },
        springOpts,
        // from: the inverted delta (Invert); velocities default to 0.
        { x: delta.x, y: delta.y, scaleX: delta.scaleX, scaleY: delta.scaleY },
        {},
      ),
      (frame) => Effect.sync(() => gate.write(id, frame.value)),
    ),
  )
}

/** Options for {@link useLayoutMember}. */
export interface UseLayoutMemberOptions {
  /** The provider runtime the FLIP Play forks on. */
  readonly runtime: WardicRuntime
  /** The provider-owned flush gate (ADR-0006). */
  readonly gate: FlushGate
  /** The element's gate id (the spine's entry — FLIP writes merge here). */
  readonly id: string
  /** The live DOM element to measure + FLIP. */
  readonly element: HTMLElement
  /** The element's `layoutDependency` accessor (a re-measure trigger). */
  readonly layoutDependency: () => unknown
  /** The element's effective transition (drives the FLIP spring). */
  readonly transition: () => WardicTransition | undefined
}

/**
 * Resolve a layout transition to the progress spring's options: a tween-typed
 * transition (or none) falls back to spring defaults `{}` — layout animation is
 * spring-shaped (framer-motion parity), so the box-mix progress is always sprung.
 */
const toSpringOptions = (t: WardicTransition | undefined): SpringOptions =>
  t !== undefined && t.type !== "tween" ? t : {}

/**
 * Wire a single `layout` element into FLIP. Called from the `useWardic` spine
 * once the element + gate id exist (ADR-0005). Behaviour splits on context:
 *
 *   - UNDER a `<LayoutGroup>`: register the member; the group owns the trigger +
 *     the batched delta-key Play (enabling sibling reflow). A change to THIS
 * Registers the element as a node in the box-based projection system (ADR-0009),
 * whether or not it is under a `<LayoutGroup>` — the projection tree is built by
 * DOM ancestry, so nesting and sibling reflow are handled uniformly. The system
 * owns measurement (one shared `ResizeObserver` + this `notify`) and the per-frame
 * box-projection derive; a `layoutDependency` change requests a re-measure. No FLIP
 * on first measure.
 *
 * Must be called within a Solid owner (registers `createEffect` / `onCleanup`).
 */
export const useLayoutMember = (opts: UseLayoutMemberOptions): void => {
  const { element, id, layoutDependency, transition } = opts
  const projection = useWardicProjection()
  const handle = projection.register({ id, element, springOptions: () => toSpringOptions(transition()) })
  onCleanup(handle.dispose)
  createEffect(on(() => layoutDependency(), () => handle.notify(), { defer: true }))
}

/** Options for {@link useLayoutIdMember}. */
export interface UseLayoutIdMemberOptions {
  /** The provider runtime the FLIP Play forks on. */
  readonly runtime: WardicRuntime
  /** The provider-owned flush gate (ADR-0006). */
  readonly gate: FlushGate
  /** The element's gate id (the spine's entry — FLIP writes merge here). */
  readonly id: string
  /** This element's `layoutId` — the shared-element match key. */
  readonly layoutId: string
  /** The live DOM element to measure + FLIP. */
  readonly element: HTMLElement
  /** The element's effective transition (drives the FLIP spring). */
  readonly transition: () => WardicTransition | undefined
}

/**
 * Wire a single `layoutId` element into shared-element (cross-element) FLIP —
 * the {@link Shared layout} from CONTEXT.md, framer-motion's `layoutId` parity.
 * Called from the `useWardic` spine once the element + gate id exist (ADR-0005),
 * in addition to (and composing with) any standalone/grouped `layout` FLIP.
 *
 * Resolves the NEAREST {@link SharedLayoutContext} (the provider root by default;
 * a future `<LayoutGroup>` namespace if present). On mount (element live):
 *
 *   1. Measure THIS element's untransformed box.
 *   2. If the registry already holds a box for this `layoutId` (a PRIOR twin
 *      either still alive or just left), seed a FLIP from that prior box -> this
 *      element's measured box and Play it to identity via the spine — the
 *      entering element visually departs from where its twin was (shared-element
 *      animation). The basic same-frame swap (an indicator unmounting at A and
 *      mounting at B) falls out: A wrote its box to the registry on cleanup, B
 *      reads it here and FLIPs A->B.
 *   3. If there is NO prior box (first appearance of this id), no FLIP — just
 *      seed the registry with this element's box.
 *
 * OWNERSHIP MODEL (MEDIUM-1 / MEDIUM-2). This member holds a unique `token`. On
 * mount it `setBox(layoutId, myBox, token)` — becoming the slot's owner. On
 * cleanup it interrupts its Play, THEN acts ONLY if it still owns the slot (no
 * twin re-claimed it):
 *
 *   (a) MEDIUM-2 — if the element is still connected, RE-MEASURE its CURRENT box
 *       and `setBox(final, token)` so a same-frame twin seeds from the leaver's
 *       FINAL position (not its stale mount box).
 *   (b) MEDIUM-1 — `queueMicrotask(() => clearIfOwner(layoutId, token))` so a lone
 *       unmount BOUNDS the slot (cleared next microtask; no stale-FLIP-on-reuse)
 *       UNLESS a twin re-claims it first (then `clearIfOwner` is a no-op).
 *
 * If a twin already re-claimed the slot before this cleanup ran (`!isOwner`), do
 * NOTHING — the twin owns the seed; neither overwrite nor clear.
 *
 * BOTH swap orderings verified (Solid flushes spine effects synchronously):
 *   - mount-before-cleanup: the twin's `setBox` makes it the owner, so the
 *     leaver's cleanup sees `isOwner === false` and neither overwrites nor clears
 *     — the twin keeps its box.
 *   - cleanup-before-mount: the leaver (still owner) re-measures + `setBox(final)`
 *     + schedules the microtask clear; the twin then mounts in the SAME task,
 *     reads the leaver's FINAL box, and re-claims (`setBox` with the twin's token)
 *     BEFORE the microtask fires — so `clearIfOwner(leaver token)` is a no-op.
 *   - lone unmount (no twin): the microtask `clearIfOwner` fires and deletes the
 *     slot (bounded).
 *
 * NOTE: an async / Suspense-mounted twin (a later task) would miss the seed (the
 * microtask clear has already fired) — acceptable for v0.1.
 *
 * Must be called within a Solid owner (registers `onCleanup`).
 */
export const useLayoutIdMember = (opts: UseLayoutIdMemberOptions): void => {
  const { element, gate, id, layoutId, runtime, transition } = opts
  const shared = useSharedLayout()
  // No registry in scope (no <WardicProvider> root registry) — nothing to match
  // against; layoutId is a no-op. (The provider provides one by default.)
  if (shared === undefined) return

  // This member's unique ownership token (identity-only). It tags every setBox so
  // a twin's re-claim is distinguishable from this member's own writes.
  const token = {}

  // Per-member in-flight Play fiber, interrupted before the next Play so a fast
  // re-trigger does not stack overlapping springs on the same gate id.
  let playing: Fiber.Fiber<void, never> | undefined
  const play = (from: Bounds, to: Bounds): void => {
    if (playing !== undefined) runtime.runFork(Fiber.interrupt(playing))
    playing = playFlip(runtime, gate, id, flip(from, to), transition())
  }

  // (1) Measure THIS element's box now (the element is live — this runs from the
  // spine's on(el) effect). (2) Read the registry's prior box for this id; if one
  // exists (a prior twin), FLIP from it -> this box. (3) Claim the slot with this
  // element's box + token (the seed a later twin reads; we now own the slot).
  const myBox = measureLayoutBox(element)
  const priorBox = shared.getBox(layoutId)
  if (priorBox !== undefined && !boxesEqual(priorBox, myBox)) play(priorBox, myBox)
  shared.setBox(layoutId, myBox, token)

  onCleanup(() => {
    if (playing !== undefined) runtime.runFork(Fiber.interrupt(playing))
    // If a twin already re-claimed the slot (mount-before-cleanup), it is now the
    // owner — do NOTHING (no overwrite, no clear): the twin owns the seed.
    if (!shared.isOwner(layoutId, token)) return
    // We still own the slot (cleanup-before-mount, or a lone unmount).
    // (a) MEDIUM-2: re-measure the element's FINAL box (if still connected) so a
    //     same-frame twin seeds from where we ACTUALLY ended (not our mount box).
    if (element.isConnected) shared.setBox(layoutId, measureLayoutBox(element), token)
    // (b) MEDIUM-1: schedule a bounded clear. A same-frame twin mounting in this
    //     task re-claims (setBox twin token) BEFORE this microtask runs, making
    //     clearIfOwner a no-op; a lone unmount has no twin, so it clears the slot.
    queueMicrotask(() => shared.clearIfOwner(layoutId, token))
  })
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
