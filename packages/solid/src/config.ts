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

/** Motion's `viewport` (#273, ADR-0047): see `WardConfig.viewport`. */
export interface WardicViewport {
  readonly once?: boolean
  readonly margin?: string
  readonly amount?: "some" | "all" | number
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
  & Omit<CSSProperties, keyof WardicTransformShorthands | keyof WardicSvgAttributes>
  & WardicTransformShorthands
  & WardicSvgAttributes

/**
 * A **Keyframes** value (#429, Motion's): the stops a key passes through in order, as
 * `animate={{ scale: [1, 1.2, 1] }}`. A first `null` is where the key is now; a later one repeats the
 * stop before it. An explicit first stop is jumped to as its animation starts. More than two stops run
 * on a tween (Motion's 0.8 s one with no transition defined; `times` places them, `ease` may be one per
 * Segment): a spring takes two.
 */
export type WardicKeyframes<V> = ReadonlyArray<V | null>

/**
 * A target's values (#429): {@link WardicValues}, each a value or its {@link WardicKeyframes}. Every
 * target takes them (`animate`, `exit`, each `while*`, a variant); `initial` reads one at its first
 * stop. `style` and a Transition end take one value, as does CSS's own `transition` string.
 */
export type WardicTargetValues = {
  readonly [K in keyof WardicValues]?: K extends "transition" ? WardicValues[K] : WardicValues[K] | WardicKeyframes<Exclude<WardicValues[K], undefined>>
}

/**
 * Variant-orchestration fields (ADR-0007, step 21b), shared by both transition
 * arms. They only take effect on the parent that renders `ward.Provider`; a
 * child inherits them as the default transition but reads orchestration off the
 * parent CONTEXT (not its own transition).
 */
/** A stagger (#436, Motion's `DynamicOption<number>`): a child's delay in seconds, from its index and the count. */
export type WardicStagger = (index: number, total: number) => number

/**
 * A **Path** (#438): from where `x` and `y` start to where they end, the point at each progress, 0 to 1,
 * and a turn (`rotate`, degrees) for one that turns the element. `arc()` makes one; any function of
 * this shape is one, a curve of an app's own.
 */
export type WardicPath = Arc.Path

export interface WardicOrchestration {
  /** Seconds between successive sibling starts (core `stagger` amount). */
  readonly staggerChildren?: number
  /**
   * Fixed delay added to every child before its staggered offset; or, as Motion's, a function of a
   * child's index and the count, `stagger()`'s (#436), which decides each child's whole delay:
   * `staggerChildren`, `staggerDirection` and `from` aren't read beside it.
   */
  readonly delayChildren?: number | WardicStagger
  /** `-1` reverses the stagger order (last child leads). Default `1`. */
  readonly staggerDirection?: 1 | -1
  /** Origin the stagger distance grows from (reuses core's `Stagger.Origin`). */
  readonly from?: Stagger.Origin
  /**
   * Sequence the parent vs. its children: `"beforeChildren"` runs the parent,
   * then the children once it settles; `"afterChildren"` runs the children, then
   * the parent once all settle. Default (omitted) is concurrent.
   */
  readonly when?: "beforeChildren" | "afterChildren"
}

/**
 * A transition's reduced-motion opt-out (ADR-0029), on both arms. An animation honours the
 * provider's `reducedMotion` by default: under it, its positional keys snap and a layout
 * animation lands at once.
 */
export interface WardicReducedMotion {
  /** `false` animates the transition's keys whatever the provider's `reducedMotion` says. Default `true`. */
  readonly respectReducedMotion?: boolean
}

/**
 * A transition of `type: "inertia"` (#435, Motion's): each number glides from where it's drawn, at its
 * velocity (its own, or `velocity`), and rests `power × velocity` on, through `modifyTarget`, springing
 * back to `min` / `max` past one; its target isn't read, so with no velocity it stays where it is. A
 * key that isn't a number (a colour, a length with units) runs on its Default transition instead, as
 * if this defined none for it. Motion's units: `timeConstant` in milliseconds.
 */
export interface WardicInertia {
  readonly type: "inertia"
  /** The velocity every key glides from, per second: each key's own (its frames', #464) when left out. */
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
 * A transition's **Skipped animation** (#468, Motion's `skipAnimations`), on both arms: `true` lands its
 * keys at their ends on the next frame, with no delay, as a `WardicConfig`'s `skipAnimations` does.
 * `false` doesn't undo a config's.
 */
export interface WardicSkipAnimations {
  readonly skipAnimations?: boolean
}

/**
 * A transition's **Path** (#438, Motion's `path`): `x` and `y` travel along it together, rather than
 * each on its own, on `x`'s transition, from rest. `arc()` makes one; any {@link WardicPath} is one.
 * A layout animation reads it where Motion's does, on its layout transition: the `layout` entry when
 * there is one, else the element's transition. On any other value's entry it isn't read.
 */
export interface WardicTransitionPath {
  readonly path?: WardicPath
}

/**
 * Transition config: a primitive selector plus the matching primitive's
 * options. Without a `type`, a spring field (`stiffness`, `damping`, `mass`, `velocity`,
 * `restDelta`, `restSpeed`, `bounce`, `visualDuration`) makes it a spring and anything else a tween,
 * so `{ duration: 0.5 }` is a 0.5 s tween and `{ duration: 0.5, bounce: 0.2 }` a spring; one with only
 * orchestration, `delay` or the reduced-motion opt-out leaves each key on its Environment's Default
 * transition, Motion's by value in the DOM (ADR-0051). A spring's missing fields are Motion's 100 /
 * 10 / 1, a tween's easing Motion's `easeOut`. A spring set by time (#359: a `duration`, `bounce` or
 * `visualDuration`, and no stiffness, damping or mass) is solved to its physics instead, as Motion's
 * (`Machine.SpringOptions`). `"tween"` routes every key
 * through `animateValues` (duration-based, no velocity), and a key's Keyframes through
 * `keyframesValues`, with `times` and an `ease` per Segment (#429). Both arms also carry the
 * optional {@link WardicOrchestration} fields, {@link WardicReducedMotion}'s opt-out, {@link WardicSkipAnimations}, and
 * {@link WardicTransitionEntries}: a value's own transition (#301).
 * `from` is the stagger's origin on both: a spring's own `from` was never a transition's (each
 * key starts where it is), and the two clashed (#243).
 */
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
 * One value's own transition (#301, Motion's `ValueTransition`): a spring or a tween, as a
 * {@link WardicTransition} is, without the orchestration, which is the whole transition's. With
 * `inherit: true` it's laid over the transition's own fields, its own winning; without, it stands
 * alone, the transition's reduced-motion opt-out and `skipAnimations` the fields it takes from it.
 */
