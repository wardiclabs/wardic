/**
 * @wardic/solid — the Solid framework binding: `WardicProvider` and `WardicConfig`; `createWard`, a **Ward** to
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
  createInstantLayoutTransition,
  createInstantTransition,
  createResetProjection,
  runScoped,
  useAnimateLayout,
  useWardicFiber,
  useWardicGate,
  useWardicRuntime,
  WardicProvider,
  LazyWardic,
} from "./provider.tsx"

/**
 * **Features** (#511, ADR-0067): what a Slim element (`w.*`) has only when it's chosen, on a
 * `WardicProvider` or a `LazyWardic` (`features={[colors]}`), each its own import so an app ships only
 * those it uses; a Complete element (`wardic.*`) has every one. `colors`: every CSS colour space beyond
 * a hex, `rgb()`, `hsl()` and the colour names. `layout`: layout animations, the props `layout`,
 * `layoutId`, `layoutScroll` and `layoutRoot` (`LayoutGroup` and `Reorder` bring it themselves).
 */
export type { Feature, FeatureLoad, Features, FeaturesProp } from "./feature.ts"
export { colors } from "./features/colors.ts"
export { layout } from "./features/layout.ts"
/**
 * The gestures (#511, ADR-0067 decision 3), a Feature each: `hover`, `press` (its Keyboard presses
 * included), `focus`, `inView`, `pan` and `drag` (`dragControls` and the release's inertia included).
 * Every one but `inView` stands on the gestures' input: the Environment's when it gives one, else the
 * DOM's. Motion's bundles: `domAnimation` (`hover`, `press`, `focus`, `inView`) and `domMax` (every
 * Feature).
 */
export { drag } from "./features/drag.ts"
export { focus } from "./features/focus.ts"
export { hover } from "./features/hover.ts"
export { inView } from "./features/in-view.ts"
export { pan } from "./features/pan.ts"
export { press } from "./features/press.ts"
export { domAnimation } from "./features/dom-animation.ts"
export { domMax } from "./features/dom-max.ts"
// The Instant change and the Projection reset (#443): Motion's `useInstantTransition` and kin.
export type { InstantTransition } from "./instant.ts"
// `WardicConfig`'s `transformPagePoint` helpers (#443, Motion's): a drag inside a transformed parent, or an SVG's viewBox.
export { correctParentTransform, transformViewBoxPoint } from "./page-point.ts"
export type { AnimateLayout, WardicEnv, WardicRuntime, WardicServices } from "./runtime.ts"
export type { AnimateLayoutOptions } from "@wardic/dom/ProjectionSystem"

/**
 * `<WardicConfig>` (#434, Motion's `MotionConfig`): settings for the Wardic elements below it, its
 * **Config transition** their default `transition`. It nests anywhere under a `WardicProvider`.
 */
export { WardicConfig, type WardicConfigProps } from "./wardic-config.tsx"

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
export type { WardicDragInfo, WardicPoint, WardicPointInfo, WardicPressEvent, WardicPressInfo, WardicPressInput } from "./gesture-info.ts"
export type { WardicBoundingBox, WardicDragConstraints, WardicMeasureDragConstraints } from "./drag-constraints.ts"
// Drag controls (#431, Motion's `useDragControls`): a drag started from a handle or a track.
export { createDragControls, type WardicDragControls, type WardicDragControlsOptions } from "./drag-controls.ts"
// Imperative animation (#433, Motion's `useAnimate`): an Animation scope, its `animate` and its Playback controls;
// a sequence of Segments (Motion's), on the same controls.
export { createAnimate } from "./create-animate.ts"
export type {
  WardicAnimate,
  WardicAnimateOptions,
  WardicAnimationScope,
  WardicAnimationSequence,
  WardicAnimationSubject,
  WardicElementSegment,
  WardicFunctionSegment,
  WardicPlaybackControls,
  WardicPlayState,
  WardicSegment,
  WardicSegmentOptions,
  WardicSegmentTarget,
  WardicSequenceLabel,
  WardicSequenceOptions,
  WardicSequenceTime,
} from "./imperative.ts"
// Animation controls (#433, Motion's `useAnimationControls`): `animate={controls}`, then `start`, `set` and `stop`.
export { createAnimationControls, type WardicAnimationControls, type WardicControlsDefinition } from "./animation-controls.ts"

/**
 * Low-level sensor hooks: `createHover` / `createPress` / `createFocus` /
 * `createInView` / `createDrag` (recognizer-backed signals) and `createReducedMotion`
 * (`Probe.prefersReducedMotion` atom bridge); `createReducedMotionConfig`, the nearest config's
 * setting over it, and `createPageInView`, whether the page is shown (#443).
 */
