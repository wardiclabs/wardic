/**
 * `@wardic/solid/v1`, deprecated: the Solid 1 binding, `@wardic/solid` itself until 2.0, when Solid 2's
 * became the root (#566). Frozen, bug fixes only; it goes at Wardic's next major. Each name it exports
 * is `@deprecated`, so an editor marks the import.
 *
 * The Solid 1 binding: `WardicProvider` and `WardicConfig`; `createWard`, a **Ward** to
 * spread onto an element, with variant orchestration through `ward.Provider`; `wardic.*`,
 * `wardic.create()` and the `use:wardic` directive; `<AnimatePresence>`, `<LayoutGroup>` and
 * `<Reorder>`; and the low-level `createX` primitives (ADR-0008, ADR-0042). Built directly on
 * `effect`'s in-core reactivity (`effect/reactivity`) — there is no `@effect-atom/atom-solid`
 * dependency.
 */
/**
 * The version of `@wardic/solid` this is.
 *
 * @see https://wardic.dev/reference/solid/utilities/version
 *
 * @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566).
 */
export const VERSION = "2.0.2"

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
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createInstantLayoutTransition,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createInstantTransition,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createResetProjection,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  runScoped,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  useAnimateLayout,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  useWardicFiber,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  useWardicGate,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  useWardicRuntime,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicProvider,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  LazyWardic,
} from "./provider.tsx"

/**
 * **Features** (#511, ADR-0067): what a Slim element (`w.*`) has only when it's chosen, on a
 * `WardicProvider` or a `LazyWardic` (`features={[colors]}`), each its own import so an app ships only
 * those it uses; a Complete element (`wardic.*`) has every one. `colors`: every CSS colour space beyond
 * a hex, `rgb()`, `hsl()` and the colour names. `layout`: layout animations, the props `layout`,
 * `layoutId`, `layoutScroll` and `layoutRoot` (`LayoutGroup` and `Reorder` bring it themselves).
 * `scroll`: a container's scroll, which `createScroll` brings itself (#518).
 */
export type {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  Feature,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  FeatureLoad,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  Features,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  FeaturesProp,
} from "@wardic/dom/unstable/Feature"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  colors,
} from "@wardic/dom/unstable/features/Colors"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  layout,
} from "@wardic/dom/unstable/features/Layout"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  scroll,
} from "@wardic/dom/unstable/features/Scroll"
/**
 * The gestures (#511, ADR-0067 decision 3), a Feature each: `hover`, `press` (its Keyboard presses
 * included), `focus`, `inView`, `pan` and `drag` (`dragControls` and the release's inertia included).
 * Every one but `inView` stands on the gestures' input: the Environment's when it gives one, else the
 * DOM's. Motion's bundles: `domAnimation` (`hover`, `press`, `focus`, `inView`) and `domMax` (every
 * Feature).
 */
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  drag,
} from "@wardic/dom/unstable/features/Drag"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  focus,
} from "@wardic/dom/unstable/features/Focus"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  hover,
} from "@wardic/dom/unstable/features/Hover"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  inView,
} from "@wardic/dom/unstable/features/InView"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  pan,
} from "@wardic/dom/unstable/features/Pan"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  press,
} from "@wardic/dom/unstable/features/Press"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  domAnimation,
} from "@wardic/dom/unstable/features/DomAnimation"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  domMax,
} from "@wardic/dom/unstable/features/DomMax"
// The Instant change and the Projection reset (#443): Motion's `useInstantTransition` and kin.
export type {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  InstantTransition,
} from "@wardic/dom/unstable/Instant"
// `WardicConfig`'s `transformPagePoint` helpers (#443, Motion's): a drag inside a transformed parent, or an SVG's viewBox.
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  correctParentTransform,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  transformViewBoxPoint,
} from "@wardic/dom/unstable/PagePoint"
export type {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  AnimateLayout,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicEnv,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicRuntime,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicServices,
} from "../runtime.ts"
export type {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  AnimateLayoutOptions,
} from "@wardic/dom/ProjectionSystem"

/**
 * `<WardicConfig>` (#434, Motion's `MotionConfig`): settings for the Wardic elements below it, its
 * **Config transition** their default `transition`. It nests anywhere under a `WardicProvider`.
 */
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicConfig,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type WardicConfigProps,
} from "./wardic-config.tsx"

