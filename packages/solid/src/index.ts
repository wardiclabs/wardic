/**
 * @wardic/solid — the Solid framework binding (the v0.1 user surface).
 *
 * Will provide the layered API from docs/plans/v0.1.md: `WardicProvider`, the primary
 * `useWardic` hook, variant orchestration (`ward.Provider`), the `wardic.create()` HOC,
 * the `use:ward` directive, `<AnimatePresence>` / `<LayoutGroup>`, and the low-level
 * `createX` primitives. Built directly on `effect`'s in-core reactivity
 * (`effect/reactivity`) — there is no `@effect-atom/atom-solid` dependency.
 *
 * Only a placeholder provider exists today — see implementation order steps 10–15.
 */
export const VERSION = "0.1.0-alpha.0"

/**
 * `WardicProvider` (one Effect runtime + `AtomRegistry` per ADR-0006), the
 * `useWardicRuntime` accessor, and the scoped-fiber runner (`runScoped` /
 * `useWardicFiber`) that interrupts forked fibers on consumer unmount.
 *
 * NOTE: `provider.tsx` ships Solid JSX, so consumers must add `@wardic/solid`
 * (and any other workspace package shipping Solid JSX) to `ssr.noExternal` in
 * their Vite config so the Solid plugin transforms it — already pre-wired in
 * examples/solid-start-basic.
 */
export {
  runScoped,
  useAnimateLayout,
  useWardicFiber,
  useWardicGate,
  useWardicRuntime,
  WardicProvider,
} from "./provider.tsx"
export type { AnimateLayout, WardicEnv, WardicRuntime, WardicServices } from "./provider.tsx"
export type { AnimateLayoutOptions } from "@wardic/dom/ProjectionSystem"

/**
 * The provider-owned reactive flush gate (ADR-0006): an accumulator + gated
 * Refresh frames + single-`batch()` flush with two sink modes (signal / commit).
 * It's `@wardic/dom`'s, built by the provider with Solid's `batch` (ADR-0031), and
 * `useWardicGate` returns it; the types are re-exported here.
 */
export type { Shape as FlushGate, Sink as FlushSink } from "@wardic/dom/FlushGate"

/**
 * Reactive bridges (ADR-0006): `streamToSignal` (core `Stream` -> Solid signal,
 * scoped fiber) and `fromAtom` (Effect `Atom` -> Solid signal via the runtime's
 * `AtomRegistry`).
 */
export { fromAtom, streamToSignal } from "./bridge.ts"

/**
 * Low-level sensor hooks: `createHover` / `createPress` / `createFocus` /
 * `createInView` / `createDrag` (recognizer-backed signals), `createReducedMotion`
 * (`Probe.prefersReducedMotion` atom bridge), and the pure `createTransform`.
 */
export {
  type CreateDragOptions,
  createDrag,
  createFocus,
  createHover,
  createInView,
  createPress,
  createReducedMotion,
  createTransform,
} from "./sensors.ts"

/**
 * `useWardic` — the primary motion spine (ADR-0005): recognizers -> Override
 * stack -> spring/tween Retarget -> the gate, which commits each frame onto the
 * element (ADR-0034), with an SSR-correct synchronous initial (ADR-0003). Returns a callable `ward` to
 * spread onto a JSX element (`<div {...ward()}>`).
 */
export {
  type Ward,
  type WardicConfig,
  type WardicDragTransition,
  type WardicReducedMotion,
  type WardicTransformShorthands,
  type WardicTransition,
  type WardicValues,
  type WardProps,
  type WardUserProps,
  useWardic,
} from "./use-wardic.tsx"

/**
 * `<Reorder>` (ADR-0020, ADR-0008 Tier 1): `Reorder.Group` / `Reorder.Item` (also
 * named `ReorderGroup` / `ReorderItem`), built on the headless API: `createReorderGroup`
 * and `createReorderItem` spread onto any elements, and the `use:reorderItem` directive
 * (client-only). The app owns `values`, sets them from `onReorder`, and keys its items
 * with `<For>`.
 */