export type WardicValueTransition =
  | ({ readonly type?: "spring" } & Omit<Machine.SpringOptions, "from"> & WardicReducedMotion & WardicSkipAnimations & WardicTransitionPath & WardicInherit)
  | ({ readonly type?: "tween" } & Machine.KeyframesOptions & WardicReducedMotion & WardicSkipAnimations & WardicTransitionPath & WardicInherit)
  | (WardicInertia & WardicReducedMotion & WardicSkipAnimations & WardicTransitionPath & WardicInherit)

/** An entry's or a target's `inherit` (#277, #301, Motion's): laid over the transition it would replace. */
export interface WardicInherit {
  readonly inherit?: boolean
}

/** The name of a value a transition can have an entry for (#301): a style, a transform shorthand, an SVG attribute. */
export type WardicValueKey = Exclude<keyof WardicValues & string, "transition">

/**
 * A transition's entries (#301, Motion's `TransitionWithValueOverrides`): a value's own transition by
 * its name, `default` for every value without one, and `layout` for the element's layout animations
 * (ADR-0009 *Amendment (#171)*). A key runs on its entry, else `default`, else the transition's own
 * fields (Motion's `getValueTransition`); a layout animation on `layout`, else `default`, else the
 * own fields, else Motion's 0.45 s tween.
 */
export type WardicTransitionEntries = WardicValueEntries<WardicValueKey> & { readonly layout?: WardicValueTransition }

/** Entries for the values `K`, and `default` for the rest (#301). */
export type WardicValueEntries<K extends string> = { readonly default?: WardicValueTransition } & { readonly [P in K]?: WardicValueTransition }

/**
 * A variant's own transition, or a target's (#277, ADR-0048, Motion's): it drives the animation that
 * variant starts, in place of the element's `transition`, unless `inherit: true` lays it over the
 * element's (Motion's `inherit`: a shallow merge, its own keys winning).
 */