/**
 * The provider's **Flush gate** (ADR-0006): where each element's animated values are written,
 * drawn onto the elements together once a frame, at the end of its animation tick (ADR-0034).
 * It's `@wardic/dom`'s, built by the provider with Solid's `batch` (ADR-0031), and
 * `useWardicGate` returns it; the types are re-exported here.
 */
export type {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  Shape as FlushGate,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  Sink as FlushSink,
} from "@wardic/dom/FlushGate"

/**
 * Reactive bridges (ADR-0006): `streamToSignal` (core `Stream` -> Solid signal,
 * scoped fiber) and `fromAtom` (Effect `Atom` -> Solid signal via the runtime's
 * `AtomRegistry`).
 */
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  fromAtom,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  streamToSignal,
} from "./bridge.tsx"
export type {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicDragInfo,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicPoint,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicPointInfo,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicPressEvent,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicPressInfo,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicPressInput,
} from "@wardic/dom/unstable/GestureInfo"
export type {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicBoundingBox,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicDragConstraints,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicMeasureDragConstraints,
} from "@wardic/dom/unstable/DragConstraints"
// Drag controls (#431, Motion's `useDragControls`): a drag started from a handle or a track.
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createDragControls,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type WardicDragControls,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type WardicDragControlsOptions,
} from "@wardic/dom/unstable/DragControls"
// Imperative animation (#433, Motion's `useAnimate`): an Animation scope, its `animate` and its Playback controls;
// a sequence of Segments (Motion's), on the same controls.
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createAnimate,
} from "./create-animate.tsx"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createBatch,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type WardicBatch,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type WardicBatchConfig,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type WardicBatchMember,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type WardicBatchMemberProps,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type WardicKeyedBatch,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type WardicKeyedBatchConfig,
} from "./create-batch.tsx"
export type {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicBatchExit,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicBatchGesture,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicBatchKey,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicBatchLanding,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicBatchSegmentTarget,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicBatchSegmentValue,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicBatchStop,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicBatchSubject,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicBatchTarget,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicBatchTransition,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicBatchValues,
} from "@wardic/dom/unstable/BatchMembers"
export type {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicAnimate,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicAnimateOptions,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicAnimationScope,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicAnimationSequence,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicAnimationSubject,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicBatchSegment,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicElementSegment,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicFunctionSegment,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicPlaybackControls,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicPlayState,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicSegment,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicSegmentOptions,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicSegmentTarget,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicSequenceLabel,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicSequenceOptions,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicSequenceTime,
} from "@wardic/dom/unstable/Imperative"
// Animation controls (#433, Motion's `useAnimationControls`): `animate={controls}`, then `start`, `set` and `stop`.
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createAnimationControls,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type WardicAnimationControls,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type WardicControlsDefinition,
} from "@wardic/core/unstable/AnimationControls"

/**
 * Low-level sensor hooks: `createHover` / `createPress` / `createFocus` /
 * `createInView` / `createDrag` (recognizer-backed signals) and `createReducedMotion`
 * (`Probe.prefersReducedMotion` atom bridge); `createReducedMotionConfig`, the nearest config's
 * setting over it, and `createPageInView`, whether the page is shown (#443).
 */
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type CreateDragOptions,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createInView,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createPageInView,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createReducedMotion,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createReducedMotionConfig,
} from "./sensors.tsx"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createDrag,
} from "./drag-sensor.tsx"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createFocus,
} from "./focus-sensor.tsx"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createHover,
} from "./hover-sensor.tsx"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createPress,
} from "./press-sensor.tsx"
// `createCycle` (#443, Motion's `useCycle`): one of a list of states at a time, stepped through.
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createCycle,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type Cycle,
} from "./cycle.ts"

