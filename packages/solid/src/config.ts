/**
 * The Solid bindings' configuration types (#209): what an element's `initial`, `animate`,
 * `transition`, variants, gestures, drag and layout props take, for the Solid 1 binding and the
 * Solid 2 one (`@wardic/solid/unstable/v2`) alike. Solid-free: CSS properties come from
 * `csstype`, as both Solids' own `JSX.CSSProperties` do.
 *
 * @module
 */
import type * as Machine from "@wardic/core/Machine"
import type * as Stagger from "@wardic/core/Stagger"
import type * as CSS from "csstype"
import type { WardicDragConstraints, WardicMeasureDragConstraints } from "./drag-constraints.ts"
import type { WardicDragInfo, WardicPointInfo } from "./gesture-info.ts"

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
 * Variant-orchestration fields (ADR-0007, step 21b), shared by both transition
 * arms. They only take effect on the parent that renders `ward.Provider`; a
 * child inherits them as the default transition but reads orchestration off the
 * parent CONTEXT (not its own transition).
 */
export interface WardicOrchestration {
  /** Seconds between successive sibling starts (core `stagger` amount). */
  readonly staggerChildren?: number
  /** Fixed delay added to every child before its staggered offset. */
  readonly delayChildren?: number
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
 * Transition config: a primitive selector plus the matching primitive's
 * options. Without a `type`, a spring field (`stiffness`, `damping`, `mass`, `velocity`,
 * `restDelta`, `restSpeed`, `bounce`, `visualDuration`) makes it a spring and anything else a tween,
 * so `{ duration: 0.5 }` is a 0.5 s tween and `{ duration: 0.5, bounce: 0.2 }` a spring; one with only
 * orchestration, `delay` or the reduced-motion opt-out leaves each key on its Environment's Default
 * transition, Motion's by value in the DOM (ADR-0051). A spring's missing fields are Motion's 100 /
 * 10 / 1, a tween's easing Motion's `easeOut`. A spring set by time (#359: a `duration`, `bounce` or
 * `visualDuration`, and no stiffness, damping or mass) is solved to its physics instead, as Motion's
 * (`Machine.SpringOptions`). `"tween"` routes every key
 * through `animateValues` (duration-based, no velocity). Both arms also carry the
 * optional {@link WardicOrchestration} fields, {@link WardicReducedMotion}'s opt-out, and
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
  | ({ readonly type?: "spring" } & Omit<Machine.SpringOptions, "from"> & WardicOrchestration & WardicReducedMotion & E)
  | ({ readonly type?: "tween" } & Machine.AnimateOptions & WardicOrchestration & WardicReducedMotion & E)

/**
 * One value's own transition (#301, Motion's `ValueTransition`): a spring or a tween, as a
 * {@link WardicTransition} is, without the orchestration, which is the whole transition's. With
 * `inherit: true` it's laid over the transition's own fields, its own winning; without, it stands
 * alone, the transition's reduced-motion opt-out the one field it takes from it.
 */
export type WardicValueTransition =
  | ({ readonly type?: "spring" } & Omit<Machine.SpringOptions, "from"> & WardicReducedMotion & WardicInherit)
  | ({ readonly type?: "tween" } & Machine.AnimateOptions & WardicReducedMotion & WardicInherit)

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
 * A target, as a variant, `animate` or `exit` gives it (#277, Motion's `TargetAndTransition`): its
 * values, and optionally the transition the animation to it runs on, as an object. A plain
 * {@link WardicValues} map fits too, its CSS `transition` string a value as any other.
 */
export type WardicVariant = WardicValues | (Omit<WardicValues, "transition"> & { readonly transition?: WardicVariantTransition })

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
 * Motion's `definition` of an animation (#257): a variant name, or its target values. A list of names
 * (#297) on Solid 2's landing, where `animate` gave one; Solid 1's callbacks are told each name.
 */
export type WardicAnimationDefinition = WardicVariantLabels | WardicValues

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
   * accessor `cfg()`. Its own `transition` (#277) drives the animation to it.
   */
  readonly animate?: WardicVariant | WardicVariantLabels
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
  /** A press began on the element: a primary pointer's down, with no drag active. */
  readonly onTapStart?: (event: PointerEvent, info: WardicPointInfo) => void
  /** That press ended in a release on the element or inside it. */
  readonly onTap?: (event: PointerEvent, info: WardicPointInfo) => void
  /** It ended elsewhere, or was cancelled. A press a drag took over is neither a tap nor a cancel. */
  readonly onTapCancel?: (event: PointerEvent, info: WardicPointInfo) => void
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
   * `false` keeps this element at its Starting style until mount during a server render, when the
   * provider would start its mount animation in CSS from first paint (an Appear animation, #48,
   * ADR-0044), for an animation that should start only once the page responds. Read on the server,
   * once; the provider's `appear` turns it off for every element.
   */
  readonly appear?: boolean
}
