/**
 * The box-based projection system (ADR-0009) — the reusable DOM half of the
 * layout engine. It holds the projection nodes, the trigger sources, and the
 * Clock-driven coordinator that derives each node's transform every frame.
 *
 * It has NO framework reactivity: it reaches its host binding through two seams
 * only — a {@link ProjectionSink} (`write` per-element projection values into the
 * binding's flush gate + `scheduleMeasure` a coalesced pre-flush read pass) and a
 * `ManagedRuntime` providing {@link Clock} (to fork the ref-counted tick fiber).
 * So it lives here in `@wardic/dom`, next to `ClockDomLive`/the Renderer, and any
 * binding (Solid today; React/vanilla later) wires it with its own gate + runtime.
 *
 * Pipeline (the locked design):
 *   - REGISTER a node (its gate `id`, `element`, and a `springOptions` accessor).
 *   - TRIGGER (registration / a shared `ResizeObserver` size change /
 *     `layoutDependency` via `notify`) -> `sink.scheduleMeasure(measurePass)`.
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
  placeRelativeBox,
  type Point,
  PROJECTION_KEY,
  Renderer,
  type SpringOptions,
  type SpringState,
  springStep,
} from "@wardic/core"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import type * as ManagedRuntime from "effect/ManagedRuntime"
import * as Stream from "effect/Stream"
import { isScrollRoot, measureDocumentScroll, measureLayoutBox, measureScroll } from "./measure.ts"
import { isUnitScale, SCALE_CORRECTORS, type ScaleCorrector } from "./scale-correction.ts"

/**
 * The binding seam the coordinator writes through — structurally satisfied by the
 * binding's flush gate (e.g. `@wardic/solid`'s `FlushGate`), so the engine never
 * imports a framework. `write` merges a per-element projection value-map into the
 * gate; `scheduleMeasure` enqueues a coalesced read pass that runs in the gate's
 * pre-flush read-queue (reads-before-writes, one rAF).
 */
