/**
 * A `wardic.*` element's motion props (ADR-0008), Solid-free (#209): every prop the element takes
 * off its props so none reaches the DOM, their types, and the config a Ward reads from them. Both
 * bindings' components and `<Reorder.Item>` share them.
 *
 * @module
 */
import type * as Drag from "@wardic/core/Drag"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"
import type { WardConfig, WardicAnimationDefinition, WardicDragTransition, WardicTransition, WardicValues } from "./config.ts"
import type { WardicDragInfo, WardicPointInfo } from "./gesture-info.ts"
import type { Accessor } from "./reactivity.ts"

/** Motion's gesture callbacks (#273): Solid 1's, which most elements don't take. */
const GESTURE_CALLBACKS = [
  "onHoverStart",
  "onHoverEnd",
  "onTapStart",
  "onTap",
  "onTapCancel",
  "onDragStart",
  "onDrag",
  "onDragEnd",
  "onDragTransitionEnd",
  "onPanSessionStart",
  "onPanStart",
  "onPan",
  "onPanEnd",
] as const

/** One of {@link GESTURE_CALLBACKS}. */
type GestureCallback = (typeof GESTURE_CALLBACKS)[number]

/**
 * Every motion prop the HOC consumes off the props object so it never leaks to
 * the DOM. A subset (`initial` / `animate` / `variants` / `whileHover` /
 * `whileTap` / `transition`) is wired into {@link createWard} today; the rest
 * (`whileFocus` / `whileInView` / `exit` / `drag` / `dragConstraints` /
 * `layout` / `layoutId`) are accepted + split now but NOT yet wired (a
 * follow-up) — they are intentionally consumed so they don't render as DOM
 * attributes. Shared with `<Reorder>`'s item and the Solid 2 binding (internal, not a package export).
 */
export const MOTION_PROPS = [
  "initial",
  "animate",
  "variants",
  "inherit",
  "whileHover",
  "whileTap",
  "whileFocus",
  "whileInView",
  "exit",
  "drag",
  "whileDrag",
  "dragConstraints",
  "dragElastic",
  "dragMomentum",
  "dragSnapToOrigin",
  "dragTransition",
  "dragPropagation",
  "layout",
  "layoutDependency",
  "layoutId",
  "layoutScroll",
  "layoutRoot",
  "layoutAnchor",
  "onAnimationStart",
  "onAnimationComplete",
  ...GESTURE_CALLBACKS,
  "onLayoutAnimationStart",
  "onLayoutAnimationComplete",
  "onUpdate",
  "appear",
  "transition",
] as const

/**
 * The motion props Solid 1 takes and Solid 2 doesn't (#257): Motion's animation and layout animation
 * callbacks, which Solid 2 hands over as async values (`card.next("settled")`, `"layoutStart"`,
 * `"layoutComplete"`).
 */
const SOLID_1_CALLBACKS = [
  "onAnimationStart",
  "onAnimationComplete",
  "onLayoutAnimationStart",
  "onLayoutAnimationComplete",
  // Motion's gesture callbacks (#273): Solid 2 hears them through `next(name)`, so on a Solid 2
  // element `onDrag`, `onDragStart` and `onDragEnd` are the DOM's HTML drag-and-drop events.
  ...GESTURE_CALLBACKS,
] as const

/** The callbacks only Solid 1 takes (#257, #273): Solid 2's config and props leave them out. */
export type SolidOneCallback = (typeof SOLID_1_CALLBACKS)[number]

/** {@link MOTION_PROPS} on Solid 2 (#257): all but Solid 1's callbacks, so `onAnimationStart` on an element there is the DOM's. */
export const MOTION_PROPS_V2 = Arr.filter(MOTION_PROPS, (prop) => Bool.not(Arr.contains(SOLID_1_CALLBACKS, prop))) as ReadonlyArray<
  Exclude<(typeof MOTION_PROPS)[number], (typeof SOLID_1_CALLBACKS)[number]>
>

/**
 * The motion props a `wardic.*` element accepts, on top of the element's own
 * intrinsic props.
 *
 * REACTIVITY (step 21f): each field is a plain VALUE — the SAME static type as the
 * matching {@link WardConfig} field, NO `MaybeAccessor`. Reactivity is supplied
 * by Solid's reactive prop getters, not by per-prop accessors: a `wardic.*`
 * element's props are getters, so reading `motion.animate` INSIDE the config
 * accessor {@link motionToConfig} builds tracks whatever signals back the prop.
 * Write a TRACKED EXPRESSION as the value (`animate={open() ? a : b}`), NOT a
 * function — passing `animate={() => ...}` is a type error here (props are values).
 */