export {
  createReorderGroup,
  createReorderItem,
  Reorder,
  type ReorderElementTag,
  ReorderGroup,
  type ReorderGroupProps,
  ReorderItem,
  type ReorderItemProps,
  type ReorderGroupConfig,
  type ReorderGroupWard,
  type ReorderGroupWardProps,
  type ReorderItemConfig,
  type ReorderItemSpread,
  type ReorderItemUserProps,
  type ReorderItemWard,
  type ReorderItemLayout,
  type ReorderItemDirectiveValue,
  reorderItem,
} from "./reorder.tsx"

/**
 * `runDragTrack` (ADR-0004): the binding-orchestrated drag track shared by both
 * the `useWardic` signal-sink path and the `wardic.create(Component)` commit-sink
 * path (it lives in `runSpine`, which both share). The pointer DIRECT-SETS `x`/`y`
 * while the spring drives every other key + `whileDrag`; the release is pluggable
 * (decay momentum / snapToOrigin / rest-in-place).
 */
export {
  type DragSnapshot,
  type DragTrackConfig,
  type RunDragTrackOptions,
  runDragTrack,
} from "./drag.ts"

/**
 * Variant orchestration context (ADR-0007): the `WardicVariantContext` that
 * carries the parent's current variant NAME + inherited transition down the
 * tree, and the `useVariantContext` reader. `ward.Provider` (a property on the
 * `useWardic` callable) publishes into it; inheriting children resolve the name
 * against their own `variants` map.
 */
export {
  type WardicVariantContextValue,
  useVariantContext,
  WardicVariantContext,
} from "./variants.ts"

/**
 * `wardic.create(tag)` HOC + the `wardic.*` motion-element proxy (ADR-0008 Tier
 * 1): `wardic.div` / `wardic.create("div")` build a motion component that wires
 * the element's motion props through `useWardic` and merges the animated style
 * over the user's static style (`Style.over`) while preserving the user's ref
 * (`mergeRefs`) and passing all other props through.
 */
export {
  create,
  type Wardic,
  type WardicMotionProps,
  type WardicProps,
  wardic,
} from "./wardic.tsx"

/**
 * `<AnimatePresence>` — single-child exit-before-unmount (ADR-0007). Wraps a
 * conditional child (e.g. under a `<Show>`); when the child leaves, the presence
 * RETAINS its DOM node and drives the child's `exit` target (parent-driven, since
 * Solid disposes the leaving child's reactive owner), removing the node once the
 * exit settles. `PresenceContext` carries the registrar down to descendant spines.
 * `initial={false}` starts the child present at its first render at its `animate` (#134).
 */
export {
  AnimatePresence,
  type AnimatePresenceProps,
  PresenceContext,
  type PresenceContextValue,
  type PresenceRecord,
  usePresenceContext,
} from "./presence.tsx"

/**
 * `layout` / `layoutId` surface (ADR-0009 + ADR-0005). `layout` FLIP runs on the
 * box-based projection system: `useLayoutMember` registers the element as a
 * projection node (the provider-owned tree handles nesting + sibling reflow).
 * `<LayoutGroup>` is now a thin grouping boundary whose `layoutDependency`
 * triggers a full re-measure. `layoutId` shared-element animation (Switch and
 * Crossfade) is matched entirely by the projection engine (ADR-0010 *Amendment
 * (#13)*); `measureLayoutBox` reads an untransformed box.
 */
export { type UseLayoutMemberOptions, LayoutGroup, useLayoutMember } from "./layout.tsx"
export { measureLayoutBox } from "@wardic/dom/ProjectionSystem"

/**
 * `use:ward` — the directive surface (ADR-0008 Tier 1). `<div use:ward={config}>`
 * drives the host element through the shared spine (the same path as every Wardic
 * element). CLIENT-ONLY (post-hydration, no SSR initial —
 * may flash; use `useWardic` / `wardic.create` for SSR-correct initial, ADR-0003).
 *
 * IMPORTANT: consumers MUST `import { ward } from "@wardic/solid"` for `use:ward`
 * to resolve — Solid's `use:` compiles to a bare `ward(...)` reference, so the
 * import retains the symbol (no tree-shake).
 */
export { ward } from "./directive.ts"
