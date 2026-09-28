/**
 * The box-based projection system (ADR-0009) — the reusable DOM half of the
 * layout engine. It holds the projection nodes, the trigger sources, and the
 * Clock-driven coordinator that derives each node's transform every frame.
 *
 * It has NO framework reactivity: it reaches its host binding through two seams
 * only — a {@link ProjectionSink} (`write` per-element projection values into the
 * binding's flush gate + `flushPass` a Measure pass, applying its writes at once) and a
 * `ManagedRuntime` providing {@link Clock} (to fork the ref-counted tick fiber).
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
 *     during the pass's own flush repeats it (at most 5 rounds). Then every node the
 *     pass seeded takes one **Priming step** (the Clock's Priming tick on a Cold
 *     start), so it moves on the next painted frame whatever the Clock's state.
 *   - COORDINATOR (a single Clock-driven fiber, ref-counted ACTIVE while >=1 node
 *     animates, Q4): each tick steps every active node's progress spring, then
 *     `deriveAll()` walks the active nodes TOP-DOWN (ancestors first) computing
 *     each node's `projectionDelta` + `treeScale` via `applyTreeDeltas` over its
 *     animating ancestors' deltas, and writes the `@projection` value (the renderer
 *     assembles the transform). On settle it drops the node; when none remain it
 *     interrupts the fiber (idle = zero cost).
 *
 * Nesting: parent links come from a DOM-ancestry WALK (CSS composes by DOM
 * nesting, so that is exactly what projection must follow), and a child's box is
 * corrected for its ancestors' transforms via `applyTreeDeltas` (+ `treeScale`)
 * for nested SCALE. For nested layout, an animating child with a pure-translate
 * animating ancestor uses RELATIVE projection (`relativeParentOf` + `derive`): it
 * re-anchors to its `relativeParent`'s CURRENT target each frame, so it stays
 * glued even when parent and child run DIFFERENT transitions ("not left behind").
 */
import {
  applyTreeDeltas,
  type Box,
  boundsToBox,
  calcBoxDelta,
  calcRelativeBox,
  Clock,
  type Delta,
  initSpring,
  MAX_DT,
  mixBox,
  NOMINAL_DT,
  nextMicrotask,
  placeRelativeBox,
  type Point,
  PROJECTION_KEY,
  Renderer,
  type SpringOptions,
  type SpringState,
  springStep,
} from "@wardic/core"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import type * as ManagedRuntime from "effect/ManagedRuntime"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { isScrollRoot, measureDocumentScroll, measureScroll, readLayoutBox } from "./measure.ts"
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
 * The runtime flavour the coordinator needs: a `ManagedRuntime` that can run the
 * Clock-subscribing tick loop AND resolve the `Renderer` (to drive a presence-
 * retained leaving Follower whose gate registration was torn down on owner
 * disposal — ADR-0010). A binding's wider runtime (e.g. one providing the full
 * `WardicServices`) is assignable here.
 */
export type ProjectionRuntime = ManagedRuntime.ManagedRuntime<Clock | Renderer, never>

/** Identity tree-scale (no ancestor scaling). */
const TREE_SCALE_IDENTITY: Point = { x: 1, y: 1 }

/** Default relative-projection anchor (top-left) when a node sets no `layoutAnchor` (ADR-0013). */
const ZERO_ANCHOR: Point = { x: 0, y: 0 }

