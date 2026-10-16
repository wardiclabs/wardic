/**
 * `useWardic` — the primary motion spine of the Solid binding (ADR-0005).
 *
 * This is the fixed orchestration spine the binding contract prescribes:
 *
 *   Recognizers (hover/press) -> Override stack -> Override.resolve -> reactive
 *   `target()` -> a settling primitive (spring/Retarget by default, tween for
 *   `transition.type: "tween"`) -> per-frame `gate.write(id, values)` -> the
 *   gate projects the `Patch` and commits it onto the element (ADR-0034).
 *
 * The hook returns a callable `ward`: `<div {...ward()}>` spreads `ref` (wires
 * the element on mount, where the gate commits) and a reactive `style` getter: the
 * Starting style until the first commit, then the user's style without the keys the
 * gate holds (ADR-0034). No frame goes through Solid.
 *
 * SSR contract (ADR-0003): the initial style is resolved synchronously and
 * purely as `project(resolveInitial(config))` — never by spinning the engine.
 * That one resolved value is the `style` until the first commit (so the server /
 * pre-mount render emits it with no flash) AND the spring's `from` Snapshot (so frame 1
 * flows continuously out of the seed). `initial` is a static map / variant name
 * (SSR-serializable) at the hook boundary; the component layer unwraps an
 * accessor `initial` once before passing it in (see {@link WardicConfig.initial}).
 *
 * Scope (v0.1, this step): `initial` / `animate` / `whileHover` / `whileTap`.
 * NO variant-tree propagation, NO drag, NO exit/layout. Mixed numeric+string
 * targets are handled by routing numeric keys through `springValues` and any
 * string/color keys through `springBlend`, the same spring on a progress (both
 * writing into the same gate id) — see core's `Values.split`.
 */
import * as BaseValue from "@wardic/core/BaseValue"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import type * as Drag from "@wardic/core/Drag"
import * as Override from "@wardic/core/Override"
import type * as Projection from "@wardic/core/Projection"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as Renderer from "@wardic/core/Renderer"
import * as Stagger from "@wardic/core/Stagger"
import * as Values from "@wardic/core/Values"
import * as Machine from "@wardic/core/Machine"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import type * as FlushGate from "@wardic/dom/FlushGate"
import * as OwnValues from "@wardic/dom/OwnValues"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Report from "@wardic/dom/Report"
import * as Style from "@wardic/dom/Style"
import * as Svg from "@wardic/dom/Svg"
import * as Variables from "@wardic/dom/Variables"
import { mergeRefs } from "@solid-primitives/refs"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FiberSet from "effect/FiberSet"
import { constTrue, identity, pipe } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  type JSX,
  on,
  onCleanup,
  untrack,
} from "solid-js"
import { dragTransitionOf, type DragTrackConfig, runDragTrack } from "./drag.ts"
import { createElementStyle } from "./element-style.ts"
import { createVariantNode, serverVariantNode, startingValuesOf, startsAtAnimate } from "./variant-node.ts"
import { useLayoutMember } from "./layout.tsx"
import { type PresenceRecord, presenceBlocksInitial, usePresenceContext } from "./presence.tsx"
import { createHover, createPress, createWhenWanted } from "./sensors.ts"
import { useWardicGate, useWardicPositionalKeys, useWardicProjection, useWardicReducedMotion, useWardicRuntime, type WardicRuntime, type WardicServices } from "./provider.tsx"
import { isHydrating, isServer } from "./server.ts"
import { type WardicVariantContextValue, useVariantContext, WardicVariantContext } from "./variants.ts"

/**
 * The transform-shorthand keys the `@wardic/dom` renderer's `TRANSFORM_KEYS`
 * groups into a single `transform` string (see `renderer.ts`). They are NOT
 * valid `JSX.CSSProperties` keys (`x`, `scale`, `rotate`, …), so they are added
 * here as an intersection on top of `JSX.CSSProperties`. Each is
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
 * These are the SVG keys NOT already typed by `JSX.CSSProperties`, plus the
 * geometry keys (`cx`/`cy`/`r`/`rx`/`ry`) re-typed `number | string` (csstype's
 * CSS-Geometry types are narrower). `fill`/`stroke`/`stroke-*` stay as
 * `JSX.CSSProperties` provides (color/length strings — already animatable). The
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
 * The Solid-binding value type: every `JSX.CSSProperties` key PLUS the transform
 * shorthands and the {@link WardicSvgAttributes} the renderer understands. This is
 * the type users write at the edge (`animate={{ opacity: 1, x: 100, cx: 50 }}`).
 * Core's `Values` (`Record<string, number | string>`) is framework-agnostic and
 * UNCHANGED; the binding funnels `WardicValues` through {@link toValues} before core.
 *
 * Some shorthand / geometry keys (`x`, `scale`, `cx`, `r`, …) ALSO exist on
 * `csstype`'s property set with much narrower value types (e.g. `scale: "none" |
 * string`). A plain intersection would narrow those to the (often `never`-like)
 * overlap and reject `scale: 1.1`. So we `Omit` those keys off `JSX.CSSProperties`
 * first, letting the `number | string` typing here win for them.
 */
export type WardicValues =
  & Omit<JSX.CSSProperties, keyof WardicTransformShorthands | keyof WardicSvgAttributes>
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
 */
export type WardicTransition =
  | ({ readonly type?: "spring" } & Machine.SpringOptions & WardicOrchestration & WardicReducedMotion & WardicLayoutKey)
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
 * Config accepted by {@link useWardic}.
 *
 * REACTIVITY LAYERING (step 21e): every field here is a STATIC value. The hook's
 * reactivity is solely via the WHOLE-CONFIG accessor: `useWardic(() => ({ ... }))`
 * re-reads the config when a signal it touches changes, recomputing `target()`
 * and driving a Retarget. Per-field accessor unwrapping is the COMPONENT layer's
 * job ({@link "./wardic.tsx"} `MotionProps`), not the hook's — at the hook
 * boundary a config field is always a plain value.
 */
export interface WardicConfig {
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
}

/**
 * The Layout mode a `layout` prop names (ADR-0009, *Amendment (#42)*): a mode's name, else
 * `true` (`layout`, or a node a `layoutId`, `layoutScroll` or `layoutRoot` gives).
 */
const layoutModeOf = (layout: WardicConfig["layout"]): Projection.LayoutMode =>
  Option.getOrElse(Option.liftPredicate(layout, isModeName), (): Projection.LayoutMode => true)

/** Whether a `layout` prop names a Layout mode (a string), not `true` / `false`. */
const isModeName = (layout: WardicConfig["layout"]): layout is Exclude<WardicConfig["layout"], boolean | undefined> => Predicate.isString(layout)

/**
 * Optional user-supplied props passed INTO the {@link Ward} callable to be
 * merged with ward's own ref/style (Option A — ward's animated style wins).
 */