export interface ProjectionSink {
  readonly write: (id: string, partial: Record<string, unknown>) => void
  readonly scheduleMeasure: (pass: () => void) => void
}

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
  /**
   * Shared-element match key (ADR-0010). Enrols the node in the per-`layoutId`
   * lead/follow stack so coexisting twins crossfade. Omitted for a plain `layout`
   * node.
   */
  readonly layoutId?: string
  /**
   * The switch-gap seed origin (ADR-0010): the leaver's last box, **captured by
   * the binding synchronously at mount** (the accessor returns that captured value,
   * NOT a live registry read — by the first measure pass the registry slot may be
   * cleared). When it yields a box AND no live twin is in the stack, the node's
   * FIRST measure animates FROM that box to its own (a switch), instead of the
   * no-FLIP identity seed.
   */
  readonly seedOrigin?: () => Box | undefined
  /**
   * Mark this element as a scroll container (ADR-0012, Motion's `layoutScroll`):
   * its scroll offset is sampled at measure and folded out of its descendants'
   * boxes, so a scroll change BETWEEN triggers doesn't leak into their FLIP delta.
   */
  readonly layoutScroll?: boolean
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
  /** Switch-gap seed-origin accessor (returns the binding's mount-captured leaver box). */
  readonly seedOrigin: (() => Box | undefined) | undefined
  /** Marked a scroll container (ADR-0012): its scroll is sampled + folded out of descendants. */
  readonly isScroll: boolean
  /** This scroll container's offset, sampled at measure (`{0,0}` for a non-scroll node). */
  scroll: Point
  /** Whether this (scroll) node is `position: fixed` — a scroll root (resets the fold). */
  isScrollRoot: boolean
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
}

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
  // AFTER dispose can re-introduce it as a leaving Follower (cleared next microtask).
  const recentLeavers = new Map<HTMLElement, { readonly layoutId: string; readonly box: Box }>()

  // The Renderer's pure halves, resolved once (like the gate) — used to drive a
  // presence-retained leaving Follower DIRECTLY (its gate registration is gone).
  const renderer = runtime.runSync(
    Effect.gen(function* () {
      return yield* Renderer
    }),
  )

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

  /** A delta with ~no scale on either axis (a pure-translate projection). */
  const isUnscaled = (d: Delta): boolean =>
    Math.abs(d.x.scale - 1) < 1e-3 && Math.abs(d.y.scale - 1) < 1e-3

  /**
   * The node's relativeParent (ADR-0009 / Motion's getClosestProjectingParent):
   * the nearest ANIMATING ancestor with ~no scale distortion. A child re-anchors
   * to its relativeParent's CURRENT target each frame, so it stays glued even when
   * parent and child run DIFFERENT transitions ("not left behind"). Scaling
   * ancestors are skipped (relative placement through a scaled frame is unsound);
   * the node then projects ABSOLUTELY.
   */
  const relativeParentOf = (node: NodeState): NodeState | undefined => {
    let p = node.parent
    while (p !== undefined) {
      if (active.has(p) && p.animating && p.origin !== undefined && p.layoutBox !== undefined && isUnscaled(p.lastDelta)) {
        return p
      }
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

    const rp = relativeParentOf(node)
    let targetBox: Box
    if (rp !== undefined && rp.origin !== undefined && rp.layoutBox !== undefined && rp.lastTarget !== undefined) {
      // RELATIVE: track the (pure-translate, animating) parent. Use the node's OWN
      // progress while it animates; once its own spring is done — or if it never
      // animated (a carried child) — it sits at its final relative offset and KEEPS
      // tracking the parent (so a fast child does not detach from a slow parent).
      const progress = node.animating && node.spring !== undefined ? node.spring.position : 1
      const relFrom = node.origin !== undefined ? calcRelativeBox(node.origin, rp.origin) : calcRelativeBox(box, rp.layoutBox)
      const relTo = calcRelativeBox(box, rp.layoutBox)
      const relTarget = mixBox(relFrom, relTo, progress)
      targetBox = placeRelativeBox(relTarget, rp.lastTarget)
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
   * Fold scroll out of `box` (ADR-0012) → a scroll-stable (content-frame) box. ADDS
   * each `layoutScroll` ancestor's scroll (Motion's `removeElementScroll` adds the
   * offset back to undo the scroll's visual effect), stopping at a `position: fixed`
   * scroll-root ancestor, and adds the document/page scroll unless the node sits in a
   * scroll root. No-op on the non-scroll path (no isScroll ancestors + zero page
   * scroll ⇒ box unchanged), so it never perturbs ordinary layout animation.
   */
  const foldScroll = (node: NodeState, box: Box, documentScroll: Point): Box => {
    if (node.isScroll && node.isScrollRoot) return box // a fixed node is itself viewport-relative
    let dx = 0
    let dy = 0
    let pageApplies = true
    for (let p = node.parent; p !== undefined; p = p.parent) {
      if (!p.isScroll) continue
      dx += p.scroll.x
      dy += p.scroll.y
      if (p.isScrollRoot) {
        // A fixed scroll-root ancestor: its own scroll applies, but its subtree is
        // viewport-relative — nothing OUTSIDE it (further containers, the page) does.
        pageApplies = false
        break
      }
    }
    if (pageApplies) {
      dx += documentScroll.x
      dy += documentScroll.y
    }
    if (dx === 0 && dy === 0) return box
    return { x: { min: box.x.min + dx, max: box.x.max + dx }, y: { min: box.y.min + dy, max: box.y.max + dy } }
  }

  // --- The measure pass (reads), run in the gate's pre-flush read-queue. ------
  const measurePass = (): void => {
    // Parent links + depth FIRST (DOM-ancestry only, box-independent): the scroll
    // fold walks the ancestor chain, and we measure ancestors-first so each scroll
    // container's offset is sampled before a descendant folds it in.
    computeTree()
    const documentScroll = measureDocumentScroll()
    const ordered = [...nodes].sort((a, b) => a.depth - b.depth)
    for (const node of ordered) {
      const viewportBox = boundsToBox(measureLayoutBox(node.element))
      if (node.isScroll) {
        node.scroll = measureScroll(node.element)
        node.isScrollRoot = isScrollRoot(node.element)
      }
      // Store the box in the SCROLL-STABLE frame (ADR-0012), so a scroll change
      // between triggers doesn't leak into the delta.
      const newBox = foldScroll(node, viewportBox, documentScroll)
      const prev = node.retained
      node.retained = newBox
      // Read scale-correction bases ONCE (ADR-0011), the first time we measure this
      // node — i.e. before any correction is written. Re-reading would pick up our
      // OWN corrected inline value (inline overrides the stylesheet) and compound the
      // radius/shadow each frame. (A node's authored radius changing mid-life is the
      // documented v0.1 limit.)
      if (node.correctorBases === undefined) node.correctorBases = readBases(node.element)

      if (prev === undefined) {
        // First measure — detection priority (ADR-0010):
        // (1) CROSSFADE: a LIVE prior twin already in this node's stack → animate
        //     FROM the prior lead's box (the prior twins become Followers locked
        //     onto us, fading out via the stack derive). Takes priority over the
        //     registry switch seed — the live twin's box is authoritative.
        const priorLead = priorLeadOf(node)
        const priorBox = priorLead !== undefined ? (priorLead.layoutBox ?? priorLead.retained) : undefined
        if (priorBox !== undefined && !boxesEqual(priorBox, newBox)) {
          node.origin = priorBox
          node.layoutBox = newBox
          node.spring = initSpring({ from: 0 })
          node.animating = true
          active.add(node)
          continue
        }
        // (2) SWITCH: a `layoutId` enterer whose binding captured a leaver box
        //     (seedOrigin) — no live twin in the stack — FLIPs from that box to its
        //     own measured box (a move, no crossfade — the leaver is gone).
        const seed = node.seedOrigin?.()
        if (seed !== undefined && !boxesEqual(seed, newBox)) {
          node.origin = seed
          node.layoutBox = newBox
          node.spring = initSpring({ from: 0 }) // progress spring restarts at 0
          node.animating = true
          active.add(node)
          continue
        }
        // No seed: seed retained, NO FLIP. Write an identity projection so a layout
        // element is consistently projection-owned from mount (its animated
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

    // Seed the initial (progress-0) frame for new movers, top-down. (Parent links
    // were computed at the top of the pass, before the scroll fold.)
    deriveAll()
    ensureRunning()
  }

  /** Enqueue a coalesced measure pass (gate dedups by the stable `measurePass` ref). */
  const scheduleMeasure = (): void => sink.scheduleMeasure(measurePass)

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
    seedOrigin: undefined,
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
  })

  const handleLeave: ProjectionSystem["handleLeave"] = (el, onDone) => {
    const live = elementToNode.get(el)
    const recent = recentLeavers.get(el)
    const layoutId = live?.layoutId ?? recent?.layoutId
    if (layoutId === undefined) return false

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
      if (active.has(leadOf(layoutId)!)) deriveAll()
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
    nodes.add(follower)
    elementToNode.set(el, follower)
    stack.splice(stack.length - 1, 0, follower) // insert below the Lead
    computeTree()
    if (active.has(lead)) deriveAll()
    else finishLeaver(follower)
    return true
  }

  const register: ProjectionSystem["register"] = (opts) => {
    const node: NodeState = {
      id: opts.id,
      element: opts.element,
      springOptions: opts.springOptions,
      layoutId: opts.layoutId,
      seedOrigin: opts.seedOrigin,
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
    }
    nodes.add(node)
    elementToNode.set(node.element, node)
    // Enrol in the per-`layoutId` stack: newest → Lead; prior entries are relegated
    // to Followers (the crossfade is detected from the stack at first measure).
    if (node.layoutId !== undefined) {
      let stack = stacks.get(node.layoutId)
      if (stack === undefined) {
        stack = []
        stacks.set(node.layoutId, stack)
      }
      stack.push(node)
    }
    if (ro === undefined && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => scheduleMeasure())
    }
    ro?.observe(node.element)
    // Seed retained + write the identity projection on the next frame.
    scheduleMeasure()

    return {
      notify: scheduleMeasure,
      dispose: () => {
        // A leaving Follower's removal is owned by finishLeaver (presence retained
        // it for the crossfade); a plain dispose must NOT tear it down here.
        if (node.leaving) return
        // Record the box so a presence handleLeave arriving AFTER this dispose can
        // re-introduce the leaver as a Follower (bounded — cleared next microtask).
        if (node.layoutId !== undefined) {
          const box = node.layoutBox ?? node.retained
          if (box !== undefined) {
            recentLeavers.set(node.element, { layoutId: node.layoutId, box })
            queueMicrotask(() => recentLeavers.delete(node.element))
          }
        }
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
    stopTicking()
    ro?.disconnect()
    ro = undefined
    active.clear()
    nodes.clear()
    elementToNode.clear()
  }

  return { register, notify: scheduleMeasure, handleLeave, dispose }
}