export type WardicVariantTransition = WardicTransition & WardicInherit

/**
 * A target's **Transition end** (#428, Motion's `transitionEnd`): values set at once, with no
 * animation, once the keys the target animates have landed, `{ opacity: 0, transitionEnd: { display:
 * "none" } }`. Its keys are the target's, so they return to their base when it's no longer active;
 * a target interrupted before it lands never sets them; the target an element renders first sets its
 * own at once, on a server too.
 */
export type WardicTransitionEnd = Omit<WardicValues, "transition">

/**
 * A target, as a variant, `animate` or `exit` gives it (#277, Motion's `TargetAndTransition`): its
 * values, each a value or its Keyframes (#429, {@link WardicTargetValues}), optionally the transition
 * the animation to it runs on, as an object, and its Transition end ({@link WardicTransitionEnd},
 * #428). A plain {@link WardicValues} map fits too, its CSS `transition` string a value as any other.
 */
export type WardicVariant =
  | (WardicTargetValues & { readonly transitionEnd?: WardicTransitionEnd })
  | (Omit<WardicTargetValues, "transition"> & { readonly transition?: WardicVariantTransition; readonly transitionEnd?: WardicTransitionEnd })

/**
 * Variant names (#297, Motion's `VariantLabels`): one name, or a list of them. A list merges its
 * names' values in order, a later name's winning a key both set. Each key animates on the own
 * transition of the last name that sets it, and each name orchestrates the keys it sets in the
 * element's Variant children. An empty list is no name.
 */
export type WardicVariantLabels = string | ReadonlyArray<string>

/**
 * A dynamic variant (#277, ADR-0048, Motion's `TargetResolver`): called each time the variant is
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

/** Named targets, each a target or a {@link WardicVariantResolver} (#277). */
export type WardicVariants = Readonly<Record<string, WardicVariant | WardicVariantResolver>>

/**
 * A drag's release (ADR-0016, *Amendment (#140)*), Motion's `dragTransition`: the inertia every
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
 * Which of an element's gestures reach its pressable ancestors (#439, Motion's `PropagateOptions`): only
 * `tap` so far. `false` stops it; left out or `true`, it propagates.
 */
export interface WardicPropagate {
  readonly tap?: boolean
}

/**
 * Motion's `definition` of an animation (#257): a variant name, or its target values. A list of names
 * (#297) on Solid 2's landing, where `animate` gave one; Solid 1's callbacks are told each name.
 */
export type WardicAnimationDefinition = WardicVariantLabels | WardicValues

/**
 * An app's scale corrector (#443, Motion's `addScaleCorrector` entry), given to `WardicProvider`'s
 * `scaleCorrectors` by the value key it corrects: `correct(latest, { target, treeScale, projectionDelta })`
 * turns the element's value into the one to write while a layout animation scales it (`target` the
 * box it's drawn into, `treeScale` its ancestors' scale, `projectionDelta` its delta, Motion's
 * shapes), written under `applyTo`'s keys when given, else its own. `latest` is the element's own
 * value for the key (from its `style` or an animation), else its computed value at its first measure.
 */
export type WardicScaleCorrector = ProjectionSystem.ScaleCorrector

/**
 * A point mapping (#443, Motion's `TransformPoint`): handed a point in the viewport's coordinates, it
 * gives the one a drag or a pan uses: `WardicConfig`'s `transformPagePoint`.
 */
export type WardicTransformPoint = (point: { readonly x: number; readonly y: number }) => { readonly x: number; readonly y: number }

/** A layout box (#443, Motion's `Box`): each axis's `min` and `max`, in the page's pixels. */
export type WardicLayoutBox = Box.Box

/**
 * A **Transform template** (#443, Motion's `transformTemplate`): `(values, generated) => transform`.
 *
 * - **At rest and animating:** `values` holds the element's transform keys in their units, as
 *   Motion's do (`x: "10px"`, `rotate: "45deg"`, `scale: 1.5`), and `generated` is the transform
 *   Wardic would draw, `""` when every key is at its identity. It's called with no transform key too.
 * - **While a layout animation moves it:** `values` holds every value as it is (`x: 10`), and
 *   `generated` is the projection's transform. Once the flight lands, it's called as at rest.
 * - **Held for a Measure pass:** every value as it is, and `""`.
 */