export interface WardUserProps {
  /** The user's ref callback — invoked alongside ward's internal ref. */
  readonly ref?: (el: HTMLElement) => void
  /**
   * The user's style — ward's animated keys merge ON TOP. May be a LIVE getter
   * (the `wardic.*` element layer passes one so a reactive `style` prop is
   * tracked, not frozen at setup), hence `| undefined` to allow a getter that
   * yields no style yet. Reactivity flows via the getter, not a `MaybeAccessor`.
   */
  readonly style?: JSX.CSSProperties | undefined
}

/** Spreadable props the {@link useWardic} `ward` callable returns. */
export interface WardProps {
  /**
   * Ref callback — wires the element into the spine on mount (merging any
   * user-supplied ref via `mergeRefs`).
   */
  readonly ref: (el: HTMLElement) => void
  /**
   * Reactive projected `Patch` merged with any user style, typed as
   * `JSX.CSSProperties` so `{...ward()}` spreads cleanly (the projected keys are
   * valid CSS props).
   */
  readonly style: JSX.CSSProperties
  /** `"false"` on a drag element (Motion's default, ADR-0019 *Amendment (Reorder)*); absent otherwise. */
  readonly draggable?: "false"
}

/**
 * The callable returned by {@link useWardic}. Called with no args it returns
 * ward's own ref + animated style (back-compat); called with {@link WardUserProps}
 * it returns the MERGED spreadable (user ref + ward ref; user style with ward's
 * animated style on top).
 *
 * It also carries a `Provider` property (ADR-0007): `<ward.Provider>{children}</ward.Provider>`
 * publishes THIS instance's current variant NAME + transition down the tree, so
 * descendant `useWardic` calls inherit the variant by name (resolving it against
 * their own `variants` map).
 */
export type Ward = ((userProps?: WardUserProps) => WardProps) & {
  /**
   * Provides this ward instance's current variant name + transition to the
   * subtree (ADR-0007 name propagation). Inheriting children resolve the name
   * against their OWN `variants`.
   */
  readonly Provider: Component<{ readonly children?: JSX.Element }>
}

/**
 * Resolve an `animate`-style entry (a {@link WardicValues} map or a variant name)
 * to a clean core {@link Values} map. Both arms funnel through {@link toValues}
 * so `Override.resolve` / `Values.split` never receive `undefined`-valued keys.
 */
const resolveValues = (
  entry: WardicValues | string | undefined,
  variants: Record<string, WardicValues> | undefined,
): Values.Values => {
  if (entry === undefined) return {}
  if (typeof entry === "string") return Style.toValues(variants?.[entry])
  return Style.toValues(entry)
}

/** The keys a drag direct-sets (ADR-0004) and a projection owns (ADR-0016). */
const TRANSLATE_KEYS: ReadonlySet<string> = new Set(["x", "y", "translateX", "translateY"])

/** Whether a value map has any key. */
const hasKeys: Predicate.Predicate<Values.Values> = Predicate.not(Rec.isEmptyRecord)

/** A transition's `delay` in seconds: 0 when it has none. */
const secondsOf = (delay: number | undefined): number => UndefinedOr.match(delay, { onUndefined: () => 0, onDefined: identity })

/** The Override stack resolved: the spine effect's input. */
interface Resolution {
  /** Each key's value from the highest active layer. */
  readonly resolved: Values.Values
  /** The base layer, the first link of a key's Base value (ADR-0022). */
  readonly base: Values.Values
  /** Whether a drag holds the translate keys (ADR-0004's strip). */
  readonly dragging: boolean
}

/** Options for the internal {@link runSpine} helper. */
/**
 * What a `<Reorder>` item adds to the spine (ADR-0020; internal, D9: nothing in
 * {@link WardicConfig}):
 *
 * - `dragAxis`: the gesture's axis, read at each drag's start and held until its end
 *   (`true` = free); it makes the element draggable without a `drag` config.
 * - `onDragSample`: each drag sample, after its projection write.
 * - `onLayoutHandle`: the projection node's handle, once registered.
 * - `raiseWhileDragged`: raise the node while dragged.
 * - `lifted`: whether a **Keyboard reorder** has the element lifted (ADR-0037): its `whileDrag`
 *   applies then too, as for a drag, with nothing else of the drag's (its `x`/`y` stay the spring's).
 * - `baseStyle`: style under the user's, above the drag defaults (the item's
 *   `touch-action`), read reactively.
 * - `tag`: the element's tag, set by `wardic.create(tag)`, so an svg-inner element's
 *   Starting style renders its attribute keys as attributes (ADR-0021; a `useWardic`
 *   spread doesn't know its tag and stays all style).
 */
export interface SpineInternals {
  readonly tag?: string | undefined
  readonly dragAxis?: (() => boolean | "x" | "y") | undefined
  readonly onDragSample?: ((sample: Drag.Sample) => void) | undefined
  readonly onLayoutHandle?: ((handle: ProjectionSystem.NodeHandle) => void) | undefined
  readonly raiseWhileDragged?: boolean | undefined
  readonly lifted?: Accessor<boolean> | undefined
  readonly baseStyle?: (() => JSX.CSSProperties | undefined) | undefined
}

export interface RunSpineOptions {
  /** The provider runtime the spine forks its fibers on. */
  readonly runtime: WardicRuntime
  /** The provider-owned flush gate (ADR-0006). */
  readonly gate: FlushGate.Shape
  /** SSR/hydration-stable gate id for this element's entry. */
  readonly id: string
  /** The element accessor; the spine is gated on it (started once defined). */
  readonly el: Accessor<HTMLElement | undefined>
  /** Reactive config accessor (animate / whileHover / whileTap / transition read reactively). */
  readonly cfg: Accessor<WardicConfig>
  /**
   * The variant context this element inherits from (ADR-0007): its nearest ancestor's with
   * variants, for a Variant child (#50, `variant-node.ts`'s `inherited`), else `undefined`.
   * The spine reads `parent.variant()` reactively to resolve an INHERITED variant name against
   * THIS element's own `variants` (when no local `animate`), starts from `parent.initial` when
   * it has no `initial` of its own, and falls back to `parent.transition()` when this config
   * has no local transition.
   */
  readonly parent: WardicVariantContextValue | undefined
  /**
   * Called for EVERY emitted spine frame with that frame's `done` flag (ADR-0007
   * orchestration): true on the settling frame, false while moving. The owner
   * uses it to drive the `when` settle signals (a child reports to its parent's
   * registry; a parent reports its OWN settle for `beforeChildren`). Optional —
   * a root instance with no orchestration omits it.
   */
  readonly onFrame?: ((done: boolean) => void) | undefined
  /**
   * Per-Retarget reactive GATE on starting the spring (ADR-0007 `when`): when it
   * returns false the `on(target)` effect skips starting the primitive and
   * re-runs (the previous fiber is already interrupted, freezing the value at the
   * snapshot) once the accessor flips true. Optional — omitted = always start.
   * Read REACTIVELY inside the spine effect so a flip re-triggers the start.
   */
  readonly canStart?: (() => boolean) | undefined
  /**
   * Reactive extra delay (seconds) folded into the effective transition's
   * `delay` for the inherited-variant Retarget (ADR-0007 per-child stagger).
   * Read at Retarget time. Optional — omitted = no extra delay.
   */
  readonly extraDelay?: (() => number) | undefined
  /** A `<Reorder>` item's additions (internal; see {@link SpineInternals}). */
  readonly internal?: SpineInternals | undefined
  /**
   * The surface's live user style, the `style` link of a key's Base value (ADR-0022): a
   * `useWardic` spread's (the style last given to `ward(userProps)`, which is the live getter
   * on `wardic.*`), or `wardic.create(Component)`'s. Read untracked, at need: a style change
   * never Retargets on its own. Omitted on the directives, whose base is the element's own
   * value (its inline style included, read once).
   */
  readonly styleOf?: (() => object | string | undefined) | undefined
  /**
   * Builds the {@link FlushSink} for the registered element: the element itself, plus, for a
   * surface whose `style` prop reaches it (`useWardic`, `wardic.create(Component)`), the hooks
   * that switch that `style` (ADR-0034). The spine itself never reads the sink's hooks.
   */
  readonly makeSink: (el: HTMLElement) => FlushGate.Sink
  /**
   * Whether the element's drag defaults and base style reach it with its props: a `useWardic`
   * spread's `style` and attributes. Otherwise the spine sets them on the element at mount (the
   * directives, and a `wardic.create(Component)` wrap, in case its component doesn't pass them
   * on).
   */
  readonly defaultsInProps?: boolean | undefined
}

