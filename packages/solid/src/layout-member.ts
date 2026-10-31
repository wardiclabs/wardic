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
import * as Bool from "effect/Boolean"
import { constFalse, constTrue, identity } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Values from "@wardic/core/Values"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import type { WardConfig, WardicTransition } from "./config.ts"
import { layoutIdIn } from "./layout-group.ts"
import type { PresenceSeed } from "./presence-record.ts"
import { runOf, transitionForKey } from "./retarget-legs.ts"
import { ownOrInherited, type WardicVariantContextValue } from "./variant-tree.ts"

/**
 * One transition as a layout animation's (ADR-0009 *Amendment (#171)*, ADR-0051): as it runs, a value's
 * rule (a spring when it says so or gives a spring field, else a tween, Motion's fields filled in), so
 * a ported `{ duration: 0.5 }` is a 0.5 s tween. One that defines none, a `delay` alone say, is
 * Motion's default layout tween with its delay: it never turns a layout animation into a spring. An
 * inertia (#435) is that tween too: a layout animation's progress has no velocity to glide on.
 */
const asLayoutTransition = (t: WardicTransition): ProjectionSystem.LayoutTransition =>
  UndefinedOr.match(runOf(t), {
    // A layout tween takes one `ease`: a list of them (#429) is a Keyframes tween's, which core's layout tween rejects.
    onDefined: (run): ProjectionSystem.LayoutTransition =>
      Bool.match(run.type === "inertia", { onTrue: () => defaultLayoutAfter(t.delay), onFalse: () => run as ProjectionSystem.LayoutTransition }),
    onUndefined: () => defaultLayoutAfter(t.delay),
  })

/** Motion's default layout tween, after `delay` when given. */
const defaultLayoutAfter = (delay: number | undefined): ProjectionSystem.LayoutTransition =>
  UndefinedOr.match(delay, { onUndefined: () => ProjectionSystem.DEFAULT_LAYOUT_TRANSITION, onDefined: (after): ProjectionSystem.LayoutTransition => ({ ...ProjectionSystem.DEFAULT_LAYOUT_TRANSITION, delay: after }) })

/**
 * The element's layout transition (ADR-0009 *Amendment (#171)*, *Amendment (#301)*): Motion's
 * `layout` entry, else its `default`, else its whole `transition`; `undefined`, with none, for the
 * engine's default, Motion's 0.45 s tween.
 */
const toLayoutTransition = (t: WardicTransition | undefined): Option.Option<ProjectionSystem.LayoutTransition> =>
  Option.map(Option.fromUndefinedOr(transitionForKey(t, "layout")), asLayoutTransition)

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
  /** Whether reduced motion applies to it now (ADR-0029): its nearest `WardicConfig`'s, else the provider's (#434). Default: the system's. */
  readonly reducedMotion?: () => boolean
  /** Whether its animations are skipped now (#468): its nearest `WardicConfig`'s `skipAnimations`. Default: never. */
  readonly skipAnimations?: () => boolean
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
  /** Whether a handover onto it crossfades (#442, `layoutCrossfade`), read as each begins. Default: always. */
  readonly crossfade?: () => boolean
  /** Raise the node while it's dragged (ADR-0016 *Amendment (Reorder)*; internal, a `<Reorder>` item's). */
  readonly raiseWhileDragged?: boolean
  /** The element's Layout mode, read at each layout animation's start (ADR-0009, *Amendment (#42)*). Default `true`. */
  readonly layoutMode?: () => Projection.LayoutMode
  /** The element's own scale, read at each handover and each frame it follows (ADR-0010 *Amendment (#8)*). */
  readonly ownScale?: () => Point.Point
  /** The element's own translate, in page pixels, read where its own scale is (#363). */
  readonly ownTranslate?: () => Point.Point
  /** The element's own `rotate` and opacity, which a handover blends into (ADR-0010 *Amendment (#166)*). */
  readonly ownRotate?: () => number
  readonly ownOpacity?: () => number
  /** What a Measure pass holds its transform at (#443): its Transform template's. Left out with none. */
  readonly heldTransform?: () => string
  /** The app's `onBeforeLayoutMeasure` and `onLayoutMeasure` (#443), each left out when it had none at mount. */
  readonly onBeforeMeasure?: () => void
  readonly onMeasure?: (box: Box.Box, prev: Box.Box | undefined) => void
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

/** Whether a layout transition skips its animation (#468): its `layout` entry's, else its own `skipAnimations`. */
const layoutSkips = (transition: WardicTransition | undefined): boolean =>
  UndefinedOr.match(transitionForKey(transition, "layout"), { onUndefined: constFalse, onDefined: (t) => t.skipAnimations === true })

