/**
 * The box-based projection system (ADR-0009) — the reusable DOM half of the
 * layout engine. It holds the projection nodes, the trigger sources, and the
 * Clock-driven coordinator that derives each node's transform every frame.
 *
 * It has NO framework reactivity: it reaches its host binding through two seams
 * only — a {@link ProjectionSink} (`write` per-element projection values into the
 * binding's flush gate + `flushPass` a Measure pass, applying its writes at once) and a
 * `ManagedRuntime` providing the Environment's {@link FrameLoop} (the coordinator is one
 * run on it, ADR-0027).
 * So it lives here in `@wardic/dom`, next to `ClockDomLive`/the Renderer, and any
 * binding (Solid today; React/vanilla later) wires it with its own gate + runtime.
 *
 * Pipeline (the locked design):
 *   - REGISTER a node (its gate `id`, `element`, and a `springOptions` accessor).
 *   - TRIGGER (registration / a shared `ResizeObserver` size change /
 *     `layoutDependency` via `notify`) -> ONE **Measure pass** per task, run by the
 *     engine in a microtask at the end of that task (ADR-0018).
 *   - MEASURE pass (through `sink.flushPass`, which applies what it wrote before
 *     returning): re-measure EVERY node's untransformed box (Q5); compute the
 *     projection TREE by DOM ancestry (each node's parent = the nearest ancestor
 *     ELEMENT that is a registered node); for each node that moved, set up an
 *     animation (origin + target) and seed the progress-0 frame; start the
 *     coordinator. A running node whose box didn't change is left alone. A trigger
 *     during the pass's own flush repeats it (at most 5 rounds). Every node the pass
 *     seeded takes its first step at the Frame loop's next tick, whose end flushes the
 *     gate, so it moves in that Refresh frame whatever the Clock's state (ADR-0033).
 *   - COORDINATOR (one run on the Environment's Frame loop while >=1 node animates,
 *     Q4; ADR-0027, #75): each tick steps every active node's progress spring, then
 *     `deriveAll()` walks the active nodes TOP-DOWN (ancestors first) computing
 *     each node's `projectionDelta` + `treeScale` via `applyTreeDeltas` over its
 *     animating ancestors' deltas, and writes the `@projection` value (the renderer
 *     assembles the transform). On settle it drops the node; when none remain the
 *     run settles and leaves the loop (idle = zero cost).
 *
 * DRAG (ADR-0016 and its *Amendment (#26)*): a dragged node follows the pointer through
 * its target (`grabBox + dragDelta`), and it and its subtree are drag-blocked: a
 * Measure pass updates their slots but starts no animation there, the dragged node is
 * its subtree's relative parent, and a resting descendant is left to ride the drag
 * through CSS. A pointer move re-derives the dragged group; the release is a FLIP from
 * the drag target to the latest slot, first stepped at the loop's next tick.
 *
 * Nesting: parent links come from a DOM-ancestry WALK (CSS composes by DOM
 * nesting, so that is exactly what projection must follow), and a child's box is
 * corrected for its ancestors' transforms via `applyTreeDeltas` (+ `treeScale`)
 * for nested SCALE. For nested layout, an animating child with a pure-translate
 * animating ancestor uses RELATIVE projection (`relativeParentOf` + `derive`): it
 * re-anchors to its `relativeParent`'s CURRENT target each frame, so it stays
 * glued even when parent and child run DIFFERENT transitions ("not left behind").
 */
import * as Box from "@wardic/core/Box"
import type * as Frame from "@wardic/core/Frame"
import type * as FrameLoop from "@wardic/core/FrameLoop"
import * as Microtask from "@wardic/core/Microtask"
import type * as Point from "@wardic/core/Point"
import * as Projection from "@wardic/core/Projection"
import * as Renderer from "@wardic/core/Renderer"
import * as Spring from "@wardic/core/Spring"
import * as Machine from "@wardic/core/Machine"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FiberHandle from "effect/FiberHandle"
import * as FiberSet from "effect/FiberSet"
import type * as ManagedRuntime from "effect/ManagedRuntime"
import * as Match from "effect/Match"
import { constFalse, constTrue, identity } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import {
  type Holdable,
  holdTransform,
  isHoldable,
  isScrollRoot,
  measureDocumentScroll,
  measureScroll,
  readLayoutBox,
  releaseTransforms,
  type ScrollStyle,
  scrollStyleFrom,
  type TransformHold,
  type TransformStyle,
  transformStyleFrom,
  transitionRunning,
} from "./measure.ts"
import { reportFailure } from "./report.ts"
import { isUnitScale, SCALE_CORRECTORS, type ScaleCorrector } from "./scale-correction.ts"

/**
 * The binding seam the coordinator writes through — structurally satisfied by the
 * binding's flush gate (e.g. `@wardic/solid`'s `FlushGate`), so the engine never
 * imports a framework. `write` merges a per-element projection value-map into the
 * gate (applied on the gate's next Refresh frame, ADR-0006); `flushPass` runs a
 * Measure pass now and applies exactly what it wrote before returning (ADR-0018),
 * so a new layout never paints without its projection.
 */
export interface ProjectionSink {
  readonly write: (id: string, partial: Record<string, unknown>) => void
  readonly flushPass: (pass: () => void) => void
}

/** How many pass -> flush rounds one Measure pass runs before the rest waits for the next task (ADR-0018). */
const MAX_ROUNDS = 5

/**
 * The runtime flavour the engine needs: a `ManagedRuntime` that can run the
 * coordinator on the Environment's {@link FrameLoop} (ADR-0027, #75) AND resolve the
 * `Renderer` (to drive a presence-retained leaving Follower whose gate registration
 * was torn down on owner disposal — ADR-0010). A binding's wider runtime (e.g. one
 * providing the full `WardicServices`) is assignable here.
 */
export type ProjectionRuntime = ManagedRuntime.ManagedRuntime<FrameLoop.FrameLoop | Renderer.Renderer, never>

/**
 * The coordinator's Frames on the Frame loop (#75). It carries no value, since its writes
 * are made inside its step, so its two Frames are built once and its sink does nothing.
 */
const COORDINATOR_RUNNING: Frame.Frame<void> = { value: undefined, done: false }
const COORDINATOR_SETTLED: Frame.Frame<void> = { value: undefined, done: true }
const ignoreFrame: FrameLoop.Sink<Frame.Frame<void>> = () => undefined

/** Identity tree-scale (no ancestor scaling). */
const TREE_SCALE_IDENTITY: Point.Point = { x: 1, y: 1 }

/** Default relative-projection anchor (top-left) when a node sets no `layoutAnchor` (ADR-0013). */
const ZERO_ANCHOR: Point.Point = { x: 0, y: 0 }

/** The resting projection delta — element at its real box (a no-op in applyTreeDeltas). */
const IDENTITY_DELTA: Projection.Delta = {
  x: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 },
  y: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 },
}

/**
 * Sub-pixel tolerance for box comparison. `getBoundingClientRect` returns
 * fractional values and the scroll-fold adds/subtracts offsets, so two boxes can
 * differ by float-arithmetic jitter well below a pixel without a real layout move.
 * Comparing within this epsilon (instead of strict `===`) keeps that jitter from
 * spuriously seeding a FLIP or blocking the unchanged-node skip.
 */
const BOX_EPSILON = 0.01

/** Structural equality of two boxes on the geometry that matters for a FLIP (within {@link BOX_EPSILON}). */
const boxesEqual = (a: Box.Box, b: Box.Box): boolean =>
  Math.abs(a.x.min - b.x.min) < BOX_EPSILON &&
  Math.abs(a.x.max - b.x.max) < BOX_EPSILON &&
  Math.abs(a.y.min - b.y.min) < BOX_EPSILON &&
  Math.abs(a.y.max - b.y.max) < BOX_EPSILON

/** Whether `b` moved by `shift` is `a`, within {@link BOX_EPSILON}, without building the moved box. */
const equalShifted = (a: Box.Box, b: Box.Box, shift: Point.Point): boolean =>
  Math.abs(a.x.min - b.x.min - shift.x) < BOX_EPSILON &&
  Math.abs(a.x.max - b.x.max - shift.x) < BOX_EPSILON &&
  Math.abs(a.y.min - b.y.min - shift.y) < BOX_EPSILON &&
  Math.abs(a.y.max - b.y.max - shift.y) < BOX_EPSILON

/** Translate a box by a point (ADR-0016: the dragged target is `grabBox + dragDelta`). */
const offsetBox = (box: Box.Box, delta: Point.Point): Box.Box => ({
  x: { min: box.x.min + delta.x, max: box.x.max + delta.x },
  y: { min: box.y.min + delta.y, max: box.y.max + delta.y },
})

/** The centre of a box. */
const centreOf = (box: Box.Box): Point.Point => ({ x: (box.x.min + box.x.max) / 2, y: (box.y.min + box.y.max) / 2 })

/**
 * `box`, in `node`'s frame, as `node`'s ancestors that aren't nodes paint it (ADR-0012,
 * *Amendment (#136)*). Unchanged when none of them moves it. Per frame for a Follower.
 */
const paintedOf = (node: NodeState, box: Box.Box): Box.Box => {
  if (Predicate.isUndefined(node.paintDelta)) return box
  return Projection.applyBoxDelta(box, node.paintDelta)
}

/** A box as painted, in `node`'s frame: the inverse of {@link paintedOf}. */
const unpaintedOf = (node: NodeState, box: Box.Box): Box.Box => {
  if (Predicate.isUndefined(node.unpaintDelta)) return box
  return Projection.applyBoxDelta(box, node.unpaintDelta)
}

/**
 * A box in twin `from`'s frame, in twin `to`'s (ADR-0012, *Amendment (#136)*): through
 * where it paints, so twins under different transforms meet on screen.
 */
const between = (from: NodeState, to: NodeState, box: Box.Box): Box.Box => unpaintedOf(to, paintedOf(from, box))

/** Whether two boxes have the same width and height (within {@link BOX_EPSILON}). */
const sameSize = (a: Box.Box, b: Box.Box): boolean =>
  Math.abs(a.x.max - a.x.min - (b.x.max - b.x.min)) < BOX_EPSILON &&
  Math.abs(a.y.max - a.y.min - (b.y.max - b.y.min)) < BOX_EPSILON

/** `box` resized to `size`'s width and height about its own centre. */
const resizeAboutCentre = (box: Box.Box, size: Box.Box): Box.Box => {
  const c = centreOf(box)
  const w = (size.x.max - size.x.min) / 2
  const h = (size.y.max - size.y.min) / 2
  return { x: { min: c.x - w, max: c.x + w }, y: { min: c.y - h, max: c.y + h } }
}

/** Options to register a layout element as a projection node. */
export interface RegisterNodeOptions {
  /** The element's gate id (shared with its spine — `@projection` writes merge there). */
  readonly id: string
  /** The live DOM element to measure + project. */
  readonly element: HTMLElement
  /**
   * The spring config for the node's progress (0→1) animation, read at each
   * (re)start. A tween-typed transition resolves to `{}` (spring defaults) — layout
   * is spring-shaped (framer-motion parity); the caller does that resolution.
   */
  readonly springOptions: () => Machine.SpringOptions
  /**
   * Whether the node's layout animations honour reduced motion (ADR-0029), read at each
   * (re)start: `false` animates them whatever the system's `reducedMotion` says (a binding's
   * per-transition opt-out). Default `true`.
   */
  readonly respectReducedMotion?: () => boolean
  /**
   * Shared-element match key (ADR-0010). Enrols the node in the per-`layoutId`
   * lead/follow stack so coexisting twins crossfade, and lets a twin disposed in the
   * same task seed its first measure (a Switch, *Amendment (#13)*). Omitted for a
   * plain `layout` node.
   */
  readonly layoutId?: string
  /**
   * Mark this element a scroll container that is itself a projection node (ADR-0012,
   * Motion's `layoutScroll`): its scroll offset is sampled at measure and folded out
   * of its descendants' boxes, so a scroll change BETWEEN triggers doesn't leak into
   * their FLIP delta, and as a `position: fixed` scroll root its style is read every
   * pass. Every other ancestor that can scroll is folded too, unmarked (*Amendment
   * (Reorder)*).
   */
  readonly layoutScroll?: boolean
  /**
   * Mark this element a stable projection sub-root (ADR-0013, Motion's `layoutRoot`):
   * it never FLIPs its own layout (self-snaps), bounds delta accumulation /
   * relativeParent search for its subtree, and is a persistent relative anchor.
   */
  readonly layoutRoot?: boolean
  /**
   * The anchor (0–1 per axis, ADR-0013, Motion's `layoutAnchor`) for this node's
   * RELATIVE projection — where in its relativeParent it anchors (default top-left
   * `{0,0}`). `false` opts out of relative projection (force absolute).
   */
  readonly layoutAnchor?: Point.Point | false
  /**
   * Raise the node while it's dragged (ADR-0016, *Amendment (Reorder)*): from the drag
   * start until its release settles (at once for a release in place) its projection
   * carries a raise the renderer emits as `z-index: 1`, so it paints above its
   * siblings, as Motion's Reorder items do; then one last write drops it. A
   * `<Reorder>` item sets it.
   */
  readonly raiseWhileDragged?: boolean
}