export interface WardicMotionProps {
  /** The seed: a values map, a `variants` name, or `false` to start at `animate` with no mount animation (#134). */
  readonly initial?: WardicValues | string | false
  readonly animate?: WardicValues | string
  readonly variants?: Record<string, WardicValues>
  /** `false` keeps a `variants` element out of its ancestors' variants (#50, Motion's `inherit`). */
  readonly inherit?: boolean
  readonly whileHover?: WardicValues
  readonly whileTap?: WardicValues
  readonly transition?: WardicTransition
  /** Accepted + split now; not yet wired (follow-up). */
  readonly whileFocus?: WardicValues
  /** Accepted + split now; not yet wired (follow-up). */
  readonly whileInView?: WardicValues
  /**
   * The exit target — the state this element animates toward when it leaves an
   * `<AnimatePresence>` (ADR-0007). Wired through to the spine's presence
   * registration; the parent `<AnimatePresence>` drives the exit on leave.
   */
  readonly exit?: WardicValues
  /**
   * Enable dragging (ADR-0004). `true` = free; `"x"`/`"y"` = axis-locked. While
   * held (and during the release tail) the drag DIRECT-SETS `x`/`y` (1:1 with the
   * pointer); the spring keeps driving every other key + {@link whileDrag}. The
   * element gets Motion's drag defaults (`touch-action` for its axis, no text
   * selection, `draggable="false"`; ADR-0019 *Amendment (Reorder)*), which its own
   * `style` overrides.
   */
  readonly drag?: boolean | "x" | "y"
  /**
   * Target merged in (highest priority) while dragging. Driven by the spring (NOT
   * stripped) so e.g. `scale: 1.1` animates while held and returns after release.
   */
  readonly whileDrag?: WardicValues
  /**
   * Constrain the element's `x`/`y` to a static numeric box (per axis), whichever gesture moved it
   * there; a Fling springs back to an edge it would cross. Only when `drag` is on.
   */
  readonly dragConstraints?: Drag.Bounds
  /** Rubber-band resistance past {@link dragConstraints}: 0 a hard clamp, with a wall for a bounce. Default 0.35. */
  readonly dragElastic?: number
  /** Fling on release (default `true`); `false` releases with no velocity. Only when `drag` is on. */
  readonly dragMomentum?: boolean
  /** Spring `x`/`y` back to the origin on release, on {@link dragTransition}. Only when `drag` is on. */
  readonly dragSnapToOrigin?: boolean
  /**
   * What the release runs on (Motion's `dragTransition`): Motion's inertia, its options over
   * Motion's defaults, `timeConstant` in milliseconds. Only when `drag` is on.
   */
  readonly dragTransition?: WardicDragTransition
  /**
   * `true`: the drag takes no Drag claim, so a draggable ancestor drags with it (Motion's
   * `dragPropagation`). Only when `drag` is on.
   */
  readonly dragPropagation?: boolean
  /**
   * Enable layout FLIP (ADR-0005). Under a `<LayoutGroup>` sibling reflow is
   * animated too; standalone, only this element's own size/`layoutDependency`
   * change is observed. Read once, at mount; a **Layout mode** (`"position"`, `"size"`,
   * `"x"`, `"y"`, `"preserve-aspect"`; ADR-0009, *Amendment (#42)*) animates part of the
   * change, read at each layout animation's start.
   */
  readonly layout?: boolean | "position" | "size" | "preserve-aspect" | "x" | "y"
  /**
   * A value/signal whose change re-measures this element and plays a FLIP
   * (framer-motion's prop name + semantics). Only consulted when `layout` is on.
   */
  readonly layoutDependency?: unknown
  /**
   * Shared-element (cross-element) FLIP key (ADR-0005, framer-motion `layoutId`
   * parity). An element entering with the same `layoutId` a prior element left
   * animates FROM that prior element's box. Works with NO `<LayoutGroup>` — the
   * registry is provided at the `WardicProvider` root by default. Composes with
   * `layout`/`layoutDependency` and `animate` (FLIP keys merge + project once).
   */
  readonly layoutId?: string
  /** Scroll container (ADR-0012): its scroll is folded out of descendants' layout animations. */
  readonly layoutScroll?: boolean
  /** Stable projection sub-root (ADR-0013): self-snaps, bounds its subtree, persistent relative anchor. */
  readonly layoutRoot?: boolean
  /**
   * Relative-projection anchor (ADR-0013): where in its relativeParent this element
   * anchors (0–1 per axis, default top-left). `false` forces absolute projection.
   */
  readonly layoutAnchor?: { readonly x: number; readonly y: number } | false
  /** Called when an animation of this element starts, with its `definition` (#257, Motion's prop; see `WardConfig`). */
  readonly onAnimationStart?: (definition: WardicAnimationDefinition) => void
  /** Called when that animation lands, with its `definition` (#257, Motion's prop; see `WardConfig`). */
  readonly onAnimationComplete?: (definition: WardicAnimationDefinition) => void
  /** Motion's gesture callbacks (#273; see `WardConfig`): `(event, info)`, at the event, `point` in the viewport. */
  readonly onHoverStart?: (event: PointerEvent, info: WardicPointInfo) => void
  readonly onHoverEnd?: (event: PointerEvent, info: WardicPointInfo) => void
  readonly onTapStart?: (event: PointerEvent, info: WardicPointInfo) => void
  readonly onTap?: (event: PointerEvent, info: WardicPointInfo) => void
  readonly onTapCancel?: (event: PointerEvent, info: WardicPointInfo) => void
  readonly onDragStart?: (event: PointerEvent, info: WardicDragInfo) => void
  readonly onDrag?: (event: PointerEvent, info: WardicDragInfo) => void
  readonly onDragEnd?: (event: PointerEvent, info: WardicDragInfo) => void
  readonly onDragTransitionEnd?: () => void
  readonly onPanSessionStart?: (event: PointerEvent, info: WardicPointInfo) => void
  readonly onPanStart?: (event: PointerEvent, info: WardicDragInfo) => void
  readonly onPan?: (event: PointerEvent, info: WardicDragInfo) => void
  readonly onPanEnd?: (event: PointerEvent, info: WardicDragInfo) => void
  /**
   * Called when a layout animation of this element starts (#191, ADR-0039, Motion's prop): at the
   * frame where it takes its first step, after that frame is painted. A restart fires it again;
   * restarts in one task are one. A handover's is the new Lead's. No call when nothing animates (a
   * `layoutRoot`'s snap, a Layout mode with nothing to move). Read when it fires.
   */
  readonly onLayoutAnimationStart?: () => void
  /**
   * Called when a layout animation of this element lands on its own (#191, ADR-0039, Motion's prop):
   * at the frame it lands. Not for one a restart interrupted, a window resize finished early, or an
   * unmount cut off, so a start isn't always followed by a complete; `animateLayout`'s `onSettled`
   * reports a change's end however it went. Read when it fires.
   */
  readonly onLayoutAnimationComplete?: () => void
  /**
   * Called once a frame in which Wardic changed the element's values, after that frame's commits
   * (#233, Motion's `onUpdate`), with every value it holds for the element. `latest` is reused: copy
   * it to keep it. Whether the element reports is read once, at mount.
   */
  readonly onUpdate?: (latest: Readonly<Record<string, number | string>>) => void
  /**
   * `false` keeps this element at its Starting style until mount during a server render, when the
   * provider would start its mount animation in CSS from first paint (#48, ADR-0044). Read on the
   * server, once.
   */
  readonly appear?: boolean
}