/**
 * A layout node's registration with the projection system (ADR-0009, ADR-0010): exactly one node per
 * element, whether it has `layout`, `layoutId`, or both. Each getter is read where the projection
 * system needs it, outside the binding's tracking.
 */
export const registrationOf = (opts: UseLayoutMemberOptions): ProjectionSystem.RegisterNodeOptions => {
  const { crossfade, dragTransition, element, enteredFrom, fadeFrom, id, layoutAnchor, layoutId, layoutMode, layoutRoot, layoutScroll, heldTransform, onBeforeMeasure, onMeasure, onLayoutAnimationComplete, onLayoutAnimationStart, onReleaseEnd, ownOpacity, ownRotate, ownScale, ownTranslate, raiseWhileDragged, reducedMotion, skipAnimations, transition } = opts
  const configSkips = UndefinedOr.match(skipAnimations, { onUndefined: () => constFalse, onDefined: identity })
  return {
    id,
    element,
    transition: () => toLayoutTransition(transition()),
    // Its layout transition's Path (#438, ADR-0065), Motion's: the `layout` entry's, else the element's.
    // A layout animation of 20 px or more curves along it.
    path: () => UndefinedOr.map(transitionForKey(transition(), "layout"), (t) => t.path),
    // The layout transition's reduced-motion opt-out (ADR-0029, #301), read at each layout animation's start.
    respectReducedMotion: () =>
      UndefinedOr.match(transitionForKey(transition(), "layout"), { onUndefined: constTrue, onDefined: (t) => t.respectReducedMotion !== false }),
    // Whether reduced motion applies to it (#434): its subtree's, else the system's.
    ...UndefinedOr.match(reducedMotion, { onUndefined: () => ({}), onDefined: (applies) => ({ reducedMotion: applies }) }),
    // Whether its layout animations are skipped (#468): its subtree's, or its layout transition's own
    // `skipAnimations`, as Motion's projection runs on its layout transition. Read at each start.
    skipAnimations: () => Bool.or(configSkips(), layoutSkips(transition())),
    ...UndefinedOr.match(layoutId, { onUndefined: () => ({}), onDefined: (twinId) => ({ layoutId: twinId }) }),
    ...Bool.match(layoutScroll === true, { onTrue: () => ({ layoutScroll: true }), onFalse: () => ({}) }),
    ...Bool.match(layoutRoot === true, { onTrue: () => ({ layoutRoot: true }), onFalse: () => ({}) }),
    ...UndefinedOr.match(layoutAnchor, { onUndefined: () => ({}), onDefined: (anchor) => ({ layoutAnchor: anchor }) }),
    ...UndefinedOr.match(crossfade, { onUndefined: () => ({}), onDefined: (fades) => ({ crossfade: fades }) }),
    ...Bool.match(raiseWhileDragged === true, { onTrue: () => ({ raiseWhileDragged: true }), onFalse: () => ({}) }),
    ...UndefinedOr.match(dragTransition, { onUndefined: () => ({}), onDefined: (release) => ({ dragTransition: () => Option.some(release()) }) }),
    ...UndefinedOr.match(layoutMode, { onUndefined: () => ({}), onDefined: (mode) => ({ layoutMode: mode }) }),
    ...UndefinedOr.match(ownScale, { onUndefined: () => ({}), onDefined: (scale) => ({ ownScale: scale }) }),
    ...UndefinedOr.match(ownTranslate, { onUndefined: () => ({}), onDefined: (translate) => ({ ownTranslate: translate }) }),
    ...UndefinedOr.match(ownRotate, { onUndefined: () => ({}), onDefined: (rotate) => ({ ownRotate: rotate }) }),
    ...UndefinedOr.match(ownOpacity, { onUndefined: () => ({}), onDefined: (opacity) => ({ ownOpacity: opacity }) }),
    ...UndefinedOr.match(heldTransform, { onUndefined: () => ({}), onDefined: (held) => ({ heldTransform: held }) }),
    ...UndefinedOr.match(onBeforeMeasure, { onUndefined: () => ({}), onDefined: (before) => ({ onBeforeMeasure: before }) }),
    ...UndefinedOr.match(onMeasure, { onUndefined: () => ({}), onDefined: (measured) => ({ onMeasure: measured }) }),
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
  /** The id of the **Layout group** the ward was made in (#432), whose namespace its `layoutId` goes in. */
  readonly layoutGroup?: string | undefined
  /** Whether reduced motion applies to it now (ADR-0029): its nearest `WardicConfig`'s, else the provider's (#434). */
  readonly reducedMotion?: (() => boolean) | undefined
  /** Whether its animations are skipped now (#468): its nearest `WardicConfig`'s. */
  readonly skipAnimations?: (() => boolean) | undefined
  /** What a Measure pass holds its transform at (#443): its Transform template's, when it had one at mount. */
  readonly heldTransform?: (() => string) | undefined
}

/**
 * A ward's layout node options, from its config: `layoutId` (in its **Layout group**'s namespace,
 * #432), `layoutScroll`, `layoutRoot` and `layoutAnchor` read once, at mount; its transition, Layout
 * mode and callbacks read when the projection system needs them.
 */
export const layoutOptionsOf = (ward: WardLayout): UseLayoutMemberOptions => {
  const { config, element, id, parent, snapshot, dragTransition, raiseWhileDragged, taken, layoutGroup, reducedMotion, skipAnimations, heldTransform } = ward
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
    // And its own translate, which the renderer adds to its projection's (#363).
    ownTranslate: () => DomRenderer.ownTranslateOf(snapshot.values),
    // And its own rotate and opacity, which a handover blends into (ADR-0010 *Amendment (#166)*).
    ownRotate: () => DomRenderer.ownRotateOf(snapshot.values),
    ownOpacity: () => DomRenderer.ownOpacityOf(snapshot.values),
    // The app's layout animation callbacks, read when they fire (#191, ADR-0039).
    onLayoutAnimationStart: () => config().onLayoutAnimationStart,
    onLayoutAnimationComplete: () => config().onLayoutAnimationComplete,
    // The app's `onDragTransitionEnd` (#273): its Release offset at rest.
    onReleaseEnd: () => config().onDragTransitionEnd,
    // Whether a handover onto it crossfades (#442, Motion's `layoutCrossfade`), read as each begins.
    crossfade: () => config().layoutCrossfade !== false,
    ...UndefinedOr.match(layoutIdIn(layoutGroup, c0.layoutId), { onUndefined: () => ({}), onDefined: (twinId) => ({ layoutId: twinId }) }),
    ...Bool.match(c0.layoutScroll === true, { onTrue: () => ({ layoutScroll: true }), onFalse: () => ({}) }),
    ...Bool.match(c0.layoutRoot === true, { onTrue: () => ({ layoutRoot: true }), onFalse: () => ({}) }),
    ...UndefinedOr.match(c0.layoutAnchor, { onUndefined: () => ({}), onDefined: (anchor) => ({ layoutAnchor: anchor }) }),
    ...Bool.match(raiseWhileDragged, { onTrue: () => ({ raiseWhileDragged: true }), onFalse: () => ({}) }),
    ...takenOptionsOf(taken),
    ...UndefinedOr.match(reducedMotion, { onUndefined: () => ({}), onDefined: (applies) => ({ reducedMotion: applies }) }),
    ...UndefinedOr.match(skipAnimations, { onUndefined: () => ({}), onDefined: (skips) => ({ skipAnimations: skips }) }),
    // Its Transform template's hold for a Measure pass (#443): a node without one is cleared.
    ...UndefinedOr.match(heldTransform, { onUndefined: () => ({}), onDefined: (held) => ({ heldTransform: held }) }),
    // The app's layout measure callbacks (#443), read when each is called: a node whose config had
    // none at mount is given none, and pays nothing a pass.
    ...Bool.match(Predicate.isNotUndefined(c0.onBeforeLayoutMeasure), {
      onTrue: () => ({ onBeforeMeasure: () => UndefinedOr.map(config().onBeforeLayoutMeasure, (before) => before()) }),
      onFalse: () => ({}),
    }),
    ...Bool.match(Predicate.isNotUndefined(c0.onLayoutMeasure), {
      onTrue: () => ({ onMeasure: (box: Box.Box, prev: Box.Box | undefined) => UndefinedOr.map(config().onLayoutMeasure, (measured) => measured(box, prev)) }),
      onFalse: () => ({}),
    }),
  }
}

/** A take-over's layout start (#286), when its child took over from a leaver: its box and fade. */
const takenOptionsOf = (taken: PresenceSeed | undefined): Pick<UseLayoutMemberOptions, "enteredFrom" | "fadeFrom"> => {
  if (Predicate.isUndefined(taken)) return NONE
  return takeOverOf(taken.box, taken.fade)
}
