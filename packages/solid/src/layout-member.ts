/**
 * A layout node's registration (ADR-0009, ADR-0010), Solid-free (#209): its layout transition, and
 * what each binding's `useLayoutMember` hands the provider's projection system. The binding adds
 * its own lifetime: the node's disposal, and a `layoutDependency` change's re-measure.
 *
 * @module
 */
import type * as Box from "@wardic/core/Box"
import type * as Point from "@wardic/core/Point"
import type * as Projection from "@wardic/core/Projection"
import * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { constTrue } from "effect/Function"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Values from "@wardic/core/Values"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import type { WardConfig, WardicTransition } from "./config.ts"
import type { PresenceSeed } from "./presence-record.ts"
import { type MotionTransition, motionOf, transitionForKey } from "./retarget-legs.ts"
import { ownOrInherited, type WardicVariantContextValue } from "./variant-tree.ts"

/** The spring fields: one of them, with no `type`, makes a layout transition a spring (ADR-0009 *Amendment (#171)*). */
const SPRING_FIELDS = ["stiffness", "damping", "mass", "velocity", "restDelta", "restVelocity"] as const

/** A transition that isn't a tween: `type: "spring"`, or no `type`, as its machines take it (#243). */
type SpringTransition = Exclude<MotionTransition, { readonly type: "tween" }>

/** Whether a transition with no `type` sets a spring field. */
const hasSpringField = (t: SpringTransition): boolean => Arr.some(SPRING_FIELDS, (key) => Predicate.isNotUndefined(t[key]))

/**
 * A transition that isn't a tween, as a layout animation's: a spring when it says so or sets a spring
 * field; anything else, a `delay` alone say, is Motion's default tween with its delay, so it never
 * turns a layout animation into a spring (ADR-0009 *Amendment (#171)*).
 */
const springOrDefault = (t: SpringTransition): ProjectionSystem.LayoutTransition =>
  Bool.match(Bool.or(t.type === "spring", hasSpringField(t)), {
    onTrue: (): ProjectionSystem.LayoutTransition => ({ ...t, type: "spring" }),
    onFalse: () =>
      UndefinedOr.match(t.delay, { onUndefined: () => ProjectionSystem.DEFAULT_LAYOUT_TRANSITION, onDefined: (delay): ProjectionSystem.LayoutTransition => ({ ...ProjectionSystem.DEFAULT_LAYOUT_TRANSITION, delay }) }),
  })

/** One transition as a layout animation's (ADR-0009 *Amendment (#171)*): a tween keeps its timing. */
const asLayoutTransition = (t: MotionTransition): ProjectionSystem.LayoutTransition =>
  Match.value(t).pipe(
    Match.when({ type: "tween" }, (tween): ProjectionSystem.LayoutTransition => ({ ...tween, type: "tween" })),
    Match.orElse(springOrDefault),
  )

/**
 * The element's layout transition (ADR-0009 *Amendment (#171)*, *Amendment (#301)*): Motion's
 * `layout` entry, else its `default`, else its whole `transition`; `undefined`, with none, for the
 * engine's default, Motion's 0.45 s tween.
 */
const toLayoutTransition = (t: WardicTransition | undefined): Option.Option<ProjectionSystem.LayoutTransition> =>
  Option.map(Option.fromUndefinedOr(motionOf(transitionForKey(t, "layout"))), asLayoutTransition)

/** A layout node's options: what a binding's `useLayoutMember` registers with the projection system. */
export interface UseLayoutMemberOptions {
  /** The element's gate id (the spine's entry — `@projection` writes merge here). */
  readonly id: string
  /** The live DOM element to measure + project. */
  readonly element: HTMLElement
  /** The element's `layoutDependency` accessor (a re-measure trigger). */
  readonly layoutDependency: () => unknown
  /** The element's effective transition: its `layout` key, else itself, drives its layout animations (ADR-0009 *Amendment (#171)*). */
  readonly transition: () => WardicTransition | undefined
  /** The element's drag transition, resolved: what its Release offset runs on (ADR-0016, *Amendment (#140)*). */
  readonly dragTransition?: () => ProjectionSystem.DragTransition
  /**
   * The element's `layoutId` (shared-element key, ADR-0010), or omitted for a plain
   * `layout` element. When set, the one node joins the engine's per-`layoutId`
   * lead/follow stack (crossfade for coexisting twins) and takes a Switch seed from
   * a twin disposed in the same task — both engine-side (*Amendment (#13)*).
   */
  readonly layoutId?: string
  /**
   * Mark this element a scroll container (ADR-0012): its scroll offset is sampled at
   * measure and folded out of its descendants' boxes, so a scroll change between
   * triggers doesn't leak into their FLIP delta.
   */
  readonly layoutScroll?: boolean
  /** Mark this element a stable projection sub-root (ADR-0013): self-snap + boundary + persistent relative anchor. */
  readonly layoutRoot?: boolean
  /** This element's relative-projection anchor (ADR-0013): a 0–1 Point, or `false` to force absolute. */
  readonly layoutAnchor?: Point.Point | false
  /** Raise the node while it's dragged (ADR-0016 *Amendment (Reorder)*; internal, a `<Reorder>` item's). */
  readonly raiseWhileDragged?: boolean
  /** The element's Layout mode, read at each layout animation's start (ADR-0009, *Amendment (#42)*). Default `true`. */
  readonly layoutMode?: () => Projection.LayoutMode
  /** The element's own scale, read at each handover and each frame it follows (ADR-0010 *Amendment (#8)*). */
  readonly ownScale?: () => Point.Point
  /** The element's own `rotate` and opacity, which a handover blends into (ADR-0010 *Amendment (#166)*). */
  readonly ownRotate?: () => number
  readonly ownOpacity?: () => number
  /** The app's layout animation callbacks, read when they fire (#191, ADR-0039). */
  readonly onLayoutAnimationStart?: () => (() => void) | undefined
  readonly onLayoutAnimationComplete?: () => (() => void) | undefined
  /** The app's `onDragTransitionEnd` (#273): a drag's Release offset at rest, read when it fires. */
  readonly onReleaseEnd?: () => (() => void) | undefined
  /** Where a presence take-over starts its first layout animation (#286): its leaver's box, in the Root frame. */
  readonly enteredFrom?: Box.Box
  /** Where a keyed twin's take-over starts its handover's fade (#286): the factor its leaver had faded to. */
  readonly fadeFrom?: number
}

