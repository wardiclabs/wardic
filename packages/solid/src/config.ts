/**
 * The Solid bindings' configuration types (#209): what an element's `initial`, `animate`,
 * `transition`, variants, gestures, drag and layout props take, for the Solid 1 binding and the
 * Solid 2 one (`@wardic/solid/unstable/v2`) alike. Solid-free: CSS properties come from
 * `csstype`, as both Solids' own `JSX.CSSProperties` do.
 *
 * @module
 */
import type * as Drag from "@wardic/core/Drag"
import type * as Machine from "@wardic/core/Machine"
import type * as Stagger from "@wardic/core/Stagger"
import type * as CSS from "csstype"

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
 * options. `type` defaults to `"spring"`; `"tween"` routes every key through
 * `animateValues` (duration-based, no velocity). Both arms also carry the
 * optional {@link WardicOrchestration} fields and {@link WardicReducedMotion}'s opt-out.
 * `from` is the stagger's origin on both: a spring's own `from` was never a transition's (each
 * key starts where it is), and the two clashed (#243).
 */
export type WardicTransition =
  | ({ readonly type?: "spring" } & Omit<Machine.SpringOptions, "from"> & WardicOrchestration & WardicReducedMotion & WardicLayoutKey)
  | ({ readonly type: "tween" } & Machine.AnimateOptions & WardicOrchestration & WardicReducedMotion & WardicLayoutKey)

/**
 * Motion's `layout` key (ADR-0009 *Amendment (#171)*): the element's layout animations' own
 * transition, over the rest of its `transition`. Without it, the whole `transition` drives them; with
 * no `transition`, Motion's default, a 0.45 s tween.
 */
export interface WardicLayoutKey {
  readonly layout?: WardicTransition
}

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
/** Motion's `definition` of an animation (#257): a variant name, or its target values. */
export type WardicAnimationDefinition = string | WardicValues

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
  readonly initial?: WardicValues | string | false
  /** The resting target. A string names a `variants` entry. Read reactively through the whole-config accessor `cfg()`. */
  readonly animate?: WardicValues | string
  /** Named value maps `initial` / `animate` strings resolve against. */
  readonly variants?: Record<string, WardicValues>
  /**
   * `false` keeps an element with `variants` out of its ancestors' variants (#50, Motion's
   * `inherit`): it inherits no names, takes no stagger slot, and hands its children no names
   * from above it. By default a Variant child (`variants`, no `initial` or `animate` name of
   * its own) joins its nearest ancestor with variants (CONTEXT.md).
   */
  readonly inherit?: boolean
  /** Target merged in (highest-but-one priority) while hovered. */
  readonly whileHover?: WardicValues
  /** Target merged in (highest priority) while pressed. */
  readonly whileTap?: WardicValues
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
  readonly whileDrag?: WardicValues
  /**
   * Constrain the element's `x`/`y` to a static numeric box (per axis), whichever gesture moved it
   * there; a Fling springs back to an edge it would cross (ADR-0016, *Amendment (#140)*). Only when
   * `drag` is on. Static config (LOW-3): read ONCE at mount; not re-read reactively in v0.1.
   */
  readonly dragConstraints?: Drag.Bounds
  /**
   * Rubber-band resistance past {@link dragConstraints}: 0 a hard clamp, with a wall for a bounce.
   * Default 0.35, Motion's. Static config (LOW-3): read ONCE at mount; not re-read reactively in v0.1.
   */
  readonly dragElastic?: number
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
  /** Primitive selector + options (default spring). */
  readonly transition?: WardicTransition
  /**
   * The exit target — the state this element animates toward when it leaves an
   * `<AnimatePresence>` (ADR-0007). The child itself never DRIVES this exit (it
   * is disposed on leave); instead the spine publishes the live exit values into
   * the presence registration, and the parent `<AnimatePresence>` runs the exit
   * on the retained DOM node.
   */
  readonly exit?: WardicValues
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