/**
 * The fixed motion spine, factored out so both sink shapes share it (ADR-0006):
 *
 *   on(el) once-defined -> gate.register(id, makeSink(element)) -> recognizers
 *   (hover/press) -> override-stack memo from cfg() -> on(target) Retarget
 *   (springValues / animateValues seeded from the Snapshot ref) -> gate.write.
 *
 * The caller supplies `makeSink`: the gate commits the flushed `Patch` onto the element,
 * whichever surface owns it (ADR-0034). `initial` is read EXACTLY ONCE at setup (`untrack`) to seed the
 * spring's `from` Snapshot (ADR-0003); `animate` / `whileHover` / `whileTap` /
 * `transition` / `variants` are read reactively through `cfg()`.
 *
 * Must be called within a Solid owner (it registers `createEffect` / `onCleanup`).
 */
export function runSpine(opts: RunSpineOptions): void {
  const { canStart, cfg, defaultsInProps, el, extraDelay, gate, id, internal, makeSink, onFrame, parent, runtime, styleOf } = opts

  // The nearest <AnimatePresence>, or undefined at the root (ADR-0007). When
  // present, this spine publishes its live value-map (`snapshot`) + exit target
  // (`exit`) into a presence registration; the PARENT drives the exit on leave
  // (this child is disposed). The child does NOT unregister on its own
  // onCleanup — <AnimatePresence> owns removal after the exit settles.
  const presence = usePresenceContext()

  // Whether reduced motion applies (ADR-0029), read at each Retarget.
  const reducedMotion = useWardicReducedMotion()
  const positionalKeys = useWardicPositionalKeys()

  // SSR seed: resolved purely from the config read EXACTLY ONCE (untrack — no
  // reactive dependency, must not re-seed after mount), with the inherited `initial`
  // name for a Variant child that has none (#50). Seeds the spring `from` Snapshot so
  // frame 1 flows continuously out of it (no snap).
  const initialConfig = untrack(cfg)
  // With `initial={false}` (its own, inherited, or an `<AnimatePresence initial={false}>`'s first
  // render) the seed is its `animate`, and nothing animates at mount (#134).
  const presenceBlocks = presenceBlocksInitial(presence)
  const startedAtAnimate = startsAtAnimate(initialConfig, parent, presenceBlocks)
  const initialValues = startingValuesOf(initialConfig, parent, presenceBlocks)
  // Its `initial` link in the Base-value chain and its fallback base layer, or, having started at
  // `animate`, none: those values come after `style`, as Motion's `baseTarget` (ADR-0022, #134).
  const initialLink: Values.Values = Bool.match(startedAtAnimate, { onTrue: () => ({}), onFalse: () => initialValues })
  const startedLink: Values.Values = Bool.match(startedAtAnimate, { onTrue: () => initialValues, onFalse: () => ({}) })

  // Plain (non-reactive) Snapshot ref: each key's last emitted value, a number or a
  // string, + the numeric velocities, seeded from the SSR initial (velocities 0). Used
  // to retarget from where each key is, with momentum carried across the seam
  // (ADR-0005, ADR-0024).
  const snapshot: { values: Values.Values; velocities: Record<string, number> } = {
    values: { ...initialValues },
    velocities: {},
  }

  // Start everything once the element mounts. createEffect(on(el, ...)) re-runs
  // only when the element identity changes; the spine inner-effect lives under
  // this owner so onCleanup teardown (gate.unregister + fiber interrupts) fires
  // on unmount.
  createEffect(
    on(el, (element) => {
      if (element === undefined) return

      // Register the element with the caller-supplied sink (ADR-0006): each
      // flushed frame's Patch is committed onto it (ADR-0034).
      const unregister = gate.register(id, makeSink(element))
      onCleanup(unregister)

      // A surface whose props don't carry a drag element's defaults (ADR-0019 *Amendment
      // (Reorder)*): set each one the element's inline style doesn't already, and the
      // attribute unless it has one, once at mount.
      if (defaultsInProps !== true) {
        const base = internal?.baseStyle
        if (base !== undefined) {
          // The base style goes under the user's: a key the element's own inline style
          // sets at mount is the user's, and is never written.
          const own = new Set<string>()
          for (let i = 0; i < element.style.length; i++) own.add(element.style.item(i))
          const write = (style: Record<string, unknown> | undefined): void => {
            if (style === undefined) return
            for (const key in style) if (!own.has(key)) element.style.setProperty(key, String(style[key]))
          }
          // Written now, then on each change. Now, not in the effect's first run: that runs
          // just before this element's spine effect, whose first Retarget may read the
          // element's Own values (ADR-0022), so a list of items would alternate a write and a
          // read per item and force a style recalculation each (#47's mount measurement).
          write(untrack(base) as Record<string, unknown> | undefined)
          createEffect(on(base, (style) => write(style as Record<string, unknown> | undefined), { defer: true }))
        }
        const dragAxis = dragAxisOf(untrack(cfg), internal)
        if (dragAxis !== undefined) applyDragDefaults(element, Style.dragDefaults(dragAxis))
      }

      // --- Base values (ADR-0022) ---------------------------------------------
      // A key with no value starts from its `style` value, else its Own value; a key no
      // layer sets any more returns to its Base value (`initial`, `style`, Own value). The
      // Own value is read from the element once per key, at first need (D3): this runs after
      // mount, so never on a server (ADR-0021). Each link is coerced to the shape of the
      // key's target (`like`).
      const ownValue = OwnValues.of(element)
      // Its Variable values (#55, ADR-0035 *Amendment (#55)*): the Key rule bound to this element,
      // added to each leg it starts, so a `var()` end blends what it resolves to here.
      const elementRules = [Variables.values(element)]
      const linksFor = (like: number | string) => ({
        style: (key: string) =>
          Option.flatMap(Option.fromUndefinedOr(styleOf), (of) =>
            Option.fromUndefinedOr(OwnValues.valueLike(OwnValues.styleValueOf(untrack(of), key), like)),
          ),
        own: (key: string) => Option.fromUndefinedOr(OwnValues.valueLike(ownValue(key), like)),
      })
      const startOf = (key: string, like: number | string) => Option.getOrUndefined(BaseValue.start(key, linksFor(like)))

      // --- Presence registration (ADR-0007 exit) -------------------------------
      // Under an <AnimatePresence>, publish a live record so the PARENT can drive
      // this element's exit after Solid disposes its owner. `snapshot.current` is
      // updated to the latest emitted value-map EACH FRAME (so the exit departs
      // continuously from where the element rests); `exit.current` tracks
      // cfg().exit reactively. Seed the snapshot with the SSR initial so an exit
      // that fires before any frame still has a sensible `from`. The child does
      // NOT call the disposer on its own onCleanup — <AnimatePresence> removes the
      // registration after the exit settles.
      let presenceRec: PresenceRecord | undefined
      if (presence !== undefined) {
        presenceRec = {
          element,
          snapshot: { current: { ...initialValues } },
          exit: { current: Style.toValues(untrack(cfg).exit) },
          // An exit key with no value starts from its Base value's start links (ADR-0022),
          // read from the retained node at the exit.
          startOf: (key, like) => startOf(key, like)?.value,
        }
        presence.register(presenceRec)
        // Keep exit.current current while the child is alive.
        createEffect(() => {
          presenceRec!.exit.current = Style.toValues(cfg().exit)
        })
      }

      // Merge an emitted frame's value-map into the presence snapshot (no-op
      // without a presence). The accumulator mirrors what the gate accumulates,
      // so the exit departs from the element's actual resting value-map.
      const recordFrame = (value: Values.Values): void => {
        if (presenceRec !== undefined) Object.assign(presenceRec.snapshot.current, value)
      }

      // A Retarget's returns have settled (ADR-0022, D4). A key back at its `style` value is
      // handed back to the element's style, so a later style change shows at rest and the
      // next gesture starts from it; any other key rests inline at its Base value and leaves
      // the target. A key a later Retarget took over is left alone.
      const settleReturns = (returns: ReadonlyArray<readonly [string, BaseValue.BaseSource]>): void => {
        const handedBack: Array<string> = []
        for (const [key, source] of returns) {
          if (returning.get(key) !== source) continue
          returning.delete(key)
          driven.delete(key)
          if (source === "style") handedBack.push(key)
        }
        if (handedBack.length === 0) return
        let restore: Record<string, string> | undefined
        if (styleOf !== undefined) {
          // The gate writes the user's current value back, as the element's `style` would
          // (ADR-0034). A key gone from the user's style by now is cleared, not restored stale.
          const style = untrack(styleOf)
          restore = {}
          for (const key of handedBack) {
            const value = OwnValues.styleValueOf(style, key)
            restore[key] = value !== undefined ? String(value) : ""
          }
        }
        gate.release(id, handedBack, restore)
        for (const key of handedBack) {
          delete snapshot.values[key]
          delete snapshot.velocities[key]
          if (presenceRec !== undefined) delete presenceRec.snapshot.current[key]
        }
      }

      // Cold path: once per Retarget that started a key from its Base value or returned one,
      // run at the head of that Retarget's first leg (no fiber of its own: forking one per
      // element cost 10-20 µs each at a 1000-element mount).
      const baseLog = (started: Record<string, string>, returns: ReadonlyArray<readonly [string, BaseValue.BaseSource]>): Effect.Effect<void> =>
        Effect.logDebug("wardic.base: a key with no value started from, or returned to, its Base value (ADR-0022)").pipe(
          Effect.annotateLogs({ id, started, returned: Object.fromEntries(returns) }),
        )

      // Every element's values, by element, for the projection (ADR-0012 *Amendment (#137)*): a twin's
      // flight follows the translate and scale Wardic animates on its ancestors each frame.
      onCleanup(useWardicProjection().registerValues(element, () => snapshot.values))

      // --- Layout / shared-element / scroll projection (ADR-0009/0010/0012) ---
      // ONE projection node per element: `layout`, `layoutId`, and/or `layoutScroll`
      // feed the SAME node (no double registration). `layout` is a static enable
      // flag; `layoutId` (static, read once) enrols the node in the engine's
      // lead/follow stack (crossfade) and lets a twin disposed in the same task seed
      // it (a Switch, engine-side — ADR-0010 *Amendment (#13)*); `layoutScroll`
      // (static) marks it a scroll container whose scroll is folded out of its
      // descendants' boxes. All static,
      // read once — the reserved props layoutRoot/layoutAnchor remain typed-but-no-op
      // (P4).
      const c0 = untrack(cfg)
      const layoutId = c0.layoutId
      // layout / layoutId / layoutScroll / layoutRoot each warrant a node; layoutAnchor
      // alone does not (it only tunes a node that already projects), but is forwarded.
      let layoutHandle: ProjectionSystem.NodeHandle | undefined
      // What every release runs on, the layout node's Release offset and the drag track's (ADR-0016, *Amendment (#140)*).
      const dragTransition = dragTransitionOf(c0.dragElastic, c0.dragTransition)
      if (c0.layout === true || Predicate.isString(c0.layout) || layoutId !== undefined || c0.layoutScroll === true || c0.layoutRoot === true) {
        layoutHandle = useLayoutMember({
          id,
          element,
          layoutDependency: () => cfg().layoutDependency,
          transition: () => cfg().transition ?? parent?.transition(),
          dragTransition: () => dragTransition,
          // The Layout mode, read at each layout animation's start (ADR-0009, *Amendment (#42)*).
          layoutMode: () => layoutModeOf(cfg().layout),
          // The own scale the renderer draws, from the values last written (ADR-0010 *Amendment (#8)*).
          ownScale: () => DomRenderer.ownScaleOf(snapshot.values),
          // And its own rotate and opacity, which a handover blends into (ADR-0010 *Amendment (#166)*).
          ownRotate: () => DomRenderer.ownRotateOf(snapshot.values),
          ownOpacity: () => DomRenderer.ownOpacityOf(snapshot.values),
          // The app's layout animation callbacks, read when they fire (#191, ADR-0039).
          onLayoutAnimationStart: () => cfg().onLayoutAnimationStart,
          onLayoutAnimationComplete: () => cfg().onLayoutAnimationComplete,
          ...(layoutId !== undefined ? { layoutId } : {}),
          ...(c0.layoutScroll === true ? { layoutScroll: true } : {}),
          ...(c0.layoutRoot === true ? { layoutRoot: true } : {}),
          ...(c0.layoutAnchor !== undefined ? { layoutAnchor: c0.layoutAnchor } : {}),
          ...(internal?.raiseWhileDragged === true ? { raiseWhileDragged: true } : {}),
        })
        internal?.onLayoutHandle?.(layoutHandle)
      }

      // --- Drag track (ADR-0004) ----------------------------------------------
      // When cfg().drag is truthy, run the binding-orchestrated drag track: the
      // pointer DIRECT-SETS x/y (1:1, not sprung) while the spring keeps driving
      // every other key + whileDrag. `dragging` is the ONLY reactive piece (it
      // gates the whileDrag override + the translate-key strip below); the drag
      // CONFIG is static — read ONCE here (untrack), since drag config is a
      // document. The track's single fiber is scoped to this owner's onCleanup.
      const dragCfg = dragAxisOf(untrack(cfg), internal)
      const [dragging, setDragging] = createSignal(false)
      if (dragCfg !== undefined) {
        const c0d = untrack(cfg)
        const trackConfig: DragTrackConfig = {
          axis: dragCfg,
          constraints: c0d.dragConstraints,
          elastic: c0d.dragElastic,
          momentum: c0d.dragMomentum,
          snapToOrigin: c0d.dragSnapToOrigin,
          propagation: c0d.dragPropagation,
          transition: dragTransition,
        }
        runDragTrack({
          runtime,
          gate,
          id,
          element,
          snapshot,
          recordFrame,
          setDragging,
          config: trackConfig,
          // ADR-0016: a drag on a LAYOUT node feeds the projection (the renderer
          // ignores a projected element's raw x/y), so the dragged item follows the
          // pointer and FLIPs to its slot on release. Free drag (no handle) is unchanged.
          ...(layoutHandle !== undefined ? { projection: layoutHandle } : {}),
          ...(internal?.dragAxis !== undefined ? { axisAt: internal.dragAxis } : {}),
          ...(internal?.onDragSample !== undefined ? { onSample: internal.onDragSample } : {}),
        })
      }

      // Recognizers over the live element, each started the first time its `while*` target
      // appears (#87, ADR-0040), its fiber scoped to this owner's onCleanup via
      // streamToSignal -> runScoped. Until then it reads false.
      const hovered = createWhenWanted(
        () => Predicate.isNotUndefined(cfg().whileHover),
        () => createHover(element),
      )
      const pressed = createWhenWanted(
        () => Predicate.isNotUndefined(cfg().whileTap),
        () => createPress(element),
      )

      // The keys a Retarget drove, each with its last target value (its shape), and the
      // ones returning to their Base value until that return settles (ADR-0022). Both are
      // the spine effect's: a Retarget mid-return carries them again, so a return is never
      // frozen half-way, and a key that settled has left them, so a Retarget of the same
      // target (a `when` gate reopening, ADR-0007) leaves it be. The translate keys never
      // return on a projected element (the projection owns them, ADR-0016). On a drag
      // element, the keys the drag moves leave the return while it runs, so they stay where
      // it dropped them (C9) until a layer sets them again.
      const driven = new Map<string, number | string>()
      let returning = new Map<string, BaseValue.BaseSource>()
      const projected = layoutHandle !== undefined
      const dragMoves: ReadonlyArray<string> =
        projected || dragCfg === undefined ? [] : dragCfg === "x" ? ["x"] : dragCfg === "y" ? ["y"] : ["x", "y"]

      // Override stack (ascending priority): base (animate, or initial when no
      // animate) -> whileHover -> whileTap. Override.resolve picks the last
      // active entry per key. The memo DEPENDS on cfg() (read inside), so a
      // reactive config change recomputes target() and drives a Retarget. Pure: the
      // returns, the drag strip and every read are the spine effect's.
      const target = createMemo<Resolution>(() => {
        const c = cfg()
        // Read each field directly off the whole-config snapshot. Reactivity is
        // via cfg() itself: a signal touched inside the config accessor recomputes
        // cfg(), recomputes this memo, and drives a Retarget. `variants` is shared
        // by base + overrides.
        const animate = c.animate
        const variants = c.variants
        // Base target resolution priority (ADR-0007):
        //   (1) local `animate` (a Values map or a variant name) — overrides any
        //       inherited variant entirely;
        //   (2) else an INHERITED variant name from the parent context, resolved
        //       against THIS child's OWN `variants` (a child's "open" != its
        //       sibling's "open"); read parent.variant() here so a parent flip
        //       recomputes this memo and retargets;
        //   (3) else the SSR-seeded `initial`.
        const inheritedName = parent?.variant()
        const base =
          animate !== undefined
            ? resolveValues(animate, variants)
            : inheritedName !== undefined
              ? resolveValues(inheritedName, variants)
              : initialLink
        const resolved = Override.resolve([
          { active: true, values: base },
          { active: hovered(), values: Style.toValues(c.whileHover) },
          { active: pressed(), values: Style.toValues(c.whileTap) },
          // whileDrag sits ABOVE tap (highest priority) — driven by the spring,
          // NOT stripped, so e.g. `scale: 1.1` animates while held and returns
          // after release. Read dragging() so a flip recomputes this memo; a keyboard
          // lift turns it on too (ADR-0037).
          { active: Bool.or(dragging(), internal?.lifted?.() === true), values: Style.toValues(c.whileDrag) },
        ])
        return { resolved, base, dragging: dragging() }
      })

      // The spine: on each target change, end the running legs and reseed a fresh primitive
      // from the Snapshot (velocity-preserving). Every leg runs in this element's FiberSet (#76):
      // a Retarget clears it before it starts its own legs, and the element's teardown closes its
      // Scope, which interrupts whatever is left. Both end the legs in the calling task: a leg
      // waiting on the Frame loop is interrupted inline, and its run leaves the loop at once
      // (ADR-0027, decision 5). The same shape as the projection system's end-of-task holds.
      const legScope = Scope.makeUnsafe()
      const legFibers = runtime.runSync(FiberSet.make<void, never>().pipe(Scope.provide(legScope)))
      onCleanup(() => {
        runtime.runFork(Scope.close(legScope, Exit.void))
      })

      // The spine effect depends on BOTH `target` and `canStart` (ADR-0007 `when`):
      // Solid's `on` runs its callback under `untrack`, so the gate accessor MUST
      // be an explicit dependency for a gate flip (false -> true) to RE-RUN this
      // effect and release the held Retarget. `target` already depends on cfg() +
      // parent.variant(); adding canStart() releases the gate without restarting on
      // every frame (canStart only changes on settle-signal flips, not per frame).
      createEffect(
        on(
          () => {
            const t = target()
            // Track the gate so its flips re-run this effect (value unused).
            canStart?.()
            return t
          },
          ({ resolved, base, dragging: held }) => {
            runtime.runFork(FiberSet.clear(legFibers))

            // `when` start-gate (ADR-0007): when canStart() is false, freeze at the
            // snapshot (the previous legs are already interrupted) and bail; the
            // effect re-runs once the gate flips true (tracked above).
            if (canStart !== undefined && !canStart()) {
              // Report NOT settled: a gated child sits at its snapshot, still
              // owing an animation, so it must not count as settled (afterChildren).
              onFrame?.(false)
              return
            }

            // A key a Retarget drove and no layer sets now returns to its Base value
            // (ADR-0022); with none, it stays where it is (as before #47).
            const t: Values.Values = { ...resolved }
            for (const key in resolved) if (!(projected && TRANSLATE_KEYS.has(key))) driven.set(key, resolved[key]!)
            if (held) for (const key of dragMoves) driven.delete(key)
            returning = new Map()
            for (const [key, like] of driven) {
              // A translate key the strip below holds back returns once the drag lets go.
              if (Object.hasOwn(resolved, key) || (held && TRANSLATE_KEYS.has(key))) continue
              const r = Option.getOrUndefined(BaseValue.of(key, { base, initial: initialLink, started: startedLink, ...linksFor(like) }))
              if (r === undefined) driven.delete(key)
              else {
                t[key] = r.value
                returning.set(key, r.source)
              }
            }
            // MULTI-OWNER strip (ADR-0004): while dragging, x/y are DIRECT-SET by the
            // drag track, so strip the translate keys from the spring's target — the
            // spring must never fight the direct-set. Once dragging() is false the
            // keys re-enter normally (post-drag handoff: the spring continues x/y only
            // if `animate` sets them, from the snapshot's rested position).
            if (held) for (const key of TRANSLATE_KEYS) delete t[key]
            // Every key's Own value is read at its first need, before anything writes it, so a
            // return later finds the element's value, not Wardic's (ADR-0022, D3). The read is
            // kept: a later need is a lookup. A transform key reads nothing.
            for (const key in t) if (!Object.hasOwn(initialValues, key)) ownValue(key)
            // Each key starts from its Snapshot value, coerced to its target's shape (ADR-0024,
            // D1). A key with no value yet, or one whose value can't take that shape, starts
            // from its Base value's start links, read here at its first need (ADR-0022, D3);
            // with none, it starts at its target (no motion).
            const started: Record<string, string> = {}
            for (const key in t) {
              const like = t[key]!
              const current = snapshot.values[key]
              const coerced = current !== undefined ? OwnValues.valueLike(current, like) : undefined
              if (coerced !== undefined) {
                snapshot.values[key] = coerced
                continue
              }
              const s = startOf(key, like)
              if (s !== undefined && typeof s.value === typeof like) {
                snapshot.values[key] = s.value
                started[key] = s.source
              } else {
                snapshot.values[key] = like
                started[key] = "target"
              }
            }
            const from: Values.Values = {}
            for (const key in t) from[key] = snapshot.values[key]!
            // The keys this Retarget returns; once every leg settles, a key back at its
            // `style` value is handed back to the element's style (D4) and the rest rest inline.
            const returns = [...returning]
            // Each leg: the base-value log at the head of the first, and, once the leg's run
            // settles, a count toward settling the returns, so the per-frame handlers stay as
            // they were.
            let pendingLog = returns.length > 0 || Object.keys(started).length > 0 ? baseLog(started, returns) : undefined
            let legs = 0
            const legDone = Effect.sync(() => {
              if (--legs === 0) settleReturns(returns)
            })
            // A leg's end, told apart (ADR-0027, decision 7): a settle counts toward the returns;
            // an interruption (a Retarget, an unmount) is nothing; anything else (a step or a
            // sink that threw, the Frame loop's own failure) is logged and reported (ADR-0030,
            // decision 4), and doesn't count.
            const legEnded = (exit: Exit.Exit<unknown>): Effect.Effect<void> =>
              Exit.match(exit, {
                onSuccess: () => legDone,
                onFailure: (cause) => Report.failure("wardic.spine: a leg failed", cause).pipe(Effect.annotateLogs({ id })),
              })
            // The element settles with its last leg (ADR-0024, D5): a string leg can outlast the
            // numeric one, so each leg's frames report, and only the last leg's settle reports done.
            let reporting = 0
            let settled = 0
            const report = (done: boolean): void => {
              if (done) settled++
              onFrame?.(settled === reporting)
            }
            const leg = <R,>(program: Effect.Effect<unknown, never, R>): Effect.Effect<void, never, R> => {
              legs++
              const log = pendingLog
              pendingLog = undefined
              return UndefinedOr.match(log, {
                onUndefined: () => program,
                onDefined: (head) => Effect.andThen(head, program),
              }).pipe(Effect.onExit(legEnded), Effect.asVoid)
            }
            // Start a leg in this element's FiberSet: forked on the provider's runtime, which runs
            // it inline up to its add on the loop, so every leg started in a task is on the loop by
            // the end of that task and takes its first step at the next tick (ADR-0027 decision 5,
            // ADR-0033). Not `FiberSet.run`: forked from
            // a `runSync`, a leg would inherit that call's scheduler (ADR-0027, decision 6).
            const runLeg = <R extends WardicServices>(program: Effect.Effect<unknown, never, R>): void =>
              FiberSet.addUnsafe(legFibers, runtime.runFork(leg(program)))
            // Read transition from cfg() at retarget time so transition changes
            // apply to the next retarget. (Read inside this effect run; the effect
            // is gated on `target`, which already depends on cfg().) A child with
            // no local transition inherits the parent context's (ADR-0007).
            const baseTransition = cfg().transition ?? parent?.transition()
            // Fold the per-child stagger delay (ADR-0007) into the effective
            // transition.delay = base.delay + computedDelay. extraDelay() is read
            // at Retarget time so a re-snapshot before this start is reflected.
            const extra = extraDelay?.() ?? 0
            const transition =
              extra !== 0
                ? ({ ...(baseTransition ?? {}), delay: (baseTransition?.delay ?? 0) + extra } as WardicTransition)
                : baseTransition
            const useTween = transition?.type === "tween"

            // Reduced motion (ADR-0029), read now for this Retarget's legs: the positional keys
            // snap to where their leg would end, holding through the delay it would hold, and the
            // rest animate as they would. A transition opts out with `respectReducedMotion: false`.
            const respects = UndefinedOr.match(transition, {
              onUndefined: constTrue,
              onDefined: (tr) => tr.respectReducedMotion !== false,
            })
            const { positional, rest } = Bool.match(Bool.and(respects, reducedMotion()), {
              onTrue: () => ReducedMotion.split(t, positionalKeys),
              onFalse: (): ReducedMotion.Split => ({ positional: {}, rest: t }),
            })
            const snapping = hasKeys(positional)
            // The snap's leg: the positional keys, from where they are to `to`, after `delay`. A
            // snapped key comes to rest, so a later spring starts it at rest.
            const runSnap = (to: Values.Values, delay: number): void => {
              snapshot.velocities = { ...snapshot.velocities, ...Rec.map(positional, () => 0) }
              runLeg(
                ReducedMotion.snap(Values.pick(from, positional), to, { delay }).pipe(
                  Machine.run((frame) => {
                    snapshot.values = { ...snapshot.values, ...frame.value }
                    gate.write(id, frame.value)
                    recordFrame(frame.value)
                    report(frame.done)
                    return undefined
                  }),
                ),
              )
            }

            if (useTween) {
              // Tween: animateValues drives ALL keys (numeric + string) from the
              // current snapshot values; no velocity (snapshot.velocities stays {}).
              // Its options as they are: a missing `duration` is core's 0.3 s, and the rest still
              // apply (#107).
              const options = transition as Machine.AnimateOptions
              // With every key snapped, there's nothing left to tween.
              const tweening = Bool.or(!snapping, hasKeys(rest))
              reporting = Number(snapping) + Number(tweening)
              if (snapping) {
                runSnap(
                  Rec.map(positional, (to, key) => ReducedMotion.endOf(UndefinedOr.getOrThrow(from[key]), to, options)),
                  secondsOf(options.delay),
                )
              }
              if (tweening) {
                runLeg(
                  Machine.animateValues(Values.pick(from, rest), rest, options).pipe(
                    InterpolatorRegistry.withKeyRules(elementRules),
                    Effect.flatMap(
                      Machine.run((frame) => {
                        // MULTI-OWNER MERGE (ADR-0004): merge the tween's keys into
                        // the snapshot rather than replacing it, so the drag's
                        // direct-set x/y survive alongside the tween's keys and the
                        // post-drag handoff continues from the rested position.
                        snapshot.values = { ...snapshot.values, ...frame.value }
                        gate.write(id, frame.value)
                        recordFrame(frame.value)
                        report(frame.done)
                        return undefined
                      }),
                    ),
                  ),
                )
              }
            } else {
              // Spring (default): numeric keys via springValues (velocity-carrying
              // retarget); any string/color keys via springBlend, the same spring on a
              // 0→100 progress (ADR-0024, D5), into the same gate id.
              const springOpts = (transition ?? {}) as Machine.SpringOptions
              // Of the keys that animate: both halves write into the same gate id, so they
              // collapse into one projected `Patch`.
              const { numbers: numeric, strings } = Values.split(rest)
              const hasNumeric = Object.keys(numeric).length > 0
              const hasStrings = Object.keys(strings).length > 0
              reporting = Number(snapping) + Number(hasNumeric) + Number(hasStrings)
              // A spring settles at its target: the snap lands there.
              if (snapping) runSnap(positional, secondsOf(springOpts.delay))
              if (hasNumeric) {
                const fromNumeric: Record<string, number> = {}
                for (const key in numeric) fromNumeric[key] = from[key] as number
                runLeg(
                  Machine.springValues(numeric, springOpts, fromNumeric, snapshot.velocities).pipe(
                    Machine.run((frame) => {
                      // MULTI-OWNER MERGE (ADR-0004): merge the spring's keys
                      // into the snapshot rather than replacing it, so the
                      // drag's direct-set x/y survive alongside the spring's
                      // keys (drag owns x/y, spring owns the rest) and the
                      // post-drag handoff continues from the rested position.
                      snapshot.values = { ...snapshot.values, ...frame.value }
                      snapshot.velocities = { ...snapshot.velocities, ...frame.velocity }
                      gate.write(id, frame.value)
                      recordFrame(frame.value)
                      report(frame.done)
                      return undefined
                    }),
                  ),
                )
              }
              if (hasStrings) {
                const fromStrings: Values.Values = {}
                for (const key in strings) fromStrings[key] = from[key]!
                runLeg(
                  Machine.springBlend(fromStrings, strings, springOpts).pipe(
                    InterpolatorRegistry.withKeyRules(elementRules),
                    Effect.flatMap(
                      Machine.run((frame) => {
                        snapshot.values = { ...snapshot.values, ...frame.value }
                        gate.write(id, frame.value)
                        recordFrame(frame.value)
                        report(frame.done)
                        return undefined
                      }),
                    ),
                  ),
                )
              }
            }
          },
        ),
      )
    }),
  )
}