/** {@link WardicMotionProps} on Solid 2 (#257): all but Solid 1's callbacks. */
export type WardicMotionPropsV2 = Omit<WardicMotionProps, (typeof SOLID_1_CALLBACKS)[number]>

/**
 * Build a reactive `Accessor<WardConfig>` from a split-off `motion` props
 * object (step 21f — the reactivity boundary).
 *
 * Each motion prop is a plain VALUE (the same static type as the matching
 * {@link WardConfig} field). The returned accessor reads each prop DIRECTLY off
 * the `motion` object inside the accessor body. Because `motion` is a Solid
 * split-props object whose fields are reactive getters, reading `motion.animate`
 * here subscribes to whatever signal backs the prop — so a tracked expression
 * (`animate={open() ? a : b}`) re-runs this config accessor on a flip and drives a
 * Retarget. NO `access()`/unwrapping: Solid's prop getters already do the tracking.
 *
 * Keys are only assigned when the value is defined — exactOptionalPropertyTypes
 * forbids an explicit `undefined` on the optional config fields, and an absent key
 * is exactly how a Ward reads "no field".
 *
 * `fixedKeys`: `motion`'s keys stay as they are (it isn't a proxy over a reactive spread), so the
 * gesture callbacks it wasn't given are never read (#273). Without it, all are.
 */
