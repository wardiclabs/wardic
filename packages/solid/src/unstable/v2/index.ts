/**
 * `@wardic/solid/unstable/v2`: Wardic for Solid 2 (#209). Unstable: it tracks Solid 2's release
 * candidate (`solid-js@2.0.0-rc`), and any release may change it. It lives here, inside
 * `@wardic/solid`, until Solid 2.0 is stable, when `@wardic/solid` itself becomes it and the Solid 1
 * binding moves to `@wardic/solid/v1`.
 *
 * @module
 */
export {
  runScoped,
  useAnimateLayout,
  useWardicFiber,
  useWardicGate,
  useWardicRuntime,
  WardicProvider,
} from "./provider.tsx"
export type { WardicEnv, WardicRuntime, WardicServices } from "../../runtime.ts"
export type { AnimateLayout } from "./provider.tsx"

/**
 * `ward(config)`: a **Ward**, one element's motion, as a ref that carries its props. Spread it
 * (`<div {...ward(config)} />`, its Starting style in server HTML) or give it to `ref`
 * (`ref={ward(config)}`, client-only). A kept ward has `.Provider` for its Variant children,
 * `.read(key)` and `.atom(key)` for its values.
 */
export {
  type AnyWard,
  type Ward,
  type WardChecked,
  type WardConfig,
  type WardOptions,
  type WardProps,
  type WardRead,
  type WardStyle,
  type WardWithProps,
  ward,
} from "./ward.tsx"
export type { WardDragInfo, WardElement, WardEvent, WardEvents, WardGestures, WardPoint, WardPointInfo, WardPressInfo, WardSettled } from "./lifecycle.ts"
export type { WardicAnimationDefinition } from "../../config.ts"
export type { AnimatedKey, WardKey, WardValueOf } from "../../ward-keys.ts"

/** The variant context (ADR-0007): what a ward's `.Provider` and a `wardic.*` element hand their children. */
export { useVariantContext, WardicVariantContext } from "./variant-node.ts"
export type { WardicVariantContextValue } from "../../variant-tree.ts"
export type {
  WardicOrchestration,
  WardicReducedMotion,
  WardicTransformShorthands,
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
} from "../../config.ts"

/**
 * `wardic.<tag>` and `wardic.create(tag | Component)` (ADR-0008): Motion's components, with the
 * element's own props and the motion props; a `wardic.create(Component)` component forwards its `ref`.
 */
export {
  type GivenWard,
  type Wardic,
  type WardicBeside,
  type WardicComponent,
  type WardicMotion,
  type WardicProps,
  type WardicWrappable,
  type WardicWrapped,
  type WardNodeKey,
  type WardRefCallback,
  wardic,
} from "./wardic.tsx"
export type { WardicMotionPropsV2 as WardicMotionProps } from "../../motion-props.ts"

/**
 * `<AnimatePresence>` (ADR-0007): a single child's exit before it's removed, from its ward's `exit`;
 * `initial={false}` starts the child present at its first render at its `animate` (#134).
 */
export { AnimatePresence, type AnimatePresenceProps, PresenceContext, usePresenceContext } from "./presence.tsx"
export { type IsPresent, type PresenceHold, type PresenceLeaveEvents, useIsPresent, usePresence, usePresenceData } from "./presence-hooks.ts"
export type { PresenceMode } from "../../presence-controller.ts"
export { createPresence, type Presence, type PresenceEvent, type PresenceEvents } from "./presence-handle.ts"
export type { PresenceContextValue, PresenceRecord } from "../../presence-record.ts"

/**
 * Layout (ADR-0009, ADR-0010): a ward's `layout`, `layoutId`, `layoutScroll`, `layoutRoot` and
 * `layoutAnchor` register its projection node; `<LayoutGroup layoutDependency>` re-measures them all.
 */
export { LayoutGroup } from "./layout.tsx"
export { measureLayoutBox } from "@wardic/dom/ProjectionSystem"

/**
 * Sensors (#209 PR 3's Q1): each a ref that's also its reading. `createHover`, `createPress`,
 * `createFocus`, `createInView` and `createDrag` attach to the element they're given as a ref;
 * `createReducedMotion` follows the user's preference.
 */
export {
  type CreateDragOptions,
  createDrag,
  createFocus,
  createHover,
  createInView,
  createPress,
  createReducedMotion,
  type Sensor,
} from "./sensors.ts"

/** Reactive bridges (ADR-0006): a core `Stream` or an Effect `Atom` as an accessor. */
export { fromAtom, streamToSignal } from "./bridge.ts"
export type { WardicDragTransition } from "../../config.ts"
export type { WardicBoundingBox, WardicDragConstraints, WardicMeasureDragConstraints } from "../../drag-constraints.ts"
// Drag controls (#431, Motion's `useDragControls`): a drag started from a handle or a track.
export { createDragControls, type WardicDragControls, type WardicDragControlsOptions } from "../../drag-controls.ts"
// Imperative animation (#433, Motion's `useAnimate`): an Animation scope with `settled()`, its `animate` and its Playback controls.
export { createAnimate, type WardicAnimationScopeV2, type WardicScopeLanding } from "./create-animate.ts"
export type {
  WardicAnimate,
  WardicAnimateOptions,
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
} from "../../imperative.ts"


/**
 * Live values (#130, ADR-0043; #209 PR 3's Q2): core's `LiveValue` helpers as accessors. One derived
 * on an Atom (a ward's `read(key)`, another helper's) carries it, so a `style` given it is written in
 * the frame its source moves.
 */
export {
  createScroll,
  createSpring,
  createTime,
  createTransform,
  createVelocity,
  type ElementSource,
  type ScrollOptions,
  type ScrollValues,
} from "./live-value.ts"
export type { Live, LiveSource, SpringAccessor } from "../../live-style.ts"

/**
 * `<Reorder>` (ADR-0020, ADR-0037; #209 PR 3b): `reorderGroup(config)` and `reorderItem(list, config)`,
 * refs carrying their props as a ward is, and Motion's `Reorder.Group` / `Reorder.Item` on them.
 */
export {
  type AnyReorderGroup,
  type AnyReorderItem,
  type GroupRefCallback,
  Reorder,
  type ReorderElementTag,
  type ReorderGroup,
  type ReorderGroupComponentProps,
  type ReorderGroupConfig,
  type ReorderGroupEvents,
  type ReorderGroupOf,
  type ReorderGroupProps,
  reorderGroup,
  type ReorderItem,
  type ReorderItemComponentProps,
  type ReorderItemConfig,
  type ReorderItemLayout,
  type ReorderItemOf,
  reorderItem,
} from "./reorder.tsx"

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
