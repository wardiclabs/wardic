/**
 * @wardic/solid — the Solid framework binding: `WardicProvider`; `createWard`, a **Ward** to
 * spread onto an element, with variant orchestration through `ward.Provider`; `wardic.*`,
 * `wardic.create()` and the `use:wardic` directive; `<AnimatePresence>`, `<LayoutGroup>` and
 * `<Reorder>`; and the low-level `createX` primitives (ADR-0008, ADR-0042). Built directly on
 * `effect`'s in-core reactivity (`effect/reactivity`) — there is no `@effect-atom/atom-solid`
 * dependency.
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
 * `createInView` / `createDrag` (recognizer-backed signals) and `createReducedMotion`
 * (`Probe.prefersReducedMotion` atom bridge).
 */
export {
  type CreateDragOptions,
  createDrag,
  createFocus,
  createHover,
  createInView,
  createPress,
  createReducedMotion,
} from "./sensors.ts"

/**
 * Live values (#130, ADR-0043): a value the user moves, given in an element's `style` (an accessor
 * or an Atom), followed while no layer of the Override stack sets its key. `createTransform` maps
 * one (through a function, or ranges), `createSpring` follows one with a spring.
 */
export { createSpring, createTransform } from "./live-value.ts"
export type { Live, LiveSource } from "./live-style.ts"

/**
 * `createWard` — a **Ward**, one element's motion binding (ADR-0005, ADR-0042): recognizers ->
 * Override stack -> spring/tween Retarget -> the gate, which commits each frame onto the
 * element (ADR-0034), with an SSR-correct synchronous initial (ADR-0003). Returns a callable
 * `Ward` to spread onto a JSX element (`<div {...ward()}>`).
 */
export {
  type Ward,
  type WardConfig,
  type WardStyle,
  type WardValue,
  type WardicDragTransition,
  type WardicReducedMotion,
  type WardicTransformShorthands,
  type WardicTransition,
  type WardicValues,
  type WardProps,
  type WardUserProps,
  createWard,
} from "./create-ward.tsx"

/**
 * `<Reorder>` (ADR-0020, ADR-0008 Tier 1): `Reorder.Group` / `Reorder.Item`, built on the
 * headless API: `createReorderGroup` (a `ReorderGroup`) and `createReorderItem` (a
 * `ReorderItemWard`) spread onto any elements, and the `use:reorderItem` directive
 * (client-only). The app owns `values`, sets them from `onReorder`, and keys its items
 * with `<For>`.
 */
export {
  createReorderGroup,
  createReorderItem,
  Reorder,
  type ReorderElementTag,
  type ReorderGroup,
  type ReorderGroupProps,
  type ReorderItemProps,
  type ReorderGroupConfig,
  type ReorderGroupSpread,
  type ReorderGroupUserProps,
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
 * the `createWard` signal-sink path and the `wardic.create(Component)` commit-sink
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
 * `createWard` callable) publishes into it; inheriting children resolve the name
 * against their own `variants` map.
 */
export {
  type WardicVariantContextValue,
  useVariantContext,
  WardicVariantContext,
} from "./variants.ts"

/**
 * `wardic` (ADR-0008 Tier 1, ADR-0042): the `wardic.*` motion-element proxy, `wardic.create(tag)`
 * HOC, and, called, the `use:wardic` directive. `wardic.div` / `wardic.create("div")` build a
 * motion component that puts a Ward on its element and merges the animated style over the
 * user's static style (`Style.over`) while preserving the user's ref (`mergeRefs`) and passing
 * all other props through. `<div use:wardic={config}>` puts one on any element, client-only:
 * import `wardic` for it to resolve.
 */
export {
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