/**
 * A layout node's registration with the projection system (ADR-0009, ADR-0010): exactly one node per
 * element, whether it has `layout`, `layoutId`, or both. Each getter is read where the projection
 * system needs it, outside the binding's tracking.
 */
export const registrationOf = (opts: UseLayoutMemberOptions): ProjectionSystem.RegisterNodeOptions => {
  const { dragTransition, element, enteredFrom, fadeFrom, id, layoutAnchor, layoutId, layoutMode, layoutRoot, layoutScroll, onLayoutAnimationComplete, onLayoutAnimationStart, onReleaseEnd, ownOpacity, ownRotate, ownScale, raiseWhileDragged, transition } = opts
  return {
    id,
    element,
    transition: () => toLayoutTransition(transition()),
    // The layout transition's reduced-motion opt-out (ADR-0029, #301), read at each layout animation's start.
    respectReducedMotion: () =>
      UndefinedOr.match(transitionForKey(transition(), "layout"), { onUndefined: constTrue, onDefined: (t) => t.respectReducedMotion !== false }),
    ...UndefinedOr.match(layoutId, { onUndefined: () => ({}), onDefined: (twinId) => ({ layoutId: twinId }) }),
    ...Bool.match(layoutScroll === true, { onTrue: () => ({ layoutScroll: true }), onFalse: () => ({}) }),
    ...Bool.match(layoutRoot === true, { onTrue: () => ({ layoutRoot: true }), onFalse: () => ({}) }),
    ...UndefinedOr.match(layoutAnchor, { onUndefined: () => ({}), onDefined: (anchor) => ({ layoutAnchor: anchor }) }),
    ...Bool.match(raiseWhileDragged === true, { onTrue: () => ({ raiseWhileDragged: true }), onFalse: () => ({}) }),
    ...UndefinedOr.match(dragTransition, { onUndefined: () => ({}), onDefined: (release) => ({ dragTransition: () => Option.some(release()) }) }),
    ...UndefinedOr.match(layoutMode, { onUndefined: () => ({}), onDefined: (mode) => ({ layoutMode: mode }) }),
    ...UndefinedOr.match(ownScale, { onUndefined: () => ({}), onDefined: (scale) => ({ ownScale: scale }) }),
    ...UndefinedOr.match(ownRotate, { onUndefined: () => ({}), onDefined: (rotate) => ({ ownRotate: rotate }) }),
    ...UndefinedOr.match(ownOpacity, { onUndefined: () => ({}), onDefined: (opacity) => ({ ownOpacity: opacity }) }),
    ...UndefinedOr.match(onLayoutAnimationStart, {
      onUndefined: () => ({}),
      onDefined: (start) => ({ onLayoutAnimationStart: () => Option.fromUndefinedOr(start()) }),
    }),
    ...UndefinedOr.match(onLayoutAnimationComplete, {
      onUndefined: () => ({}),
      onDefined: (complete) => ({ onLayoutAnimationComplete: () => Option.fromUndefinedOr(complete()) }),
    }),
    ...UndefinedOr.match(onReleaseEnd, {
      onUndefined: () => ({}),
      onDefined: (ended) => ({ onReleaseEnd: () => Option.fromUndefinedOr(ended()) }),
    }),
    ...takeOverOf(enteredFrom, fadeFrom),
  }
}

/** No options: what most registrations add for a take-over (#286). */
const NONE = {}

/**
 * A take-over's layout start (#286): the leaver's box and fade, each when it has one. Guards, not a
 * match per option: every layout node registers through here.
 */
