/**
 * The Solid bindings' configuration types (#209): what an element's `initial`, `animate`,
 * `transition`, variants, gestures, drag and layout props take, for the Solid 1 binding and the
 * Solid 2 one (`@wardic/solid/unstable/v2`) alike. Solid-free: CSS properties come from
 * `csstype`, as both Solids' own `JSX.CSSProperties` do.
 *
 * @module
 */
import type { WardicAnimationControls } from "./animation-controls.ts"
import type * as Arc from "@wardic/core/Arc"
import type * as Machine from "@wardic/core/Machine"
import type * as Stagger from "@wardic/core/Stagger"
import type * as CSS from "csstype"
import type * as DomRenderer from "@wardic/dom/DomRenderer"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import type * as Box from "@wardic/core/Box"
import type { WardicDragConstraints, WardicMeasureDragConstraints } from "./drag-constraints.ts"
import type { WardicDragControls } from "./drag-controls.ts"
import type { WardicDragInfo, WardicPointInfo, WardicPressEvent, WardicPressInfo } from "./gesture-info.ts"

/** What "in view" means: an element's `viewport`, and `createInView`'s. Motion's `viewport` and `useInView` options. */
// #273, ADR-0047.
export interface WardicViewport {
  /** Stays in view after its first entry. */
  readonly once?: boolean
  /** Grown around the root, as CSS `rootMargin`: `"0px 0px -100px 0px"` counts it in 100 px later at the bottom. */
  readonly margin?: string
  /** How much of the element must show: `"some"` (the default), `"all"`, or 0 to 1. */
  readonly amount?: "some" | "all" | number
  /** The scrolling container it's in view of, as an accessor; the window if none. Read as it starts watching. */
  readonly root?: () => Element | undefined
}

/** CSS properties as Solid types them: `csstype`'s hyphenated set, and custom properties. */
export interface CSSProperties extends CSS.PropertiesHyphen {
  [key: `-${string}`]: string | number | undefined
}

/**
 * The transform-shorthand keys the `@wardic/dom` renderer's `TRANSFORM_KEYS`
 * groups into a single `transform` string (see `renderer.ts`). They are NOT
 * valid {@link CSSProperties} keys (`x`, `scale`, `rotate`, …), so they are added
 * here as an intersection on top of {@link CSSProperties}. Each is
 * `number | string` (a bare number gets the renderer's default unit; a string
 * is used verbatim).
 */
export interface WardicTransformShorthands {
  readonly x?: number | string
  readonly y?: number | string
  readonly z?: number | string
  readonly translateX?: number | string
  readonly translateY?: number | string
  readonly translateZ?: number | string
  readonly scale?: number | string
  readonly scaleX?: number | string
  readonly scaleY?: number | string
  readonly rotate?: number | string
  readonly rotateX?: number | string
  readonly rotateY?: number | string
  readonly rotateZ?: number | string
  readonly skewX?: number | string
  readonly skewY?: number | string
}

/**
 * Animatable SVG attributes (ADR-0014) the DOM applier routes via `setAttribute`.
 * These are the SVG keys NOT already typed by {@link CSSProperties}, plus the
 * geometry keys (`cx`/`cy`/`r`/`rx`/`ry`) re-typed `number | string` (csstype's
 * CSS-Geometry types are narrower). `fill`/`stroke`/`stroke-*` stay as
 * {@link CSSProperties} provides (color/length strings — already animatable). The
 * runtime accepts any key regardless; this is purely DX typing.
 */
export interface WardicSvgAttributes {
  readonly cx?: number | string
  readonly cy?: number | string
  readonly r?: number | string
  readonly rx?: number | string
  readonly ry?: number | string
  readonly x1?: number | string
  readonly y1?: number | string
  readonly x2?: number | string
  readonly y2?: number | string
  /** Motion's line-draw feature: portion (0–1) of the path stroked → `stroke-dasharray`. */
  readonly pathLength?: number
  readonly pathSpacing?: number
  readonly pathOffset?: number
  /** Set the SVG `x`/`y`/`scale` ATTRIBUTE explicitly (Wardic's `x`/`y` are transform shorthands). */
  readonly attrX?: number | string
  readonly attrY?: number | string
  readonly attrScale?: number | string
}

/**
 * The Solid bindings' value type: every {@link CSSProperties} key PLUS the transform
 * shorthands and the {@link WardicSvgAttributes} the renderer understands. This is
 * the type users write at the edge (`animate={{ opacity: 1, x: 100, cx: 50 }}`).
 * Core's `Values` (`Record<string, number | string>`) is framework-agnostic and
 * UNCHANGED; the binding funnels `WardicValues` through {@link toValues} before core.
 *
 * Some shorthand / geometry keys (`x`, `scale`, `cx`, `r`, …) ALSO exist on
 * `csstype`'s property set with much narrower value types (e.g. `scale: "none" |
 * string`). A plain intersection would narrow those to the (often `never`-like)
 * overlap and reject `scale: 1.1`. So we `Omit` those keys off {@link CSSProperties}
 * first, letting the `number | string` typing here win for them.
 */
export type WardicValues =
  & Omit<CSSProperties, keyof WardicTransformShorthands | keyof WardicSvgAttributes | DomRenderer.LengthKey>
  & WardicLengths
  & WardicTransformShorthands
  & WardicSvgAttributes