/**
 * The drag seam (ADR-0016): a draggable LAYOUT node drives its drag through the
 * projection target, not a raw `x`/`y` transform (the renderer ignores a layout
 * node's own `x`/`y` — the projection owns translate). The binding's drag track
 * calls these so the dragged element follows the pointer and FLIPs to its slot on
 * release. A subset of {@link ProjectionNodeHandle}.
 */
export interface DragProjectionHandle {
  /** Begin a drag: capture the grab-time slot box as the pointer anchor; hold the node active. */
  readonly dragStart: () => void
  /**
   * The live pointer translate from the grab point — the node tracks `grabBox + delta`.
   * Re-derives the dragged group into the sink at once, so the gate's next flush paints it.
   */
  readonly dragMove: (delta: Point.Point) => void
  /** End the drag: FLIP from the dragged position to the node's latest slot, from the loop's next tick. */
  readonly dragEnd: () => void
}

/** Handle returned from {@link ProjectionSystem.register}. */
export interface ProjectionNodeHandle extends DragProjectionHandle {
  /** Request a (coalesced) measure pass — e.g. this node's `layoutDependency` changed. */
  readonly notify: () => void
  /**
   * The node's slot (its layout box) in the Scroll-stable frame, as of its last
   * Measure pass; `undefined` before the first (ADR-0016, *Amendment (Reorder)*). A
   * plain read: no layout read.
   */
  readonly layoutBox: () => Box.Box | undefined
  /**
   * How far the node paints from its slot while dragged (the drag target minus the
   * slot, per axis); `{ x: 0, y: 0 }` otherwise, the release flight included.
   */
  readonly dragOffset: () => Point.Point
  /**
   * A count that rises with every Measure pass round that measures the node (a
   * blocked one included); 0 before the first. A **Reorder group** waits on it after
   * a reorder, as on Motion's former `layoutVersion` counter (removed in motion-dom
   * 13.4.5).
   */
  readonly layoutVersion: () => number
  /** Unregister the node, finalising any in-flight animation. */
  readonly dispose: () => void
}

/** The provider-owned projection system. */
export interface ProjectionSystem {
  readonly register: (opts: RegisterNodeOptions) => ProjectionNodeHandle
  /**
   * Request a (coalesced) re-measure of the WHOLE tree (Q5). Used by a
   * group-level trigger such as `<LayoutGroup layoutDependency>` — any one trigger
   * re-measures every node, so sibling reflow falls out.
   */
  readonly notify: () => void
  /**
   * Shared-element exit coupling (ADR-0010). A binding's presence layer calls this
   * for a leaving `layoutId` element it has RETAINED (kept in the DOM mid-exit).
   * Returns `true` if there is a live twin (Lead) to crossfade toward — the engine
   * then drives `el` as a transient leaving Follower (locked onto the lead, fading
   * out, driven directly via the Renderer since its gate registration is gone) and
   * calls `onDone` once the crossfade settles, so presence removes the DOM node.
   * Returns `false` for a lone leave (no twin) — presence runs its normal `exit`.
   *
   * A method on the shared engine (the binding already holds it), NOT a service:
   * the flow is unidirectional (presence → engine), and `onDone` is the only
   * callback back. Presence keeps ADR-0007 ownership of retention + DOM removal.
   */
  readonly handleLeave: (el: HTMLElement, onDone: () => void) => boolean
  /** Stop the coordinator's run + tear down the observer (wired into the provider's onCleanup). */
  readonly dispose: () => void
}

/** Per-node mutable state held by the system. */
interface NodeState {
  readonly id: string
  readonly element: HTMLElement
  readonly springOptions: () => Machine.SpringOptions
  /** Whether the node's layout animations honour reduced motion, read at each (re)start (ADR-0029). */
  readonly respectReducedMotion: () => boolean
  /** Shared-element match key (ADR-0010), or `undefined` for a plain layout node. */
  readonly layoutId: string | undefined
  /**
   * The Switch seed handed to this node (ADR-0010 *Amendment (#13)*): a disposed
   * twin's box in the **Root frame**, taken from the per-`layoutId` hold at
   * registration or handed over directly by a twin disposed before this node's
   * first measure. Consumed (and cleared) by that first measure, which rebases it
   * into this node's Scroll-stable frame. `undefined` otherwise.
   */
  seed: Box.Box | undefined
  /**
   * How this `layoutId` node's ancestors that aren't nodes paint it, at its last pass
   * (ADR-0012, *Amendment (#136)*): the delta from its box (which carries no transform)
   * to the box as painted, and back. Twins are compared as painted, each converted
   * through its own. `undefined` when no such ancestor moves it, or for a plain node.
   */
  paintDelta: Projection.Delta | undefined
  unpaintDelta: Projection.Delta | undefined
  /**
   * This node's box as its last pass read it, with its ancestors' transforms still on
   * (ADR-0012, *Amendment (#136)*). A pass that reads the same knows nothing moved the
   * node, layout or transform, and keeps its stored box without reading what's above it.
   */
  seenBox: Box.Box | undefined
  /** Marked a scroll container (ADR-0012): its scroll is sampled + folded out of descendants. */
  readonly isScroll: boolean
  /** This scroll container's offset, sampled at measure (`{0,0}` for a non-scroll node). */
  scroll: Point.Point
  /** Whether this (scroll) node is `position: fixed` — a scroll root (resets the fold). */
  isScrollRoot: boolean
  /** The scroll folded out of this node's box at its last pass (ADR-0012): see {@link Fold}. */
  fold: Fold
  /** Whether this (plain) node's element is `position: fixed`, read once; `undefined` until then. */
  ownFixed: boolean | undefined
  /** How many Measure pass rounds have measured this node (the handle's `layoutVersion`). */
  layoutVersion: number
  /** Whether the node is raised while dragged (its `raiseWhileDragged` option). */
  readonly raiseWhileDragged: boolean
  /** Whether its projection carries the raise now: from its drag start until its release settles. */
  raised: boolean
  /** Marked a stable projection sub-root (ADR-0013): self-snaps, bounds the subtree, persistent relativeParent. */
  readonly layoutRoot: boolean
  /** This node's relative-projection anchor (ADR-0013): a 0–1 Point, or `false` to force absolute. */
  readonly layoutAnchor: Point.Point | false | undefined
  /** Last measured untransformed box (the FLIP "First"); `undefined` until first measure. */
  retained: Box.Box | undefined
  /** Where the element appears at progress 0 (the box it animates FROM). */
  origin: Box.Box | undefined
  /** The element's real (current measured) box — the delta source + progress-1 target. */
  layoutBox: Box.Box | undefined
  /** Progress (0→1) spring state; `undefined` at rest. */
  spring: Spring.State | undefined
  animating: boolean
  // --- tree (recomputed each measure pass via DOM-ancestry walk) ---
  /** Nearest ancestor projection node, or `undefined` at the root. */
  parent: NodeState | undefined
  /** Number of ancestor projection nodes (for top-down ordering). */
  depth: number
  /** This frame's projection delta — read by descendants for applyTreeDeltas; identity at rest. */
  lastDelta: Projection.Delta
  /** This frame's viewport target box — read by a child using this node as its relativeParent. */
  lastTarget: Box.Box | undefined
  /**
   * A presence-retained LEAVING Follower (ADR-0010): it crossfades out toward the
   * Lead and is removed on the lead's settle. `dispose` SKIPS a leaving node (the
   * {@link finishLeaver} lifecycle owns its removal); its `@projection` is driven
   * directly via the Renderer (its gate registration is gone).
   */
  leaving: boolean
  /** Called once the leaving Follower's crossfade settles → presence removes the DOM node. */
  onLeaveDone: (() => void) | undefined
  /**
   * Scale-correctable base values read at measure (ADR-0011) — the non-trivial
   * `border-radius`/`box-shadow` correctors for this element, or `undefined`/empty
   * if it has nothing to correct.
   */
  correctorBases: ReadonlyArray<{ readonly corrector: ScaleCorrector; readonly base: unknown }> | undefined
  /** Whether a corrected style is currently applied (so it's restored once at rest). */
  corrected: boolean
  // --- drag (ADR-0016) ---
  /** Whether this node is being dragged: its target follows the pointer (no spring), held active. */
  dragging: boolean
  /**
   * The slot box captured at drag start — the pointer anchor; the target is `grabBox +
   * dragDelta`, at the current slot's size about its centre (see {@link dragTargetOf}).
   */
  grabBox: Box.Box | undefined
  /** The live pointer translate from the grab point (zero when not dragging). */
  dragDelta: Point.Point
  /**
   * Whether this node's FLIP is a drag's release (set by `dragEnd`, cleared when it
   * settles or the node is grabbed again): it stays its subtree's relative parent
   * until then, as while dragged, so the whole subtree flies back with it.
   */
  releasing: boolean
}

/**
 * A just-disposed `layoutId` node's content-frame box, kept until the end of the
 * current task so a presence `handleLeave` arriving AFTER dispose can re-introduce
 * the element as a leaving Follower (ADR-0010). `reintroduced` records whether it did.
 */
interface RecentLeaver {
  readonly layoutId: string
  readonly box: Box.Box
  /** The leaver's paint deltas at its last pass, for the leaving Follower it may become (#136). */
  readonly paintDelta: Projection.Delta | undefined
  readonly unpaintDelta: Projection.Delta | undefined
  reintroduced: boolean
}

/**
 * A disposed twin's Switch seed, in the **Root frame**, held per `layoutId` until
 * the end of the current task (ADR-0010 *Amendment (#13)*). `consumed` records
 * whether an enterer picked it up at registration.
 */
interface HeldSeed {
  readonly box: Box.Box
  consumed: boolean
}

/** The origin point: no scroll to add. */
const ZERO_POINT: Point.Point = { x: 0, y: 0 }

/** A container whose scroll is folded out of a node's box, and its scroll at that pass. */
interface FoldedContainer {
  readonly element: HTMLElement
  readonly scroll: Point.Point
}

/**
 * The scroll folded out of a node's box (ADR-0012, *Amendment (Reorder)*): every
 * container between it and the page that can scroll, nearest first, with their summed
 * scroll, up to the first `position: fixed` element (a scroll root: nothing outside it
 * folds), and whether the page's scroll folds too (no scroll root on the way).
 */
interface Fold {
  readonly containers: ReadonlyArray<FoldedContainer>
  readonly x: number
  readonly y: number
  readonly root: boolean
}

/** No container, the page's scroll folds: a node at the top level. */
const ROOT_FOLD: Fold = { containers: [], x: 0, y: 0, root: true }
/** Nothing folds: a node that is itself, or sits right under, a scroll root. */
const NO_FOLD: Fold = { containers: [], x: 0, y: 0, root: false }

/** Each system's pass-end listeners ({@link onPassEnd}). */
const passEnds = new WeakMap<ProjectionSystem, Set<() => void>>()

/**
 * Run `listener` at the end of every Measure pass of `system`: once per pass, after
 * every round's boxes are stored (a blocked pass and one whose flush triggered more
 * rounds included). Returns the unsubscribe. A listener that
 * throws is logged and doesn't stop the pass or the others.
 *
 * @internal for the Reorder controller (ADR-0020): not exported from `@wardic/dom`, so
 * there is no public push hook (ADR-0020 decision 2).
 */