/** The resting projection delta — element at its real box (a no-op in applyTreeDeltas). */
const IDENTITY_DELTA: Delta = {
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
const boxesEqual = (a: Box, b: Box): boolean =>
  Math.abs(a.x.min - b.x.min) < BOX_EPSILON &&
  Math.abs(a.x.max - b.x.max) < BOX_EPSILON &&
  Math.abs(a.y.min - b.y.min) < BOX_EPSILON &&
  Math.abs(a.y.max - b.y.max) < BOX_EPSILON

/** Translate a box by a point (ADR-0016: the dragged target is `grabBox + dragDelta`). */
const offsetBox = (box: Box, delta: Point): Box => ({
  x: { min: box.x.min + delta.x, max: box.x.max + delta.x },
  y: { min: box.y.min + delta.y, max: box.y.max + delta.y },
})

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
  readonly springOptions: () => SpringOptions
  /**
   * Shared-element match key (ADR-0010). Enrols the node in the per-`layoutId`
   * lead/follow stack so coexisting twins crossfade, and lets a twin disposed in the
   * same task seed its first measure (a Switch, *Amendment (#13)*). Omitted for a
   * plain `layout` node.
   */
  readonly layoutId?: string
  /**
   * Mark this element as a scroll container (ADR-0012, Motion's `layoutScroll`):
   * its scroll offset is sampled at measure and folded out of its descendants'
   * boxes, so a scroll change BETWEEN triggers doesn't leak into their FLIP delta.
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
  readonly layoutAnchor?: Point | false
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
  /** The live pointer translate from the grab point — the node tracks `grabBox + delta`. */
  readonly dragMove: (delta: Point) => void
  /** End the drag: FLIP from the dragged position to the node's current layout slot. */
  readonly dragEnd: () => void
}

/** Handle returned from {@link ProjectionSystem.register}. */
export interface ProjectionNodeHandle extends DragProjectionHandle {
  /** Request a (coalesced) measure pass — e.g. this node's `layoutDependency` changed. */
  readonly notify: () => void
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
  /** Tear down the coordinator fiber + observer (wired into the provider's onCleanup). */
  readonly dispose: () => void
}

/** Per-node mutable state held by the system. */
interface NodeState {
  readonly id: string
  readonly element: HTMLElement
  readonly springOptions: () => SpringOptions
  /** Shared-element match key (ADR-0010), or `undefined` for a plain layout node. */
  readonly layoutId: string | undefined
  /**
   * The Switch seed handed to this node (ADR-0010 *Amendment (#13)*): a disposed
   * twin's box in the **Root frame**, taken from the per-`layoutId` hold at
   * registration or handed over directly by a twin disposed before this node's
   * first measure. Consumed (and cleared) by that first measure, which rebases it
   * into this node's Scroll-stable frame. `undefined` otherwise.
   */
  seed: Box | undefined
  /** Marked a scroll container (ADR-0012): its scroll is sampled + folded out of descendants. */
  readonly isScroll: boolean
  /** This scroll container's offset, sampled at measure (`{0,0}` for a non-scroll node). */
  scroll: Point
  /** Whether this (scroll) node is `position: fixed` — a scroll root (resets the fold). */
  isScrollRoot: boolean
  /** Marked a stable projection sub-root (ADR-0013): self-snaps, bounds the subtree, persistent relativeParent. */
  readonly layoutRoot: boolean
  /** This node's relative-projection anchor (ADR-0013): a 0–1 Point, or `false` to force absolute. */
  readonly layoutAnchor: Point | false | undefined
  /** Last measured untransformed box (the FLIP "First"); `undefined` until first measure. */
  retained: Box | undefined
  /** Where the element appears at progress 0 (the box it animates FROM). */
  origin: Box | undefined
  /** The element's real (current measured) box — the delta source + progress-1 target. */
  layoutBox: Box | undefined
  /** Progress (0→1) spring state; `undefined` at rest. */
  spring: SpringState | undefined
  animating: boolean
  // --- tree (recomputed each measure pass via DOM-ancestry walk) ---
  /** Nearest ancestor projection node, or `undefined` at the root. */
  parent: NodeState | undefined
  /** Number of ancestor projection nodes (for top-down ordering). */
  depth: number
  /** This frame's projection delta — read by descendants for applyTreeDeltas; identity at rest. */
  lastDelta: Delta
  /** This frame's viewport target box — read by a child using this node as its relativeParent. */
  lastTarget: Box | undefined
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
  /** The slot box captured at drag start — the pointer anchor; `target = grabBox + dragDelta`. */
  grabBox: Box | undefined
  /** The live pointer translate from the grab point (zero when not dragging). */
  dragDelta: Point
  /**
   * Whether the coordinator has stepped this node since a Measure pass last seeded
   * it. The Priming step skips a node the Clock's Priming tick already stepped (a
   * Cold start), so the first step is never taken twice (ADR-0018).
   */
  steppedSinceSeed: boolean
}