/**
 * The CSS lengths a value takes a bare number on, drawn in `px` (#522, Motion's `animate={{ height: 200 }}`):
 * the DOM renderer's `LENGTH_KEYS`, so a number typechecks only where it's drawn as a length. Every
 * other length takes `csstype`'s value, `0` or a string. `style` keeps Solid's own types: Solid writes a
 * number there as it is.
 */
export type WardicLengths = { readonly [K in DomRenderer.LengthKey]?: number | CSSProperties[K] }

/**
 * A **Keyframes** value (Motion's): the stops a key passes through in order, as
 * `animate={{ scale: [1, 1.2, 1] }}`. A first `null` is where the key is now; a later one repeats the
 * stop before it. An explicit first stop is jumped to as its animation starts. More than two stops run
 * on a tween (Motion's 0.8 s one with no transition defined; `times` places them, `ease` may be one per
 * Interval, between two stops): a spring takes two.
 */
export type WardicKeyframes<V> = ReadonlyArray<V | null>

/**
 * A target's values: {@link WardicValues}, each a value or its {@link WardicKeyframes}. Every
 * target takes them (`animate`, `exit`, each `while*`, a variant); `initial` reads one at its first
 * stop. `style` and a Transition end take one value, as does CSS's own `transition` string.
 */
export type WardicTargetValues = {
  readonly [K in keyof WardicValues]?: K extends "transition" ? WardicValues[K] : WardicValues[K] | WardicKeyframes<Exclude<WardicValues[K], undefined>>
}

/** A stagger: a child's delay in seconds, from its index and the count. `stagger()` makes one. Motion's `DynamicOption<number>`. */
// #436.
export type WardicStagger = (index: number, total: number) => number

/**
 * A path for `x` and `y` to travel along together: from where they start to where they end, the point
 * at each progress, 0 to 1, with a turn (`rotate`, in degrees) for one that turns the element. `arc()`
 * makes one; any function of this shape is one, a curve of your own.
 */
// A Path (#438).
export type WardicPath = Arc.Path

/**
 * How a parent's variant children are timed against it and each other: `when`, `delayChildren`,
 * `staggerChildren`, `staggerDirection` and `from`. Read on the parent's transition, for the variant
 * change it hands its children.
 */
// ADR-0007: they take effect on the parent that hands its names down; a child inherits them as its
// default transition but reads orchestration off the parent's context, not its own transition.
export interface WardicOrchestration {
  /** Seconds between one child's start and the next's. */
  readonly staggerChildren?: number
  /**
   * Fixed delay added to every child before its staggered offset; or, as Motion's, a function of a
   * child's index and the count, `stagger()`'s, which decides each child's whole delay:
   * `staggerChildren`, `staggerDirection` and `from` aren't read beside it.
   */
  // #436.
  readonly delayChildren?: number | WardicStagger
  /** `-1` reverses the stagger order, the last child first. Default `1`. */
  readonly staggerDirection?: 1 | -1
  /** The child the stagger grows from: `"first"` (the default), `"last"`, `"center"` or an index. */
  readonly from?: Stagger.Origin
  /**
   * Orders the parent and its children: `"beforeChildren"` animates the parent, then the children once
   * it lands; `"afterChildren"` the children, then the parent once they've all landed. Left out, they
   * animate together.
   */
  readonly when?: "beforeChildren" | "afterChildren"
}

/**
 * A transition's reduced-motion opt-out, on both arms. An animation honours the
 * provider's `reducedMotion` by default: under it, its positional keys snap and a layout
 * animation lands at once.
 */
export interface WardicReducedMotion {
  /** `false` animates the transition's keys whatever the provider's `reducedMotion` says. Default `true`. */
  readonly respectReducedMotion?: boolean
}

/**
 * A transition of `type: "inertia"`: each number glides from where it is at its velocity, its own or
 * `velocity`, and comes to rest `power × velocity` on, through `modifyTarget`, springing back to `min`
 * or `max` past one. Its target isn't read, so with no velocity it stays where it is. A value that
 * isn't a number, a colour or a length with units, runs on its default transition instead.
 * `timeConstant` is in milliseconds, as Motion's. Motion's `inertia`.
 */
// #435.
export interface WardicInertia {
  readonly type: "inertia"
  /** The velocity every key glides from, per second: each key's own when left out. */
  readonly velocity?: number
  /** How far a glide carries, as a multiple of its velocity. Default 0.8. */
  readonly power?: number
  /** The glide's time constant, in milliseconds. Default 325. */
  readonly timeConstant?: number
  /** The bounce back from an edge: its stiffness and damping. Defaults 500 and 10. */
  readonly bounceStiffness?: number
  readonly bounceDamping?: number
  /** At rest within this of where it's going. Default 0.5. */
  readonly restDelta?: number
  /** A bounce at rest below this speed, per second. Default 2. */
  readonly restSpeed?: number
  /** Moves where a glide rests, called with where it would: snapping it to a grid, say. */
  readonly modifyTarget?: (ideal: number) => number
  /** The edges: past one, the glide springs back to it. */
  readonly min?: number
  readonly max?: number
  /** Seconds each key holds where it is before it glides. */
  readonly delay?: number
}

/**
 * A transition's **Skipped animation** (Motion's `skipAnimations`), on both arms: `true` lands its
 * keys at their ends on the next frame, with no delay, as a `WardicConfig`'s `skipAnimations` does.
 * `false` doesn't undo a config's.
 */