export const onPassEnd = (system: ProjectionSystem, listener: () => void): (() => void) => {
  const listeners = passEnds.get(system)
  if (listeners === undefined) return () => {}
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** {@link makeProjectionSystem}'s options. */
export interface ProjectionSystemOptions {
  /**
   * Whether reduced motion applies now (ADR-0029), read when a layout animation starts: the
   * binding's `ReducedMotion.applies` of its app's setting and the user's preference. Under it,
   * a layout animation lands on its new box at once, and a crossfade switches at once; a drag's
   * release still returns to its slot, since it continues the gesture (as Motion's does). By
   * default, never.
   */
  readonly reducedMotion?: () => boolean
}

/**
 * Build a projection system against a binding's `runtime` (providing its
 * {@link FrameLoop}) and its {@link ProjectionSink} (its flush gate).
 *
 * Runs the coordinator on `runtime`'s Frame loop; the binding disposes the system in
 * its own teardown (e.g. the provider's `onCleanup`).
 */
export const makeProjectionSystem = (
  runtime: ProjectionRuntime,
  sink: ProjectionSink,
  options: ProjectionSystemOptions = {},
): ProjectionSystem => {
  const reducedMotion = UndefinedOr.match(options.reducedMotion, { onUndefined: () => constFalse, onDefined: identity })
  /**
   * A layout animation's progress spring, at its (re)start: at 0, or, when reduced motion
   * applies to `node` (ADR-0029), at 1 and at rest, so the node lands on its new box at once
   * and the spring settles on its first step.
   */
  const startSpring = (node: NodeState): Spring.State =>
    Spring.init({
      from: Bool.match(Bool.and(node.respectReducedMotion(), reducedMotion()), { onTrue: () => 1, onFalse: () => 0 }),
    })
  // {@link onPassEnd}'s listeners, run at the end of each Measure pass.
  const passEndListeners = new Set<() => void>()
  const nodes = new Set<NodeState>()
  const active = new Set<NodeState>()
  // Element -> node, for the DOM-ancestry parent walk.
  const elementToNode = new Map<HTMLElement, NodeState>()
  // Per-`layoutId` mount-order stack (ADR-0010): the newest live node is the Lead,
  // the rest are Followers. Crossfade is driven engine-side off this stack.
  const stacks = new Map<string, Array<NodeState>>()
  // One shared ResizeObserver for size triggers (created lazily; happy-dom/SSR-safe).
  let ro: ResizeObserver | undefined
  // A just-disposed `layoutId` node's box, so a presence `handleLeave` arriving
  // AFTER dispose can re-introduce it as a leaving Follower (cleared at the end of
  // the task, by the leaver's `endOfTask` hold).
  const recentLeavers = new Map<HTMLElement, RecentLeaver>()
  // A disposed twin's Switch seed per `layoutId`, in the Root frame, until the end of
  // the task (ADR-0010 *Amendment (#13)*). An enterer registering within the task
  // takes it; a twin already registered but unmeasured gets it handed over directly.
  // Plain `Map`s keyed by string / element identity — nothing here is Effect-hashed.
  const heldSeeds = new Map<string, HeldSeed>()
  // The end-of-task hold fibers. A `FiberSet` (a native `Set`, reference identity)
  // inside a Scope the system owns: disposing the system closes it, interrupting any
  // hold still pending.
  const scope = Scope.makeUnsafe()
  const taskFibers = runtime.runSync(FiberSet.make<void, never>().pipe(Scope.provide(scope)))
  // The coordinator's run on the Frame loop (#75): at most one, from the first node that
  // animates until none does. In the same Scope, so disposing the system interrupts it.
  const coordinator = runtime.runSync(FiberHandle.make<void, never>().pipe(Scope.provide(scope)))
  // Whether the coordinator's step is running: a stop from inside it settles the run.
  let inStep = false
  // The Measure pass (ADR-0018): whether one is queued for the end of this task,
  // whether one is running its rounds (a trigger then repeats it), whether a trigger
  // arrived during the current round, and the next-task leftover past the round cap.
  let passQueued = false
  let inPass = false
  let triggeredDuringPass = false
  let leftover: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  // The Resize block (ADR-0018 *Amendment (#39)*): the window width last seen, whether
  // the next Measure pass is blocked, and the timer that runs it if nothing else does.
  let resizeListening = false
  let lastWidth = 0
  let resizeBlocked = false
  let resizeTimer: ReturnType<typeof setTimeout> | undefined

  // The Renderer's pure halves, resolved once (like the gate) — used to drive a
  // presence-retained leaving Follower DIRECTLY (its gate registration is gone).
  const renderer = runtime.runSync(
    Effect.gen(function* () {
      return yield* Renderer.Renderer
    }),
  )

  /**
   * Emit a debug-level lifecycle log on a COLD path (register / dispose / leave /
   * coordinator start-stop / measure summary). Forked on the runtime so the calling
   * sync path (a gate callback / `onCleanup`) isn't blocked, and filtered out unless
   * the logger is at Debug (observability convention: `wardic.*` + annotated debug
   * logs on lifecycle; the per-frame derive/step hot path stays SILENT).
   */
  const debug = (event: string, annotations?: Record<string, unknown>): void => {
    runtime.runFork(
      annotations !== undefined
        ? Effect.logDebug(`wardic.projection: ${event}`).pipe(Effect.annotateLogs(annotations))
        : Effect.logDebug(`wardic.projection: ${event}`),
    )
  }

  /**
   * Run `expire` at the end of the current task — the next microtask checkpoint,
   * before any timer, frame or later task — on a traced, interruptible fiber
   * (ADR-0010 *Amendment (#13)*, option a′). `runFork` evaluates the fiber
   * synchronously up to `Microtask.next`, whose `queueMicrotask` resumes it
   * synchronously inside that microtask — no trip through the Effect scheduler, so
   * the window ends at the same checkpoint in browsers, React Native and the test
   * harness. Keep `expire` synchronous: a `yieldNow` or a child fork before it would
   * move the end of the window onto the scheduler (`setTimeout(0)` in browsers).
   * `expire` returns the outcome attributes, annotated onto `span` before it ends.
   */
  const endOfTask = (
    span: string,
    attributes: Record<string, unknown>,
    expire: () => Record<string, unknown>,
  ): void => {
    FiberSet.addUnsafe(
      taskFibers,
      runtime.runFork(
        Microtask.next.pipe(
          Effect.map(expire),
          Effect.flatMap((outcome) => Effect.annotateCurrentSpan(outcome)),
          Effect.tapCause((cause) => reportFailure(`wardic.projection: ${span} failed`, cause)),
          Effect.withSpan(span, { attributes }),
        ),
      ),
    )
  }

  /**
   * Write a node's per-frame `@projection` value (Option A) plus any scale-corrected
   * style keys (ADR-0011). The optional `opacity` is the crossfade factor (ADR-0010)
   * the renderer multiplies with the user opacity; omitted for a non-crossfading node
   * so it passes through (a fresh `Projection.Value` REPLACES the gate's `@projection`,
   * dropping any stale factor). `corrected` (e.g. `{ borderRadius, boxShadow }`) flows
   * as ordinary style keys the renderer applies verbatim.
   *
   * A LEAVING Follower is gate-unregistered (its owner was disposed), so it is
   * driven directly via the Renderer onto the retained element instead of the gate.
   */
  const writeProjection = (
    node: NodeState,
    delta: Projection.Delta,
    treeScale: Point.Point,
    opacity?: number,
    corrected?: Record<string, string>,
  ): void => {
    const value: Projection.Value = node.raised
      ? opacity !== undefined ? { delta, treeScale, opacity, raise: 1 } : { delta, treeScale, raise: 1 }
      : opacity !== undefined
      ? { delta, treeScale, opacity }
      : { delta, treeScale }
    const patch = corrected !== undefined ? { [Projection.KEY]: value, ...corrected } : { [Projection.KEY]: value }
    if (node.leaving) {
      renderer.commit(node.element, renderer.project(patch))
    } else {
      sink.write(node.id, patch)
    }
  }

  /** Read this element's non-trivial scale-correction bases (ADR-0011), measure phase. */
  const readBases = (el: HTMLElement): NodeState["correctorBases"] => {
    const out: Array<{ corrector: ScaleCorrector; base: unknown }> = []
    for (const corrector of SCALE_CORRECTORS) {
      const base = corrector.read(el)
      if (base !== undefined) out.push({ corrector, base })
    }
    return out
  }

  /**
   * The scale-corrected style keys for `node` at the per-axis visual scale `(sx,sy)`
   * (ADR-0011), or `undefined` when there is nothing to write. At unit scale a
   * previously-corrected node is restored to its base ONCE (then nothing) so no
   * stale correction lingers and rest stays zero-cost.
   */
  const correctionsFor = (node: NodeState, sx: number, sy: number): Record<string, string> | undefined => {
    const bases = node.correctorBases
    if (bases === undefined || bases.length === 0) return undefined
    if (isUnitScale(sx, sy)) {
      if (!node.corrected) return undefined
      node.corrected = false
      const out: Record<string, string> = {}
      for (const { corrector, base } of bases) out[corrector.key] = corrector.correct(base, 1, 1)
      return out
    }
    node.corrected = true
    const out: Record<string, string> = {}
    for (const { corrector, base } of bases) out[corrector.key] = corrector.correct(base, sx, sy)
    return out
  }

  /** The Lead of `layoutId` — the newest live node in its stack — or undefined. */
  const leadOf = (layoutId: string): NodeState | undefined => {
    const stack = stacks.get(layoutId)
    return stack !== undefined && stack.length > 0 ? stack[stack.length - 1] : undefined
  }

  /** The node directly below `node` in its stack (the prior Lead it crossfades from), or undefined. */
  const priorLeadOf = (node: NodeState): NodeState | undefined => {
    if (node.layoutId === undefined) return undefined
    const stack = stacks.get(node.layoutId)
    if (stack === undefined) return undefined
    const i = stack.indexOf(node)
    return i > 0 ? stack[i - 1] : undefined
  }

  /** Whether `node` is a Follower: in a `layoutId` stack but NOT its (newest-live) Lead. */
  const isFollower = (node: NodeState): boolean =>
    node.layoutId !== undefined && leadOf(node.layoutId) !== node

  /** The crossfade factor for a LEAD (its own progress) — only when it has Followers; else undefined. */
  const leadOpacity = (node: NodeState): number | undefined => {
    if (node.layoutId === undefined) return undefined
    const stack = stacks.get(node.layoutId)
    if (stack === undefined || stack.length < 2 || stack[stack.length - 1] !== node) return undefined
    return node.spring !== undefined ? node.spring.position : 1 // mix(0,1,progress)
  }

  /**
   * This node's ancestor projection deltas, ROOT-FIRST. Every projection-node
   * ancestor is included; a resting (or settled) ancestor holds an identity delta,
   * which is a no-op in applyTreeDeltas — so this is the cumulative ancestor
   * transform that CSS nesting applies to the node.
   */
  const ancestorDeltas = (node: NodeState): Array<Projection.Delta> => {
    const chain: Array<Projection.Delta> = []
    let p = node.parent
    while (p !== undefined) {
      chain.push(p.lastDelta)
      if (p.layoutRoot) break // accumulation boundary (ADR-0013): a layoutRoot is the sub-root
      p = p.parent
    }
    chain.reverse()
    return chain
  }

  /**
   * Whether any ancestor is animating its own FLIP (so this node is "carried" + must
   * counter-correct). A dragged ancestor doesn't count: its transform is where the user
   * put it, not a FLIP to undo, so a resting descendant keeps its identity projection
   * and CSS carries it with the drag (ADR-0016 *Amendment (#26)*; Motion projects no
   * resting node, create-projection-node.ts:1262, :1484-1498 at 16c6122).
   */
  const hasActiveAncestor = (node: NodeState): boolean => {
    let p = node.parent
    while (p !== undefined) {
      if (active.has(p) && !p.dragging) return true
      if (p.layoutRoot) return false // boundary (ADR-0013): ancestors above a layoutRoot don't carry this node
      p = p.parent
    }
    return false
  }

  /**
   * The node's relativeParent (ADR-0009/0013, Motion's getClosestProjectingParent):
   * the nearest ANIMATING ancestor (any scale — the {@link layoutAnchor} makes
   * relative-through-a-scaled-parent sound, ADR-0013), OR a `layoutRoot` ancestor
   * (a persistent relative anchor + boundary, even at rest). A child re-anchors to
   * its relativeParent's CURRENT target each frame, so it stays glued even when
   * parent and child run DIFFERENT transitions ("not left behind"). `layoutAnchor:
   * false` opts the node out (it then projects ABSOLUTELY), except under a dragged
   * ancestor: a dragged node (and one flying back from its release) is the relative
   * parent of its whole subtree, so everything in it rides the drag (ADR-0016
   * *Amendment (#26)*).
   */
  const relativeParentOf = (node: NodeState): NodeState | undefined => {
    let p = node.parent
    while (p !== undefined) {
      if ((p.dragging || p.releasing) && p.layoutBox !== undefined) return p
      if (node.layoutAnchor === false) {
        // Opted out (Motion's layoutAnchor !== false gate): only a dragged ancestor,
        // below the next layoutRoot boundary, anchors it.
        if (p.layoutRoot) return undefined
      } else {
        // A layoutRoot is a persistent relative anchor AND the boundary — stop here.
        if (p.layoutRoot) return p.layoutBox !== undefined ? p : undefined
        if (active.has(p) && p.animating && p.origin !== undefined && p.layoutBox !== undefined) return p
      }
      p = p.parent
    }
    return undefined
  }

  /**
   * A dragged node's target: its grab box moved by the pointer delta (ADR-0016 Q3a). If
   * its slot has since changed size, the target takes the slot's size about the same
   * centre, so the node paints its new size under the pointer instead of being scaled
   * back to its grab size (Motion shifts a dragged node by the layout delta measured at
   * the centre, VisualElementDragControls.ts:742-759, delta-calc.ts:24-36).
   */
  const dragTargetOf = (node: NodeState, slot: Box.Box): Box.Box => {
    const moved = offsetBox(node.grabBox!, node.dragDelta)
    return sameSize(moved, slot) ? moved : resizeAboutCentre(moved, slot)
  }

  /**
   * Derive + write one node's projection for the current frame.
   *   - ANIMATING with a (pure-translate) animating relativeParent: RELATIVE —
   *     mix the child's offset-within-parent (before→after) and PLACE it into the
   *     parent's CURRENT target, so it tracks the parent regardless of progress.
   *   - ANIMATING with no relativeParent: ABSOLUTE — mix its own viewport box.
   *   - CARRIED (own box unchanged, ancestor animating): target its real box, so
   *     applyTreeDeltas yields the counter-transform that keeps it visually put.
   * In every case applyTreeDeltas supplies treeScale + the ancestor-transform
   * correction, and `delta = calcBoxDelta(layoutCorrected, targetBox)`.
   */
  const derive = (node: NodeState): void => {
    const box = node.layoutBox ?? node.retained
    if (box === undefined) return

    // DRAGGING (ADR-0016): the target is the pointer's visual position — the grab-time
    // slot translated by the live pointer delta. Anchored at `grabBox` (not the current
    // `layoutBox`), so a mid-drag reorder that moves the slot keeps the item under the
    // pointer (the delta just recomputes against the new layoutBox). No spring.
    if (node.dragging && node.grabBox !== undefined) {
      const targetBox = dragTargetOf(node, box)
      const { box: layoutCorrected, treeScale } = Projection.applyTreeDeltas(box, ancestorDeltas(node))
      const delta = Projection.calcBoxDelta(layoutCorrected, targetBox)
      node.lastTarget = targetBox
      node.lastDelta = delta
      const corrected = correctionsFor(node, delta.x.scale * treeScale.x, delta.y.scale * treeScale.y)
      writeProjection(node, delta, treeScale, leadOpacity(node), corrected)
      return
    }

    const rp = relativeParentOf(node)
    let targetBox: Box.Box
    if (rp !== undefined && rp.layoutBox !== undefined && rp.lastTarget !== undefined) {
      // RELATIVE: track the relativeParent (any scale, ADR-0013) at the node's
      // `layoutAnchor` (default top-left). Use the node's OWN progress while it
      // animates; once settled — or for a carried child — it sits at its final
      // relative offset and KEEPS tracking the parent (a fast child doesn't detach
      // from a slow one). For a static `layoutRoot` relativeParent (no own
      // animation), the parent's "from" box is just its layout box.
      const anchor = node.layoutAnchor !== false && node.layoutAnchor !== undefined ? node.layoutAnchor : ZERO_ANCHOR
      const rpFromBox = rp.origin ?? rp.layoutBox
      const progress = node.animating && node.spring !== undefined ? node.spring.position : 1
      const relFrom =
        node.origin !== undefined ? Projection.calcRelativeBox(node.origin, rpFromBox, anchor) : Projection.calcRelativeBox(box, rp.layoutBox, anchor)
      const relTo = Projection.calcRelativeBox(box, rp.layoutBox, anchor)
      const relTarget = Box.mix(relFrom, relTo, progress)
      targetBox = Projection.placeRelativeBox(relTarget, rp.lastTarget, anchor)
    } else if (node.animating && node.origin !== undefined && node.spring !== undefined) {
      // ABSOLUTE: own viewport interpolation (no animating pure-translate ancestor).
      targetBox = Box.mix(node.origin, box, node.spring.position)
    } else {
      // CARRIED under a SCALED ancestor / at rest: target the real box — applyTreeDeltas
      // supplies the counter-transform.
      targetBox = box
    }

    const { box: layoutCorrected, treeScale } = Projection.applyTreeDeltas(box, ancestorDeltas(node))
    // delta source is the element's REAL box pushed through ancestor transforms;
    // target is where it should appear.
    const delta = Projection.calcBoxDelta(layoutCorrected, targetBox)
    node.lastTarget = targetBox
    node.lastDelta = delta
    // A Lead with Followers carries the crossfade factor (fades IN over its own
    // progress); otherwise none (a plain/switch node — user opacity passes through).
    // Scale-correct border-radius/box-shadow at the true visual scale (ADR-0011).
    const corrected = correctionsFor(node, delta.x.scale * treeScale.x, delta.y.scale * treeScale.y)
    writeProjection(node, delta, treeScale, leadOpacity(node), corrected)
  }

  /**
   * Derive a FOLLOWER (ADR-0010): lock it onto its Lead's CURRENT target box (so it
   * overlaps the lead) and fade it OUT over the lead's progress. Run AFTER the lead
   * (pass 2 of {@link deriveAll}) so `lead.lastTarget` is fresh; lead and follower
   * can live in unrelated subtrees, so this is NOT tree-depth ordered. `treeScale` +
   * the ancestor correction still apply to the follower's OWN box.
   */
  const deriveFollower = (node: NodeState): void => {
    if (node.layoutId === undefined) return
    const lead = leadOf(node.layoutId)
    if (lead === undefined || lead === node || lead.lastTarget === undefined) return
    const box = node.layoutBox ?? node.retained
    if (box === undefined) return
    const { box: layoutCorrected, treeScale } = Projection.applyTreeDeltas(box, ancestorDeltas(node))
    // Lock onto the lead's box, where it paints (#136): the two may sit under different transforms.
    const target = between(lead, node, lead.lastTarget)
    const delta = Projection.calcBoxDelta(layoutCorrected, target)
    node.lastTarget = target
    node.lastDelta = delta
    const progress = lead.spring !== undefined ? lead.spring.position : 1
    const corrected = correctionsFor(node, delta.x.scale * treeScale.x, delta.y.scale * treeScale.y)
    writeProjection(node, delta, treeScale, 1 - progress, corrected) // follower fades out: mix(1,0,progress)
  }

  /**
   * Two-pass derive (ADR-0010):
   *   1. Leads + plain nodes (animating or carried by an animating ancestor),
   *      TOP-DOWN by tree depth — a child reads its ancestors' fresh `lastDelta`.
   *   2. Followers — lock onto their (now-derived) Lead's fresh `lastTarget`.
   * A Follower is derived only WHILE its Lead is active (idle = zero cost: a settled
   * Follower holds its last hidden-locked `@projection` write in the gate).
   */
  const deriveAll = (): void => {
    const leads: Array<NodeState> = []
    const followers: Array<NodeState> = []
    for (const n of nodes) {
      if (isFollower(n)) {
        const lead = n.layoutId !== undefined ? leadOf(n.layoutId) : undefined
        if (lead !== undefined && active.has(lead)) followers.push(n)
      } else if (active.has(n) || hasActiveAncestor(n)) {
        leads.push(n)
      }
    }
    leads.sort((a, b) => a.depth - b.depth)
    for (const node of leads) derive(node)
    for (const node of followers) deriveFollower(node)
  }

  /**
   * Whether `node` is in a dragged subtree: it or an ancestor is being dragged. Such a
   * node is drag-blocked: a Measure pass starts or restarts no animation on it (Motion's
   * `isTreeAnimationBlocked`, create-projection-node.ts:633-639 at 16c6122).
   */
  const inDraggedTree = (node: NodeState): boolean => {
    for (let p: NodeState | undefined = node; p !== undefined; p = p.parent) if (p.dragging) return true
    return false
  }

  /** Whether `node` is a descendant of `ancestor`. */
  const isDescendantOf = (node: NodeState, ancestor: NodeState): boolean => {
    for (let p = node.parent; p !== undefined; p = p.parent) if (p === ancestor) return true
    return false
  }

  /** Whether an ancestor of `node` (up to and including a `layoutRoot` boundary) is in `changed`. */
  const hasChangedAncestor = (node: NodeState, changed: ReadonlySet<NodeState>): boolean => {
    for (let p = node.parent; p !== undefined; p = p.parent) {
      if (changed.has(p)) return true
      if (p.layoutRoot) return false
    }
    return false
  }

  /**
   * The nodes whose projection a Measure pass changes (ADR-0018): for each node it
   * (re)seeded, the whole subtree of that node's highest RUNNING ancestor (or of the
   * node itself). A seed is derived against its ancestors' deltas, so the node and
   * everything sharing those deltas must paint together. That includes the climb
   * past a `layoutRoot`: a layoutRoot under a running ancestor is derived each frame
   * to counter that ancestor's transform, so a node seeded inside it still depends on
   * the ancestor. Every other node keeps the value its last Clock tick wrote: a
   * running animation elsewhere is left alone.
   */
  const groupOf = (changed: ReadonlySet<NodeState>): Set<NodeState> => {
    const group = new Set<NodeState>()
    if (changed.size === 0) return group
    const roots = new Set<NodeState>()
    for (const node of changed) {
      let root = node
      for (let p = node.parent; p !== undefined; p = p.parent) if (active.has(p)) root = p
      roots.add(root)
    }
    for (const node of nodes) {
      for (let p: NodeState | undefined = node; p !== undefined; p = p.parent) {
        if (roots.has(p)) {
          group.add(node)
          break
        }
      }
    }
    return group
  }

  /** {@link deriveAll}, restricted to `group`: its leads top-down, then the followers of its active leads. */
  const deriveGroup = (group: ReadonlySet<NodeState>): void => {
    if (group.size === 0) return
    const leads: Array<NodeState> = []
    const followers: Array<NodeState> = []
    for (const n of nodes) {
      if (isFollower(n)) {
        const lead = n.layoutId !== undefined ? leadOf(n.layoutId) : undefined
        if (lead !== undefined && active.has(lead) && group.has(lead)) followers.push(n)
      } else if (group.has(n) && (active.has(n) || hasActiveAncestor(n))) {
        leads.push(n)
      }
    }
    leads.sort((a, b) => a.depth - b.depth)
    for (const node of leads) derive(node)
    for (const node of followers) deriveFollower(node)
  }

  /** Recompute parent links + depth for every node by walking DOM ancestry. */
  const computeTree = (): void => {
    for (const node of nodes) {
      let el: HTMLElement | null = node.element.parentElement
      let parent: NodeState | undefined
      while (el !== null) {
        const candidate = elementToNode.get(el)
        if (candidate !== undefined) {
          parent = candidate
          break
        }
        el = el.parentElement
      }
      node.parent = parent
    }
    for (const node of nodes) {
      let depth = 0
      let p = node.parent
      while (p !== undefined) {
        depth++
        p = p.parent
      }
      node.depth = depth
    }
  }

  /**
   * Whether `el` can scroll and whether it is `position: fixed`, read once per element
   * for the system's life (ADR-0012, *Amendment (Reorder)*). An element whose
   * `overflow` or `position` changes while nodes live in it keeps its first answer;
   * a remount reads it afresh.
   */
  const scrollStyles = new WeakMap<Element, ScrollStyle>()
  const scrollStyleOf = (el: Element): ScrollStyle => {
    let style = scrollStyles.get(el)
    if (style === undefined) {
      style = scrollStyleFrom(computedOf(el))
      scrollStyles.set(el, style)
    }
    return style
  }

  /**
   * Each element's computed style, from one `getComputedStyle` call for the system's life.
   * The declaration is live, so the transform read each pass (ADR-0012, *Amendment
   * (#136)*) reads current values from it: a property read per pass, not a call.
   */
  const computedStyles = new WeakMap<Element, CSSStyleDeclaration>()
  const computedOf = (el: Element): CSSStyleDeclaration =>
    UndefinedOr.match(computedStyles.get(el), {
      onDefined: identity,
      onUndefined: () => {
        const style = getComputedStyle(el)
        computedStyles.set(el, style)
        return style
      },
    })

  /** The twins that carry paint deltas (ADR-0012, *Amendment (#136)*): a pass that moves one sets them again. */
  const painted = new Set<NodeState>()

  /**
   * The fold of everything from `el` up to the page (inclusive of `el`), memoized per
   * pass by element so the nodes under one container share it and each container's
   * scroll is read once. A `layoutScroll` node contributes its sampled scroll and is a
   * scroll root when fixed; any other element contributes its scroll when it can
   * scroll, and is a scroll root when it is `position: fixed`. Read phase only.
   */
  const foldFrom = (el: HTMLElement | null, memo: Map<Element, Fold>): Fold => {
    if (el === null) return ROOT_FOLD
    const doc = el.ownerDocument
    if (el === doc.body || el === doc.documentElement) return ROOT_FOLD
    const hit = memo.get(el)
    if (hit !== undefined) return hit
    const node = elementToNode.get(el)
    let scroll: Point.Point | undefined
    let stop: boolean
    if (node?.isScroll === true) {
      scroll = node.scroll
      stop = node.isScrollRoot
    } else {
      const style = scrollStyleOf(el)
      scroll = style.scrollable ? measureScroll(el) : undefined
      stop = style.fixed
    }
    const above = stop ? NO_FOLD : foldFrom(el.parentElement, memo)
    const fold: Fold = scroll === undefined
      ? above
      : { containers: [{ element: el, scroll }, ...above.containers], x: above.x + scroll.x, y: above.y + scroll.y, root: above.root }
    memo.set(el, fold)
    return fold
  }

  /**
   * Whether the nodes inside `el` are moved by a transform the projection doesn't own:
   * `el`'s, or one above it (ADR-0012, *Amendment (#136)*). Memoized per pass by element.
   * Each such element that isn't a node goes into `holds`, to be held at its identity for
   * the read, unless its transform is mid CSS transition: that one is left as it is, the
   * documented limit, and still counts. A node's own transform is the projection's, and the
   * pass clears it. Read phase only.
   */
  const transformedFrom = (el: Element | null, memo: Map<Element, boolean>, holds: Array<readonly [Holdable, TransformStyle]>): boolean => {
    if (Predicate.isNull(el)) return false
    const hit = memo.get(el)
    if (Predicate.isNotUndefined(hit)) return hit
    const above = transformedFrom(el.parentElement, memo, holds)
    const moved = Bool.or(above, movesNodes(el, holds))
    memo.set(el, moved)
    return moved
  }

  /** Whether `el` itself, not a node, carries a transform; collected into `holds` when it can be held. */
  const movesNodes = (el: Element, holds: Array<readonly [Holdable, TransformStyle]>): boolean => {
    if (elementToNode.has(el as HTMLElement)) return false
    if (isHoldable(el)) return carriesTransform(el, holds)
    return false
  }

  const carriesTransform = (el: Holdable, holds: Array<readonly [Holdable, TransformStyle]>): boolean => {
    const style = transformStyleFrom(computedOf(el))
    if (Arr.isReadonlyArrayEmpty(style.moved)) return false
    if (Bool.not(transitionRunning(el))) holds.push([el, style])
    return true
  }

  /**
   * Whether `node`'s box, read this pass with its ancestors' transforms still on and moved
   * by `shift` (its fold), is what its last pass read (ADR-0012, *Amendment (#136)*).
   */
  const readsAsBefore = (node: NodeState, box: Box.Box, shift: Point.Point): boolean => {
    const seen = node.seenBox
    if (Predicate.isUndefined(seen)) return false
    return equalShifted(seen, box, shift)
  }

  /** `node`'s box this pass: its stored one when nothing moved it, else the box just read, folded. */
  const boxThisPass = (node: NodeState, moved: boolean, read: Box.Box, documentScroll: Point.Point): Box.Box => {
    if (Bool.not(moved)) return UndefinedOr.getOrThrow(node.retained)
    return foldScroll(node, read, documentScroll)
  }

  /** `node`'s fold this pass: nothing when it is itself a scroll root, else its ancestors'. */
  const foldOf = (node: NodeState, memo: Map<Element, Fold>): Fold => {
    // A plain node's own `position: fixed`, read once (the cache's answer, kept on the node).
    const ownRoot = node.isScroll ? node.isScrollRoot : (node.ownFixed ??= scrollStyleOf(node.element).fixed)
    return ownRoot ? NO_FOLD : foldFrom(node.element.parentElement, memo)
  }

  /**
   * The scroll the fold adds to `node`'s box (ADR-0012): its containers' scroll at
   * its last pass (Motion's `removeElementScroll` adds the offset back to undo the
   * scroll's visual effect; every container that can scroll counts, not only
   * `layoutScroll` ones), plus `rootScroll` unless a scroll root is on the way. With
   * `ZERO_POINT` as `rootScroll` it is the containers' share alone: what rebases a
   * Root-frame Switch seed into the node's Scroll-stable frame.
   */
  const scrollOffset = (node: NodeState, rootScroll: Point.Point): Point.Point => {
    const fold = node.fold
    const dx = fold.x + (fold.root ? rootScroll.x : 0)
    const dy = fold.y + (fold.root ? rootScroll.y : 0)
    return dx === 0 && dy === 0 ? ZERO_POINT : { x: dx, y: dy }
  }

  /**
   * Fold scroll out of `box` (ADR-0012) → a scroll-stable (content-frame) box. No-op
   * on the non-scroll path (no container + zero root scroll ⇒ box unchanged), so it
   * never perturbs ordinary layout animation. `box` is the pass's freshly read box,
   * which nothing else holds, so it is moved in place: no allocation per node.
   */
  const foldScroll = (node: NodeState, box: Box.Box, rootScroll: Point.Point): Box.Box => {
    const fold = node.fold
    const dx = fold.x + (fold.root ? rootScroll.x : 0)
    const dy = fold.y + (fold.root ? rootScroll.y : 0)
    if (dx === 0 && dy === 0) return box
    const fresh = box as { readonly x: { min: number; max: number }; readonly y: { min: number; max: number } }
    fresh.x.min += dx
    fresh.x.max += dx
    fresh.y.min += dy
    fresh.y.max += dy
    return box
  }

  /**
   * Whether the root's scroll is part of `node`'s frame (ADR-0012; CONTEXT.md **Root
   * frame**): not when the node, or one of its ancestors, is a `position: fixed`
   * scroll root (a fixed `layoutScroll` node's style read live, any other element's
   * from the cache). Walks the LIVE DOM ancestry — it serves a node at dispose, when
   * the last pass's parent links and samples may be stale — so call it inside a read
   * window.
   */
  const isRootAt = (el: HTMLElement): boolean =>
    elementToNode.get(el)?.isScroll === true ? isScrollRoot(el) : scrollStyleOf(el).fixed
  const rootScrollApplies = (node: NodeState): boolean => {
    if (isRootAt(node.element)) return false
    const doc = node.element.ownerDocument
    for (let el = node.element.parentElement; el !== null && el !== doc.body && el !== doc.documentElement; el = el.parentElement) {
      if (isRootAt(el)) return false
    }
    return true
  }

  /**
   * `node`'s box in the **Root frame** (CONTEXT.md; ADR-0012 *Amendment (#13)*): the
   * viewport box plus the root's scroll, containers' scroll left as rendered —
   * Motion's `measuredBox`. While the element is connected it is read fresh: own
   * transform cleared and every read inside one write → read → restore window, so it
   * costs the one forced layout the binding's seed read used to. Once disconnected it
   * is derived from the last measured (Scroll-stable) box, put back where it painted
   * through its paint delta (ADR-0012 *Amendment (#136)*), by taking the containers'
   * share of the fold back out — at each container's LIVE scroll while it is still
   * connected (its last-pass sample otherwise), so a container scrolled since the
   * last pass doesn't shift the seed. The root's scroll needs no such care: the Root
   * frame carries it, so it cancels. `undefined` when there is neither.
   */
  const rootFrameBox = (node: NodeState): Box.Box | undefined => {
    const el = node.element
    if (el.isConnected) {
      const saved = el.style.transform
      el.style.transform = ""
      try {
        const viewport = Box.fromBounds(readLayoutBox(el))
        return rootScrollApplies(node) ? offsetBox(viewport, measureDocumentScroll()) : viewport
      } finally {
        el.style.transform = saved
      }
    }
    const stored = node.layoutBox ?? node.retained
    if (Predicate.isUndefined(stored)) return undefined
    // Where it painted: the stored box leaves its ancestors' transforms out (#136).
    const stable = paintedOf(node, stored)
    let dx = 0
    let dy = 0
    for (const container of node.fold.containers) {
      const scroll = container.element.isConnected ? measureScroll(container.element) : container.scroll
      dx += scroll.x
      dy += scroll.y
    }
    return dx === 0 && dy === 0 ? stable : offsetBox(stable, { x: -dx, y: -dy })
  }

  /**
   * The twin a disposed node's Switch seed goes straight to: the newest other live
   * node in its stack that has registered but not yet been measured — it mounted
   * first (the register-then-dispose ordering), so it has no hold left to read at
   * registration. `undefined` when there is none.
   */
  const pendingTwinOf = (node: NodeState, layoutId: string): NodeState | undefined => {
    const stack = stacks.get(layoutId)
    if (stack === undefined) return undefined
    for (let i = stack.length - 1; i >= 0; i--) {
      const twin = stack[i]
      if (twin !== node && !twin.leaving && twin.retained === undefined) return twin
    }
    return undefined
  }

  /**
   * Hold a disposed `layoutId` node's two end-of-task records (ADR-0010 *Amendment
   * (#13)*): the content-frame box a presence `handleLeave` may re-introduce, and the
   * Switch seed in the Root frame — handed straight to a twin that registered first,
   * or held per `layoutId` for an enterer that registers within this task. ONE
   * `wardic.projection.leaverHold` fiber per leaver expires both at the end of the
   * task and annotates what became of them.
   */
  const holdLeaver = (node: NodeState, layoutId: string): void => {
    const box = node.layoutBox ?? node.retained
    const recent = UndefinedOr.map(box, (stored): RecentLeaver => ({
      layoutId,
      box: stored,
      paintDelta: node.paintDelta,
      unpaintDelta: node.unpaintDelta,
      reintroduced: false,
    }))
    if (recent !== undefined) recentLeavers.set(node.element, recent)

    const seedBox = rootFrameBox(node)
    let handedOff = false
    let held: HeldSeed | undefined
    if (seedBox !== undefined) {
      const twin = pendingTwinOf(node, layoutId)
      if (twin !== undefined) {
        twin.seed = seedBox
        handedOff = true
      } else {
        held = { box: seedBox, consumed: false }
        heldSeeds.set(layoutId, held)
      }
    }
    if (recent === undefined && seedBox === undefined) return

    endOfTask("wardic.projection.leaverHold", { layoutId }, () => {
      if (recent !== undefined && recentLeavers.get(node.element) === recent) recentLeavers.delete(node.element)
      let seed = handedOff ? "handed-off" : "none"
      if (held !== undefined) {
        if (held.consumed) {
          seed = "consumed"
        } else if (heldSeeds.get(layoutId) === held) {
          heldSeeds.delete(layoutId)
          seed = "expired"
        } else {
          seed = "replaced" // a later leaver with the same layoutId took the slot
        }
      }
      return { seed, reintroduced: recent?.reintroduced ?? false }
    })
  }

  // --- One round of the Measure pass (reads, then FLIP seeds), run inside the ---
  // sink's `flushPass`, which applies what it writes before returning. The
  // {@link measurePass} wraps its rounds in the `wardic.projection.measure` span.
  // Every node it (re)starts is added to `seeded`, counted on the pass's span; every node
  // of a dragged subtree whose box changed is added to `dragBlocked` instead.
  /**
   * The slot-only update a blocked node takes (a dragged subtree's, or every node's
   * after a resize): its box becomes its slot, no animation starts or restarts, and a
   * running one keeps its delta (its origin moves with its box). A first measure writes
   * the identity projection. Returns whether the slot changed, so the node is
   * re-derived and flushed with its group.
   */
  const slotOnly = (node: NodeState, prev: Box.Box | undefined, newBox: Box.Box): boolean => {
    if (prev === undefined) {
      node.lastDelta = IDENTITY_DELTA
      writeProjection(node, IDENTITY_DELTA, TREE_SCALE_IDENTITY)
      return false
    }
    if (boxesEqual(prev, newBox)) return false
    if (!node.dragging && node.animating && node.origin !== undefined) {
      const from = centreOf(node.layoutBox ?? prev)
      const to = centreOf(newBox)
      node.origin = offsetBox(node.origin, { x: to.x - from.x, y: to.y - from.y })
    }
    node.layoutBox = newBox
    return true
  }

  const runMeasurePass = (seeded: Set<NodeState>, dragBlocked: Set<NodeState>, blocked: boolean): void => {
    // Parent links + depth FIRST (DOM-ancestry only, box-independent): the scroll
    // fold walks the ancestor chain, and the depth order makes every phase below
    // ancestors-first, so each scroll container's offset is sampled before a
    // descendant folds it in (ADR-0012).
    computeTree()
    const ordered = [...nodes].sort((a, b) => a.depth - b.depth)
    // The nodes this round (re)seeded or whose box changed under their descendants.
    const changed = new Set<NodeState>()
    const start = (node: NodeState): void => {
      changed.add(node)
      seeded.add(node)
    }

    // --- WRITE: reset every node's transform, before ANY box is read. ---------
    // `getBoundingClientRect` is viewport-space, so a node measured while an
    // ANCESTOR is mid-animation reads an ancestor-transform-polluted box. Clearing
    // inside the per-node read (the old `measureLayoutBox` loop) cannot fix that:
    // it restores in a `finally`, i.e. before the next node is read. So the reset
    // is hoisted here, to its own pass (Motion's `resetTransformStyle` loop).
    //
    // Motion flags `shouldResetTransform` on the `path + self` of each DIRTY node
    // and clears only those. Wardic re-measures the WHOLE registered tree every
    // pass (ADR-0009 Q5), so that set is exactly `ordered` — the flag would be
    // dead machinery. A descendant's transform cannot pollute an ancestor's rect,
    // so this is still the minimal set, not a widening.
    const savedTransforms: Array<string> = []
    for (const node of ordered) {
      savedTransforms.push(node.element.style.transform)
      node.element.style.transform = ""
    }

    // --- READ: no DOM writes until the next banner. ---------------------------
    // Everything that touches layout lives here: the boxes, the scroll samples
    // (ADR-0012) and the `getComputedStyle` scale-correction bases (ADR-0011).
    // Assignments onto NodeState are plain JS — they don't invalidate layout.
    //
    // The scroll offsets are sampled HERE, in the reset state, not before the clear
    // loop: clearing a transform can shrink a container's scrollable overflow and so
    // clamp its `scrollLeft`/`scrollTop`, and the boxes we are about to read reflect
    // whatever scroll position the reset left behind. Sampling alongside the boxes
    // keeps offset and box in the same frame, which is what the fold needs (Motion
    // samples in the same phase, `updateLayout` -> `updateScroll`). The residual is
    // that the clamp itself is not undone by the restore — the ADR-0012
    // scroll-during-transition limit.
    const viewportBoxes: Array<Box.Box> = []
    // Per node, in `ordered`: whether anything moved it since its last pass.
    const moved: Array<boolean> = []
    // The nodes a transform that isn't the projection's moves (their indices), and each one's box as painted.
    const under: Array<number> = []
    const paintedBoxes: Array<Box.Box> = []
    let holds: ReadonlyArray<TransformHold> = []
    let documentScroll: Point.Point
    try {
      documentScroll = measureDocumentScroll()
      for (const node of ordered) {
        viewportBoxes.push(Box.fromBounds(readLayoutBox(node.element)))
        if (node.isScroll) {
          node.scroll = measureScroll(node.element)
          node.isScrollRoot = isScrollRoot(node.element)
        }
        // Read scale-correction bases ONCE (ADR-0011), the first time we measure this
        // node — i.e. before any correction is written. Re-reading would pick up our
        // OWN corrected inline value (inline overrides the stylesheet) and compound the
        // radius/shadow each frame. (A node's authored radius changing mid-life is the
        // documented v0.1 limit.)
        if (node.correctorBases === undefined) node.correctorBases = readBases(node.element)
      }
      // Each node's fold (ADR-0012, *Amendment (Reorder)*), now every `layoutScroll`
      // sample is in: every container that can scroll, read once this pass.
      const folds = new Map<Element, Fold>()
      for (const node of ordered) node.fold = foldOf(node, folds)

      // --- READ: what moved each node, besides the projection (ADR-0012, *Amendment (#136)*).
      // A box carries no transform, its node's own or an ancestor's, whoever set it, so a
      // parent moved between two passes (by `animate`, a free drag, a stylesheet, another
      // library) carries its nodes, as CSS does, instead of leaving a stale box. The boxes
      // just read still carry what the ancestors that aren't nodes paint. A node that reads
      // as it did at its last pass hasn't moved, whatever is above it, and keeps its stored
      // box: an unrelated pass reads nothing more. For one that moved, the elements above it
      // that carry a transform are found (each one's style read once a pass), held at their
      // identity, and its box read again.
      const wanted: Array<readonly [Holdable, TransformStyle]> = []
      const transformMemo = new Map<Element, boolean>()
      for (let i = 0; i < ordered.length; i++) {
        const node = ordered[i]
        const shift = scrollOffset(node, documentScroll)
        if (readsAsBefore(node, viewportBoxes[i], shift)) {
          moved.push(false)
          continue
        }
        moved.push(true)
        node.seenBox = offsetBox(viewportBoxes[i], shift)
        // Its paint deltas are this pass's to set again, below.
        if (painted.delete(node)) {
          node.paintDelta = undefined
          node.unpaintDelta = undefined
        }
        if (transformedFrom(node.element.parentElement, transformMemo, wanted)) under.push(i)
      }
      // --- WRITE: hold the ancestors that carry a transform at their identity. -----
      holds = Arr.map(wanted, ([el, style]) => holdTransform(el, style))
      // --- READ: those nodes' boxes again, with nothing transformed. ----------
      if (Arr.isArrayNonEmpty(wanted)) {
        for (const i of under) {
          paintedBoxes.push(viewportBoxes[i])
          viewportBoxes[i] = Box.fromBounds(readLayoutBox(ordered[i].element))
        }
      }
    } finally {
      // --- WRITE: restore the transforms we cleared. --------------------------
      // `deriveAll()` at the tail re-derives the inline transform from the new delta
      // for every node it touches, so this only matters for a node it won't (one at
      // rest with no animating ancestor). Restoring unconditionally saves having to
      // prove that set empty, and it lands in the SAME synchronous pass — the gate's
      // flush then overwrites it for every animating node, so no frame ever paints a
      // cleared or stale transform.
      //
      // In a `finally` because the reset is now pass-level: a throwing read would
      // otherwise leave EVERY node's transform wiped (the per-node helper this
      // replaced could only ever strand one), and the gate's `flush` has no
      // `finally` of its own, so it would stay latched mid-flush.
      releaseTransforms(holds)
      for (let i = 0; i < ordered.length; i++) ordered[i].element.style.transform = savedTransforms[i]
    }

    // Each moved twin's paint deltas, between its box and its box as painted, both in its
    // Scroll-stable frame (the fold is the same shift for the two). Before the loop below
    // folds the boxes in place, and for every twin first, so a crossfade reads its prior
    // Lead's from this pass. A twin that didn't move keeps its last pass's; one that moved
    // out from under every transform had them dropped above.
    if (Arr.isArrayNonEmpty(paintedBoxes)) {
      Arr.forEach(under, (i, k) => {
        const node = ordered[i]
        if (Predicate.isUndefined(node.layoutId)) return
        const shift = scrollOffset(node, documentScroll)
        const local = offsetBox(viewportBoxes[i], shift)
        const seen = offsetBox(paintedBoxes[k], shift)
        node.paintDelta = Projection.calcBoxDelta(local, seen)
        node.unpaintDelta = Projection.calcBoxDelta(seen, local)
        painted.add(node)
      })
    }

    // --- WRITE: FLIP detection + seeding, on the already-measured boxes. ------
    for (let i = 0; i < ordered.length; i++) {
      const node = ordered[i]
      // Store the box in the SCROLL-STABLE frame (ADR-0012), so a scroll change
      // between triggers doesn't leak into the delta. Every scroll offset was
      // sampled in the read phase, so the whole ancestor chain is available.
      // A node nothing moved keeps its stored box (#136): the box just read may still carry
      // what an ancestor's transform paints.
      const prev = node.retained
      const newBox = boxThisPass(node, moved[i], viewportBoxes[i], documentScroll)
      node.retained = newBox
      node.layoutVersion++
      // A Switch seed only ever serves a node's first measure (ADR-0010 *Amendment
      // (#13)*); take it now, whichever branch below handles the node.
      const seed = node.seed
      node.seed = undefined

      // SELF-SNAP (ADR-0013): a layoutRoot never FLIPs its own layout. Publish its
      // stable box (layoutBox + lastTarget) so descendants project relative to it,
      // and write identity — no spring, never `active`. A dragged layoutRoot follows the
      // pointer instead: it takes the drag-blocked update below, like any dragged node.
      if (node.layoutRoot && !node.dragging) {
        if (prev !== undefined && !boxesEqual(prev, newBox)) {
          changed.add(node)
          if (inDraggedTree(node)) dragBlocked.add(node)
        }
        node.layoutBox = newBox
        node.lastTarget = newBox
        node.origin = undefined
        node.spring = undefined
        node.animating = false
        // A released layoutRoot's flight ends here, so its raise goes with this write.
        node.releasing = false
        node.raised = false
        active.delete(node)
        node.lastDelta = IDENTITY_DELTA
        writeProjection(node, IDENTITY_DELTA, TREE_SCALE_IDENTITY)
        continue
      }

      // DRAG-BLOCKED (ADR-0016 *Amendment (#26)*): a dragged node and its subtree take a
      // slot-only update. No animation starts or restarts here, a first-measure crossfade
      // or switch included (Motion's blocked tree, create-projection-node.ts:507-511):
      // the dragged node keeps following the pointer from its new slot, and a descendant
      // rides the drag. The node counts as changed, so it is re-derived and flushed with
      // its group in this pass, but it is not seeded. A
      // running descendant's origin moves with its box, so its animation keeps its delta
      // and doesn't jump (Motion keeps the running `targetDelta` of a blocked node).
      //
      // RESIZE-BLOCKED (ADR-0018 *Amendment (#39)*): the first pass after a window width
      // change gives every node the same slot-only update, so the reflow the resize
      // caused doesn't animate (Motion's `updateBlockedByResize`: it measures every node
      // and notifies none, create-projection-node.ts:728-748 at 16c6122).
      if (blocked || inDraggedTree(node)) {
        if (slotOnly(node, prev, newBox)) {
          changed.add(node)
          if (inDraggedTree(node)) dragBlocked.add(node)
        }
        continue
      }

      if (prev === undefined) {
        // First measure — detection priority (ADR-0010):
        // (1) CROSSFADE: a LIVE prior twin already in this node's stack → animate
        //     FROM the prior lead's box (the prior twins become Followers locked
        //     onto us, fading out via the stack derive). Takes priority over the
        //     switch seed — the live twin's box is authoritative.
        // The prior Lead's box in this node's frame, through where it paints (#136).
        const priorBox = UndefinedOr.map(priorLeadOf(node), (lead) =>
          UndefinedOr.map(UndefinedOr.match(lead.layoutBox, { onDefined: identity, onUndefined: () => lead.retained }), (box) => between(lead, node, box)))
        if (priorBox !== undefined && !boxesEqual(priorBox, newBox)) {
          node.origin = priorBox
          node.layoutBox = newBox
          node.spring = startSpring(node)
          node.animating = true
          active.add(node)
          start(node)
          continue
        }
        // (2) SWITCH: a disposed twin left this node a seed — no live twin in the
        //     stack. The seed is in the Root frame; rebase it into this node's
        //     Scroll-stable frame by adding its containers' scroll (sampled this
        //     pass) and taking out what its ancestors' transforms paint (#136), then
        //     FLIP from it to the measured box (a move, no crossfade — the leaver is
        //     gone). ADR-0012 / ADR-0010 *Amendment (#13)*.
        if (seed !== undefined) {
          const containers = scrollOffset(node, ZERO_POINT)
          const origin = unpaintedOf(node, containers === ZERO_POINT ? seed : offsetBox(seed, containers))
          if (!boxesEqual(origin, newBox)) {
            node.origin = origin
            node.layoutBox = newBox
            node.spring = startSpring(node) // progress spring restarts at 0
            node.animating = true
            active.add(node)
            start(node)
            continue
          }
        }
        // No seed: seed retained, NO FLIP. Write an identity projection so a layout
        // element is consistently projection-owned from mount (its animated
        // translate/scale are ignored, rotate/skew woven — matches Motion). A nested
        // first-mount node is carried by its ancestors via CSS (identity own transform).
        node.lastDelta = IDENTITY_DELTA
        writeProjection(node, IDENTITY_DELTA, TREE_SCALE_IDENTITY)
        continue
      }

      // Skip a node that did not move, unless it is mid-animation under an ancestor
      // this pass restarted (its origin is relative to that ancestor's old motion). A
      // running node whose box didn't change keeps its animation: not restarted, not
      // re-written, not primed (ADR-0018; Motion leaves an unchanged target alone,
      // create-projection-node.ts:546-552 at 16c6122).
      if (boxesEqual(prev, newBox) && (!node.animating || !hasChangedAncestor(node, changed))) continue

      // Origin = where the element appears RIGHT NOW: mid-animation, the current
      // mixed target box (smooth interrupt, no jump — Q3); at rest, the prior box.
      const origin =
        node.animating && node.origin !== undefined && node.layoutBox !== undefined && node.spring !== undefined
          ? Box.mix(node.origin, node.layoutBox, node.spring.position)
          : prev

      node.origin = origin
      node.layoutBox = newBox
      node.spring = startSpring(node) // progress spring restarts at 0 (velocity 0)
      node.animating = true
      active.add(node)
      start(node)
    }

    // Seed the initial (progress-0) frame for the nodes this round changed and
    // everything that shares their ancestors' deltas, top-down. (Parent links were
    // computed at the top of the pass, before the scroll fold.) This is also the
    // real restore for them: `writeProjection` rebuilds each node's inline transform
    // from its new delta, rather than writing back the pre-pass value.
    deriveGroup(groupOf(changed))
    ensureRunning()
  }

  /**
   * One **Measure pass** (ADR-0018), at the end of the task that queued it: rounds
   * of `sink.flushPass(round)` until a round ends with no new trigger (a trigger
   * during a round comes from an effect in its flush), at most {@link MAX_ROUNDS};
   * past the cap the rest runs as a fresh Measure pass in the next task. The nodes it
   * seeded take their first step at the Frame loop's next tick (ADR-0033). Traced as one
   * `wardic.projection.measure` span annotated with the
   * node counts, how many nodes it seeded, how many it gave a slot-only update in a
   * dragged subtree (`dragBlocked`), how many rounds it ran, and whether a window
   * resize blocked it (`blocked`: every node took a slot-only update).
   */
  const measurePass: Effect.Effect<void> = Effect.suspend(() => {
    passQueued = false
    const seeded = new Set<NodeState>()
    const dragBlocked = new Set<NodeState>()
    // The Resize block: this pass takes it and clears it.
    const blocked = resizeBlocked
    resizeBlocked = false
    if (resizeTimer !== undefined) {
      clearTimeout(resizeTimer)
      resizeTimer = undefined
    }
    let rounds = 0
    inPass = true
    try {
      do {
        triggeredDuringPass = false
        rounds++
        sink.flushPass(() => runMeasurePass(seeded, dragBlocked, blocked))
      } while (triggeredDuringPass && rounds < MAX_ROUNDS)
    } finally {
      inPass = false
    }
    for (const listener of passEndListeners) {
      try {
        listener()
      } catch (defect) {
        runtime.runFork(reportFailure("wardic.projection: pass-end listener failed", Cause.die(defect)))
      }
    }
    if (triggeredDuringPass && !disposed) {
      triggeredDuringPass = false
      debug("measure round cap", { rounds })
      leftover = setTimeout(() => {
        leftover = undefined
        scheduleMeasure()
      }, 0)
    }
    return Effect.annotateCurrentSpan({
      nodes: nodes.size,
      active: active.size,
      seeded: seeded.size,
      dragBlocked: dragBlocked.size,
      rounds,
      blocked,
    })
  }).pipe(Effect.withSpan("wardic.projection.measure"))

  /**
   * Queue the Measure pass for the end of the current task (one per task, however
   * many triggers). A trigger while a pass runs its rounds repeats the pass instead.
   * The fiber reaches `Microtask.next` synchronously and resumes inside that
   * microtask, so no Effect scheduler is involved (ADR-0010 *Amendment (#13)*).
   */
  const scheduleMeasure = (): void => {
    if (disposed) return
    if (inPass) {
      triggeredDuringPass = true
      return
    }
    if (passQueued) return
    passQueued = true
    FiberSet.addUnsafe(
      taskFibers,
      runtime.runFork(
        Microtask.next.pipe(
          Effect.andThen(measurePass),
          Effect.tapCause((cause) => reportFailure("wardic.projection: measure pass failed", cause)),
        ),
      ),
    )
  }

  /**
   * Derive `root` and every node below it once, top-down, resting ones included (the
   * drag start's cleanup, see `dragStart`).
   */
  const deriveSubtree = (root: NodeState): void => {
    const subtree: Array<NodeState> = [root]
    for (const n of nodes) if (!isFollower(n) && isDescendantOf(n, root)) subtree.push(n)
    subtree.sort((a, b) => a.depth - b.depth)
    for (const n of subtree) derive(n)
  }

  // --- The coordinator (writes), one tick of the Clock. -----------------------
  const step = (dtRaw: number): void => {
    const dt = dtRaw > Machine.MAX_DT ? Machine.MAX_DT : dtRaw
    const settled: Array<NodeState> = []
    // 1) Step every active node's progress spring (no derive yet — the tree-aware
    //    derive needs ALL springs advanced before computing parent-first).
    for (const node of active) {
      // A dragging node (ADR-0016) follows the pointer with no spring — keep it
      // active + derived each frame, never spring-stepped or settled.
      if (node.dragging) continue
      if (node.spring === undefined) {
        settled.push(node)
        continue
      }
      const r = Spring.step(node.spring, dt, 1, Spring.resolve(node.springOptions()))
      node.spring = r.state
      if (r.done) settled.push(node)
    }
    // 2) Derive all top-down (settled nodes are still in `active` here, so their
    //    progress=1 identity-ish delta is available to descendants this frame).
    deriveAll()
    finishSettled(settled)
  }

  /** Finalise settled nodes (at rest, projection-owned at identity), finish their leavers, and stop at idle. */
  const finishSettled = (settled: ReadonlyArray<NodeState>): void => {
    for (const node of settled) {
      node.releasing = false
      node.animating = false
      node.spring = undefined
      node.origin = undefined
      node.lastDelta = IDENTITY_DELTA
      active.delete(node)
      // A raised node's release has settled: one last write, at rest, drops the raise.
      if (node.raised) {
        node.raised = false
        derive(node)
      }
    }
    // 3b) A leaving Follower whose Lead just settled is done crossfading → remove it
    //     (fires onDone → presence removes the retained DOM node).
    for (const node of settled) {
      if (node.layoutId !== undefined && leadOf(node.layoutId) === node) {
        const stack = stacks.get(node.layoutId)
        if (stack !== undefined) for (const f of [...stack]) if (f.leaving) finishLeaver(f)
      }
    }
    if (active.size === 0) stopTicking()
  }

  /**
   * A window resize (ADR-0018 *Amendment (#39)*; Motion's resize listener,
   * create-projection-node.ts:459-487 at 16c61222c4166bbef5ff6ab0051192faa79fa8c8).
   * Only a width change counts, as Motion's: it finishes every running layout
   * animation but a dragged node's (which keeps following the pointer), and blocks the
   * next Measure pass for 250 ms, so the reflow the resize causes snaps instead of
   * animating from boxes measured before it. Motion only lifts its block at 250 ms;
   * here the timer runs the blocked pass itself if none ran, so the boxes are fresh
   * for the next trigger (and a drag start runs it at once, see `dragStart`).
   */
  const onResize = (): void => {
    if (disposed) return
    const width = window.innerWidth
    if (width === lastWidth) return
    lastWidth = width
    const finished: Array<NodeState> = []
    for (const node of active) if (!node.dragging) finished.push(node)
    if (finished.length > 0) {
      // At rest on their slots, derived while still active (as a tick derives a node
      // before it settles), so each writes its resting projection; then settled.
      for (const node of finished) {
        node.origin = undefined
        node.spring = undefined
        node.animating = false
      }
      deriveGroup(groupOf(new Set(finished)))
      finishSettled(finished)
      debug("resize finish", { finished: finished.length })
    }
    resizeBlocked = true
    if (resizeTimer !== undefined) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      resizeTimer = undefined
      if (resizeBlocked) scheduleMeasure()
    }, 250)
  }

  /** Run a pending blocked pass now, synchronously (its rounds run before the fiber's first async step). */
  const runBlockedPass = (): void => {
    if (!resizeBlocked || inPass || disposed) return
    FiberSet.addUnsafe(
      taskFibers,
      runtime.runFork(
        measurePass.pipe(Effect.tapCause((cause) => reportFailure("wardic.projection: blocked pass failed", cause))),
      ),
    )
  }

  /**
   * The coordinator as a machine on the Frame loop (ADR-0027, #75): each tick is one
   * `step`, whose writes are plain calls inside it, and the run settles at the first tick
   * that ends with no node active (a dragging node stays active, so a drag keeps it
   * running). Built for each run, so its span carries the `active` count it started
   * with. Its step works on the system's own state, which holds because there is never
   * more than one run.
   */
  const coordinatorMachine = (): Machine.Machine<Frame.Frame<void>> =>
    Machine.make({
      settles: true,
      span: { name: "wardic.projection.coordinator", attributes: { active: active.size } },
      start: () => (dt) => {
        // Per frame (ADR-0025): a `try` around the step, and a statement `if`.
        inStep = true
        try {
          step(dt)
        } finally {
          inStep = false
        }
        if (active.size === 0) return COORDINATOR_SETTLED
        return COORDINATOR_RUNNING
      },
    })

  /**
   * The coordinator's end, told apart (ADR-0027, decision 7): a settle, or an
   * interruption (a stop outside its step, the system's dispose), is nothing; anything
   * else (a step that threw, the Frame loop's own failure) is logged and reported
   * (`reportFailure`, ADR-0030 decision 4). Its nodes then wait where the last step left
   * them, and the next trigger starts a fresh run.
   */
  const coordinatorEnded = (exit: Exit.Exit<unknown>): Effect.Effect<void> =>
    Exit.match(exit, {
      onSuccess: () => Effect.void,
      onFailure: (cause) =>
        reportFailure("wardic.projection: coordinator failed", cause).pipe(Effect.annotateLogs({ active: active.size })),
    })

  /** Whether the coordinator's run is on the Frame loop: its fiber is still in the handle. */
  const coordinating = (): boolean =>
    Match.value(coordinator.state).pipe(
      Match.tag("Open", (state) => Predicate.isNotUndefined(state.fiber)),
      Match.tag("Closed", () => false),
      Match.exhaustive,
    )

  /**
   * Start the coordinator's run unless it's on the loop or nothing is active. Its span,
   * `wardic.projection.coordinator`, covers the WHOLE animation burst: it opens here and
   * closes when the run settles or is stopped. On a devtool timeline that's one bar per
   * burst, with each measure pass that re-seeds mid-burst appearing alongside. The
   * per-tick `step` stays span-less (hot path).
   *
   * Started as the spine's legs are (ADR-0027, *Implementation in #76*): `runFork` on the
   * runtime runs it inline up to its add on the loop. So when the loop is idle, its
   * burst's `Clock.ticks` subscription is made in this call, and the nodes take their first
   * step at the next Refresh frame's tick, cold or warm (ADR-0033). Added during a tick (from
   * another run's continuation), it's stepped from the next one (ADR-0027, decision 5).
   */
  const ensureRunning = (): void => {
    if (coordinating() || active.size === 0) return
    FiberHandle.setUnsafe(
      coordinator,
      runtime.runFork(
        coordinatorMachine().pipe(
          Machine.run(ignoreFrame),
          Effect.onExit(coordinatorEnded),
          Effect.asVoid,
        ),
      ),
    )
  }

  /**
   * Stop the coordinator: nothing is active. Inside its own step (its settle, or a node
   * disposed by a leaver's `onDone`), the run settles: the step returns its settled
   * Frame, and the loop takes it off. Outside it, the run is interrupted: it's waiting on
   * the loop, so it ends in this call, and gets no further Frame, even mid-tick (ADR-0027,
   * decision 5).
   */
  const stopTicking = (): void => {
    if (!coordinating()) return
    debug("coordinator: stop")
    // Everything is at rest now — reset deltas to identity (belt-and-suspenders so
    // no stale carried-node delta lingers for a future tree walk).
    for (const node of nodes) node.lastDelta = IDENTITY_DELTA
    if (inStep) return
    runtime.runFork(FiberHandle.clear(coordinator))
  }

  /** Promote `node` to an animating Lead from `fromBox` → its own box (un-hide + move home). */
  const promoteFrom = (node: NodeState, from: NodeState): void => {
    const ownBox = node.retained
    const fromStored = from.layoutBox ?? from.retained
    if (Predicate.isUndefined(fromStored)) return
    if (Predicate.isUndefined(ownBox)) return
    const fromBox = between(from, node, fromStored)
    if (boxesEqual(fromBox, ownBox)) return
    node.origin = fromBox
    node.layoutBox = ownBox
    node.spring = startSpring(node)
    node.animating = true
    active.add(node)
    ensureRunning()
  }

  /** Remove a finished leaving Follower + fire its `onDone` (presence removes the DOM node). */
  const finishLeaver = (node: NodeState): void => {
    debug("finishLeaver", { layoutId: node.layoutId })
    const cb = node.onLeaveDone
    node.onLeaveDone = undefined
    node.leaving = false
    ro?.unobserve(node.element)
    elementToNode.delete(node.element)
    if (node.layoutId !== undefined) {
      const stack = stacks.get(node.layoutId)
      if (stack !== undefined) {
        const i = stack.indexOf(node)
        if (i >= 0) stack.splice(i, 1)
        if (stack.length === 0) stacks.delete(node.layoutId)
      }
    }
    active.delete(node)
    nodes.delete(node)
    painted.delete(node)
    cb?.()
  }

  /** Build a transient leaving-Follower node for a re-introduced (already-disposed) leaver. */
  const makeFollowerNode = (el: HTMLElement, layoutId: string, recent: RecentLeaver, onDone: () => void): NodeState => ({
    id: "", // a leaving Follower is driven via the Renderer, not the gate — no id needed
    element: el,
    springOptions: () => ({}),
    respectReducedMotion: () => true,
    layoutId,
    seed: undefined,
    paintDelta: recent.paintDelta,
    unpaintDelta: recent.unpaintDelta,
    seenBox: undefined,
    retained: recent.box,
    origin: undefined,
    layoutBox: recent.box,
    spring: undefined,
    animating: false,
    parent: undefined,
    depth: 0,
    lastDelta: IDENTITY_DELTA,
    lastTarget: undefined,
    leaving: true,
    onLeaveDone: onDone,
    correctorBases: readBases(el),
    corrected: false,
    isScroll: false,
    scroll: { x: 0, y: 0 },
    isScrollRoot: false,
    fold: ROOT_FOLD,
    ownFixed: undefined,
    layoutVersion: 0,
    raiseWhileDragged: false,
    raised: false,
    layoutRoot: false,
    layoutAnchor: undefined,
    dragging: false,
    grabBox: undefined,
    dragDelta: { x: 0, y: 0 },
    releasing: false,
  })

  const doHandleLeave = (el: HTMLElement, onDone: () => void): boolean => {
    const live = elementToNode.get(el)
    const recent = recentLeavers.get(el)
    const layoutId = live?.layoutId ?? recent?.layoutId
    if (layoutId === undefined) return false
    debug("handleLeave", { layoutId, branch: live !== undefined ? "live" : "reintroduce" })

    // (A) handleLeave BEFORE dispose — el's node is still live. Mark it leaving (its
    // later dispose then SKIPS removal), demote it to a Follower, and promote the twin.
    if (live !== undefined) {
      const stack = stacks.get(layoutId)
      const isLead = leadOf(layoutId) === live
      const twin = isLead ? priorLeadOf(live) : leadOf(layoutId)
      if (twin === undefined || twin === live || stack === undefined) return false // lone leave
      live.leaving = true
      live.onLeaveDone = onDone
      if (isLead) {
        // Swap so the twin becomes the Lead (last); el becomes a Follower below it.
        const last = stack.length - 1
        stack[last - 1] = live
        stack[last] = twin
        promoteFrom(twin, live)
      }
      // After a possible swap, re-read the (new) Lead — never assert it exists.
      const newLead = leadOf(layoutId)
      if (newLead !== undefined && active.has(newLead)) deriveAll()
      else finishLeaver(live) // no animating lead to ride → finish promptly (already hidden)
      return true
    }

    // (B) dispose BEFORE handleLeave — el's node is gone; re-introduce it as a
    // transient leaving Follower from the recorded box (the re-introduce model).
    const lead = leadOf(layoutId)
    if (lead === undefined || lead.element === el || recent === undefined) return false
    const stack = stacks.get(layoutId)
    if (stack === undefined) return false
    const follower = makeFollowerNode(el, layoutId, recent, onDone)
    recent.reintroduced = true
    nodes.add(follower)
    elementToNode.set(el, follower)
    stack.splice(stack.length - 1, 0, follower) // insert below the Lead
    computeTree()
    if (active.has(lead)) deriveAll()
    else finishLeaver(follower)
    return true
  }

  /**
   * Shared-element exit coupling, inside the `wardic.projection.handleLeave` span
   * (so the timeline shows the presence→engine hand-off; the `handleLeave` debug
   * log it emits attaches as a span event). The crossfade burst it kicks off runs
   * on the coordinator's own span.
   */
  const handleLeave: ProjectionSystem["handleLeave"] = (el, onDone) =>
    runtime.runSync(
      Effect.sync(() => doHandleLeave(el, onDone)).pipe(Effect.withSpan("wardic.projection.handleLeave")),
    )

  const register: ProjectionSystem["register"] = (opts) => {
    const node: NodeState = {
      id: opts.id,
      element: opts.element,
      springOptions: opts.springOptions,
      respectReducedMotion: UndefinedOr.match(opts.respectReducedMotion, { onUndefined: () => constTrue, onDefined: identity }),
      layoutId: opts.layoutId,
      seed: undefined,
      paintDelta: undefined,
      unpaintDelta: undefined,
      seenBox: undefined,
      retained: undefined,
      origin: undefined,
      layoutBox: undefined,
      spring: undefined,
      animating: false,
      parent: undefined,
      depth: 0,
      lastDelta: IDENTITY_DELTA,
      lastTarget: undefined,
      leaving: false,
      onLeaveDone: undefined,
      correctorBases: undefined,
      corrected: false,
      isScroll: opts.layoutScroll === true,
      scroll: { x: 0, y: 0 },
      isScrollRoot: false,
      fold: ROOT_FOLD,
      ownFixed: undefined,
      layoutVersion: 0,
      raiseWhileDragged: opts.raiseWhileDragged === true,
      raised: false,
      layoutRoot: opts.layoutRoot === true,
      layoutAnchor: opts.layoutAnchor,
      dragging: false,
      grabBox: undefined,
      dragDelta: { x: 0, y: 0 },
      releasing: false,
    }
    nodes.add(node)
    elementToNode.set(node.element, node)
    debug("register", {
      id: opts.id,
      layoutId: opts.layoutId,
      layoutRoot: opts.layoutRoot === true,
      layoutScroll: opts.layoutScroll === true,
    })
    // Enrol in the per-`layoutId` stack: newest → Lead; prior entries are relegated
    // to Followers (the crossfade is detected from the stack at first measure).
    if (node.layoutId !== undefined) {
      let stack = stacks.get(node.layoutId)
      if (stack === undefined) {
        stack = []
        stacks.set(node.layoutId, stack)
      }
      stack.push(node)
      // Take the Switch seed a twin disposed earlier in this task left behind.
      const held = heldSeeds.get(node.layoutId)
      if (held !== undefined) {
        node.seed = held.box
        held.consumed = true
        heldSeeds.delete(node.layoutId)
      }
    }
    if (ro === undefined && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => scheduleMeasure())
    }
    if (!resizeListening && typeof window !== "undefined") {
      resizeListening = true
      lastWidth = window.innerWidth
      window.addEventListener("resize", onResize)
    }
    ro?.observe(node.element)
    // Seed retained + write the identity projection on the next frame.
    scheduleMeasure()

    return {
      notify: scheduleMeasure,
      // --- geometry (ADR-0016 *Amendment (Reorder)*): plain reads ------------------
      layoutBox: () => node.layoutBox ?? node.retained,
      dragOffset: () => {
        if (!node.dragging || node.grabBox === undefined) return ZERO_POINT
        const slot = node.layoutBox ?? node.grabBox
        const target = dragTargetOf(node, slot)
        return { x: target.x.min - slot.x.min, y: target.y.min - slot.y.min }
      },
      layoutVersion: () => node.layoutVersion,
      // --- drag (ADR-0016) -----------------------------------------------------
      dragStart: () => {
        if (node.dragging) return // idempotent — a re-fired start must not re-anchor mid-drag
        // A width change since the last pass left every box stale: run the blocked pass
        // first, so the grab anchors at the slot the node has now (#39).
        runBlockedPass()
        // Anchor at the grab-time slot; the node then tracks `grabBox + dragDelta`.
        node.grabBox = node.layoutBox ?? node.retained
        if (node.grabBox === undefined) return // not measured yet — nothing to anchor
        debug("dragStart", { id: node.id })
        node.dragging = true
        node.releasing = false
        node.raised = node.raiseWhileDragged
        node.dragDelta = { x: 0, y: 0 }
        node.spring = undefined
        node.origin = undefined
        node.animating = false
        // The slot: the delta source, and the frame its subtree is placed in while dragged.
        node.layoutBox = node.grabBox
        active.add(node)
        ensureRunning()
        // Derive the subtree once: from now on its resting nodes aren't derived (CSS
        // carries them), so none may keep a projection written for an earlier motion.
        deriveSubtree(node)
      },
      dragMove: (delta) => {
        if (!node.dragging) return
        node.dragDelta = delta
        // Re-derive the dragged group now, so the gate's next flush paints the pointer's
        // position (a pointer move lands before its frame's flush). The group is the one a
        // Measure pass flushes, so the ancestors it is derived against stay coherent.
        // Motion renders in its move handler (VisualElementDragControls.ts:216).
        deriveGroup(groupOf(new Set([node])))
      },
      dragEnd: () => {
        if (!node.dragging || node.grabBox === undefined) return
        debug("dragEnd", { id: node.id })
        const slot = node.layoutBox ?? node.grabBox
        const visual = dragTargetOf(node, slot)
        // A running descendant placed in this node's frame (its relative parent is this
        // node, or a running node that is) animated relative to the slot while dragged;
        // from here it animates relative to this node's release, which starts at
        // `visual`. Move its origin with that frame, so it doesn't jump. One placed in
        // another frame (a layoutRoot's inside this node) keeps its origin.
        const shift = { x: visual.x.min - slot.x.min, y: visual.y.min - slot.y.min }
        if (shift.x !== 0 || shift.y !== 0) {
          const moved: Array<NodeState> = []
          for (const n of nodes) {
            if (!n.animating || n.origin === undefined || !isDescendantOf(n, node)) continue
            let frame = relativeParentOf(n)
            while (frame !== undefined && frame !== node && frame.animating) frame = relativeParentOf(frame)
            if (frame === node) moved.push(n)
          }
          for (const n of moved) n.origin = offsetBox(n.origin!, shift)
        }
        node.dragging = false
        node.grabBox = undefined
        node.dragDelta = { x: 0, y: 0 }
        if (boxesEqual(visual, slot)) {
          // No travel (released in place at its slot) — settle now, no FLIP. Write the
          // resting projection first, so no frame keeps an offset an earlier write left
          // (a safety net: every pointer move writes its offset, so the last write is
          // normally the slot already).
          node.animating = false
          node.spring = undefined
          node.origin = undefined
          node.releasing = false
          node.raised = false
          deriveGroup(groupOf(new Set([node])))
          node.lastDelta = IDENTITY_DELTA
          active.delete(node)
          if (active.size === 0) stopTicking()
          return
        }
        // FLIP from the dragged visual position to the latest slot, via the layout spring,
        // first stepped at the loop's next tick, as a Measure pass's FLIP is (ADR-0033). Reduced
        // motion leaves it as it is: it continues the gesture, as Motion's release does (ADR-0029).
        node.origin = visual
        node.layoutBox = slot
        node.spring = Spring.init({ from: 0 })
        node.animating = true
        node.releasing = true
        active.add(node)
        ensureRunning()
      },
      dispose: () => {
        // A leaving Follower's removal is owned by finishLeaver (presence retained
        // it for the crossfade); a plain dispose must NOT tear it down here.
        if (node.leaving) return
        debug("dispose node", { id: node.id, layoutId: node.layoutId })
        // Hold the leaver's end-of-task records before it leaves the stack: the box
        // a presence handleLeave arriving AFTER this dispose re-introduces, and its
        // Switch seed for a twin (ADR-0010 *Amendment (#13)*).
        if (node.layoutId !== undefined) holdLeaver(node, node.layoutId)
        ro?.unobserve(node.element)
        elementToNode.delete(node.element)
        active.delete(node)
        nodes.delete(node)
        painted.delete(node)
        // Stack relegation / promotion (ADR-0010): a leaving Lead promotes the new
        // newest node, animating it FROM the leaver's box (un-hide + move home).
        if (node.layoutId !== undefined) {
          const stack = stacks.get(node.layoutId)
          if (stack !== undefined) {
            const wasLead = stack[stack.length - 1] === node
            const i = stack.indexOf(node)
            if (i >= 0) stack.splice(i, 1)
            if (stack.length === 0) stacks.delete(node.layoutId)
            else if (wasLead) promoteFrom(stack[stack.length - 1]!, node)
          }
        }
        if (active.size === 0) stopTicking()
      },
    }
  }

  const dispose: ProjectionSystem["dispose"] = () => {
    debug("dispose system", { nodes: nodes.size })
    disposed = true
    passQueued = false
    if (leftover !== undefined) {
      clearTimeout(leftover)
      leftover = undefined
    }
    if (resizeTimer !== undefined) {
      clearTimeout(resizeTimer)
      resizeTimer = undefined
    }
    if (resizeListening) {
      resizeListening = false
      window.removeEventListener("resize", onResize)
    }
    stopTicking()
    // Interrupt any end-of-task hold still pending, then drop what they held.
    runtime.runFork(Scope.close(scope, Exit.void))
    heldSeeds.clear()
    recentLeavers.clear()
    ro?.disconnect()
    ro = undefined
    active.clear()
    nodes.clear()
    elementToNode.clear()
    passEndListeners.clear()
  }

  const system: ProjectionSystem = { register, notify: scheduleMeasure, handleLeave, dispose }
  passEnds.set(system, passEndListeners)
  return system
}
