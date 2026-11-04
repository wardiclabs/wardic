/**
 * A `wardic.*` element's motion props (ADR-0008), Solid-free (#209): every prop the element takes
 * off its props so none reaches the DOM, their types, and the config a Ward reads from them. Both
 * bindings' components and `<Reorder.Item>` share them.
 *
 * @module
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"
import type { WardConfig } from "./config.ts"
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
  "onDirectionLock",
  "onViewportEnter",
  "onViewportLeave",
  "onPanSessionStart",
  "onPanStart",
  "onPan",
  "onPanEnd",
] as const

/**
 * The keys most elements don't take, which a config with fixed keys reads only when given (#273): the
 * gesture callbacks, `dragDirectionLock`, `dragControls` and `dragListener` (#431),
 * `onMeasureDragConstraints`, `whileInView`, `whileFocus`, `viewport` and `custom` (#277).
 */
const RARE_KEYS = [
  ...GESTURE_CALLBACKS,
  "dragDirectionLock",
  "dragControls",
  "dragListener",
  "onMeasureDragConstraints",
  "propagate",
  "layoutCrossfade",
  "transformTemplate",
  "onBeforeLayoutMeasure",
  "onLayoutMeasure",
  "whileInView",
  "whileFocus",
  "viewport",
  "custom",
  "key",
] as const

/** One of {@link RARE_KEYS}. */
type RareKey = (typeof RARE_KEYS)[number]

/**
 * Every key {@link motionToConfig} copies into a config, in the order it sets them: the common keys,
 * the rare ones, then the layout animation and update callbacks.
 */
const CONFIG_KEYS = [
  "initial",
  "animate",
  "whileHover",
  "whileTap",
  "transition",
  "variants",
  "inherit",
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
  ...RARE_KEYS,
  "onLayoutAnimationStart",
  "onLayoutAnimationComplete",
  "onUpdate",
  "appear",
] as const

/** One of {@link CONFIG_KEYS}. */
type ConfigKey = (typeof CONFIG_KEYS)[number]

/**
 * A config's build from `motion`'s `keys`: each one's value, when it's defined; reading a key tracks
 * it. A build allocates its config alone (#525, #540).
 */
const configBuildOf = (motion: WardicMotionProps, keys: ReadonlyArray<ConfigKey>): Accessor<WardConfig> => () => {
  // Per element at mount (#540): a loop.
  const config: Record<string, unknown> = {}
  for (const key of keys) {
    const value = motion[key]
    if (Predicate.isNotUndefined(value)) config[key] = value
  }
  return config as WardConfig
}

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
  "custom",
  "inherit",
  "whileHover",
  "whileTap",
  "propagate",
  "whileFocus",
  "whileInView",
  "viewport",
  "exit",
  "drag",
  "whileDrag",
  "dragConstraints",
  "dragElastic",
  "dragMomentum",
  "dragSnapToOrigin",
  "dragTransition",
  "dragPropagation",
  "dragDirectionLock",
  "dragControls",
  "dragListener",
  "onMeasureDragConstraints",
  "layout",
  "layoutDependency",
  "layoutId",
  "layoutScroll",
  "layoutRoot",
  "layoutAnchor",
  "layoutCrossfade",
  "onAnimationStart",
  "onAnimationComplete",
  ...GESTURE_CALLBACKS,
  "onLayoutAnimationStart",
  "onLayoutAnimationComplete",
  "onUpdate",
  "transformTemplate",
  "onBeforeLayoutMeasure",
  "onLayoutMeasure",
  "appear",
  "transition",
  "key",
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
export const MOTION_PROPS_V2 = /*#__PURE__*/ Arr.filter(MOTION_PROPS, (prop) => Bool.not(Arr.contains(SOLID_1_CALLBACKS, prop))) as ReadonlyArray<
  Exclude<(typeof MOTION_PROPS)[number], (typeof SOLID_1_CALLBACKS)[number]>
>

const MOTION_PROP_SET: ReadonlySet<string> = /*#__PURE__*/ new Set(MOTION_PROPS)
const MOTION_PROP_SET_V2: ReadonlySet<string> = /*#__PURE__*/ new Set(MOTION_PROPS_V2)

/**
 * Whether `key` is one of a Wardic element's motion props on Solid 1 (#443, Motion's
 * `isValidMotionProp`): what `wardic.*` takes for itself and keeps off its element. Wardic's own list,
 * exactly, not Motion's prefixes: `whileHover` is one, `whileAnything` isn't.
 *
 * ```ts
 * isValidWardicProp("animate") // true
 * isValidWardicProp("href") // false
 * ```
 */
export const isValidWardicProp = (key: string): boolean => MOTION_PROP_SET.has(key)

/**
 * {@link isValidWardicProp} on Solid 2 (#443): its own list, without the callbacks that are the DOM's
 * events there (`onAnimationStart`, `onDrag`…), which a Wardic element hands on.
 */
export const isValidWardicPropV2 = (key: string): boolean => MOTION_PROP_SET_V2.has(key)

/**
 * The motion props a Wardic element takes beside its own: `initial`, `animate`, `transition`, the
 * gestures, drag, layout and the callbacks. Give each as a value, which Solid keeps up to date:
 * `animate={open() ? shown : hidden}`, not a function.
 *
 * @see https://wardic.dev/reference/solid/elements/props
 */
// The same props as WardConfig, so one JSDoc per prop is every hover's (#558). Each is a plain value,
// with no MaybeAccessor (step 21f): a Wardic element's props are getters, so reading one inside the
// config accessor (motionToConfig) tracks whatever signals back it.
export type WardicMotionProps = WardConfig

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
 * `fixedKeys`: `motion`'s keys stay as they are (it isn't a proxy over a reactive spread), so only
 * the keys it was given are read, found once (#273, #525): the config is rebuilt at each read, a
 * mount reads it 13 times, and each read took the 28 common keys where most elements are given two
 * or three. Without it, all are, as a proxy's keys can change.
 */
export const motionToConfig = (motion: WardicMotionProps, fixedKeys = false): Accessor<WardConfig> => {
  if (fixedKeys) {
    return configBuildOf(
      motion,
      Arr.filter(CONFIG_KEYS, (key) => key in motion),
    )
  }
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
    Arr.forEach(RARE_KEYS, (key) => {
      const value = motion[key]
      if (Predicate.isNotUndefined(value)) (config as Record<RareKey, unknown>)[key] = value
    })
    if (Predicate.isNotUndefined(onLayoutAnimationStart)) config.onLayoutAnimationStart = onLayoutAnimationStart
    if (Predicate.isNotUndefined(onLayoutAnimationComplete)) config.onLayoutAnimationComplete = onLayoutAnimationComplete
    if (Predicate.isNotUndefined(onUpdate)) config.onUpdate = onUpdate
    if (Predicate.isNotUndefined(appear)) config.appear = appear
    return config
  }
}