/**
 * A just-disposed `layoutId` node's content-frame box, kept until the end of the
 * current task so a presence `handleLeave` arriving AFTER dispose can re-introduce
 * the element as a leaving Follower (ADR-0010). `reintroduced` records whether it did.
 */
interface RecentLeaver {
  readonly layoutId: string
  readonly box: Box
  reintroduced: boolean
}

/**
 * A disposed twin's Switch seed, in the **Root frame**, held per `layoutId` until
 * the end of the current task (ADR-0010 *Amendment (#13)*). `consumed` records
 * whether an enterer picked it up at registration.
 */
interface HeldSeed {
  readonly box: Box
  consumed: boolean
}

/** The origin point: no scroll to add. */
const ZERO_POINT: Point = { x: 0, y: 0 }

/**
 * Build a projection system against a binding's `runtime` (providing {@link Clock})
 * and its {@link ProjectionSink} (its flush gate).
 *
 * Forks the coordinator on `runtime` directly; the binding disposes the system in
 * its own teardown (e.g. the provider's `onCleanup`).
 */
export const makeProjectionSystem = (runtime: ProjectionRuntime, sink: ProjectionSink): ProjectionSystem => {
  const nodes = new Set<NodeState>()
  const active = new Set<NodeState>()
  // Element -> node, for the DOM-ancestry parent walk.
  const elementToNode = new Map<HTMLElement, NodeState>()
  // Per-`layoutId` mount-order stack (ADR-0010): the newest live node is the Lead,
  // the rest are Followers. Crossfade is driven engine-side off this stack.
  const stacks = new Map<string, Array<NodeState>>()
  // The Clock-driven coordinator fiber, present only while >=1 node animates.
  let tickFiber: Fiber.Fiber<void, never> | undefined
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
  // The Measure pass (ADR-0018): whether one is queued for the end of this task,
  // whether one is running its rounds (a trigger then repeats it), whether a trigger
  // arrived during the current round, and the next-task leftover past the round cap.
  let passQueued = false
  let inPass = false
  let triggeredDuringPass = false
  let leftover: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  // The Renderer's pure halves, resolved once (like the gate) — used to drive a
  // presence-retained leaving Follower DIRECTLY (its gate registration is gone).
  const renderer = runtime.runSync(
    Effect.gen(function* () {
      return yield* Renderer
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
   * synchronously up to `nextMicrotask`, whose `queueMicrotask` resumes it
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
        nextMicrotask.pipe(
          Effect.map(expire),
          Effect.flatMap((outcome) => Effect.annotateCurrentSpan(outcome)),
          Effect.tapCause((cause) => Effect.logError(`wardic.projection: ${span} failed`, cause)),
          Effect.withSpan(span, { attributes }),
        ),
      ),
    )
  }

  /**
   * Write a node's per-frame `@projection` value (Option A) plus any scale-corrected
   * style keys (ADR-0011). The optional `opacity` is the crossfade factor (ADR-0010)
   * the renderer multiplies with the user opacity; omitted for a non-crossfading node
   * so it passes through (a fresh ProjectionValue REPLACES the gate's `@projection`,
   * dropping any stale factor). `corrected` (e.g. `{ borderRadius, boxShadow }`) flows
   * as ordinary style keys the renderer applies verbatim.
   *
   * A LEAVING Follower is gate-unregistered (its owner was disposed), so it is
   * driven directly via the Renderer onto the retained element instead of the gate.
   */
  const writeProjection = (
    node: NodeState,
    delta: Delta,
    treeScale: Point,
    opacity?: number,
    corrected?: Record<string, string>,
  ): void => {
    const value = opacity !== undefined ? { delta, treeScale, opacity } : { delta, treeScale }
    const patch = corrected !== undefined ? { [PROJECTION_KEY]: value, ...corrected } : { [PROJECTION_KEY]: value }
    if (node.leaving) {
      runtime.runSync(renderer.commit(node.element, renderer.project(patch)))
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
  const ancestorDeltas = (node: NodeState): Array<Delta> => {
    const chain: Array<Delta> = []
    let p = node.parent
    while (p !== undefined) {
      chain.push(p.lastDelta)
      if (p.layoutRoot) break // accumulation boundary (ADR-0013): a layoutRoot is the sub-root
      p = p.parent
    }
    chain.reverse()
    return chain
  }

  /** Whether any ancestor is animating its own FLIP (so this node is "carried" + must counter-correct). */
  const hasActiveAncestor = (node: NodeState): boolean => {
    let p = node.parent
    while (p !== undefined) {
      if (active.has(p)) return true
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
   * false` opts the node out entirely (it then projects ABSOLUTELY).
   */
  const relativeParentOf = (node: NodeState): NodeState | undefined => {
    if (node.layoutAnchor === false) return undefined // opt out -> absolute (Motion's layoutAnchor !== false gate)
    let p = node.parent
    while (p !== undefined) {
      // A layoutRoot is a persistent relative anchor AND the boundary — stop here.
      if (p.layoutRoot) return p.layoutBox !== undefined ? p : undefined
      if (active.has(p) && p.animating && p.origin !== undefined && p.layoutBox !== undefined) return p
      p = p.parent
    }
    return undefined
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
      const targetBox = offsetBox(node.grabBox, node.dragDelta)
      const { box: layoutCorrected, treeScale } = applyTreeDeltas(box, ancestorDeltas(node))
      const delta = calcBoxDelta(layoutCorrected, targetBox)
      node.lastTarget = targetBox
      node.lastDelta = delta
      const corrected = correctionsFor(node, delta.x.scale * treeScale.x, delta.y.scale * treeScale.y)
      writeProjection(node, delta, treeScale, leadOpacity(node), corrected)
      return
    }

    const rp = relativeParentOf(node)
    let targetBox: Box
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
        node.origin !== undefined ? calcRelativeBox(node.origin, rpFromBox, anchor) : calcRelativeBox(box, rp.layoutBox, anchor)
      const relTo = calcRelativeBox(box, rp.layoutBox, anchor)
      const relTarget = mixBox(relFrom, relTo, progress)
      targetBox = placeRelativeBox(relTarget, rp.lastTarget, anchor)
    } else if (node.animating && node.origin !== undefined && node.spring !== undefined) {
      // ABSOLUTE: own viewport interpolation (no animating pure-translate ancestor).
      targetBox = mixBox(node.origin, box, node.spring.position)
    } else {
      // CARRIED under a SCALED ancestor / at rest: target the real box — applyTreeDeltas
      // supplies the counter-transform.
      targetBox = box
    }

    const { box: layoutCorrected, treeScale } = applyTreeDeltas(box, ancestorDeltas(node))
    // delta source is the element's REAL box pushed through ancestor transforms;
    // target is where it should appear.
    const delta = calcBoxDelta(layoutCorrected, targetBox)
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
    const { box: layoutCorrected, treeScale } = applyTreeDeltas(box, ancestorDeltas(node))
    const delta = calcBoxDelta(layoutCorrected, lead.lastTarget) // lock onto the lead's box
    node.lastTarget = lead.lastTarget
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
   * (re)seeded, the whole subtree of that node's highest RUNNING ancestor below any
   * `layoutRoot` boundary (or of the node itself). A seed is derived against its
   * ancestors' deltas, so the node and everything sharing those deltas must paint
   * together. Every other node keeps the value its last Clock tick wrote: a running
   * animation elsewhere is left alone.
   */
  const groupOf = (changed: ReadonlySet<NodeState>): Set<NodeState> => {
    const group = new Set<NodeState>()
    if (changed.size === 0) return group
    const roots = new Set<NodeState>()
    for (const node of changed) {
      let root = node
      for (let p = node.parent; p !== undefined && !p.layoutRoot; p = p.parent) if (active.has(p)) root = p
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
   * The scroll the fold adds to `node`'s box (ADR-0012): each `layoutScroll`
   * ancestor's scroll (Motion's `removeElementScroll` adds the offset back to undo
   * the scroll's visual effect), stopping at a `position: fixed` scroll-root
   * ancestor, plus `rootScroll` unless the node sits in a scroll root. Reads the last
   * pass's scroll samples. With `ZERO_POINT` as `rootScroll` it is the containers'
   * share alone: what rebases a Root-frame Switch seed into the node's Scroll-stable
   * frame.
   */
  const scrollOffset = (node: NodeState, rootScroll: Point): Point => {
    if (node.isScroll && node.isScrollRoot) return ZERO_POINT // a fixed node is itself viewport-relative
    let dx = 0
    let dy = 0
    let rootApplies = true
    for (let p = node.parent; p !== undefined; p = p.parent) {
      if (!p.isScroll) continue
      dx += p.scroll.x
      dy += p.scroll.y
      if (p.isScrollRoot) {
        // A fixed scroll-root ancestor: its own scroll applies, but its subtree is
        // viewport-relative — nothing OUTSIDE it (further containers, the root) does.
        rootApplies = false
        break
      }
    }
    if (rootApplies) {
      dx += rootScroll.x
      dy += rootScroll.y
    }
    return dx === 0 && dy === 0 ? ZERO_POINT : { x: dx, y: dy }
  }

  /**
   * Fold scroll out of `box` (ADR-0012) → a scroll-stable (content-frame) box. No-op
   * on the non-scroll path (no isScroll ancestors + zero root scroll ⇒ box
   * unchanged), so it never perturbs ordinary layout animation.
   */
  const foldScroll = (node: NodeState, box: Box, rootScroll: Point): Box => {
    const offset = scrollOffset(node, rootScroll)
    return offset === ZERO_POINT ? box : offsetBox(box, offset)
  }

  /**
   * Whether the root's scroll is part of `node`'s frame (ADR-0012; CONTEXT.md **Root
   * frame**): not when the node, or one of its `layoutScroll` ancestors, is a
   * `position: fixed` scroll root. Walks the LIVE DOM ancestry and reads computed
   * style — it serves a node at dispose, when the last pass's parent links and
   * samples may be stale — so call it inside a read window.
   */
  const rootScrollApplies = (node: NodeState): boolean => {
    if (node.isScroll && isScrollRoot(node.element)) return false
    for (let el = node.element.parentElement; el !== null; el = el.parentElement) {
      if (elementToNode.get(el)?.isScroll === true && isScrollRoot(el)) return false
    }
    return true
  }

  /**
   * `node`'s box in the **Root frame** (CONTEXT.md; ADR-0012 *Amendment (#13)*): the
   * viewport box plus the root's scroll, nested `layoutScroll` scroll left as
   * rendered — Motion's `measuredBox`. While the element is connected it is read
   * fresh: own transform cleared and every read inside one write → read → restore
   * window, so it costs the one forced layout the binding's seed read used to. Once
   * disconnected it is derived from the last measured (Scroll-stable) box by taking
   * the containers' share of the fold back out — at each container's LIVE scroll
   * while it is still connected (its last-pass sample otherwise), so a container
   * scrolled since the last pass doesn't shift the seed. The root's scroll needs no
   * such care: the Root frame carries it, so it cancels. `undefined` when there is
   * neither.
   */
  const rootFrameBox = (node: NodeState): Box | undefined => {
    const el = node.element
    if (el.isConnected) {
      const saved = el.style.transform
      el.style.transform = ""
      try {
        const viewport = boundsToBox(readLayoutBox(el))
        return rootScrollApplies(node) ? offsetBox(viewport, measureDocumentScroll()) : viewport
      } finally {
        el.style.transform = saved
      }
    }
    const stable = node.layoutBox ?? node.retained
    if (stable === undefined) return undefined
    if (node.isScroll && node.isScrollRoot) return stable // a fixed node folds nothing (see scrollOffset)
    let dx = 0
    let dy = 0
    for (let p = node.parent; p !== undefined; p = p.parent) {
      if (!p.isScroll) continue
      const scroll = p.element.isConnected ? measureScroll(p.element) : p.scroll
      dx += scroll.x
      dy += scroll.y
      if (p.isScrollRoot) break
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
    const recent: RecentLeaver | undefined = box !== undefined ? { layoutId, box, reintroduced: false } : undefined
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
  // Every node it (re)starts is added to `seeded`, for the Priming step.
  const runMeasurePass = (seeded: Set<NodeState>): void => {
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
      node.steppedSinceSeed = false
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
    const viewportBoxes: Array<Box> = []
    let documentScroll: Point
    try {
      documentScroll = measureDocumentScroll()
      for (const node of ordered) {
        viewportBoxes.push(boundsToBox(readLayoutBox(node.element)))
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
      for (let i = 0; i < ordered.length; i++) ordered[i].element.style.transform = savedTransforms[i]
    }

    // --- WRITE: FLIP detection + seeding, on the already-measured boxes. ------
    for (let i = 0; i < ordered.length; i++) {
      const node = ordered[i]
      // Store the box in the SCROLL-STABLE frame (ADR-0012), so a scroll change
      // between triggers doesn't leak into the delta. Every scroll offset was
      // sampled in the read phase, so the whole ancestor chain is available.
      const newBox = foldScroll(node, viewportBoxes[i], documentScroll)
      const prev = node.retained
      node.retained = newBox
      // A Switch seed only ever serves a node's first measure (ADR-0010 *Amendment
      // (#13)*); take it now, whichever branch below handles the node.
      const seed = node.seed
      node.seed = undefined

      // SELF-SNAP (ADR-0013): a layoutRoot never FLIPs its own layout. Publish its
      // stable box (layoutBox + lastTarget) so descendants project relative to it,
      // and write identity — no spring, never `active`.
      if (node.layoutRoot) {
        if (prev !== undefined && !boxesEqual(prev, newBox)) changed.add(node)
        node.layoutBox = newBox
        node.lastTarget = newBox
        node.origin = undefined
        node.spring = undefined
        node.animating = false
        active.delete(node)
        node.lastDelta = IDENTITY_DELTA
        writeProjection(node, IDENTITY_DELTA, TREE_SCALE_IDENTITY)
        continue
      }

      if (prev === undefined) {
        // First measure — detection priority (ADR-0010):
        // (1) CROSSFADE: a LIVE prior twin already in this node's stack → animate
        //     FROM the prior lead's box (the prior twins become Followers locked
        //     onto us, fading out via the stack derive). Takes priority over the
        //     switch seed — the live twin's box is authoritative.
        const priorLead = priorLeadOf(node)
        const priorBox = priorLead !== undefined ? (priorLead.layoutBox ?? priorLead.retained) : undefined
        if (priorBox !== undefined && !boxesEqual(priorBox, newBox)) {
          node.origin = priorBox
          node.layoutBox = newBox
          node.spring = initSpring({ from: 0 })
          node.animating = true
          active.add(node)
          start(node)
          continue
        }
        // (2) SWITCH: a disposed twin left this node a seed — no live twin in the
        //     stack. The seed is in the Root frame; rebase it into this node's
        //     Scroll-stable frame by adding its own `layoutScroll`-ancestor scroll
        //     (sampled this pass), then FLIP from it to the measured box (a move, no
        //     crossfade — the leaver is gone). ADR-0012 / ADR-0010 *Amendment (#13)*.
        if (seed !== undefined) {
          const containers = scrollOffset(node, ZERO_POINT)
          const origin = containers === ZERO_POINT ? seed : offsetBox(seed, containers)
          if (!boxesEqual(origin, newBox)) {
            node.origin = origin
            node.layoutBox = newBox
            node.spring = initSpring({ from: 0 }) // progress spring restarts at 0
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
          ? mixBox(node.origin, node.layoutBox, node.spring.position)
          : prev

      node.origin = origin
      node.layoutBox = newBox
      node.spring = initSpring({ from: 0 }) // progress spring restarts at 0 (velocity 0)
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
   * past the cap the rest runs as a fresh Measure pass in the next task. Then, after
   * the microtasks the rounds queued (a Cold start's Priming tick among them), the
   * Priming step. Traced as one `wardic.projection.measure` span annotated with the
   * node counts, how many nodes it seeded and how many rounds it ran.
   */
  const measurePass: Effect.Effect<void> = Effect.suspend(() => {
    passQueued = false
    const seeded = new Set<NodeState>()
    let rounds = 0
    inPass = true
    try {
      do {
        triggeredDuringPass = false
        rounds++
        sink.flushPass(() => runMeasurePass(seeded))
      } while (triggeredDuringPass && rounds < MAX_ROUNDS)
    } finally {
      inPass = false
    }
    if (triggeredDuringPass) {
      triggeredDuringPass = false
      debug("measure round cap", { rounds })
      leftover = setTimeout(() => {
        leftover = undefined
        scheduleMeasure()
      }, 0)
    }
    return Effect.annotateCurrentSpan({ nodes: nodes.size, active: active.size, seeded: seeded.size, rounds }).pipe(
      Effect.andThen(nextMicrotask),
      Effect.andThen(Effect.sync(() => primingStep(seeded))),
    )
  }).pipe(Effect.withSpan("wardic.projection.measure"))

  /**
   * Queue the Measure pass for the end of the current task (one per task, however
   * many triggers). A trigger while a pass runs its rounds repeats the pass instead.
   * The fiber reaches `nextMicrotask` synchronously and resumes inside that
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
        nextMicrotask.pipe(
          Effect.andThen(measurePass),
          Effect.tapCause((cause) => Effect.logError("wardic.projection: measure pass failed", cause)),
        ),
      ),
    )
  }

  /**
   * The **Priming step** (ADR-0018): one nominal-dt step for each node the Measure
   * pass seeded that no tick has stepped since (a Cold start's Priming tick already
   * did; a node that settled or left is skipped), written into the gate for its next
   * Refresh frame. So a layout animation moves on the next painted frame whether the
   * Clock was idle or ticking. Only those nodes' groups are re-derived.
   */
  const primingStep = (seeded: ReadonlySet<NodeState>): void => {
    const primed = new Set<NodeState>()
    const settled: Array<NodeState> = []
    for (const node of seeded) {
      if (node.steppedSinceSeed || node.dragging || node.spring === undefined || !active.has(node)) continue
      const r = springStep(node.spring, NOMINAL_DT, 1, node.springOptions())
      node.spring = r.state
      node.steppedSinceSeed = true
      primed.add(node)
      if (r.done) settled.push(node)
    }
    if (primed.size === 0) return
    deriveGroup(groupOf(primed))
    finishSettled(settled)
  }

  // --- The coordinator (writes), one tick of the Clock. -----------------------
  const step = (dtRaw: number): void => {
    const dt = dtRaw > MAX_DT ? MAX_DT : dtRaw
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
      const r = springStep(node.spring, dt, 1, node.springOptions())
      node.spring = r.state
      node.steppedSinceSeed = true
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
      node.animating = false
      node.spring = undefined
      node.origin = undefined
      node.lastDelta = IDENTITY_DELTA
      active.delete(node)
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

  const ensureRunning = (): void => {
    if (tickFiber !== undefined || active.size === 0) return
    debug("coordinator: start", { active: active.size })
    // One span spans the WHOLE animation burst: it opens here and closes when
    // `stopTicking` interrupts the fiber (every node settled). On a devtool timeline
    // that's one bar per burst, with each measure pass that re-seeds mid-burst
    // appearing alongside. The per-tick `step` stays span-less (hot path).
    tickFiber = runtime.runFork(
      Effect.gen(function* () {
        const clock = yield* Clock
        yield* Stream.runForEach(clock.ticks, (dt) => Effect.sync(() => step(dt)))
      }).pipe(Effect.withSpan("wardic.projection.coordinator", { attributes: { active: active.size } })),
    )
  }

  const stopTicking = (): void => {
    if (tickFiber === undefined) return
    const fiber = tickFiber
    tickFiber = undefined // clear first so a re-entrant ensureRunning starts fresh
    debug("coordinator: stop")
    // Everything is at rest now — reset deltas to identity (belt-and-suspenders so
    // no stale carried-node delta lingers for a future tree walk).
    for (const node of nodes) node.lastDelta = IDENTITY_DELTA
    runtime.runFork(Fiber.interrupt(fiber))
  }

  /** Promote `node` to an animating Lead from `fromBox` → its own box (un-hide + move home). */
  const promoteFrom = (node: NodeState, fromBox: Box | undefined): void => {
    const ownBox = node.retained
    if (fromBox === undefined || ownBox === undefined || boxesEqual(fromBox, ownBox)) return
    node.origin = fromBox
    node.layoutBox = ownBox
    node.spring = initSpring({ from: 0 })
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
    cb?.()
  }

  /** Build a transient leaving-Follower node for a re-introduced (already-disposed) leaver. */
  const makeFollowerNode = (el: HTMLElement, layoutId: string, box: Box, onDone: () => void): NodeState => ({
    id: "", // a leaving Follower is driven via the Renderer, not the gate — no id needed
    element: el,
    springOptions: () => ({}),
    layoutId,
    seed: undefined,
    retained: box,
    origin: undefined,
    layoutBox: box,
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
    layoutRoot: false,
    layoutAnchor: undefined,
    dragging: false,
    grabBox: undefined,
    dragDelta: { x: 0, y: 0 },
    steppedSinceSeed: true,
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
        promoteFrom(twin, live.layoutBox ?? live.retained)
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
    const follower = makeFollowerNode(el, layoutId, recent.box, onDone)
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
      layoutId: opts.layoutId,
      seed: undefined,
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
      layoutRoot: opts.layoutRoot === true,
      layoutAnchor: opts.layoutAnchor,
      dragging: false,
      grabBox: undefined,
      dragDelta: { x: 0, y: 0 },
      steppedSinceSeed: true,
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
    ro?.observe(node.element)
    // Seed retained + write the identity projection on the next frame.
    scheduleMeasure()

    return {
      notify: scheduleMeasure,
      // --- drag (ADR-0016) -----------------------------------------------------
      dragStart: () => {
        if (node.dragging) return // idempotent — a re-fired start must not re-anchor mid-drag
        // Anchor at the grab-time slot; the node then tracks `grabBox + dragDelta`.
        node.grabBox = node.layoutBox ?? node.retained
        if (node.grabBox === undefined) return // not measured yet — nothing to anchor
        debug("dragStart", { id: node.id })
        node.dragging = true
        node.dragDelta = { x: 0, y: 0 }
        node.spring = undefined
        node.origin = undefined
        node.animating = false
        active.add(node)
        ensureRunning()
      },
      dragMove: (delta) => {
        if (!node.dragging) return
        node.dragDelta = delta // the tick re-derives `grabBox + delta` next frame
      },
      dragEnd: () => {
        if (!node.dragging || node.grabBox === undefined) return
        debug("dragEnd", { id: node.id })
        const visual = offsetBox(node.grabBox, node.dragDelta)
        const slot = node.layoutBox ?? node.grabBox
        node.dragging = false
        node.grabBox = undefined
        node.dragDelta = { x: 0, y: 0 }
        if (boxesEqual(visual, slot)) {
          // No travel (released in place at its slot) — settle now, no FLIP.
          node.animating = false
          node.spring = undefined
          node.origin = undefined
          node.lastDelta = IDENTITY_DELTA
          active.delete(node)
          if (active.size === 0) stopTicking()
          return
        }
        // FLIP from the dragged visual position to the current slot, via the layout spring.
        node.origin = visual
        node.layoutBox = slot
        node.spring = initSpring({ from: 0 })
        node.animating = true
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
        // Stack relegation / promotion (ADR-0010): a leaving Lead promotes the new
        // newest node, animating it FROM the leaver's box (un-hide + move home).
        if (node.layoutId !== undefined) {
          const stack = stacks.get(node.layoutId)
          if (stack !== undefined) {
            const wasLead = stack[stack.length - 1] === node
            const i = stack.indexOf(node)
            if (i >= 0) stack.splice(i, 1)
            if (stack.length === 0) stacks.delete(node.layoutId)
            else if (wasLead) promoteFrom(stack[stack.length - 1]!, node.layoutBox ?? node.retained)
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
  }

  return { register, notify: scheduleMeasure, handleLeave, dispose }
}