/**
 * Drive a Solid element through Wardic's motion spine.
 *
 * `config` may be a plain {@link WardicConfig} (back-compat) OR an
 * `Accessor<WardicConfig>` for reactive config: when the accessor reads signals,
 * a change recomputes the override-stack `target()` and drives a
 * velocity-preserving Retarget through the existing Snapshot wiring. `animate` /
 * `whileHover` / `whileTap` / `transition` / `variants` are read reactively
 * through `cfg()`; `initial` is read EXACTLY ONCE at setup (`untrack`) — it is
 * the SSR/first-frame seed and must never re-seed after mount (ADR-0003).
 *
 * @param config initial/animate/whileHover/whileTap + transition (see {@link WardicConfig}), or an accessor of it.
 * @returns a callable `ward` to spread onto a JSX element.
 */
export function useWardic(config: WardicConfig | Accessor<WardicConfig>): Ward {
  return useWardicWith(config, undefined)
}

/**
 * {@link useWardic} with a `<Reorder>` item's additions (internal, ADR-0020; not
 * exported from the package).
 */
export function useWardicWith(config: WardicConfig | Accessor<WardicConfig>, internal: SpineInternals | undefined): Ward {
  const runtime = useWardicRuntime()
  // A server render takes the lean path: the Starting style only, no spine (ADR-0021).
  if (isServer) return serverWard(config, internal)
  const gate = useWardicGate()
  // Owner-scoped, SSR/hydration-stable unique id for this element's gate entry
  // (Solid's createUniqueId, not a module counter — see ADR note / no global state).
  const id = createUniqueId()

  // Normalize to an Accessor<WardicConfig>. A WardicConfig is always an object,
  // so `typeof config === "function"` is a safe discriminant for the accessor.
  const cfg: Accessor<WardicConfig> = typeof config === "function" ? config : () => config

  // Its place in variant orchestration (ADR-0007, #50): what it hands its children, and,
  // as a Variant child, the ancestor it inherits from and joins (its stagger slot, its
  // `when`). Read at hook-call time (component body owner), for this instance's lifetime.
  const node = createVariantNode(cfg, useVariantContext())

  // Resolve the Renderer's PURE project once (ADR-0003: synchronous, no engine).
  const { project } = runtime.runSync(Renderer.Renderer)

  // SSR seed: resolved purely from the config read EXACTLY ONCE (untrack — no
  // reactive dependency, must not re-seed after mount), with the inherited `initial`
  // name for a Variant child that has none (#50). It's the `style` until the first
  // commit, so pre-mount render carries the initial style (no flash).
  const initialConfig = untrack(cfg)
  const initialValues = startingValuesOf(initialConfig, node.inherited, presenceBlocksInitial(usePresenceContext()))

  // The Starting style: the projected SSR initial, carried by `style` until the gate's
  // first commit (ADR-0021 decision 6, ADR-0034). An svg-inner tag's attribute keys are
  // split off and set once as attributes, as the server renders them (ADR-0021); the
  // gate's commits take over at mount. While hydrating, it's what the server rendered, the
  // DOM's project (the Hydration hold, ADR-0021 decision 2): the Environment's Renderer
  // takes over at the first frame, and a different Starting style from it is noted once
  // (cold path).
  const projected = project(initialValues)
  const hydrating = isHydrating()
  const startingPatch = hydrating ? DomRenderer.project(initialValues) : projected
  if (hydrating) flagStartingStyle(runtime, id, startingPatch, projected)
  const seed = Svg.splitPatchForTag(internal?.tag, startingPatch)

  // A drag element's defaults (ADR-0019 *Amendment (Reorder)*), under the user's
  // style: `drag` is static, so they're chosen once.
  const dragAxis = dragAxisOf(untrack(cfg), internal)
  const dragDefaults = dragAxis !== undefined ? Style.dragDefaults(dragAxis) : undefined
  const baseStyle = internal?.baseStyle

  // The props `ward(userProps)` was last called with: their `style` is this element's style
  // link (ADR-0022), read untracked at need (the live getter on `wardic.*`), and its
  // fallback once the gate commits (ADR-0034).
  let lastUserProps: WardUserProps | undefined
  const elementStyle = createElementStyle({
    userStyle: () => lastUserProps?.style,
    starting: seed.style,
    defaults: dragDefaults,
    base: baseStyle,
  })

  // The element, available only after ref-mount. The spine is gated on it.
  const [el, setEl] = createSignal<HTMLElement>()

  // Run the shared spine: the gate commits each flushed Patch onto this element
  // (ADR-0006, ADR-0034), and the sink's hooks switch its `style`. Its variant node
  // wires the orchestration (ADR-0007, #50): the context it inherits names from, its
  // stagger delay as a Variant child, the `when` gates on its start, and its settle report.
  runSpine({
    runtime,
    gate,
    id,
    el,
    cfg,
    parent: node.inherited,
    extraDelay: node.extraDelay,
    canStart: node.canStart,
    onFrame: node.onFrame,
    internal,
    styleOf: () => lastUserProps?.style,
    // The gate commits onto the element (an svg-inner element's attribute keys as
    // attributes, ADR-0014); the hooks switch the spread's `style` (ADR-0034).
    makeSink: (element) => ({ target: element, ...elementStyle.hooks }),
    // The spread's `style` and attributes carry the drag defaults and the base style.
    defaultsInProps: true,
  })

  // `<ward.Provider>` publishes what this instance hands its children (#50): its own
  // variant context, its parent's passed through, or none.
  const Provider: Component<{ readonly children?: JSX.Element }> = (props) => (
    <WardicVariantContext.Provider value={node.provided}>{props.children}</WardicVariantContext.Provider>
  )

  // The callable + its `.Provider` property (ADR-0007). Object.assign keeps the
  // callable's merge API (ward() / ward({ ref, style })) intact while attaching
  // Provider as a property, and the cast aligns it with the `Ward` type.
  const ward: Ward = Object.assign(
    (userProps?: WardUserProps): WardProps => {
      lastUserProps = userProps
      return {
        // Merge the user's ref (if any) with ward's internal element setter so BOTH
        // are invoked with the live element on mount (Option A).
        ref: mergeRefs(userProps?.ref, setEl),
        // Getter so spreading {...ward()} stays reactive (Solid tracks the access): the
        // Starting style over the user's until the first commit, then the user's without the
        // keys the gate holds (ADR-0034). It never changes per frame.
        get style() {
          return elementStyle.style(userProps?.style)
        },
        ...seed.attrs,
        ...(dragDefaults !== undefined ? Style.DRAG_DEFAULT_ATTRIBUTES : {}),
      }
    },
    { Provider },
  )
  return ward
}