export interface WardicSkipAnimations {
  readonly skipAnimations?: boolean
}

/**
 * A transition's **Path** (#438, Motion's `path`): `x` and `y` travel along it together, rather than
 * each on its own, on `x`'s transition, from rest. `arc()` makes one; any {@link WardicPath} is one.
 * An axis the target leaves out ends where it rests (#574): where a Path in flight was taking it, so
 * one caught mid-air curves back to its line, else where it is.
 * A layout animation reads it where Motion's does, on its layout transition: the `layout` entry when
 * there is one, else the element's transition. On any other value's entry it isn't read.
 */
export interface WardicTransitionPath {
  readonly path?: WardicPath
}

/**
 * How an element gets to its target: a spring, a tween, or an inertia, with a value's own transition
 * under its name. With no `type`, a spring field (`stiffness`, `damping`, `mass`, `velocity`,
 * `restDelta`, `restSpeed`, `bounce`, `visualDuration`) makes it a spring, and anything else a tween, so
 * `{ duration: 0.5 }` is a 0.5 s tween. A spring's missing fields are Motion's 100 / 10 / 1, or set by
 * time, a `duration` or `visualDuration` with a `bounce`; a tween's easing is `easeOut`. With neither,
 * each value runs on its default. It also takes `delay`, a tween's repeats, a `path`, its variant
 * children's orchestration, `respectReducedMotion` and `skipAnimations`.
 *
 * @example
 * <w.div animate={{ x: 100, opacity: 1 }} transition={{ type: "spring", bounce: 0.2, opacity: { duration: 0.2 } }} />
 * @see https://wardic.dev/reference/solid/transitions/transition
 */
// ADR-0051: a transition with only orchestration, `delay` or the opt-out leaves each key on its
// Environment's Default transition. A spring set by time (#359) is solved to its physics. A "tween"
// routes every key through `animateValues`, Keyframes through `keyframesValues` with `times` and an
// `ease` per Interval (#429). `from` is the stagger's origin on both arms: a spring's own `from` was
// never a transition's, and the two clashed (#243). A value's own transition: #301.
export type WardicTransition = WardicTransitionWith<WardicTransitionEntries>

/**
 * A transition with the entries `E` (#301): {@link WardicTransition}'s two arms. A Wardic element's
 * config checks each transition in it against the entries its keys allow (`WardChecked`).
 */
export type WardicTransitionWith<E> =
  | ({ readonly type?: "spring" } & Omit<Machine.SpringOptions, "from"> & WardicOrchestration & WardicReducedMotion & WardicSkipAnimations & WardicTransitionPath & E)
  | ({ readonly type?: "tween" } & Machine.KeyframesOptions & WardicOrchestration & WardicReducedMotion & WardicSkipAnimations & WardicTransitionPath & E)
  | (WardicInertia & WardicOrchestration & WardicReducedMotion & WardicSkipAnimations & WardicTransitionPath & E)

/**
 * One value's own transition, under its name in a `transition`: a spring, a tween or an inertia, without
 * the orchestration, which is the whole transition's. With `inherit: true` it's laid over the
 * transition's own fields, its own winning; without, it stands alone, taking only the transition's
 * `respectReducedMotion` and `skipAnimations`. Motion's `ValueTransition`.
 */
// #301.
export type WardicValueTransition =
  | ({ readonly type?: "spring" } & Omit<Machine.SpringOptions, "from"> & WardicReducedMotion & WardicSkipAnimations & WardicTransitionPath & WardicInherit)
  | ({ readonly type?: "tween" } & Machine.KeyframesOptions & WardicReducedMotion & WardicSkipAnimations & WardicTransitionPath & WardicInherit)
  | (WardicInertia & WardicReducedMotion & WardicSkipAnimations & WardicTransitionPath & WardicInherit)

/** `inherit: true` lays a transition over the one it would replace, its own fields winning, as Motion's. */
// #277, #301.
export interface WardicInherit {
  readonly inherit?: boolean
}

/** The name of a value a transition can have an entry for: a style, a transform shorthand, an SVG attribute. */
export type WardicValueKey = Exclude<keyof WardicValues & string, "transition">

/**
 * A transition's per-value entries: a value's own transition under its name, `default` for every value
 * without one, and `layout` for the element's layout animations. A value runs on its entry, else
 * `default`, else the transition's own fields. Motion's `TransitionWithValueOverrides`.
 */
// #301; `layout`, ADR-0009 *Amendment (#171)*: a layout animation on `layout`, else `default`, else the
// own fields, else Motion's 0.45 s tween.
export type WardicTransitionEntries = WardicValueEntries<WardicValueKey> & { readonly layout?: WardicValueTransition }

/** Entries for the values `K`, and `default` for the rest (#301). */
export type WardicValueEntries<K extends string> = { readonly default?: WardicValueTransition } & { readonly [P in K]?: WardicValueTransition }

/**
 * A variant's own transition, or a target's: it runs the animation that variant starts, in place of
 * the element's `transition`, unless `inherit: true` lays it over the element's, its own fields winning.
 * Motion's.
 */
// #277, ADR-0048.
export type WardicVariantTransition = WardicTransition & WardicInherit

