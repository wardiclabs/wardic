/**
 * The box-based projection system (ADR-0009) — the binding half of the layout
 * engine. Provider-owned (one per `WardicProvider`, like the flush gate), it
 * holds the projection nodes, the trigger sources, and the Clock-driven
 * coordinator that derives each node's transform every frame.
 *
 * Pipeline (the locked design):
 *   - REGISTER a node (its gate `id`, `element`, and a `springOptions` accessor).
 *   - TRIGGER (registration / a shared `ResizeObserver` size change /
 *     `layoutDependency` via `notify`) -> `gate.scheduleMeasure(measurePass)`.
 *   - MEASURE pass (in the gate's pre-flush read-queue, D4): re-measure EVERY
 *     node's untransformed box (Q5); compute the projection TREE by DOM ancestry
 *     (each node's parent = the nearest ancestor ELEMENT that is a registered node);
 *     for each node that moved, set up an animation (origin + target) and seed the
 *     progress-0 frame; start the coordinator.
 *   - COORDINATOR (a single Clock-driven fiber, ref-counted ACTIVE while >=1 node
 *     animates, Q4): each tick steps every active node's progress spring, then
 *     `deriveAll()` walks the active nodes TOP-DOWN (ancestors first) computing
 *     each node's `projectionDelta` + `treeScale` via `applyTreeDeltas` over its
 *     animating ancestors' deltas, and writes the `@projection` value (the renderer
 *     assembles the transform). On settle it drops the node; when none remain it
 *     interrupts the fiber (idle = zero cost).
 *
 * Nesting (P1b-ii-a): parent links come from a DOM-ancestry WALK (CSS composes by
 * DOM nesting, so that is exactly what projection must follow), and a child's box
 * is corrected for its ancestors' transforms via `applyTreeDeltas` (+ `treeScale`).
 * This is correct for nested SCALE and for nested layout with SYNCHRONIZED
 * transitions. The `relativeTarget` re-anchoring that keeps a child glued to a
 * parent on DIFFERENT transitions ("not left behind") is P1b-ii-b.
 */
import {
  applyTreeDeltas,
  type Box,
  boundsToBox,
  calcBoxDelta,
  Clock,
  type Delta,
  initSpring,
  MAX_DT,
  mixBox,
  type Point,
  PROJECTION_KEY,
  type SpringOptions,
  type SpringState,
  springStep,
} from "@wardic/core"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import type { FlushGate } from "./gate.ts"
import { measureLayoutBox } from "./measure.ts"
import type { WardicRuntime } from "./provider.tsx"

/** Identity tree-scale (no ancestor scaling). */
const TREE_SCALE_IDENTITY: Point = { x: 1, y: 1 }

/** The resting projection delta — element at its real box (a no-op in applyTreeDeltas). */
const IDENTITY_DELTA: Delta = {
  x: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 },
  y: { translate: 0, scale: 1, origin: 0.5, originPoint: 0 },
}

/** Structural equality of two boxes on the geometry that matters for a FLIP. */
const boxesEqual = (a: Box, b: Box): boolean =>
  a.x.min === b.x.min && a.x.max === b.x.max && a.y.min === b.y.min && a.y.max === b.y.max

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
}

/** Handle returned from {@link ProjectionSystem.register}. */
export interface ProjectionNodeHandle {
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
  /** Tear down the coordinator fiber + observer (wired into the provider's onCleanup). */
  readonly dispose: () => void
}

/** Per-node mutable state held by the system. */
interface NodeState {
  readonly id: string
  readonly element: HTMLElement
  readonly springOptions: () => SpringOptions
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
}

/**
 * Build a projection system against the provider `runtime` + flush `gate`.
 *
 * Forks the coordinator on `runtime` directly (NOT via `runScoped`, to avoid a
 * provider↔projection import cycle); the provider disposes the system in its own
 * `onCleanup`.
 */