/**
 * Log, at debug level, the keys whose Starting style the Environment's Renderer projects
 * differently from the DOM's `project`, which rendered the server markup. Hydration keeps
 * the server's values (the Hydration hold); the Renderer's take over at the first frame.
 * Hydration only, once per element. Internal.
 */
export const flagStartingStyle = (runtime: WardicRuntime, id: string, server: Renderer.Patch, client: Renderer.Patch): void => {
  const keys: Array<string> = []
  for (const key in server) if (String(server[key]) !== String(client[key])) keys.push(key)
  for (const key in client) if (!(key in server)) keys.push(key)
  if (keys.length === 0) return
  const pick = (patch: Renderer.Patch) => Object.fromEntries(keys.map((key) => [key, patch[key]]))
  runtime.runFork(
    Effect.logDebug(
      "wardic.hydration: the Environment's Renderer projects the Starting style differently from the DOM's; " +
        "hydration keeps the server's until the first frame, and an element that never animates keeps it",
    ).pipe(
      Effect.annotateLogs({ id, keys, server: pick(server), client: pick(client) }),
    ),
  )
}

/**
 * {@link useWardicWith} during a server render (ADR-0021, decisions 1 and 4): the element's
 * Starting style and static attributes, computed purely, and nothing else: no runtime, no
 * spine, no signals. Hydration keys must land where the client's render puts them, so it
 * makes the client's one `createUniqueId` call in the same place, and its `.Provider`
 * renders the same component nesting, with a variant context that carries the names and
 * transitions but no orchestration.
 */