/**
 * Live values (#130, ADR-0043): a value the user moves, given in an element's `style` (an accessor
 * or an Atom), followed while no layer of the Override stack sets its key. `createTransform` maps
 * one (through a function, or ranges), `createFollowValue` follows one on any transition (#441) and
 * `createSpring` with a spring; `createScroll`, `createVelocity` and `createTime` make one from a
 * scroll, a value's velocity and time (#234). `createAnimationFrame` tells a callback each frame, and `createWillChange` makes a
 * `willChange` that turns on as its element animates (#443).
 */
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createAnimationFrame,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createFollowValue,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createSpring,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createTime,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createTransform,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createVelocity,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createWillChange,
} from "./live-value.tsx"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createScroll,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ElementSource,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ScrollOptions,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ScrollValues,
} from "./live-scroll.tsx"
export type {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  FollowAccessor,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  FollowValueOptions,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  Live,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  LiveSource,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  SpringAccessor,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WillChange,
} from "@wardic/dom/unstable/LiveStyle"

/**
 * `createWard` — a **Ward**, one element's motion binding (ADR-0005, ADR-0042): recognizers ->
 * Override stack -> spring/tween Retarget -> the gate, which commits each frame onto the
 * element (ADR-0034), with an SSR-correct synchronous initial (ADR-0003). Returns a callable
 * `Ward` to spread onto a JSX element (`<div {...ward()}>`).
 */
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createWard,
} from "./complete.tsx"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type Ward,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type WardStyle,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type WardValue,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type WardProps,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type WardUserProps,
} from "./create-ward.tsx"
export type {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardConfig,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicDragTransition,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicViewport,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicReducedMotion,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicSkipAnimations,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicInertia,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicOrchestration,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicStagger,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicPath,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicPropagate,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicTransformShorthands,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicTransformTemplate,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicScaleCorrector,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicLayoutBox,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicTransformPoint,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicAnimationDefinition,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicTransition,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicTransitionEntries,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicValueKey,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicValueTransition,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicKeyframes,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicTargetValues,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicValues,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicVariant,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicVariantLabels,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicVariantResolver,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicVariants,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicVariantTransition,
} from "@wardic/dom/unstable/WardConfig"

/**
 * `<Reorder>` (ADR-0020, ADR-0008 Tier 1): `Reorder.Group` / `Reorder.Item`, built on the
 * headless API: `createReorderGroup` (a `ReorderGroup`) and `createReorderItem` (a
 * `ReorderItemWard`) spread onto any elements, and the `use:reorderItem` directive
 * (client-only). The app owns `values`, sets them from `onReorder`, and keys its items
 * with `<For>`.
 */
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createReorderGroup,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createReorderItem,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  Reorder,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ReorderElementTag,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ReorderGroup,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ReorderGroupProps,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ReorderItemProps,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ReorderGroupConfig,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ReorderGroupSpread,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ReorderGroupUserProps,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ReorderItemConfig,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ReorderItemSpread,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ReorderItemUserProps,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ReorderItemWard,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ReorderItemLayout,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ReorderItemDirectiveValue,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ReorderBatchGroupProps,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ReorderBatchItemProps,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ReorderBatchColumnSize,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ReorderBatchGap,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ReorderBatchItemSize,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type ReorderBatchSizing,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  reorderItem,
} from "./reorder.tsx"

/**
 * `runDragTrack` (ADR-0004): the binding-orchestrated drag track, run by every Wardic element's
 * spine (`runSpine`), `createWard`'s and `wardic.create(Component)`'s alike. The pointer
 * DIRECT-SETS `x`/`y` while the spring drives every other key + `whileDrag`; the release runs on
 * the **Drag transition**: a **Fling**, a snap back to the origin (`dragSnapToOrigin`), or a rest
 * where it was let go (`dragMomentum={false}`).
 */
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type RunDragTrackOptions,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  runDragTrack,
} from "./drag.tsx"
export type {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  DragSnapshot,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  DragTrackConfig,
} from "@wardic/dom/unstable/DragTrack"

/**
 * Variant orchestration context (ADR-0007): the `WardicVariantContext` that
 * carries the parent's current variant NAME + inherited transition down the
 * tree, and the `useVariantContext` reader. `ward.Provider` (a property on the
 * `createWard` callable) publishes into it; inheriting children resolve the name
 * against their own `variants` map.
 */
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  useVariantContext,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicVariantContext,
} from "./variants.ts"
export type {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicVariantContextValue,
} from "@wardic/core/unstable/VariantTree"