export const motionToConfig = (motion: WardicMotionProps, fixedKeys = false): Accessor<WardConfig> => {
  // The gesture callbacks the element was given (#273), found once: the config is rebuilt at each
  // read, and most elements take none. Keys that can change (a proxy's) are all read.
  const gestures: ReadonlyArray<GestureCallback> = Bool.match(fixedKeys, {
    onTrue: () => Arr.filter(GESTURE_CALLBACKS, (key) => key in motion),
    onFalse: () => GESTURE_CALLBACKS,
  })
  return () => {
    const config: { -readonly [K in keyof WardConfig]: WardConfig[K] } = {}
    // Read each (reactive) prop getter inside the accessor so it tracks.
    const initial = motion.initial
    const animate = motion.animate
    const whileHover = motion.whileHover
    const whileTap = motion.whileTap
    const transition = motion.transition
    const variants = motion.variants
    const inherit = motion.inherit
    const exit = motion.exit
    const drag = motion.drag
    const whileDrag = motion.whileDrag
    const dragConstraints = motion.dragConstraints
    const dragElastic = motion.dragElastic
    const dragMomentum = motion.dragMomentum
    const dragSnapToOrigin = motion.dragSnapToOrigin
    const dragTransition = motion.dragTransition
    const dragPropagation = motion.dragPropagation
    const layout = motion.layout
    const layoutDependency = motion.layoutDependency
    const layoutId = motion.layoutId
    const layoutScroll = motion.layoutScroll
    const layoutRoot = motion.layoutRoot
    const layoutAnchor = motion.layoutAnchor
    const onAnimationStart = motion.onAnimationStart
    const onAnimationComplete = motion.onAnimationComplete
    const onLayoutAnimationStart = motion.onLayoutAnimationStart
    const onLayoutAnimationComplete = motion.onLayoutAnimationComplete
    const onUpdate = motion.onUpdate
    const appear = motion.appear
    if (Predicate.isNotUndefined(initial)) config.initial = initial
    if (Predicate.isNotUndefined(animate)) config.animate = animate
    if (Predicate.isNotUndefined(whileHover)) config.whileHover = whileHover
    if (Predicate.isNotUndefined(whileTap)) config.whileTap = whileTap
    if (Predicate.isNotUndefined(transition)) config.transition = transition
    if (Predicate.isNotUndefined(variants)) config.variants = variants
    if (Predicate.isNotUndefined(inherit)) config.inherit = inherit
    if (Predicate.isNotUndefined(exit)) config.exit = exit
    if (Predicate.isNotUndefined(drag)) config.drag = drag
    if (Predicate.isNotUndefined(whileDrag)) config.whileDrag = whileDrag
    if (Predicate.isNotUndefined(dragConstraints)) config.dragConstraints = dragConstraints
    if (Predicate.isNotUndefined(dragElastic)) config.dragElastic = dragElastic
    if (Predicate.isNotUndefined(dragMomentum)) config.dragMomentum = dragMomentum
    if (Predicate.isNotUndefined(dragSnapToOrigin)) config.dragSnapToOrigin = dragSnapToOrigin
    if (Predicate.isNotUndefined(dragTransition)) config.dragTransition = dragTransition
    if (Predicate.isNotUndefined(dragPropagation)) config.dragPropagation = dragPropagation
    if (Predicate.isNotUndefined(layout)) config.layout = layout
    if (Predicate.isNotUndefined(layoutDependency)) config.layoutDependency = layoutDependency
    if (Predicate.isNotUndefined(layoutId)) config.layoutId = layoutId
    if (Predicate.isNotUndefined(layoutScroll)) config.layoutScroll = layoutScroll
    if (Predicate.isNotUndefined(layoutRoot)) config.layoutRoot = layoutRoot
    if (Predicate.isNotUndefined(layoutAnchor)) config.layoutAnchor = layoutAnchor
    if (Predicate.isNotUndefined(onAnimationStart)) config.onAnimationStart = onAnimationStart
    if (Predicate.isNotUndefined(onAnimationComplete)) config.onAnimationComplete = onAnimationComplete
    if (Arr.isReadonlyArrayNonEmpty(gestures)) {
      Arr.forEach(gestures, (key) => {
        const callback = motion[key]
        if (Predicate.isNotUndefined(callback)) (config as Record<GestureCallback, unknown>)[key] = callback
      })
    }
    if (Predicate.isNotUndefined(onLayoutAnimationStart)) config.onLayoutAnimationStart = onLayoutAnimationStart
    if (Predicate.isNotUndefined(onLayoutAnimationComplete)) config.onLayoutAnimationComplete = onLayoutAnimationComplete
    if (Predicate.isNotUndefined(onUpdate)) config.onUpdate = onUpdate
    if (Predicate.isNotUndefined(appear)) config.appear = appear
    return config
  }
}