const serverWard = (config: WardicConfig | Accessor<WardicConfig>, internal: SpineInternals | undefined): Ward => {
  // The client's gate id: keeps every later hydration key in step.
  createUniqueId()
  const c = typeof config === "function" ? config() : config
  // The same names the client hands down, read once, with orchestration that does nothing
  // (#50); a Variant child's Starting style starts from its ancestor's `initial` name.
  const node = serverVariantNode(c, useVariantContext())
  const seed = Style.starting(internal?.tag, startingValuesOf(c, node.inherited, presenceBlocksInitial(usePresenceContext())))
  const dragAxis = dragAxisOf(c, internal)
  const dragDefaults = dragAxis !== undefined ? Style.dragDefaults(dragAxis) : undefined
  const Provider: Component<{ readonly children?: JSX.Element }> = (props) => (
    <WardicVariantContext.Provider value={node.provided}>{props.children}</WardicVariantContext.Provider>
  )
  return Object.assign(
    (userProps?: WardUserProps): WardProps => ({
      ref: userProps?.ref ?? noRef,
      style: pipe(seed.style, Style.over(userProps?.style), Style.over(internal?.baseStyle?.()), Style.over(dragDefaults)) as JSX.CSSProperties,
      ...seed.attrs,
      ...(dragDefaults !== undefined ? Style.DRAG_DEFAULT_ATTRIBUTES : {}),
    }),
    { Provider },
  )
}

/** A server render's `ref`: Solid never calls it there. */
const noRef = (): void => {}

/**
 * The drag axis a spine runs with: its static `drag` config, else `true` for a
 * `<Reorder>` item (its gesture's axis comes from `dragAxis`), else none.
 */
export const dragAxisOf = (config: WardicConfig, internal: SpineInternals | undefined): boolean | "x" | "y" | undefined =>
  config.drag !== undefined && config.drag !== false ? config.drag : internal?.dragAxis !== undefined ? true : undefined

/**
 * Set each of a drag element's defaults its inline style doesn't already set, and
 * `draggable="false"` unless it has the attribute (the commit-sink paths, at mount).
 */
const applyDragDefaults = (element: HTMLElement, defaults: Style.DragDefaults): void => {
  for (const key in defaults) {
    if (element.style.getPropertyValue(key) === "") element.style.setProperty(key, defaults[key]!)
  }
  if (!element.hasAttribute("draggable")) element.setAttribute("draggable", Style.DRAG_DEFAULT_ATTRIBUTES.draggable)
}