export {
  type CreateDragOptions,
  createInView,
  createPageInView,
  createReducedMotion,
  createReducedMotionConfig,
} from "./sensors.ts"
export { createDrag } from "./drag-sensor.ts"
export { createFocus } from "./focus-sensor.ts"
export { createHover } from "./hover-sensor.ts"
export { createPress } from "./press-sensor.ts"
// `createCycle` (#443, Motion's `useCycle`): one of a list of states at a time, stepped through.
export { createCycle, type Cycle } from "./cycle.ts"

/**
 * Live values (#130, ADR-0043): a value the user moves, given in an element's `style` (an accessor
 * or an Atom), followed while no layer of the Override stack sets its key. `createTransform` maps
 * one (through a function, or ranges), `createFollowValue` follows one on any transition (#441) and
 * `createSpring` with a spring; `createScroll`, `createVelocity` and `createTime` make one from a
 * scroll, a value's velocity and time (#234). `createAnimationFrame` tells a callback each frame, and `createWillChange` makes a
 * `willChange` that turns on as its element animates (#443).
 */
export {
  createAnimationFrame,
  createFollowValue,
  createScroll,
  createSpring,
  createTime,
  createTransform,
  createVelocity,
  createWillChange,
  type ElementSource,
  type ScrollOptions,
  type ScrollValues,
} from "./live-value.ts"
export type { FollowAccessor, FollowValueOptions, Live, LiveSource, SpringAccessor, WillChange } from "./live-style.ts"

/**
 * `createWard` — a **Ward**, one element's motion binding (ADR-0005, ADR-0042): recognizers ->
 * Override stack -> spring/tween Retarget -> the gate, which commits each frame onto the
 * element (ADR-0034), with an SSR-correct synchronous initial (ADR-0003). Returns a callable
 * `Ward` to spread onto a JSX element (`<div {...ward()}>`).
 */
export { createWard } from "./complete.ts"
export { type Ward, type WardStyle, type WardValue, type WardProps, type WardUserProps } from "./create-ward.tsx"
export type {
  WardConfig,
  WardicDragTransition,
  WardicViewport,
  WardicReducedMotion,
  WardicSkipAnimations,
  WardicInertia,
  WardicStagger,
  WardicPath,
  WardicPropagate,
  WardicTransformShorthands,
  WardicTransformTemplate,
  WardicScaleCorrector,
  WardicLayoutBox,
  WardicTransformPoint,
  WardicAnimationDefinition,
  WardicTransition,
  WardicTransitionEntries,
  WardicValueKey,
  WardicValueTransition,
  WardicKeyframes,
  WardicTargetValues,
  WardicValues,
  WardicVariant,
  WardicVariantLabels,
  WardicVariantResolver,
  WardicVariants,
  WardicVariantTransition,
} from "./config.ts"

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
  type WardicComponent,
  type WardicMotionProps,
  type WardicProps,
  wardic,
} from "./wardic.tsx"
/**
 * `w` (#511, ADR-0067; Motion's `m`): the **Slim element**'s forms, `w.<tag>`, `w.create`,
 * `w.createWard` and `use:w`, each as its `wardic` form but with only the Features chosen above it.
 */
export { type W, w } from "./w.tsx"
// #443 (Motion's): `wardic.create`'s options; whether a component is a Wardic element's and what it
// wraps; whether a prop is a motion prop.
export { isWardicComponent, unwrapWardicComponent, type WardicCreateOptions } from "./wardic-component.ts"
export { isValidWardicProp } from "./motion-props.ts"

/**
 * `<AnimatePresence>` — single-child exit-before-unmount (ADR-0007). Wraps a
 * conditional child (e.g. under a `<Show>`); when the child leaves, the presence
 * RETAINS its DOM node and drives the child's `exit` target (parent-driven, since
 * Solid disposes the leaving child's reactive owner), removing the node once the
 * exit settles. `PresenceContext` carries the registrar down to descendant spines.
 * `initial={false}` starts the child present at its first render at its `animate` (#134).
 * Many children, each exiting in its place, and `mode="wait"` (#277, ADR-0048).
 */
export {
  AnimatePresence,
  type AnimatePresenceProps,
  PresenceContext,
  type PresenceContextValue,
  type PresenceMode,
  type PresenceRecord,
  useIsPresent,
  usePresence,
  usePresenceContext,
  usePresenceData,
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
 * Motion's easing functions, by Motion's names (#360, ADR-0052), so a port's imports carry over:
 * `import { easeOut, cubicBezier } from "@wardic/solid"`. An `ease` also takes the names as
 * strings (`ease: "easeOut"`) and a bézier's four numbers. The Penner set and `Easing.spring` are
 * in `@wardic/core/Easing`.
 */
export {
  anticipate,
  backIn,
  backInOut,
  backOut,
  circIn,
  circInOut,
  circOut,
  cubicBezier,
  easeIn,
  easeInOut,
  easeOut,
  steps,
} from "@wardic/core/Easing"
export { stagger, type WardicStaggerOptions } from "./stagger.ts"
export { arc, type WardicArcOptions } from "./arc.ts"