export type WardicTransformTemplate = DomRenderer.TransformTemplate

export interface WardConfig {
  /**
   * The per-mount seed — the *entry-from* state the animation departs from.
   *
   * READ TIMING: resolved EXACTLY ONCE per mount (via `untrack` at setup); it is
   * the seed, not a live target, so changing the whole-config accessor does NOT
   * re-seed mid-life. It IS re-evaluated on every mount, including a re-entry
   * after an `AnimatePresence` exit.
   *
   * FORMS:
   *   - a `WardicValues` map — used verbatim; SSR-serializable.
   *   - a string — names a `variants` entry; SSR-serializable.
   *   - `false` — start at `animate` (resolved once: its map, its `variants` entry, or, for a
   *     Variant child with none, the name its ancestor hands down), so nothing animates at
   *     mount (#134, Motion's). An element that names its own variants hands it down. A key it
   *     started at returns to its `style` value, else to where it started (ADR-0022).
   */
  readonly initial?: WardicVariant | WardicVariantLabels | false
  /**
   * The resting target. A string names a `variants` entry. Read reactively through the whole-config
   * accessor `cfg()`. Its own `transition` (#277) drives the animation to it. **Animation controls**
   * (#433, `createAnimationControls()`, read once) set it instead, at each `start` or `set`.
   */
  readonly animate?: WardicVariant | WardicVariantLabels | WardicAnimationControls
  /**
   * Named targets `initial`, `animate` and `exit` strings resolve against: each a target, with its own
   * `transition` if it has one, or a function of `custom` (#277, Motion's dynamic variants).
   */
  readonly variants?: WardicVariants
  /**
   * The value handed to this element's dynamic variants (#277, ADR-0048, Motion's `custom`). A
   * change re-resolves them, and a value that changes animates. For an exit, a
   * `<AnimatePresence custom>` given is used instead: the leaving element's own can't change any more.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly custom?: any
  /**
   * Which child of an `<AnimatePresence>` this element is (#286, ADR-0048, Motion's `key`): a child
   * back while one with its key is still exiting takes over from it, starting where it is drawn,
   * and the leaver goes at once. Only on the presence's child itself (its root element); anywhere
   * else, it does nothing. Read once. Never written to the DOM.
   */
  readonly key?: string | number
  /**
   * `false` keeps an element with `variants` out of its ancestors' variants (#50, Motion's
   * `inherit`): it inherits no names, takes no stagger slot, and hands its children no names
   * from above it. By default a Variant child (`variants`, no `initial` or `animate` name of
   * its own) joins its nearest ancestor with variants (CONTEXT.md).
   */
  readonly inherit?: boolean
  /**
   * Target merged in (highest-but-one priority) while hovered. Each gesture prop takes a target, or a
   * `variants` name (#291, Motion's), which its Variant children take too while the gesture is on.
   */
  readonly whileHover?: WardicVariant | WardicVariantLabels
  /** Target merged in (highest priority) while pressed. */
  readonly whileTap?: WardicVariant | WardicVariantLabels
  /**
   * Whether the element's gestures reach its pressable ancestors (#439, Motion's `propagate`). With
   * `{ tap: false }`, its press takes a **Press claim** on the pointer down or the key it starts from, and
   * no ancestor's press starts from it: no `whileTap`, and no tap callbacks or tap events there. By
   * default every press propagates, a key's too (ADR-0066). Read at each press's start. Only an element
   * with a press claims (`whileTap`, or a tap callback or event), and a drag isn't stopped: drags hold
   * their own **Drag claim**.
   */
  readonly propagate?: WardicPropagate
  /**
   * Target merged in while the element is in view (Motion's, #273, ADR-0047), under `whileFocus` and
   * the pointer gestures: what "in view" means is `viewport`'s.
   */
  readonly whileInView?: WardicVariant | WardicVariantLabels
  /**
   * Target merged in while the element is focused as the browser shows it (Motion's, #273): a
   * keyboard's focus (`:focus-visible`), not a pointer's click. Under the pointer gestures, over
   * `whileInView`.
   */
  readonly whileFocus?: WardicVariant | WardicVariantLabels
  /**
   * What "in view" means for `whileInView` and the viewport callbacks (Motion's `viewport`, #273): the
   * container (`root`, an accessor; the viewport when none), a `margin` grown around it (CSS
   * `rootMargin`), how much of the element must be in it (`amount`: `"some"`, the default, `"all"`
   * or 0 to 1), and `once`: in view from its first entry on. Read when the recognizer starts.
   */
  readonly viewport?: WardicViewport
  /**
   * Enable dragging (ADR-0004). `true` = free; `"x"`/`"y"` = axis-locked. While
   * held (and during the release tail) the drag DIRECT-SETS `x`/`y` (1:1 with
   * the pointer, NOT sprung); the spring spine keeps driving every other key +
   * {@link whileDrag}. Ownership of `x`/`y` returns to the spring once the
   * release settles.
   *
   * STATIC (LOW-3, reactivity-layering rule): the drag CONFIG — this field plus
   * {@link dragConstraints} / {@link dragElastic} / {@link dragMomentum} /
   * {@link dragSnapToOrigin} / {@link dragTransition} / {@link dragPropagation} — is read EXACTLY ONCE
   * at mount (`untrack`); only
   * {@link whileDrag} participates in the reactive override / `dragging` path. A
   * reactively-changed axis / constraints is NOT re-read in v0.1.
   *
   * The element gets Motion's drag defaults (ADR-0019, *Amendment (Reorder)*):
   * `touch-action` `none` (`pan-y` for an `x` drag, `pan-x` for a `y` drag),
   * `user-select` and `-webkit-user-select` / `-webkit-touch-callout` `none`, and
   * `draggable="false"`, so a touch drag isn't taken for a scroll and a drag
   * starting on text isn't a native drag. The element's own `style` overrides them.
   *
   * Nested draggables (ADR-0019, *Amendment (#29)*): a drag takes its element's **Drag
   * claim** on its axis (both for `true`) when it starts, so of an element and a draggable
   * ancestor that grabs with it, the innermost drags and the other doesn't, unless they
   * drag on different axes. {@link dragPropagation} opts out.
   *
   * With {@link layout} or {@link layoutId} the drag moves the projection target
   * instead of `x`/`y`, and the release FLIPs to the slot (ADR-0016). To drag the
   * items of a list or grid into a new order, use `<Reorder>` (ADR-0020).
   */
  readonly drag?: boolean | "x" | "y"
  /**
   * Target merged in (highest priority) while dragging. Driven by the spring
   * (NOT stripped) so e.g. `scale: 1.1` animates while held and returns after
   * release. Only consulted when `drag` is on.
   */
  readonly whileDrag?: WardicVariant | WardicVariantLabels
  /**
   * Constrain the element's `x`/`y`, whichever gesture moved it there; a Fling springs back to an edge
   * it would cross (ADR-0016, *Amendment (#140)*). Only when `drag` is on. Motion's forms (#273,
   * ADR-0047):
   * - `{ top, left, right, bottom }`: the range of x (`left` to `right`) and y (`top` to `bottom`), an
   *   edge left out unbounded;
   * - an accessor of a container element (`dragConstraints={frame}`, a signal ref, or `() => frame`):
   *   the element's box stays inside the container's. It's measured at each drag's start, and when
   *   either resizes, keeping the element's place within them. One bigger than its container can be
   *   dragged to show what overflows, and no further;
   * - `false`: none.
   *
   * Static config (LOW-3): read ONCE at mount; an accessor is read at each measure.
   */
  readonly dragConstraints?: WardicDragConstraints
  /**
   * Rubber-band resistance past {@link dragConstraints}: 0 a hard clamp, with a wall for a bounce.
   * Default 0.35, Motion's. Static config (LOW-3): read ONCE at mount; not re-read reactively in v0.1.
   */
  readonly dragElastic?: number
  /**
   * Motion's `onMeasureDragConstraints` (#273, ADR-0047): with a container in `dragConstraints`, the
   * bounds measured against it, as `{ top, left, right, bottom }`, at each measure. Return other
   * bounds to use them instead (a margin, say), or nothing to keep these.
   */
  readonly onMeasureDragConstraints?: WardicMeasureDragConstraints
  /** Fling on release (default `true`); `false` releases with no velocity. Only when `drag` is on. Static config (LOW-3): read ONCE at mount; not re-read reactively in v0.1. */
  readonly dragMomentum?: boolean
  /** Spring `x`/`y` back to the origin on release, on {@link dragTransition}. Only when `drag` is on. Static config (LOW-3): read ONCE at mount; not re-read reactively in v0.1. */
  readonly dragSnapToOrigin?: boolean
  /**
   * What the release runs on (Motion's `dragTransition`, ADR-0016 *Amendment (#140)*): Motion's
   * inertia, its options over Motion's defaults. Only when `drag` is on. Static config (LOW-3): read
   * ONCE at mount; not re-read reactively in v0.1.
   */
  readonly dragTransition?: WardicDragTransition
  /**
   * `true`: the drag takes no **Drag claim** and is never refused one, so a draggable
   * ancestor drags with it (Motion's `dragPropagation`, ADR-0019 *Amendment (#29)*). It
   * still keeps hovers and presses from starting while it runs. Only when `drag` is on.
   * Static config (LOW-3): read ONCE at mount; not re-read reactively in v0.1.
   */
  readonly dragPropagation?: boolean
  /**
   * Motion's `dragDirectionLock` (#273, ADR-0047): each drag waits until it has moved 10 px on one
   * axis (y checked first), then drags on that axis alone, and claims only it, so a parent that drags
   * the other axis keeps the gesture (a card you swipe sideways inside a sheet you drag down). Until
   * then nothing has started: `onDragStart` and `whileDrag` come at the lock, after `onDirectionLock`.
   * A one-axis drag locked the other way doesn't start. Motion's drag starts at 3 px, claiming both
   * axes, and locks after. Static config (LOW-3): read ONCE at mount.
   */
  readonly dragDirectionLock?: boolean
  /**
   * Motion's `dragControls` (#431): **Drag controls** from `createDragControls()`, whose `start(event)`
   * begins this element's drag from a pointer pressed elsewhere (a handle, a track), as if it had
   * pressed the element. Only when `drag` is on. Static config (LOW-3): read ONCE at mount.
   */
  readonly dragControls?: WardicDragControls
  /**
   * Motion's `dragListener` (#431): `false`, a press on the element doesn't drag it, nor stop its
   * release; only its {@link dragControls} do, and it gets none of the drag defaults (`touch-action`,
   * no text selection, `draggable="false"`), as Motion's go with its listener: a list whose items drag
   * by a handle still scrolls by touch. Default `true`. Static config (LOW-3): read ONCE at mount.
   */
  readonly dragListener?: boolean
  /** Primitive selector + options (default spring). */
  readonly transition?: WardicTransition
  /**
   * The exit target — the state this element animates toward when it leaves an
   * `<AnimatePresence>` (ADR-0007). The child itself never DRIVES this exit (it
   * is disposed on leave); instead the spine publishes the live exit values into
   * the presence registration, and the parent `<AnimatePresence>` runs the exit
   * on the retained DOM node. A string names a `variants` entry, a dynamic one resolved as the
   * element leaves (#277); the exit runs on its own `transition`, else the element's.
   */
  readonly exit?: WardicVariant | WardicVariantLabels
  /**
   * Enable layout FLIP (ADR-0005): on a reflow this element animates from its
   * prior box to its new one (First/Last/Invert/Play). Under a `<LayoutGroup>`
   * sibling reflow is animated too; standalone, only this element's own
   * size/`layoutDependency` change is observed. Whether the element animates its layout is
   * read once, at mount. A **Layout mode** (ADR-0009, *Amendment (#42)*, Motion's) animates
   * part of it: `"position"` (its size changes at once), `"size"`, `"x"`, `"y"` or
   * `"preserve-aspect"` (position only when the width/height ratio changes); it's read at
   * each layout animation's start. `true` animates position and size.
   */
  readonly layout?: boolean | "position" | "size" | "preserve-aspect" | "x" | "y"
  /**
   * A value/signal whose change re-measures this element and plays a FLIP
   * (framer-motion's prop name + semantics). Only consulted when `layout` is on.
   * Read REACTIVELY through the whole-config accessor `cfg()`.
   */
  readonly layoutDependency?: unknown
  /**
   * Shared-element (cross-element) FLIP key (ADR-0005, framer-motion `layoutId`
   * parity). An element entering with the same `layoutId` a prior element left
   * animates FROM that prior element's box (the {@link Shared layout} from
   * CONTEXT.md). Works with NO `<LayoutGroup>` — the registry is provided at the
   * `WardicProvider` root by default. Composes with `layout`/`layoutDependency`
   * and the element's `animate` (the FLIP keys merge into the same gate id and
   * project once, ADR-0006). Static field (read once, untracked at mount).
   *
   * With {@link drag} the drag moves the projection target (ADR-0016). To drag the
   * items of a list or grid into a new order, use `<Reorder>` (ADR-0020).
   */
  readonly layoutId?: string
  /**
   * Mark this a scroll container that is itself a projection node (ADR-0012): its
   * scroll offset is folded out of its descendants' boxes, so a scroll change between
   * triggers doesn't leak into their layout animation. Any other container that can
   * scroll is folded too without it (*Amendment (Reorder)*). Static (read once at
   * mount).
   */
  readonly layoutScroll?: boolean
  /**
   * Mark this a stable projection sub-root (ADR-0013): it never FLIPs its own layout
   * (self-snaps), bounds delta accumulation for its subtree, and is a persistent
   * relative anchor for its descendants. Static (read once at mount).
   */
  readonly layoutRoot?: boolean
  /**
   * The relative-projection anchor (ADR-0013): where in its relativeParent this
   * element anchors (0–1 per axis, default top-left `{x:0,y:0}`). `false` opts out
   * of relative projection (force absolute). Static (read once at mount).
   */
  readonly layoutAnchor?: { readonly x: number; readonly y: number } | false
  /**
   * Whether a `layoutId` handover onto this element crossfades (#442, Motion's prop), read as each
   * begins. Default `true`: it fades in as the twin it takes over from fades out (ADR-0010). `false`:
   * that twin is hidden as the handover starts, and this one moves at its own opacity. Only the twin
   * that becomes the Lead reads it; a Switch, its twin already gone, blends as ever.
   */
  readonly layoutCrossfade?: boolean
  /**
   * Called when an animation of this element starts (#257, Motion's prop): at each Retarget that
   * starts one, a change of `animate` or of the variant it resolves (the entrance at mount
   * included), or a gesture layer (`whileHover`, `whileTap`, `whileDrag`) turning on or off. With
   * its `definition`: the variant name its base layer resolved when no gesture layer moved the
   * target, else the target values. Not for a change that resolves the same target, a drag's
   * momentum or return, or a layout animation (its own callbacks). Read at that Retarget.
   */
  readonly onAnimationStart?: (definition: WardicAnimationDefinition) => void
  /**
   * Called when that animation lands (#257, Motion's prop), with the same `definition`: once every
   * key it moves has settled. Not for one the next Retarget interrupted, which completes instead.
   * Read at the Retarget that started it.
   */
  readonly onAnimationComplete?: (definition: WardicAnimationDefinition) => void
  // Motion's gesture callbacks (#273, ADR-0047): Motion's `(event, info)`, the DOM's `PointerEvent`
  // first, called at the event, with `info.point` in the viewport (not Motion's page). A hover's or a
  // tap's starts its recognizer, as a `while*` does, set at mount or later. Solid 1's: Solid 2 hears the
  // same through `next(name)`. One that throws is reported, and the gesture goes on.
  /** The pointer came over the element (touch never hovers). */
  readonly onHoverStart?: (event: PointerEvent, info: WardicPointInfo) => void
  /** It left, or a press held on it while it left was let go. */
  readonly onHoverEnd?: (event: PointerEvent, info: WardicPointInfo) => void
  /**
   * A press began on the element: a primary pointer's down, with no drag active, or Enter or Space
   * going down while it has focus (a **Keyboard press**, #427: `info.input` says which).
   */
  readonly onTapStart?: (event: WardicPressEvent, info: WardicPressInfo) => void
  /** That press ended in a release on the element or inside it, or its key coming up. */
  readonly onTap?: (event: WardicPressEvent, info: WardicPressInfo) => void
  /**
   * It ended elsewhere, or was cancelled; a key's, when the element lost focus. A press a drag took
   * over is neither a tap nor a cancel.
   */
  readonly onTapCancel?: (event: WardicPressEvent, info: WardicPressInfo) => void
  /** A drag of the element started, past its threshold. */
  readonly onDragStart?: (event: PointerEvent, info: WardicDragInfo) => void
  /** That drag moved: its start, and each move after. */
  readonly onDrag?: (event: PointerEvent, info: WardicDragInfo) => void
  /** That drag ended at its release. */
  readonly onDragEnd?: (event: PointerEvent, info: WardicDragInfo) => void
  /** The drag's release came to rest on its own: its momentum or its spring back, or at once in place. Not one a grab stopped. */
  readonly onDragTransitionEnd?: () => void
  /** With `dragDirectionLock`, the axis a drag locked to, at its start, before `onDragStart` (Motion's). */
  readonly onDirectionLock?: (axis: "x" | "y") => void
  /**
   * The element came into view, as `viewport` says (Motion's, #273), with the browser's own
   * `IntersectionObserverEntry`. An element that starts out of view tells nothing until it enters.
   */
  readonly onViewportEnter?: (entry: IntersectionObserverEntry) => void
  /** It left the view (Motion's). With `viewport.once`, never after its first entry. */
  readonly onViewportLeave?: (entry: IntersectionObserverEntry) => void
  /**
   * A pan's session began: a primary pointer went down on the element (Motion's pan). A pan moves
   * nothing; once started, it counts as a drag for the element's press and hover: a press it took
   * over is neither a tap nor a cancel (Wardic's rule, ADR-0047). It sets no `touch-action`: on a
   * touch screen, give the element one (`pan-y` for a sideways pan in a scrolling page), or the
   * browser's scroll cancels it.
   */
  readonly onPanSessionStart?: (event: PointerEvent, info: WardicPointInfo) => void
  /** That pan started, past its threshold. */
  readonly onPanStart?: (event: PointerEvent, info: WardicDragInfo) => void
  /** That pan moved: its start, and each move after. */
  readonly onPan?: (event: PointerEvent, info: WardicDragInfo) => void
  /** That pan ended at its release, or was cancelled. Only a pan that started. */
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
   * (#233, Motion's `onUpdate`), with every value it holds for the element, before it's drawn (`x`
   * as a number). `latest` is one object per element, reused: read it during the call, copy it to
   * keep it. Whether the element reports is read once, at mount; the function is read each call. A
   * signal it sets paints in the next frame. For one key, `ward.value(key)` costs less.
   */
  readonly onUpdate?: (latest: Readonly<Record<string, number | string>>) => void
  /**
   * The element's whole transform, built from its values and the one Wardic would draw (#443, a
   * **Transform template**, Motion's prop). What it returns is the element's transform wherever it's
   * drawn: at rest, animating, on a server, in its Appear animation, projected by a layout animation,
   * and held for a Measure pass, so a static part of it, such as centring, is measured and stays
   * through the flight. See {@link WardicTransformTemplate} for what it's handed. Whether the element
   * has one is read at mount; the function is read each frame, and another one is drawn at the next.
   *
   * ```tsx
   * <wardic.div layoutId="modal" transformTemplate={(_, generated) => `translate(-50%, -50%) ${generated}`} />
   * ```
   */
  readonly transformTemplate?: WardicTransformTemplate
  /**
   * Called as each layout measure that measures this element begins (#443, Motion's prop), before
   * its transform is held for the read: for a layout element (`layout`, `layoutId`), resize-blocked
   * and instant measures included. Whether it's given is read at mount; the function each call. A
   * throw is reported, and the measure goes on.
   */
  readonly onBeforeLayoutMeasure?: () => void
  /**
   * Called with this layout element's box each layout measure measures it (#443, Motion's prop), and
   * its box before, `undefined` at its first: each axis's `min` and `max` in the page's pixels, its
   * transforms left out (Motion's layout box). After the read, before any animation starts.
   * Whether it's given is read at mount; the function each call. A throw is reported.
   */
  readonly onLayoutMeasure?: (box: WardicLayoutBox, prev: WardicLayoutBox | undefined) => void
  /**
   * `false` keeps this element at its Starting style until mount during a server render, when the
   * provider would start its mount animation in CSS from first paint (an Appear animation, #48,
   * ADR-0044), for an animation that should start only once the page responds. Read on the server,
   * once; the provider's `appear` turns it off for every element.
   */
  readonly appear?: boolean
}
