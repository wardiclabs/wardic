/**
 * `useWardic` — the primary motion spine of the Solid binding (ADR-0005).
 *
 * This is the fixed orchestration spine the binding contract prescribes:
 *
 *   Recognizers (hover/press) -> Override stack -> resolveOverrides -> reactive
 *   `target()` -> a settling primitive (spring/Retarget by default, tween for
 *   `transition.type: "tween"`) -> per-frame `gate.write(id, values)` -> the
 *   gate projects + flushes the `Patch` into this element's Solid style signal.
 *
 * The hook returns a callable `ward`: `<div {...ward()}>` spreads `ref` (wires
 * the element on mount) and a reactive `style` getter (the projected `Patch`).
 *
 * SSR contract (ADR-0003): the initial style is resolved synchronously and
 * purely as `project(resolveInitial(config))` — never by spinning the engine.
 * That one resolved value seeds the style signal (so the server / pre-mount
 * render emits it with no flash) AND the spring's `from` Snapshot (so frame 1
 * flows continuously out of the seed). `initial` is a static map / variant name
 * (SSR-serializable) at the hook boundary; the component layer unwraps an
 * accessor `initial` once before passing it in (see {@link WardicConfig.initial}).
 *
 * Scope (v0.1, this step): `initial` / `animate` / `whileHover` / `whileTap`.
 * NO variant-tree propagation, NO drag, NO exit/layout. Mixed numeric+string
 * targets are handled by routing numeric keys through `springValues` and any
 * string/color keys through `animateValues` (both writing into the same gate
 * id) — see {@link splitTarget}.
 */
import {
  type AnimateOptions,
  animateValues,
  type DragBounds,
  type DragSample,
  type Patch,
  Renderer,
  resolveOverrides,
  type SpringOptions,
  stagger as coreStagger,
  springValues,
  type StaggerOrigin,
  type Values,
} from "@wardic/core"
import {
  DRAG_DEFAULT_ATTRIBUTES,
  dragDefaultStyle,
  type DragDefaultStyle,
  mergeStyle,
  project as domProject,
  type ProjectionNodeHandle,
  resolveInitial,
  setSvgAttrs,
  splitPatch,
  splitPatchForTag,
  startingStyle,
  toValues,
} from "@wardic/dom"
import { mergeRefs } from "@solid-primitives/refs"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
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
import { type DragTrackConfig, runDragTrack } from "./drag.ts"
import type { FlushGate, FlushSink } from "./gate.ts"
import { useLayoutMember } from "./layout.tsx"
import { type PresenceRecord, usePresenceContext } from "./presence.tsx"
import { createHover, createPress } from "./sensors.ts"
import { runScoped, useWardicGate, useWardicRuntime, type WardicRuntime } from "./provider.tsx"
import { isHydrating, isServer } from "./server.ts"
import {
  type WardicChildRegistration,
  type WardicStaggerConfig,
  type WardicVariantContextValue,
  useVariantContext,
  WardicVariantContext,
} from "./variants.ts"

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
  /** Origin the stagger distance grows from (reuses core's StaggerOrigin). */
  readonly from?: StaggerOrigin
  /**
   * Sequence the parent vs. its children: `"beforeChildren"` runs the parent,
   * then the children once it settles; `"afterChildren"` runs the children, then
   * the parent once all settle. Default (omitted) is concurrent.
   */
  readonly when?: "beforeChildren" | "afterChildren"
}

/**
 * Transition config: a primitive selector plus the matching primitive's
 * options. `type` defaults to `"spring"`; `"tween"` routes every key through
 * `animateValues` (duration-based, no velocity). Both arms also carry the
 * optional {@link WardicOrchestration} fields.
 */