const takeOverOf = (box: Box.Box | undefined, fade: number | undefined): Pick<ProjectionSystem.RegisterNodeOptions, "enteredFrom" | "fadeFrom"> => {
  if (Bool.and(Predicate.isUndefined(box), Predicate.isUndefined(fade))) return NONE
  return { ...UndefinedOr.match(box, { onUndefined: () => NONE, onDefined: (from) => ({ enteredFrom: from }) }), ...UndefinedOr.match(fade, { onUndefined: () => NONE, onDefined: (from) => ({ fadeFrom: from }) }) }
}

/**
 * The Layout mode a `layout` prop names (ADR-0009, *Amendment (#42)*): a mode's name, else
 * `true` (`layout`, or a node a `layoutId`, `layoutScroll` or `layoutRoot` gives).
 */
export const layoutModeOf = (layout: WardConfig["layout"]): Projection.LayoutMode =>
  Option.getOrElse(Option.liftPredicate(layout, isModeName), (): Projection.LayoutMode => true)

/** Whether a `layout` prop names a Layout mode (a string), not `true` / `false`. */
const isModeName = (layout: WardConfig["layout"]): layout is Exclude<WardConfig["layout"], boolean | undefined> => Predicate.isString(layout)

/** Whether a config makes its element a projection node: `layout` (or a mode), a `layoutId`, `layoutScroll` or `layoutRoot`. */
export const wantsLayoutNode = (c: WardConfig): boolean =>
  c.layout === true || Predicate.isString(c.layout) || Predicate.isNotUndefined(c.layoutId) || c.layoutScroll === true || c.layoutRoot === true

/** What {@link layoutOptionsOf} reads of a ward. */
export interface WardLayout {
  readonly id: string
  readonly element: HTMLElement
  /** The ward's config: its static layout props read once, here; the rest read where they're used. */
  readonly config: () => WardConfig
  /** The variant context the ward inherits its default transition from. */
  readonly parent: WardicVariantContextValue | undefined
  /** The ward's Snapshot: its own scale, rotate and opacity, as the renderer draws them. */
  readonly snapshot: { readonly values: Values.Values }
  /** What a release runs on: the node's Release offset (ADR-0016, *Amendment (#140)*). */
  readonly dragTransition: ProjectionSystem.DragTransition
  /** Raise the node while it's dragged: a `<Reorder>` item's. */
  readonly raiseWhileDragged: boolean
  /** Where its child's take-over of a leaver starts it (#286): its box and fade, when it has one. */
  readonly taken?: PresenceSeed | undefined
}

/**
 * A ward's layout node options, from its config: `layoutId`, `layoutScroll`, `layoutRoot` and
 * `layoutAnchor` read once, at mount; its transition, Layout mode and callbacks read when the
 * projection system needs them.
 */
export const layoutOptionsOf = (ward: WardLayout): UseLayoutMemberOptions => {
  const { config, element, id, parent, snapshot, dragTransition, raiseWhileDragged, taken } = ward
  const c0 = config()
  return {
    id,
    element,
    layoutDependency: () => config().layoutDependency,
    transition: () => ownOrInherited(config().transition, parent),
    dragTransition: () => dragTransition,
    // The Layout mode, read at each layout animation's start (ADR-0009, *Amendment (#42)*).
    layoutMode: () => layoutModeOf(config().layout),
    // The own scale the renderer draws, from the values last written (ADR-0010 *Amendment (#8)*).
    ownScale: () => DomRenderer.ownScaleOf(snapshot.values),
    // And its own rotate and opacity, which a handover blends into (ADR-0010 *Amendment (#166)*).
    ownRotate: () => DomRenderer.ownRotateOf(snapshot.values),
    ownOpacity: () => DomRenderer.ownOpacityOf(snapshot.values),
    // The app's layout animation callbacks, read when they fire (#191, ADR-0039).
    onLayoutAnimationStart: () => config().onLayoutAnimationStart,
    onLayoutAnimationComplete: () => config().onLayoutAnimationComplete,
    // The app's `onDragTransitionEnd` (#273): its Release offset at rest.
    onReleaseEnd: () => config().onDragTransitionEnd,
    ...UndefinedOr.match(c0.layoutId, { onUndefined: () => ({}), onDefined: (twinId) => ({ layoutId: twinId }) }),
    ...Bool.match(c0.layoutScroll === true, { onTrue: () => ({ layoutScroll: true }), onFalse: () => ({}) }),
    ...Bool.match(c0.layoutRoot === true, { onTrue: () => ({ layoutRoot: true }), onFalse: () => ({}) }),
    ...UndefinedOr.match(c0.layoutAnchor, { onUndefined: () => ({}), onDefined: (anchor) => ({ layoutAnchor: anchor }) }),
    ...Bool.match(raiseWhileDragged, { onTrue: () => ({ raiseWhileDragged: true }), onFalse: () => ({}) }),
    ...takenOptionsOf(taken),
  }
}

/** A take-over's layout start (#286), when its child took over from a leaver: its box and fade. */
const takenOptionsOf = (taken: PresenceSeed | undefined): Pick<UseLayoutMemberOptions, "enteredFrom" | "fadeFrom"> => {
  if (Predicate.isUndefined(taken)) return NONE
  return takeOverOf(taken.box, taken.fade)
}