/**
 * A target's **Transition end** (Motion's `transitionEnd`): values set at once, with no
 * animation, once the keys the target animates have landed, `{ opacity: 0, transitionEnd: { display:
 * "none" } }`. Its keys are the target's, so they return to their base when it's no longer active;
 * a target interrupted before it lands never sets them; the target an element renders first sets its
 * own at once, on a server too.
 */
export type WardicTransitionEnd = Omit<WardicValues, "transition">

/**
 * A target, as a variant, `animate` or `exit` gives it (Motion's `TargetAndTransition`): its
 * values, each a value or its Keyframes ({@link WardicTargetValues}), optionally the transition
 * the animation to it runs on, as an object, and its Transition end ({@link WardicTransitionEnd}).
 * A plain {@link WardicValues} map fits too, its CSS `transition` string a value as any other.
 */
export type WardicVariant =
  | (WardicTargetValues & { readonly transitionEnd?: WardicTransitionEnd })
  | (Omit<WardicTargetValues, "transition"> & { readonly transition?: WardicVariantTransition; readonly transitionEnd?: WardicTransitionEnd })

/**
 * Variant names (Motion's `VariantLabels`): one name, or a list of them. A list merges its
 * names' values in order, a later name's winning a key both set. Each key animates on the own
 * transition of the last name that sets it, and each name orchestrates the keys it sets in the
 * element's Variant children. An empty list is no name.
 */
export type WardicVariantLabels = string | ReadonlyArray<string>

/**
 * A dynamic variant (Motion's `TargetResolver`): called each time the variant is
 * resolved with the element's `custom` (or, for an exit, its `<AnimatePresence custom>`), its values
 * now and their velocities, and returns its target, or another variant's name.
 */
export type WardicVariantResolver = (
  // Motion's `custom` is `any`: a resolver declares its own (`(direction: number) => …`).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  custom: any,
  current: Readonly<Record<string, number | string>>,
  velocity: Readonly<Record<string, number>>,
) => WardicVariant | string

/** Named targets, each a target or a {@link WardicVariantResolver}. */
export type WardicVariants = Readonly<Record<string, WardicVariant | WardicVariantResolver>>

/**
 * A drag's release, Motion's `dragTransition`: the inertia every
 * release runs on, a Fling, a snap back to the origin, and a layout node's Release offset. A glide
 * toward `power` × the release velocity that eases out over `timeConstant`, springing back on the
 * bounce at an edge it would cross. Motion's names and units: `timeConstant` in milliseconds. The
 * edges are `dragConstraints`, both at the origin with `dragSnapToOrigin`, or the slot for a layout
 * node. A release never borrows the element's `transition`.
 */
export interface WardicDragTransition {
  /** How far a release glides, as a multiple of its velocity. Default 0.8. */
  readonly power?: number
  /** The glide's time constant, in milliseconds. Default 750. */
  readonly timeConstant?: number
  /** The bounce at an edge: 200 / 40 by default, a wall (1e6 / 1e7) with `dragElastic={0}`. */
  readonly bounceStiffness?: number
  readonly bounceDamping?: number
  /** At rest within this many px of where it's going. Default 1. */
  readonly restDelta?: number
  /** At an edge, at rest below this speed, px/s. Default 10. */
  readonly restSpeed?: number
  /** Moves where a release rests, called per axis with where it would: snapping it to a grid, say. */
  readonly modifyTarget?: (ideal: number) => number
}

/**
 * Config accepted by {@link createWard}.
 *
 * REACTIVITY LAYERING (step 21e): every field here is a STATIC value. A Ward's
 * reactivity is solely via the WHOLE-CONFIG accessor: `createWard(() => ({ ... }))`
 * re-reads the config when a signal it touches changes, recomputing `target()`
 * and driving a Retarget. Per-field accessor unwrapping is the COMPONENT layer's
 * job ({@link "./wardic.tsx"} `MotionProps`), not `createWard`'s — at its
 * boundary a config field is always a plain value.
 */
/**
 * Which of an element's gestures reach its pressable ancestors (Motion's `PropagateOptions`): only
 * `tap` so far. `false` stops it; left out or `true`, it propagates.
 */
export interface WardicPropagate {
  readonly tap?: boolean
}

/**
 * Motion's `definition` of an animation: a variant name, or its target values. A list of names
 * on Solid 2's landing, where `animate` gave one; Solid 1's callbacks are told each name.
 */
export type WardicAnimationDefinition = WardicVariantLabels | WardicValues

/**
 * An app's scale corrector (Motion's `addScaleCorrector` entry), given to `WardicProvider`'s
 * `scaleCorrectors` by the value key it corrects: `correct(latest, { target, treeScale, projectionDelta })`
 * turns the element's value into the one to write while a layout animation scales it (`target` the
 * box it's drawn into, `treeScale` its ancestors' scale, `projectionDelta` its delta, Motion's
 * shapes), written under `applyTo`'s keys when given, else its own. `latest` is the element's own
 * value for the key (from its `style` or an animation), else its computed value at its first measure.
 */
export type WardicScaleCorrector = ProjectionSystem.ScaleCorrector

/**
 * A point mapping (Motion's `TransformPoint`): handed a point in the viewport's coordinates, it
 * gives the one a drag or a pan uses: `WardicConfig`'s `transformPagePoint`.
 */
export type WardicTransformPoint = (point: { readonly x: number; readonly y: number }) => { readonly x: number; readonly y: number }