export const makeProjectionSystem = (runtime: WardicRuntime, gate: FlushGate): ProjectionSystem => {
  const nodes = new Set<NodeState>()
  const active = new Set<NodeState>()
  // Element -> node, for the DOM-ancestry parent walk.
  const elementToNode = new Map<HTMLElement, NodeState>()
  // The Clock-driven coordinator fiber, present only while >=1 node animates.
  let tickFiber: Fiber.Fiber<void, never> | undefined
  // One shared ResizeObserver for size triggers (created lazily; happy-dom/SSR-safe).
  let ro: ResizeObserver | undefined

  /** Write a node's per-frame `@projection` value into the gate (Option A). */
  const writeProjection = (node: NodeState, delta: Delta, treeScale: Point): void => {
    gate.write(node.id, { [PROJECTION_KEY]: { delta, treeScale } })
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
      p = p.parent
    }
    return false
  }

  /**
   * Derive + write one node's projection for the current frame. An ANIMATING node
   * targets its mixed box (its own FLIP); a CARRIED node (own box unchanged, but an
   * ancestor is animating) targets its real box, so applyTreeDeltas yields the
   * counter-transform that keeps it visually put while the ancestor moves/scales.
   */
  const derive = (node: NodeState): void => {
    const box = node.layoutBox ?? node.retained
    if (box === undefined) return
    const targetBox =
      node.animating && node.origin !== undefined && node.spring !== undefined
        ? mixBox(node.origin, box, node.spring.position)
        : box
    const { box: layoutCorrected, treeScale } = applyTreeDeltas(box, ancestorDeltas(node))
    // delta source is the element's REAL box pushed through ancestor transforms;
    // target is where it should appear.
    const delta = calcBoxDelta(layoutCorrected, targetBox)
    node.lastDelta = delta
    writeProjection(node, delta, treeScale)
  }

  /**
   * Derive every node that is animating OR carried by an animating ancestor,
   * TOP-DOWN (by depth) — so a child reads its ancestors' fresh `lastDelta`.
   */
  const deriveAll = (): void => {
    const toDerive = [...nodes].filter((n) => active.has(n) || hasActiveAncestor(n))
    toDerive.sort((a, b) => a.depth - b.depth)
    for (const node of toDerive) derive(node)
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

  // --- The measure pass (reads), run in the gate's pre-flush read-queue. ------
  const measurePass = (): void => {
    for (const node of nodes) {
      const newBox = boundsToBox(measureLayoutBox(node.element))
      const prev = node.retained
      node.retained = newBox

      if (prev === undefined) {
        // First measure: seed retained, NO FLIP. Write an identity projection so a
        // layout element is consistently projection-owned from mount (its animated
        // translate/scale are ignored, rotate/skew woven — matches Motion). A nested
        // first-mount node is carried by its ancestors via CSS (identity own transform).
        node.lastDelta = IDENTITY_DELTA
        writeProjection(node, IDENTITY_DELTA, TREE_SCALE_IDENTITY)
        continue
      }

      // Skip a node that did not move and is not mid-animation.
      if (boxesEqual(prev, newBox) && !node.animating) continue

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
    }

    // Parent links must be fresh before the tree-aware derive (structure may have
    // changed). Then seed the initial (progress-0) frame for new movers, top-down.
    computeTree()
    deriveAll()
    ensureRunning()
  }

  /** Enqueue a coalesced measure pass (gate dedups by the stable `measurePass` ref). */
  const scheduleMeasure = (): void => gate.scheduleMeasure(measurePass)

  // --- The coordinator (writes), one tick of the Clock. -----------------------
  const step = (dtRaw: number): void => {
    const dt = dtRaw > MAX_DT ? MAX_DT : dtRaw
    const settled: Array<NodeState> = []
    // 1) Step every active node's progress spring (no derive yet — the tree-aware
    //    derive needs ALL springs advanced before computing parent-first).
    for (const node of active) {
      if (node.spring === undefined) {
        settled.push(node)
        continue
      }
      const r = springStep(node.spring, dt, 1, node.springOptions())
      node.spring = r.state
      if (r.done) settled.push(node)
    }
    // 2) Derive all top-down (settled nodes are still in `active` here, so their
    //    progress=1 identity-ish delta is available to descendants this frame).
    deriveAll()
    // 3) Finalise settled nodes: at rest, projection-owned at identity.
    for (const node of settled) {
      node.animating = false
      node.spring = undefined
      node.origin = undefined
      node.lastDelta = IDENTITY_DELTA
      active.delete(node)
    }
    if (active.size === 0) stopTicking()
  }

  const ensureRunning = (): void => {
    if (tickFiber !== undefined || active.size === 0) return
    tickFiber = runtime.runFork(
      Effect.gen(function* () {
        const clock = yield* Clock
        yield* Stream.runForEach(clock.ticks, (dt) => Effect.sync(() => step(dt)))
      }),
    )
  }

  const stopTicking = (): void => {
    if (tickFiber === undefined) return
    const fiber = tickFiber
    tickFiber = undefined // clear first so a re-entrant ensureRunning starts fresh
    // Everything is at rest now — reset deltas to identity (belt-and-suspenders so
    // no stale carried-node delta lingers for a future tree walk).
    for (const node of nodes) node.lastDelta = IDENTITY_DELTA
    runtime.runFork(Fiber.interrupt(fiber))
  }

  const register: ProjectionSystem["register"] = (opts) => {
    const node: NodeState = {
      id: opts.id,
      element: opts.element,
      springOptions: opts.springOptions,
      retained: undefined,
      origin: undefined,
      layoutBox: undefined,
      spring: undefined,
      animating: false,
      parent: undefined,
      depth: 0,
      lastDelta: IDENTITY_DELTA,
    }
    nodes.add(node)
    elementToNode.set(node.element, node)
    if (ro === undefined && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => scheduleMeasure())
    }
    ro?.observe(node.element)
    // Seed retained + write the identity projection on the next frame.
    scheduleMeasure()

    return {
      notify: scheduleMeasure,
      dispose: () => {
        ro?.unobserve(node.element)
        elementToNode.delete(node.element)
        active.delete(node)
        nodes.delete(node)
        if (active.size === 0) stopTicking()
      },
    }
  }

  const dispose: ProjectionSystem["dispose"] = () => {
    stopTicking()
    ro?.disconnect()
    ro = undefined
    active.clear()
    nodes.clear()
    elementToNode.clear()
  }

  return { register, notify: scheduleMeasure, dispose }
}