/**
 * `wardic` (ADR-0008 Tier 1, ADR-0042): the `wardic.*` element proxy, `wardic.create(tag)`
 * HOC, and, called, the `use:wardic` directive. `wardic.div` / `wardic.create("div")` build a
 * Complete element that puts a Ward on its element and merges the animated style over the
 * user's static style (`Style.over`) while preserving the user's ref (`mergeRefs`) and passing
 * all other props through. `<div use:wardic={config}>` puts one on any element, client-only:
 * import `wardic` for it to resolve.
 */
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type Wardic,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type WardicComponent,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type WardicMotionProps,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type WardicProps,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  wardic,
} from "./wardic.tsx"
/**
 * `w` (#511, ADR-0067; Motion's `m`): the **Slim element**'s forms, `w.<tag>`, `w.create`,
 * `w.createWard` and `use:w`, each as its `wardic` form but with only the Features chosen above it.
 */
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type W,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  w,
} from "./w.tsx"
// #516: what `createWardic(features)` returns, its `w` typed to its Features.
export type {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardConfigOf,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  WardicInstance,
} from "./wardic-instance.ts"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createWardic,
} from "./create-wardic.tsx"
// #443 (Motion's): `wardic.create`'s options; whether a component is a Wardic element's and what it
// wraps; whether a prop is a motion prop.
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  isWardicComponent,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  unwrapWardicComponent,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type WardicCreateOptions,
} from "../wardic-component.ts"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  isValidWardicProp,
} from "../motion-props.ts"

/**
 * `<AnimatePresence>` — exit-before-unmount (ADR-0007). Wraps its children (a conditional
 * one, under a `<Show>`, or a `<For>`'s); when one leaves, the presence RETAINS its DOM
 * node and drives the child's `exit` (parent-driven, since Solid disposes the leaving
 * child's reactive owner), removing the node once the exit settles. `PresenceContext`
 * carries the registrar down to descendant spines. `initial={false}` starts the child
 * present at its first render at its `animate` (#134). Many children, each exiting in its
 * place, and `mode="wait"` (#277, ADR-0048).
 */
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  AnimatePresence,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type AnimatePresenceProps,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  PresenceContext,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  useIsPresent,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  usePresence,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  usePresenceContext,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  usePresenceData,
} from "./presence.tsx"
export type {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  PresenceContextValue,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  PresenceMode,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  PresenceRecord,
} from "@wardic/dom/unstable/PresenceController"

/**
 * `layout` / `layoutId` surface (ADR-0009 + ADR-0005). `layout` FLIP runs on the
 * box-based projection system: `createProjectionNode` registers the element as a
 * projection node (the provider-owned tree handles nesting + sibling reflow).
 * `<LayoutGroup>` is now a thin grouping boundary whose `layoutDependency`
 * triggers a full Measure pass. `layoutId` shared-element animation (Switch and
 * Crossfade) is matched entirely by the Projection system (ADR-0010 *Amendment
 * (#13)*); `measureLayoutBox` reads an untransformed box.
 */
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  LayoutGroup,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  createProjectionNode,
} from "./layout.tsx"
export type {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  CreateProjectionNodeOptions,
} from "@wardic/dom/unstable/LayoutMember"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  measureLayoutBox,
} from "@wardic/dom/ProjectionSystem"

/**
 * Motion's easing functions, by Motion's names (#360, ADR-0052), so a port's imports carry over:
 * `import { easeOut, cubicBezier } from "@wardic/solid"`. An `ease` also takes the names as
 * strings (`ease: "easeOut"`) and a bézier's four numbers. The Penner set and `Easing.spring` are
 * in `@wardic/core/Easing`.
 */
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  anticipate,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  backIn,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  backInOut,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  backOut,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  circIn,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  circInOut,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  circOut,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  cubicBezier,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  easeIn,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  easeInOut,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  easeOut,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  steps,
} from "@wardic/core/Easing"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  stagger,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type WardicStaggerOptions,
} from "../stagger.ts"
export {
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  arc,
  /** @deprecated Solid 1's binding, deprecated and frozen: it goes at Wardic's next major. Solid 2's is `@wardic/solid` (#566). */
  type WardicArcOptions,
} from "../arc.ts"