/** A layout box (Motion's `Box`): each axis's `min` and `max`, in the page's pixels. */
export type WardicLayoutBox = Box.Box

/**
 * A **Transform template** (Motion's `transformTemplate`): `(values, generated) => transform`.
 *
 * - **At rest and animating:** `values` holds the element's transform keys in their units, as
 *   Motion's do (`x: "10px"`, `rotate: "45deg"`, `scale: 1.5`), and `generated` is the transform
 *   Wardic would draw, `""` when every key is at its identity. It's called with no transform key too.
 * - **While a layout animation moves it:** `values` holds every value as it is (`x: 10`), and
 *   `generated` is the projection's transform. Once the flight lands, it's called as at rest.
 * - **Held for a Measure pass:** every value as it is, and `""`.
 */
export type WardicTransformTemplate = DomRenderer.TransformTemplate

/**
 * The motion props a Wardic element takes, and the config a ward is made with: what it animates,
 * when, how, and what it tells you. Motion's props, by Motion's names.
 *
 * @see https://wardic.dev/reference/solid/elements/props
 */
export interface WardConfig {
  /**
   * Where the element starts: values, a `variants` name, or `false` to start at `animate`, so nothing
   * animates as it mounts. On a server-rendered page, the element arrives in the HTML at `initial`.
   *
   * @example initial={{ opacity: 0, y: 12 }}
   */
  // Read once per mount (untracked), so a later change doesn't re-seed; read again on every mount,
  // an AnimatePresence re-entry included. `false` resolves `animate` once: its map, its variants
  // entry, or a Variant child's inherited name (#134). A key started at returns to its `style`
  // value, else where it started (ADR-0022).
  readonly initial?: WardicVariant | WardicVariantLabels | false
  /**
   * Where the element animates to: values or a `variants` name. Change it, and the element animates
   * from wherever it is to the new target. Or animation controls from `createAnimationControls()`,
   * which set the target when you call `start` or `set`.
   *
   * @example animate={{ opacity: open() ? 1 : 0 }}
   */
  // Read reactively through the whole-config accessor; its own `transition` drives it (#277). Controls
  // are read once (#433).
  readonly animate?: WardicVariant | WardicVariantLabels | WardicAnimationControls
  /**
   * Named targets that `initial`, `animate`, `exit` and the `while*` props can name instead of giving
   * values. A variant can carry its own `transition`, or be a function of `custom`. Children with
   * `variants` follow their parent's names, staggered by its `transition`.
   *
   * @example variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }}
   */
  // Dynamic variants: #277. Orchestration: ADR-0007.
  readonly variants?: WardicVariants
  /**
   * The value passed to this element's function variants. When it changes, they're resolved again,
   * and the element animates to what they give. A leaving element uses `<AnimatePresence custom>`
   * instead, if given.
   */
  // #277, ADR-0048: a leaver's own `custom` can't change any more.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly custom?: any
  /**
   * Which child of an `<AnimatePresence>` this is, as React's `key` tells Motion. A child that comes
   * back while one with its key is still leaving takes over from it, starting where it's drawn. Only
   * on the presence's child itself; never written to the page.
   */
  // #286, ADR-0048. Read once.
  readonly key?: string | number
  /**
   * `false` keeps an element with `variants` out of its parent's: it doesn't follow its names or take
   * part in its stagger, and passes none of them on to its own children.
   */
  // #50. By default a Variant child (variants, no initial/animate name of its own) joins its nearest
  // ancestor with variants (CONTEXT.md).
  readonly inherit?: boolean
  /**
   * Where the element animates while the pointer is over it, and back when it leaves: values or a
   * `variants` name, which children with `variants` follow too. Needs the `hover` Feature.
   *
   * @example whileHover={{ scale: 1.05 }}
   */
  // Priority: under whileTap and whileDrag, over whileFocus and whileInView. Names reach Variant
  // children (#291).
  readonly whileHover?: WardicVariant | WardicVariantLabels
  /**
   * Where the element animates while it's pressed, by a pointer or by Enter or Space while it has
   * focus. Needs the `press` Feature.
   *
   * @example whileTap={{ scale: 0.95 }}
   */
  // Highest priority with whileDrag. Keyboard presses: #427.
  readonly whileTap?: WardicVariant | WardicVariantLabels
  /**
   * Whether a press on this element also counts as a press of its ancestors. `{ tap: false }` keeps
   * it to this element: a pressable parent doesn't play its `whileTap` or hear the tap.
   */
  // #439, ADR-0066: a Press claim on the pointer down or key. Read at each press's start. Only an
  // element with a press claims; drags hold their own Drag claim.
  readonly propagate?: WardicPropagate
  /**
   * Where the element animates while it's in view, as `viewport` defines it. Needs the `inView`
   * Feature.
   *
   * @example whileInView={{ opacity: 1 }} viewport={{ once: true }}
   */
  // #273, ADR-0047. Under whileFocus and the pointer gestures.
  readonly whileInView?: WardicVariant | WardicVariantLabels
  /**
   * Where the element animates while it has the keyboard's focus (as `:focus-visible` shows it, not
   * a click's). Needs the `focus` Feature.
   */
  // #273. Under the pointer gestures, over whileInView.
  readonly whileFocus?: WardicVariant | WardicVariantLabels
  /**
   * What "in view" means for `whileInView` and the viewport callbacks: `root`, a scrolling container
   * (the window if none); `margin`, grown around it, as CSS `rootMargin`; `amount` of the element that
   * must show, `"some"`, `"all"` or 0 to 1; and `once`, to stay in view after the first entry.
   */
  // #273. Read when the recognizer starts.
  readonly viewport?: WardicViewport
  /**
   * Makes the element draggable: `true` on both axes, `"x"` or `"y"` on one. On release it carries on
   * at the speed it was thrown and slows to a stop. Needs the `drag` Feature.
   *
   * The element gets `touch-action`, `user-select: none` and `draggable="false"`, so a touch drag
   * isn't a scroll; its own `style` can override them. Of nested draggables, the innermost drags. With
   * `layout`, the element moves within its layout and returns to its place on release.
   *
   * @example drag="x" dragConstraints={{ left: 0, right: 200 }}
   */
  // ADR-0004: the pointer direct-sets x/y while the spine drives the rest and whileDrag. The drag
  // config (this and dragConstraints … dragPropagation) is read once at mount; only whileDrag is
  // reactive. Defaults: ADR-0019 Amendment (Reorder). Nested drags: Drag claims, ADR-0019 Amendment
  // (#29). With layout/layoutId it feeds the projection (ADR-0016). Lists: <Reorder> (ADR-0020).
  readonly drag?: boolean | "x" | "y"
  /**
   * Where the element animates while it's dragged, and back once it's let go.
   *
   * @example whileDrag={{ scale: 1.1 }}
   */
  // Driven by the spring, not stripped; only read when `drag` is on.
  readonly whileDrag?: WardicVariant | WardicVariantLabels
  /**
   * Keeps the element within bounds: `{ top, left, right, bottom }` in pixels from where it started
   * (an edge left out is unbounded), or a container element, given as an accessor, that it stays
   * inside. A throw past an edge springs back to it.
   *
   * @example dragConstraints={() => frame}
   */
  // ADR-0016 Amendment (#140): x/y whichever gesture moved them. A container is measured at each drag's
  // start and when either resizes (#273). Read once at mount; an accessor at each measure.
  readonly dragConstraints?: WardicDragConstraints
  /**
   * How far the element can be pulled past `dragConstraints`, 0 to 1: 0 stops it at the edge.
   * Default `0.35`, Motion's.
   */
  // Read once at mount.
  readonly dragElastic?: number
  /**
   * With a container in `dragConstraints`: called with the bounds measured against it, at each
   * measure. Return other bounds to use them instead, such as with a margin, or nothing to keep these.
   */
  // #273, ADR-0047.
  readonly onMeasureDragConstraints?: WardicMeasureDragConstraints
  /** `false` stops the element where it's let go, instead of carrying on at the speed it was thrown. Default `true`. */
  // Read once at mount.
  readonly dragMomentum?: boolean
  /** Springs the element back to where it started when it's let go. */
  // On dragTransition. Read once at mount.
  readonly dragSnapToOrigin?: boolean
  /**
   * How the element carries on after it's let go: Motion's inertia options (`power`, `timeConstant`,
   * `bounceStiffness`, `bounceDamping`, `min`, `max`…), over Motion's defaults.
   */
  // ADR-0016 Amendment (#140). Read once at mount.
  readonly dragTransition?: WardicDragTransition
  /** `true` lets a draggable ancestor drag along with this element, instead of only the innermost dragging. */
  // ADR-0019 Amendment (#29): takes no Drag claim and is never refused one; still keeps hovers and
  // presses from starting while it runs. Read once at mount.
  readonly dragPropagation?: boolean
  /**
   * Waits until a drag has moved 10 px, then keeps it to the axis it moved on. A sideways swipe inside
   * a sheet you drag down swipes, and a downward one drags the sheet. `onDirectionLock` says which.
   */
  // #273, ADR-0047: y checked first; claims only the locked axis; onDragStart/whileDrag come at the
  // lock, after onDirectionLock. Read once at mount.
  readonly dragDirectionLock?: boolean
  /**
   * Drag controls from `createDragControls()`: their `start(event)` begins this element's drag from a
   * press somewhere else, such as a handle.
   */
  // #431. Read once at mount.
  readonly dragControls?: WardicDragControls
  /**
   * `false`: pressing the element itself doesn't drag it; only its `dragControls` do. It then gets
   * none of the drag's touch and selection styles, so a list whose items drag by a handle still
   * scrolls by touch. Default `true`.
   */
  // #431. Read once at mount.
  readonly dragListener?: boolean
  /**
   * How the element moves to a target: a spring (`stiffness`, `damping`, `mass`, or `duration` and
   * `bounce`), a tween (`duration`, `ease`), keyframes' `times`, or `inertia`, with `delay`, `repeat`
   * and, for variants, `staggerChildren` and `when`. A value's own (`opacity: {…}`) or `layout`'s apply
   * to it alone. Without one, each value gets Motion's default.
   *
   * @example transition={{ type: "spring", stiffness: 300, damping: 20 }}
   * @see https://wardic.dev/guides/transitions
   */
  // Per-value entries: ADR-0049. Default transitions: ADR-0051.
  readonly transition?: WardicTransition
  /**
   * Where the element animates as it leaves an `<AnimatePresence>`: values or a `variants` name. The
   * element stays on the page until it has played.
   *
   * @example exit={{ opacity: 0, scale: 0.9 }}
   */
  // ADR-0007: the child doesn't drive it (it's disposed); its spine publishes the exit into the
  // presence registration, and the presence runs it on the retained node. A dynamic variant resolves
  // as it leaves (#277); its own transition, else the element's.
  readonly exit?: WardicVariant | WardicVariantLabels
  /**
   * Animates the element's layout: when its size or place on the page changes, by its own layout or
   * its siblings', it moves there smoothly instead of jumping. `"position"` or `"size"` animates only
   * that part, `"x"` or `"y"` one axis, and `"preserve-aspect"` its size only when the aspect ratio
   * changes. Needs the `layout` Feature.
   *
   * @see https://wardic.dev/guides/layout
   */
  // ADR-0005, ADR-0009. Whether it's a layout node is read once at mount; its Layout mode (Amendment
  // (#42)) at each layout animation's start. A measure re-reads the whole tree, so sibling reflow
  // needs no LayoutGroup.
  readonly layout?: boolean | "position" | "size" | "preserve-aspect" | "x" | "y"
  /**
   * A value whose change makes the element look for a layout change. In Solid nothing re-renders, so
   * give it what your layout depends on, such as a signal's value; a size change is seen on its own.
   *
   * @example layoutDependency={open()}
   */
  // Motion's prop name. Read reactively through the whole-config accessor.
  readonly layoutDependency?: unknown
  /**
   * A shared-layout id: when an element with this id mounts as another with it leaves or hides, the
   * new one animates from where the old one was, crossfading between them. Needs the `layout` Feature.
   *
   * @example <w.span layoutId="underline" />
   */
  // ADR-0005, ADR-0010. Works with no LayoutGroup (the registry is the provider's). Read once at
  // mount. With drag, the drag moves the projection target (ADR-0016).
  readonly layoutId?: string
  /**
   * Marks a scrolling element that is itself a layout element, so its descendants' layout animations
   * aren't thrown by its scroll. Every other scroll, `position: sticky` included, is accounted for
   * without it.
   */
  // ADR-0012 and its Amendments (Reorder, #578). Read once at mount.
  readonly layoutScroll?: boolean
  /**
   * Makes the element a root for the layout animations inside it: it never animates its own layout,
   * and its descendants' are measured against it.
   */
  // ADR-0013: it self-snaps, bounds delta accumulation, and anchors its subtree. Read once at mount.
  readonly layoutRoot?: boolean
  /**
   * Where in its parent's box a layout element anchors as the parent changes size: 0 to 1 on each
   * axis, top-left `{ x: 0, y: 0 }` by default. `false` measures it against the page instead.
   */
  // ADR-0013 relative projection. Read once at mount.
  readonly layoutAnchor?: { readonly x: number; readonly y: number } | false
  /**
   * Whether this element crossfades with the one it takes a `layoutId` over from. Default `true`.
   * `false` hides the old one as the move starts, and this one keeps its own opacity.
   */
  // #442, ADR-0010. Read as each handover begins; only the twin that becomes the Lead reads it.
  readonly layoutCrossfade?: boolean
  /**
   * Called when an animation of the element starts, with what it animates to: the variant name, or
   * the values. Not for a layout animation, which has its own. Solid 1's.
   */
  // #257: at each Retarget that starts one (animate, its variant, a gesture layer turning on or off).
  // Not for a same-target change, a drag's momentum or return. Read at that Retarget.
  readonly onAnimationStart?: (definition: WardicAnimationDefinition) => void
  /**
   * Called when that animation lands, with the same definition, once every value it moves has
   * settled. Not for one interrupted by a new target. Solid 1; on Solid 2, the element's ward gives
   * `next("settled")`.
   */
  // #257. Read at the Retarget that started it.
  readonly onAnimationComplete?: (definition: WardicAnimationDefinition) => void
  // Motion's gesture callbacks (#273, ADR-0047): `(event, info)`, the DOM's PointerEvent first, called
  // at the event, `info.point` in the viewport (not Motion's page). A hover's or a tap's starts its
  // recognizer, as a while* does, set at mount or later. Solid 1's: Solid 2 hears the same through
  // next(name). One that throws is reported, and the gesture goes on.
  /** Called when the pointer comes over the element (a touch never hovers). Solid 1; Solid 2's ward gives `"hoverStart"`. */
  readonly onHoverStart?: (event: PointerEvent, info: WardicPointInfo) => void
  /** Called when the pointer leaves the element. Solid 1; Solid 2's ward gives `"hoverEnd"`. */
  readonly onHoverEnd?: (event: PointerEvent, info: WardicPointInfo) => void
  /**
   * Called when a press begins on the element: a pointer going down, or Enter or Space while it has
   * focus (`info.input` says which). Solid 1; Solid 2's ward gives `"pressStart"`.
   */
  // Keyboard presses: #427.
  readonly onTapStart?: (event: WardicPressEvent, info: WardicPressInfo) => void
  /** Called when that press ends on the element: a release on it, or its key coming up. Solid 1; Solid 2's ward gives `"tap"`. */
  readonly onTap?: (event: WardicPressEvent, info: WardicPressInfo) => void
  /**
   * Called when that press ends anywhere else, or is cancelled. A press a drag took over is neither a
   * tap nor a cancel. Solid 1; Solid 2's ward gives `"tapCancel"`.
   */
  readonly onTapCancel?: (event: WardicPressEvent, info: WardicPressInfo) => void
  /** Called when a drag of the element starts. Solid 1; Solid 2's ward gives `"dragStart"`. */
  readonly onDragStart?: (event: PointerEvent, info: WardicDragInfo) => void
  /** Called as the drag moves: at its start, and each move after. Solid 1; Solid 2's ward gives `"drag"`. */
  readonly onDrag?: (event: PointerEvent, info: WardicDragInfo) => void
  /** Called when the drag is let go. Solid 1; Solid 2's ward gives `"dragEnd"`. */
  readonly onDragEnd?: (event: PointerEvent, info: WardicDragInfo) => void
  /** Called when the element comes to rest after it's let go. Not when a new grab stops it. Solid 1; Solid 2's ward gives `"dragTransitionEnd"`. */
  readonly onDragTransitionEnd?: () => void
  /** With `dragDirectionLock`: called with the axis a drag locked to, before `onDragStart`. Solid 1; Solid 2's ward gives `"directionLock"`. */
  readonly onDirectionLock?: (axis: "x" | "y") => void
  /** Called when the element comes into view, as `viewport` defines it, with the browser's `IntersectionObserverEntry`. Solid 1; Solid 2's ward gives `"viewportEnter"`. */
  readonly onViewportEnter?: (entry: IntersectionObserverEntry) => void
  /** Called when the element leaves the view. With `viewport.once`, never after the first entry. Solid 1; Solid 2's ward gives `"viewportLeave"`. */
  readonly onViewportLeave?: (entry: IntersectionObserverEntry) => void
  /**
   * Called when a pointer goes down on the element, ready to pan. A pan moves nothing itself: read
   * its offset and velocity in `onPan`. On a touch screen, give the element a `touch-action`, such as
   * `pan-y` for a sideways pan, or the page's scroll takes the gesture. Solid 1; Solid 2's ward gives
   * `"panSessionStart"`.
   */
  // Once started, a pan counts as a drag for the element's press and hover: a press it took over is
  // neither a tap nor a cancel (ADR-0047).
  readonly onPanSessionStart?: (event: PointerEvent, info: WardicPointInfo) => void
  /** Called when a pan starts, past its threshold. Solid 1; Solid 2's ward gives `"panStart"`. */
  readonly onPanStart?: (event: PointerEvent, info: WardicDragInfo) => void
  /** Called as the pan moves: at its start, and each move after. Solid 1; Solid 2's ward gives `"pan"`. */
  readonly onPan?: (event: PointerEvent, info: WardicDragInfo) => void
  /** Called when a pan that started ends, or is cancelled. Solid 1; Solid 2's ward gives `"panEnd"`. */
  readonly onPanEnd?: (event: PointerEvent, info: WardicDragInfo) => void
  /**
   * Called when a layout animation of the element starts moving. Not when there's nothing to move.
   * Solid 1; Solid 2's ward gives `"layoutStart"`.
   */
  // #191, ADR-0039: at the frame of its first step, after it's painted. A restart fires it again;
  // restarts in one task are one. A handover's is the new Lead's.
  readonly onLayoutAnimationStart?: () => void
  /**
   * Called when a layout animation of the element lands. Not for one interrupted or cut short, so a
   * start isn't always followed by a complete: `animateLayout`'s `onSettled` tells a change's end
   * however it went. Solid 1; Solid 2's ward gives `"layoutComplete"`.
   */
  // #191, ADR-0039.
  readonly onLayoutAnimationComplete?: () => void
  /**
   * Called once a frame in which the element's values changed, with every value it holds (`x` as a
   * number). The object is reused: read it during the call, or copy it. For one value, `ward.read(key)`
   * on Solid 2, or `ward.value(key)` on Solid 1, costs less.
   */
  // #233. After that frame's commits, before it's drawn. Whether it reports is read once at mount; the
  // function at each call. A signal it sets paints in the next frame.
  readonly onUpdate?: (latest: Readonly<Record<string, number | string>>) => void
  /**
   * Builds the element's whole `transform` from its values and the one Wardic would draw, wherever
   * it's drawn: at rest, animating, on the server and during a layout animation.
   *
   * @example transformTemplate={(_, generated) => `translate(-50%, -50%) ${generated}`}
   */
  // #443, a Transform template. See WardicTransformTemplate for what it's handed. Whether it has one is
  // read at mount; the function each frame.
  readonly transformTemplate?: WardicTransformTemplate
  /** Called as each layout measure of this layout element begins, before it's measured. */
  // #443. Resize-blocked and instant measures included. A throw is reported, and the measure goes on.
  readonly onBeforeLayoutMeasure?: () => void
  /**
   * Called with this layout element's box each time it's measured, and its box before (`undefined`
   * the first time): each axis's `min` and `max` in page pixels, its transforms left out.
   */
  // #443: after the read, before any animation starts. A throw is reported.
  readonly onLayoutMeasure?: (box: WardicLayoutBox, prev: WardicLayoutBox | undefined) => void
  /**
   * `false`: on a server-rendered page, this element's entrance waits for the JavaScript instead of
   * playing from the first paint. The provider's `appear` sets it for every element.
   *
   * @see https://wardic.dev/guides/server-rendering
   */
  // #48, ADR-0044. Read on the server, once.
  readonly appear?: boolean
}