export type WardicTransition =
  | ({ readonly type?: "spring" } & SpringOptions & WardicOrchestration)
  | ({ readonly type: "tween" } & Partial<AnimateOptions> & WardicOrchestration)

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
   */
  readonly initial?: WardicValues | string
  /** The resting target. A string names a `variants` entry. Read reactively through the whole-config accessor `cfg()`. */
  readonly animate?: WardicValues | string
  /** Named value maps `initial` / `animate` strings resolve against. */
  readonly variants?: Record<string, WardicValues>
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
   * {@link dragSnapToOrigin} — is read EXACTLY ONCE at mount (`untrack`); only
   * {@link whileDrag} participates in the reactive override / `dragging` path. A
   * reactively-changed axis / constraints is NOT re-read in v0.1.
   *
   * The element gets Motion's drag defaults (ADR-0019, *Amendment (Reorder)*):
   * `touch-action` `none` (`pan-y` for an `x` drag, `pan-x` for a `y` drag),
   * `user-select` and `-webkit-user-select` / `-webkit-touch-callout` `none`, and
   * `draggable="false"`, so a touch drag isn't taken for a scroll and a drag
   * starting on text isn't a native drag. The element's own `style` overrides them.
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
  /** Constrain the drag to a static numeric box (per axis). Only when `drag` is on. Static config (LOW-3): read ONCE at mount; not re-read reactively in v0.1. */
  readonly dragConstraints?: DragBounds
  /** Rubber-band resistance past {@link dragConstraints} (0 = hard clamp, default). Static config (LOW-3): read ONCE at mount; not re-read reactively in v0.1. */
  readonly dragElastic?: number
  /** Fling on release under decay (default `true`). Only when `drag` is on. Static config (LOW-3): read ONCE at mount; not re-read reactively in v0.1. */
  readonly dragMomentum?: boolean
  /** Spring `x`/`y` back to the origin on release (overrides momentum). Only when `drag` is on. Static config (LOW-3): read ONCE at mount; not re-read reactively in v0.1. */
  readonly dragSnapToOrigin?: boolean
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
   * size/`layoutDependency` change is observed. Static field (reactivity-layering
   * rule): a plain boolean read once.
   */
  readonly layout?: boolean
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
}

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
 * so `resolveOverrides` / `splitTarget` never receive `undefined`-valued keys.
 */
const resolveValues = (
  entry: WardicValues | string | undefined,
  variants: Record<string, WardicValues> | undefined,
): Values => {
  if (entry === undefined) return {}
  if (typeof entry === "string") return toValues(variants?.[entry])
  return toValues(entry)
}

/** A target split into its numeric (spring-able) and string (tween-only) keys. */
interface SplitTarget {
  readonly numeric: Record<string, number>
  readonly strings: Values
}

/**
 * Partition a resolved target into numeric keys (driven by `springValues` when
 * the transition is a spring) and string/color keys (always routed through
 * `animateValues`, which goes via the InterpolatorRegistry). Both halves write
 * into the same gate id, so they collapse into one projected `Patch`.
 */
const splitTarget = (target: Values): SplitTarget => {
  const numeric: Record<string, number> = {}
  const strings: Values = {}
  for (const key in target) {
    const v = target[key]!
    if (typeof v === "number") numeric[key] = v
    else strings[key] = v
  }
  return { numeric, strings }
}

/** Pull a numeric subset (the spring snapshot keys) out of a `Values` map. */
const numericOf = (values: Values): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const key in values) {
    const v = values[key]!
    if (typeof v === "number") out[key] = v
  }
  return out
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
 * - `baseStyle`: style under the user's, above the drag defaults (the item's
 *   `touch-action`), read reactively.
 * - `tag`: the element's tag, set by `wardic.create(tag)`, so an svg-inner element's
 *   Starting style renders its attribute keys as attributes (ADR-0021; a `useWardic`
 *   spread doesn't know its tag and stays all style).
 */
export interface SpineInternals {
  readonly tag?: string | undefined
  readonly dragAxis?: (() => boolean | "x" | "y") | undefined
  readonly onDragSample?: ((sample: DragSample) => void) | undefined
  readonly onLayoutHandle?: ((handle: ProjectionNodeHandle) => void) | undefined
  readonly raiseWhileDragged?: boolean | undefined
  readonly baseStyle?: (() => JSX.CSSProperties | undefined) | undefined
}

export interface RunSpineOptions {
  /** The provider runtime the spine forks its fibers on. */
  readonly runtime: WardicRuntime
  /** The provider-owned flush gate (ADR-0006). */
  readonly gate: FlushGate
  /** SSR/hydration-stable gate id for this element's entry. */
  readonly id: string
  /** The element accessor; the spine is gated on it (started once defined). */
  readonly el: Accessor<HTMLElement | undefined>
  /** Reactive config accessor (animate / whileHover / whileTap / transition read reactively). */
  readonly cfg: Accessor<WardicConfig>
  /**
   * The nearest parent variant context (ADR-0007), or `undefined` at the root.
   * The spine reads `parent.variant()` reactively to resolve an INHERITED variant
   * name against THIS element's own `variants` (when no local `animate`), and
   * falls back to `parent.transition()` when this config has no local transition.
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
   * Builds the {@link FlushSink} for the registered element — the ONE thing that
   * differs between callers: `useWardic` supplies a SIGNAL sink (sets a style
   * signal), `wardic.create(Component)` supplies a COMMIT sink (writes the patch
   * onto the forwarded element via `Renderer.commit`). The spine itself is
   * sink-agnostic.
   */
  readonly makeSink: (el: HTMLElement) => FlushSink
}

/**
 * The fixed motion spine, factored out so both sink shapes share it (ADR-0006):
 *
 *   on(el) once-defined -> gate.register(id, makeSink(element)) -> recognizers
 *   (hover/press) -> override-stack memo from cfg() -> on(target) Retarget
 *   (springValues / animateValues seeded from the Snapshot ref) -> gate.write.
 *
 * It is sink-agnostic: the caller supplies `makeSink`, so the spine has no idea
 * whether the flushed `Patch` drives a Solid signal or commits to a forwarded
 * DOM element. `initial` is read EXACTLY ONCE at setup (`untrack`) to seed the
 * spring's `from` Snapshot (ADR-0003); `animate` / `whileHover` / `whileTap` /
 * `transition` / `variants` are read reactively through `cfg()`.
 *
 * Must be called within a Solid owner (it registers `createEffect` / `onCleanup`).
 */
export function runSpine(opts: RunSpineOptions): void {
  const { canStart, cfg, el, extraDelay, gate, id, internal, makeSink, onFrame, parent, runtime } = opts

  // The nearest <AnimatePresence>, or undefined at the root (ADR-0007). When
  // present, this spine publishes its live value-map (`snapshot`) + exit target
  // (`exit`) into a presence registration; the PARENT drives the exit on leave
  // (this child is disposed). The child does NOT unregister on its own
  // onCleanup — <AnimatePresence> owns removal after the exit settles.
  const presence = usePresenceContext()

  // SSR seed: resolved purely from the config read EXACTLY ONCE (untrack — no
  // reactive dependency, must not re-seed after mount). Seeds the spring `from`
  // Snapshot so frame 1 flows continuously out of it (no snap).
  const initialValues = resolveInitial(untrack(cfg))

  // Plain (non-reactive) Snapshot ref: the last emitted spring frame's values +
  // velocities, seeded from the SSR initial (velocities 0). Used to retarget
  // with momentum carried across the seam (ADR-0005).
  const snapshot: { values: Record<string, number>; velocities: Record<string, number> } = {
    values: numericOf(initialValues),
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
      // flushed frame's Patch is delivered through it (signal or commit).
      const sink = makeSink(element)
      const unregister = gate.register(id, sink)
      onCleanup(unregister)

      // A commit sink has no style prop to carry a drag element's defaults
      // (ADR-0019 *Amendment (Reorder)*): set each one the element's inline style
      // doesn't already, and the attribute unless it has one, once at mount.
      if (sink.kind === "commit") {
        const base = internal?.baseStyle
        if (base !== undefined) {
          // The base style goes under the user's: a key the element's own inline style
          // sets at mount is the user's, and is never written.
          const own = new Set<string>()
          for (let i = 0; i < element.style.length; i++) own.add(element.style.item(i))
          createEffect(() => {
            const style = base() as Record<string, unknown> | undefined
            if (style === undefined) return
            for (const key in style) if (!own.has(key)) element.style.setProperty(key, String(style[key]))
          })
        }
        const dragAxis = dragAxisOf(untrack(cfg), internal)
        if (dragAxis !== undefined) applyDragDefaults(element, dragDefaultStyle(dragAxis))
      }

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
          exit: { current: toValues(untrack(cfg).exit) },
        }
        presence.register(presenceRec)
        // Keep exit.current current while the child is alive.
        createEffect(() => {
          presenceRec!.exit.current = toValues(cfg().exit)
        })
      }

      // Merge an emitted frame's value-map into the presence snapshot (no-op
      // without a presence). The accumulator mirrors what the gate accumulates,
      // so the exit departs from the element's actual resting value-map.
      const recordFrame = (value: Values): void => {
        if (presenceRec !== undefined) Object.assign(presenceRec.snapshot.current, value)
      }

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
      let layoutHandle: ProjectionNodeHandle | undefined
      if (c0.layout === true || layoutId !== undefined || c0.layoutScroll === true || c0.layoutRoot === true) {
        layoutHandle = useLayoutMember({
          id,
          element,
          layoutDependency: () => cfg().layoutDependency,
          transition: () => cfg().transition ?? parent?.transition(),
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
          springOpts: (c0d.transition ?? parent?.transition()) as SpringOptions | undefined,
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

      // Recognizers over the live element (run their fibers, scoped to this
      // owner's onCleanup via streamToSignal -> runScoped).
      const hovered = createHover(element)
      const pressed = createPress(element)

      // Override stack (ascending priority): base (animate, or initial when no
      // animate) -> whileHover -> whileTap. resolveOverrides picks the last
      // active entry per key. The memo DEPENDS on cfg() (read inside), so a
      // reactive config change recomputes target() and drives a Retarget.
      const target = createMemo<Values>(() => {
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
              : initialValues
        const resolved = resolveOverrides([
          { active: true, values: base },
          { active: hovered(), values: toValues(c.whileHover) },
          { active: pressed(), values: toValues(c.whileTap) },
          // whileDrag sits ABOVE tap (highest priority) — driven by the spring,
          // NOT stripped, so e.g. `scale: 1.1` animates while held and returns
          // after release. Read dragging() so a flip recomputes this memo.
          { active: dragging(), values: toValues(c.whileDrag) },
        ])
        // MULTI-OWNER strip (ADR-0004): while dragging, x/y are DIRECT-SET by the
        // drag track, so strip the translate keys from the spring's target — the
        // spring must never fight the direct-set. Once dragging() is false the
        // keys re-enter normally (post-drag handoff: the spring continues x/y only
        // if `animate` sets them, from the snapshot's rested position).
        if (dragging()) {
          const stripped: Values = {}
          for (const k in resolved) {
            if (k === "x" || k === "y" || k === "translateX" || k === "translateY") continue
            stripped[k] = resolved[k]!
          }
          return stripped
        }
        return resolved
      })

      // The spine: on each target change, interrupt the previous fiber(s) and
      // reseed a fresh primitive from the Snapshot (velocity-preserving).
      let prevFibers: Array<Fiber.Fiber<void, never>> = []
      const interruptPrev = (): void => {
        for (const fiber of prevFibers) runtime.runFork(Fiber.interrupt(fiber))
        prevFibers = []
      }

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
          (t) => {
            interruptPrev()

            // `when` start-gate (ADR-0007): when canStart() is false, freeze at the
            // snapshot (the previous fiber is already interrupted) and bail; the
            // effect re-runs once the gate flips true (tracked above).
            if (canStart !== undefined && !canStart()) {
              // Report NOT settled: a gated child sits at its snapshot, still
              // owing an animation, so it must not count as settled (afterChildren).
              onFrame?.(false)
              return
            }

            const { numeric, strings } = splitTarget(t)
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

            if (useTween) {
              // Tween: animateValues drives ALL keys (numeric + string) from the
              // current snapshot values; no velocity (snapshot.velocities stays {}).
              const from: Values = { ...snapshot.values, ...strings }
              const options = transition as Partial<AnimateOptions>
              prevFibers.push(
                runScoped(
                  runtime,
                  Stream.runForEach(
                    animateValues(
                      from,
                      t,
                      options.duration !== undefined ? (options as AnimateOptions) : undefined,
                    ),
                    (frame) =>
                      Effect.sync(() => {
                        // MULTI-OWNER MERGE (ADR-0004): merge the tween's keys into
                        // the snapshot rather than replacing it, so the drag's
                        // direct-set x/y survive alongside the tween's keys and the
                        // post-drag handoff continues from the rested position.
                        snapshot.values = { ...snapshot.values, ...numericOf(frame.value) }
                        gate.write(id, frame.value)
                        recordFrame(frame.value)
                        onFrame?.(frame.done)
                      }),
                  ),
                ),
              )
            } else {
              // Spring (default): numeric keys via springValues (velocity-carrying
              // retarget); any string/color keys via animateValues into the same
              // gate id.
              const springOpts = (transition ?? {}) as SpringOptions
              const hasNumeric = Object.keys(numeric).length > 0
              if (hasNumeric) {
                prevFibers.push(
                  runScoped(
                    runtime,
                    Stream.runForEach(
                      springValues(numeric, springOpts, snapshot.values, snapshot.velocities),
                      (frame) =>
                        Effect.sync(() => {
                          // MULTI-OWNER MERGE (ADR-0004): merge the spring's keys
                          // into the snapshot rather than replacing it, so the
                          // drag's direct-set x/y survive alongside the spring's
                          // keys (drag owns x/y, spring owns the rest) and the
                          // post-drag handoff continues from the rested position.
                          snapshot.values = { ...snapshot.values, ...frame.value }
                          snapshot.velocities = { ...snapshot.velocities, ...frame.velocity }
                          gate.write(id, frame.value)
                          recordFrame(frame.value)
                          // The numeric spring is the primary settle signal.
                          onFrame?.(frame.done)
                        }),
                    ),
                  ),
                )
              }
              if (Object.keys(strings).length > 0) {
                const fromStrings: Values = {}
                for (const key in strings) fromStrings[key] = strings[key]!
                prevFibers.push(
                  runScoped(
                    runtime,
                    Stream.runForEach(animateValues(fromStrings, strings), (frame) =>
                      Effect.sync(() => {
                        gate.write(id, frame.value)
                        recordFrame(frame.value)
                        // Report settle from the string leg ONLY when there is no
                        // numeric driver (otherwise numeric owns the settle signal).
                        if (!hasNumeric) onFrame?.(frame.done)
                      })),
                  ),
                )
              }
            }
          },
        ),
      )

      // Interrupt the in-flight spine fiber(s) on unmount (in addition to
      // runScoped's own onCleanup, which handles the latest fiber).
      onCleanup(interruptPrev)
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

  // The nearest parent variant context (ADR-0007), or undefined at the root.
  // Read at hook-call time (component body owner) so the inheritance is wired
  // for this instance's lifetime; the spine reads parent.variant() reactively.
  const parent = useVariantContext()

  // --- Orchestration: child registration (ADR-0007, step 21b) -------------
  // If under a parent Provider, register on mount to obtain this child's
  // snapshot index/total + settle reporter. The handle is read reactively by
  // the spine (extraDelay/canStart) and onCleanup disposes it.
  const registration: WardicChildRegistration | undefined = parent?.register()
  if (registration !== undefined) onCleanup(registration.dispose)

  // Resolve the Renderer's PURE project once (ADR-0003: synchronous, no engine).
  const { project } = runtime.runSync(Renderer)

  // SSR seed: resolved purely from the config read EXACTLY ONCE (untrack — no
  // reactive dependency, must not re-seed after mount). Seeds the style signal
  // so pre-mount render carries the initial style (no flash).
  const initialValues = resolveInitial(untrack(cfg))

  // The style signal: seeded to the projected SSR initial so pre-mount render
  // carries the initial style (no flash). The gate's signal sink updates it. An
  // svg-inner tag's attribute keys are split off and set once as attributes, as the
  // server renders them (ADR-0021); the sink's setSvgAttrs takes over at mount.
  // While hydrating, seed with what the server rendered, the DOM's project (the Hydration
  // hold, ADR-0021 decision 2): the Environment's Renderer takes over at the first frame,
  // and a different Starting style from it is noted once (cold path).
  const projected = project(initialValues)
  const hydrating = isHydrating()
  const startingPatch = hydrating ? domProject(initialValues) : projected
  if (hydrating) flagStartingStyle(runtime, id, startingPatch, projected)
  const seed = splitPatchForTag(internal?.tag, startingPatch)
  const [style, setStyle] = createSignal<Patch>(seed.style)

  // The element, available only after ref-mount. The spine is gated on it.
  const [el, setEl] = createSignal<HTMLElement>()

  // --- Orchestration: this instance as a PARENT Provider (ADR-0007) -------
  // An ordered registry of child records (mount order). register() pushes a
  // record carrying per-child index/total/settled signals; the snapshot effect
  // (below, keyed on currentVariant) rewrites index/total at each trigger.
  interface ChildRecord {
    readonly setIndex: (i: number) => void
    readonly setTotal: (n: number) => void
    readonly settled: Accessor<boolean>
  }
  const [registry, setRegistry] = createSignal<ReadonlyArray<ChildRecord>>([], { equals: false })

  // parentSettled: flipped true when THIS instance's own spine settles; reset
  // false at each variant change. Drives `beforeChildren` (children wait for it).
  const [parentSettled, setParentSettled] = createSignal(false)

  const register = (): WardicChildRegistration => {
    const [index, setIndex] = createSignal(0)
    const [total, setTotal] = createSignal(1)
    const [settled, setSettled] = createSignal(false)
    const record: ChildRecord = { setIndex, setTotal, settled }
    setRegistry((prev) => [...prev, record])
    const dispose = (): void => {
      setRegistry((prev) => prev.filter((r) => r !== record))
    }
    return { index, total, setSettled, dispose }
  }

  // This instance's resolved stagger config, from cfg().transition (ADR-0007).
  const staggerConfig: Accessor<WardicStaggerConfig> = createMemo(() => {
    const t = cfg().transition
    return {
      amount: t?.staggerChildren ?? 0,
      delayChildren: t?.delayChildren ?? 0,
      from: t?.from ?? "first",
      direction: t?.staggerDirection ?? 1,
    }
  })
  const whenMode: Accessor<"beforeChildren" | "afterChildren" | undefined> = () => cfg().transition?.when

  // Snapshot-at-trigger (ADR-0007): recompute each child's index/total ONLY when
  // THIS instance's variant changes (the trigger). A mount/unmount/reorder
  // mid-transition does NOT reshuffle in-flight indices — this effect is keyed
  // on the variant, not on the registry. `staggerDirection: -1` reverses index.
  // (`currentVariant` is defined below; referenced lazily inside the effect.)
  createEffect(
    on(
      () => currentVariant(),
      () => {
        const ordered = untrack(registry)
        const n = ordered.length
        const dir = untrack(staggerConfig).direction
        ordered.forEach((rec, i) => {
          rec.setTotal(n)
          rec.setIndex(dir === -1 ? n - 1 - i : i)
        })
        // A new transition has begun: this parent is no longer settled.
        setParentSettled(false)
      },
    ),
  )

  // childrenMayStart: true immediately UNLESS beforeChildren, in which case true
  // once this parent's own animation settles (ADR-0007 `when`).
  const childrenMayStart: Accessor<boolean> = () => whenMode() !== "beforeChildren" || parentSettled()
  // allChildrenSettled: every registered child reported settled.
  const allChildrenSettled: Accessor<boolean> = createMemo(() => registry().every((rec) => rec.settled()))

  // The parent gates its OWN spine start when when==='afterChildren' (it owns the
  // registry, so it reads allChildrenSettled directly — NOT via a context).
  const ownCanStart: () => boolean = () => whenMode() !== "afterChildren" || allChildrenSettled()

  // Run the shared spine with a SIGNAL sink: each flushed Patch sets this
  // element's style signal (ADR-0006, the default element-wrap path). `parent`
  // wires the variant-name inheritance (ADR-0007) into the base resolution.
  // Orchestration wiring (ADR-0007 21b):
  //   - extraDelay: this child's per-transition stagger delay (under a parent).
  //   - canStart: gate this child on the parent's `beforeChildren`, AND gate this
  //     instance's OWN spine on its `afterChildren` (both must hold).
  //   - onFrame: report settle BOTH to the parent's registry (child role) and to
  //     this instance's own parentSettled (parent role for beforeChildren).
  const extraDelay: (() => number) | undefined =
    registration !== undefined
      ? () => {
          const s = parent!.stagger()
          return s.delayChildren + coreStagger(s.amount, { from: s.from })(registration.index(), registration.total())
        }
      : undefined
  const canStart: () => boolean = () => (parent?.childrenMayStart() ?? true) && ownCanStart()
  const onFrame = (done: boolean): void => {
    registration?.setSettled(done)
    if (done) setParentSettled(true)
    else setParentSettled(false)
  }

  runSpine({
    runtime,
    gate,
    id,
    el,
    cfg,
    parent,
    extraDelay,
    canStart,
    onFrame,
    internal,
    // SIGNAL sink (ADR-0014): split the projected Patch — CSS `style` keys feed
    // the declarative style signal (preserving the user-style merge + SSR seed),
    // SVG `attrs` are applied imperatively via setAttribute. For an HTML element
    // the attr map is empty, so this is the prior `setStyle(patch)` behavior.
    makeSink: (element) => ({
      kind: "signal",
      set: (patch) => {
        const { style, attrs } = splitPatch(element, patch)
        setStyle(style)
        setSvgAttrs(element, attrs)
      },
    }),
  })

  // This instance's CURRENT variant NAME, reactive (ADR-0007 name propagation).
  // Propagation is BY NAME: when this config's resolved `animate` is a string it
  // IS the name to publish; when `animate` is a Values map (or absent) there is
  // no name — but an inherited name flows THROUGH (so a mid-tree wrapper without
  // its own `animate` re-publishes the variant it inherited).
  const currentVariant: Accessor<string | undefined> = createMemo(() => {
    const animate = cfg().animate
    if (typeof animate === "string") return animate
    if (animate !== undefined) return undefined
    return parent?.variant()
  })

  // The effective transition published to children: this config's transition, or
  // the inherited one as the default (ADR-0007).
  const effectiveTransition: Accessor<WardicTransition | undefined> = createMemo(
    () => cfg().transition ?? parent?.transition(),
  )

  // The variant context value published by `ward.Provider` — accessors so the
  // subtree stays reactive to this instance's variant / transition changes.
  // Orchestration members (ADR-0007 21b) expose this instance's registry +
  // stagger config + when settle signals to its children.
  const providedValue: WardicVariantContextValue = {
    variant: currentVariant,
    transition: effectiveTransition,
    register,
    stagger: staggerConfig,
    when: whenMode,
    childrenMayStart,
    allChildrenSettled,
  }

  // `<ward.Provider>` publishes this instance's variant context to the subtree.
  const Provider: Component<{ readonly children?: JSX.Element }> = (props) => (
    <WardicVariantContext.Provider value={providedValue}>{props.children}</WardicVariantContext.Provider>
  )

  // The callable + its `.Provider` property (ADR-0007). Object.assign keeps the
  // callable's merge API (ward() / ward({ ref, style })) intact while attaching
  // Provider as a property, and the cast aligns it with the `Ward` type.
  // A drag element's defaults (ADR-0019 *Amendment (Reorder)*), under the user's
  // style: `drag` is static, so they're chosen once.
  const dragAxis = dragAxisOf(untrack(cfg), internal)
  const dragDefaults = dragAxis !== undefined ? dragDefaultStyle(dragAxis) : undefined
  const baseStyle = internal?.baseStyle

  const ward: Ward = Object.assign(
    (userProps?: WardUserProps): WardProps => ({
      // Merge the user's ref (if any) with ward's internal element setter so BOTH
      // are invoked with the live element on mount (Option A).
      ref: mergeRefs(userProps?.ref, setEl),
      // Getter so spreading {...ward()} stays reactive (Solid tracks the access).
      // The user's static style is the base; ward's animated keys merge ON TOP.
      get style() {
        return mergeStyle(userProps?.style, style(), dragDefaults, baseStyle?.()) as JSX.CSSProperties
      },
      ...seed.attrs,
      ...(dragDefaults !== undefined ? DRAG_DEFAULT_ATTRIBUTES : {}),
    }),
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
export const flagStartingStyle = (runtime: WardicRuntime, id: string, server: Patch, client: Patch): void => {
  const keys: Array<string> = []
  for (const key in server) if (String(server[key]) !== String(client[key])) keys.push(key)
  for (const key in client) if (!(key in server)) keys.push(key)
  if (keys.length === 0) return
  const pick = (patch: Patch) => Object.fromEntries(keys.map((key) => [key, patch[key]]))
  runtime.runFork(
    Effect.logDebug(
      "wardic.hydration: the Environment's Renderer projects the Starting style differently from the DOM's; " +
        "hydration keeps the server's until the first frame, and an element that never animates keeps it",
    ).pipe(
      Effect.annotateLogs({ id, keys, server: pick(server), client: pick(client) }),
    ),
  )
}

/** A registration that does nothing: a server render has no orchestration to join. */
const INERT_REGISTRATION: WardicChildRegistration = Object.freeze({
  index: () => 0,
  total: () => 1,
  setSettled: () => {},
  dispose: () => {},
})

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
  const parent = useVariantContext()
  const c = typeof config === "function" ? config() : config
  const seed = startingStyle(internal?.tag, resolveInitial(c))
  const dragAxis = dragAxisOf(c, internal)
  const dragDefaults = dragAxis !== undefined ? dragDefaultStyle(dragAxis) : undefined
  const t = c.transition
  const value: WardicVariantContextValue = {
    variant: () => (typeof c.animate === "string" ? c.animate : c.animate !== undefined ? undefined : parent?.variant()),
    transition: () => t ?? parent?.transition(),
    register: () => INERT_REGISTRATION,
    stagger: () => ({
      amount: t?.staggerChildren ?? 0,
      delayChildren: t?.delayChildren ?? 0,
      from: t?.from ?? "first",
      direction: t?.staggerDirection ?? 1,
    }),
    when: () => t?.when,
    childrenMayStart: () => true,
    allChildrenSettled: () => true,
  }
  const Provider: Component<{ readonly children?: JSX.Element }> = (props) => (
    <WardicVariantContext.Provider value={value}>{props.children}</WardicVariantContext.Provider>
  )
  return Object.assign(
    (userProps?: WardUserProps): WardProps => ({
      ref: userProps?.ref ?? noRef,
      style: mergeStyle(userProps?.style, seed.style, dragDefaults, internal?.baseStyle?.()) as JSX.CSSProperties,
      ...seed.attrs,
      ...(dragDefaults !== undefined ? DRAG_DEFAULT_ATTRIBUTES : {}),
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
const applyDragDefaults = (element: HTMLElement, defaults: DragDefaultStyle): void => {
  for (const key in defaults) {
    if (element.style.getPropertyValue(key) === "") element.style.setProperty(key, defaults[key]!)
  }
  if (!element.hasAttribute("draggable")) element.setAttribute("draggable", DRAG_DEFAULT_ATTRIBUTES.draggable)
}
