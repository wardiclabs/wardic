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
 *   - REGISTER a node (its gate `id`, `element`, and a `transition` accessor, ADR-0009 *Amendment (#171)*).
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
 * through CSS. A pointer move re-derives the dragged group. The drag is a layer on top of
 * the node's layout animation, which a grab leaves running; the release is a **Release
 * offset**, the drag target's distance from where the layout puts the node, springing to
 * zero per axis on top of it from the loop's next tick (ADR-0016, *Amendment (velocity
 * family)*).
 *
 * Nesting: parent links come from a DOM-ancestry WALK (CSS composes by DOM
 * nesting, so that is exactly what projection must follow), and a child's box is
 * corrected for its ancestors' transforms via `applyTreeDeltas` (+ `treeScale`)
 * for nested SCALE. For nested layout, an animating child with a pure-translate
 * animating ancestor uses RELATIVE projection (`relativeParentOf` + `derive`): it
 * re-anchors to its `relativeParent`'s CURRENT target each frame, so it stays
 * glued even when parent and child run DIFFERENT transitions ("not left behind").
 *
 * DOM ACCESS (#16, parked until a second Environment): the engine is meant to move into
 * `@wardic/core` behind a port its Environment implements, once a non-DOM Environment (canvas,
 * native) gives that port a second implementation to be shaped against. Until then, NEW DOM
 * access goes through a named read function in `measure.ts`, never inline here (no new
 * `getComputedStyle`, `getBoundingClientRect`, `parentElement` walk or `contains` in this file):
 * `measure.ts` is the port's surface, and #16 maps what this file still does inline.
 */
import * as Box from "@wardic/core/Box"
import type * as Frame from "@wardic/core/Frame"
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as Inertia from "@wardic/core/Inertia"
import * as Microtask from "@wardic/core/Microtask"
import type * as Point from "@wardic/core/Point"
import * as Probe from "@wardic/core/Probe"
import * as Projection from "@wardic/core/Projection"
import * as Renderer from "@wardic/core/Renderer"
import * as Spring from "@wardic/core/Spring"
import * as Machine from "@wardic/core/Machine"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import type * as Fiber from "effect/Fiber"
import * as Exit from "effect/Exit"
import * as FiberHandle from "effect/FiberHandle"
import * as FiberSet from "effect/FiberSet"
import * as Iter from "effect/Iterable"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { constFalse, constTrue, constVoid, identity } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as Scope from "effect/Scope"
import * as Str from "effect/String"
import * as UndefinedOr from "effect/UndefinedOr"
import { AtomRegistry } from "effect/reactivity"
import {
  type BoxSize,
  type Holdable,
  holdTransform,
  isHoldable,
  isScrollRoot,
  measureDocumentScroll,
  measureScroll,
  readBoxSize,
  readLayoutBox,
  releaseTransforms,
  type ScrollStyle,
  scrollStyleFrom,
  type TransformHold,
  type TransformStyle,
  takesFlowSpace,
  transformStyleFrom,
  transitionRunning,
} from "./measure.ts"
import { counted, watchPage, type Watched } from "./content-watch.ts"
import { pending as appearRuns } from "./appear.ts"
import { reportFailure } from "./report.ts"
import { blendRadius, borderRadiusCorrector, isUnitScale, SCALE_CORRECTORS, type ScaleCorrector, scaleRadius, ZERO_RADIUS } from "./scale-correction.ts"

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
 * What the engine needs from its Environment: the {@link FrameLoop} it runs the coordinator on
 * (ADR-0027, #75), the `Renderer` (to drive a presence-retained leaving Follower whose gate
 * registration was torn down on owner disposal — ADR-0010), and the `Probe`'s viewport, read
 * through the Environment's `AtomRegistry`, for the Resize block (ADR-0018, *Amendment (#45)*).
 */
export type ProjectionServices = FrameLoop.FrameLoop | Renderer.Renderer | Probe.Probe | AtomRegistry.AtomRegistry

/**
 * How the engine runs its Effects: synchronously, and forked. `ProjectionSystem.make` builds one
 * from its Layer's context, forking into its Scope (#132, ADR-0041); a test's `ManagedRuntime`
 * is one too.
 */
export interface ProjectionRuntime {
  readonly runSync: <A, E>(effect: Effect.Effect<A, E, ProjectionServices>) => A
  readonly runFork: <A, E>(effect: Effect.Effect<A, E, ProjectionServices>) => Fiber.Fiber<A, E>
}

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

/**
 * The crossfade's curves, Motion's (motion-dom 13.3.0, `projection/animation/mix-values.ts`,
 * `easeCrossfadeIn` / `easeCrossfadeOut`): over a handover's progress `p`, the Lead fades in over
 * its first half, `circOut` (`sin(acos(1 − p))`, motion-utils' `reverseEasing(circIn)`), and its
 * Followers fade out over 0.5–0.95, linearly. The twins are both opaque at the middle, so the
 * overlap is never see-through (#5, ADR-0010 *Amendment (#5)*). Past either end each holds, so a
 * spring's overshoot ends faded in and out. Per frame: early returns.
 */
const fadeInAt = (p: number): number => {
  if (p <= 0) return 0
  if (p >= 0.5) return 1
  return Math.sin(Math.acos(1 - p / 0.5))
}

/** {@link fadeInAt}'s twin: how far a Follower has faded out at progress `p`, 0 to 1. */
const fadeOutAt = (p: number): number => {
  if (p <= 0.5) return 0
  if (p >= 0.95) return 1
  return (p - 0.5) / 0.45
}

/** A `@projection` value under construction: its optional fields set only when present. */
type ValueDraft = { -readonly [K in keyof Projection.Value]: Projection.Value[K] }

/**
 * How long a window width change blocks the next Measure pass (ADR-0018, *Amendment (#39)*): Motion lifts
 * its block at 250 ms. A pass that runs sooner takes the block; with none, the engine runs one then.
 */
const RESIZE_BLOCK: Duration.Duration = Duration.millis(250)

/**
 * The next task: a 0 ms timer as an Effect, interrupted by clearing it (ADR-0025, *Amendment (#69)*,
 * decision 4). `Effect.sleep(0)` is only a yield, which a Scheduler may resume in this same task.
 */
const nextTask: Effect.Effect<void> = Effect.callback<void>((resume) => {
  const handle = setTimeout(() => resume(Effect.void), 0)
  return Effect.sync(() => clearTimeout(handle))
})

/** `value`, or `fallback` when it's `undefined`: `??` in its per-frame form, an early return. */
const definedOr = <A>(value: A | undefined, fallback: A): A => {
  if (Predicate.isUndefined(value)) return fallback
  return value
}

/** `box` moved by `by`, or `box` itself when `by` is the zero point. Per pass: no copy for the usual case. */
const offsetUnlessZero = (box: Box.Box, by: Point.Point): Box.Box => {
  if (by === ZERO_POINT) return box
  return offsetBox(box, by)
}

/** The patch a node's projection writes: its value, with its scale corrections when it has any. Per frame: an early return. */
const projectionPatchOf = (value: Projection.Value, corrected: Record<string, string> | undefined): Record<string, unknown> => {
  if (Predicate.isUndefined(corrected)) return { [Projection.KEY]: value }
  return { [Projection.KEY]: value, ...corrected }
}

/**
 * A node's `@projection` value, with the crossfade factor (ADR-0010), a handover's blended opacity and
 * rotation (*Amendment (#166)*) and the raise (ADR-0016) only when it carries them. A Follower's passes
 * pointer input through (*Amendment (#165)*). Per frame.
 */
const projectionValue = (
  delta: Projection.Delta,
  treeScale: Point.Point,
  opacity: number | undefined,
  raise: number | undefined,
  follower: boolean,
  rotate: number | undefined,
  blendOpacity: number | undefined,
): Projection.Value => {
  const value: ValueDraft = { delta, treeScale }
  if (Predicate.isNotUndefined(opacity)) value.opacity = opacity
  if (Predicate.isNotUndefined(blendOpacity)) value.blendOpacity = blendOpacity
  if (Predicate.isNotUndefined(rotate)) value.rotate = rotate
  if (Predicate.isNotUndefined(raise)) value.raise = raise
  if (follower) value.passesPointer = true
  return value
}

/**
 * Whether `a` and `b` draw the same (#27, ADR-0009 *Amendment (#27)*): every field the renderer reads,
 * each axis's translate and scale, the tree scale, the opacities, the rotation, the raise and the
 * pointer pass-through, and each axis's origin. Not `originPoint`, the engine's own, which moves with
 * a translating parent while nothing drawn changes. Per frame: statement `if`s, no allocation. Exported
 * for its test, not from the package.
 */
export const drawsSame = (a: Projection.Value, b: Projection.Value): boolean => {
  if (a.delta.x.translate !== b.delta.x.translate) return false
  if (a.delta.y.translate !== b.delta.y.translate) return false
  if (a.delta.x.scale !== b.delta.x.scale) return false
  if (a.delta.y.scale !== b.delta.y.scale) return false
  if (a.delta.x.origin !== b.delta.x.origin) return false
  if (a.delta.y.origin !== b.delta.y.origin) return false
  if (a.treeScale.x !== b.treeScale.x) return false
  if (a.treeScale.y !== b.treeScale.y) return false
  if (a.opacity !== b.opacity) return false
  if (a.blendOpacity !== b.blendOpacity) return false
  if (a.rotate !== b.rotate) return false
  if (a.raise !== b.raise) return false
  return a.passesPointer === b.passesPointer
}

/** How far `to` sits from `from`, by their top-left corners. */
const distanceBetween = (from: Box.Box, to: Box.Box): Point.Point => ({ x: to.x.min - from.x.min, y: to.y.min - from.y.min })

/** Whether a release has nothing to do: no offset, within {@link BOX_EPSILON}, and no velocity. */
const releasesInPlace = (offset: Point.Point, velocity: Point.Point): boolean =>
  Bool.every([Math.abs(offset.x) < BOX_EPSILON, Math.abs(offset.y) < BOX_EPSILON, velocity.x === 0, velocity.y === 0])

/**
 * A Release offset (ADR-0016, *Amendment (velocity family)*) from `offset`, each axis starting at
 * `velocity`'s, on `transition` with both edges at zero (*Amendment (#140)*).
 */
const releaseFrom = (offset: Point.Point, velocity: Point.Point, transition: DragTransition): Release => {
  const options: Machine.InertiaOptions = { ...transition, min: 0, max: 0 }
  const inertiaX = Inertia.resolve(offset.x, velocity.x, options)
  const inertiaY = Inertia.resolve(offset.y, velocity.y, options)
  return {
    x: offset.x,
    y: offset.y,
    stateX: Inertia.init(offset.x, inertiaX),
    stateY: Inertia.init(offset.y, inertiaY),
    inertiaX,
    inertiaY,
    options,
    stopped: false,
    told: false,
  }
}

/** Restart `release` from rest where it is (Motion's `stopAnimation`): its speed dropped, its edges kept. */
const restFrom = (release: Release): void => {
  release.inertiaX = Inertia.resolve(release.x, 0, release.options)
  release.inertiaY = Inertia.resolve(release.y, 0, release.options)
  release.stateX = Inertia.init(release.x, release.inertiaX)
  release.stateY = Inertia.init(release.y, release.inertiaY)
}

/**
 * Whether `node`'s element is `display: contents`, set inline (ADR-0009 *Amendment (#9)*, Motion's
 * `props.style.display === "contents"`): it lays out no box of its own, so it has none here. An
 * inline read, no style computed: once per node per Measure pass.
 */
const isBoxless = (node: NodeState): boolean => node.element.style.display === "contents"

/** The centre of a box. */
const centreOf = (box: Box.Box): Point.Point => ({ x: (box.x.min + box.x.max) / 2, y: (box.y.min + box.y.max) / 2 })

/** Below this an own scale has nothing to divide out (ADR-0010 *Amendment (#8)*): a pop-in from nothing. */
const OWN_SCALE_EPSILON = 1e-6

/** `1 / v`, or 1 where `v` is 0: an axis drawn at no size has nothing to divide out. Per frame. */
const invertScale = (v: number): number => {
  if (Math.abs(v) < OWN_SCALE_EPSILON) return 1
  return 1 / v
}

/** `box` scaled about its centre by `sx` and `sy` (ADR-0010 *Amendment (#8)*). Plain calls: per frame. */
const scaleAboutCentre = (box: Box.Box, sx: number, sy: number): Box.Box => {
  if (sx === 1 && sy === 1) return box
  const cx = (box.x.min + box.x.max) / 2
  const cy = (box.y.min + box.y.max) / 2
  const hw = ((box.x.max - box.x.min) / 2) * sx
  const hh = ((box.y.max - box.y.min) / 2) * sy
  return { x: { min: cx - hw, max: cx + hw }, y: { min: cy - hh, max: cy + hh } }
}

/** `box` moved by `dx` and `dy` (#363). Plain calls: per frame. */
const translateBox = (box: Box.Box, dx: number, dy: number): Box.Box => {
  if (dx === 0 && dy === 0) return box
  return { x: { min: box.x.min + dx, max: box.x.max + dx }, y: { min: box.y.min + dy, max: box.y.max + dy } }
}

/**
 * Where `node` is drawn when its projection puts it at `box` (ADR-0010 *Amendment (#8)*, #363): its
 * own scale on top, about the box's centre, and its own translate, as the renderer draws them
 * (Motion's `transformBox(targetWithTransforms, latestValues)`). Scaling about a box's own centre
 * and moving it commute, so the order doesn't matter.
 */
const drawnOf = (node: NodeState, box: Box.Box): Box.Box => {
  const own = node.ownScale()
  const moved = node.ownTranslate()
  return translateBox(scaleAboutCentre(box, own.x, own.y), moved.x, moved.y)
}

/**
 * Where `node`'s projection has to put it to be drawn at `box` (ADR-0010 *Amendment (#8)*, #363):
 * the inverse of {@link drawnOf}, its own translate taken back and its own scale divided out about
 * the box's centre. An axis at no own scale and no own translate keeps `box` as it is.
 */
const undrawnFor = (node: NodeState, box: Box.Box): Box.Box => {
  const own = node.ownScale()
  const moved = node.ownTranslate()
  return scaleAboutCentre(translateBox(box, -moved.x, -moved.y), invertScale(own.x), invertScale(own.y))
}

/** Whether `d` moves nothing: no translate, unit scale on both axes. */
const isIdentityDelta = (d: Projection.Delta): boolean =>
  d === IDENTITY_DELTA || (d.x.translate === 0 && d.y.translate === 0 && d.x.scale === 1 && d.y.scale === 1)

/** `p` reversed. */
const negate = (p: Point.Point): Point.Point => ({ x: -p.x, y: -p.y })

/** The point of `box` at the 0–1 `anchor` (ADR-0013's relative anchor). */
const anchorPointOf = (box: Box.Box, anchor: Point.Point): Point.Point => ({
  x: box.x.min + (box.x.max - box.x.min) * anchor.x,
  y: box.y.min + (box.y.max - box.y.min) * anchor.y,
})

/**
 * A layout animation's transition (ADR-0009 *Amendment (#171)*): a spring, its fields and its
 * `delay`; or a tween, its `duration`, `ease` (#360) and `delay`. A repeat means nothing for a flight
 * that lands once. A tween with no `duration` or `ease` takes the tween's own defaults, 0.3 s and
 * linear (a binding fills Motion's `easeOut` first, ADR-0051).
 */
export type LayoutTransition = ({ readonly type: "spring" } & Machine.SpringOptions) | ({ readonly type: "tween" } & Machine.TweenOptions)

/**
 * Motion's default layout transition (ADR-0009 *Amendment (#171)*; motion-dom 13.3.0,
 * `defaultLayoutTransition`): a 0.45 s tween, eased `cubic-bezier(0.4, 0, 0.1, 1)`, so a layout
 * animation lands on time.
 */
export const DEFAULT_LAYOUT_TRANSITION: LayoutTransition = { type: "tween", duration: 0.45, ease: [0.4, 0, 0.1, 1] }

/**
 * A drag's release (ADR-0016, *Amendment (#140)*, Motion's `dragTransition`): the inertia a node's
 * Release offset runs on, with both edges at its slot, so it springs back there on the bounce. Times in
 * seconds. Its edges are the slot's, never its own.
 */
export type DragTransition = Omit<Machine.InertiaOptions, "min" | "max">

/**
 * Motion's drag transition (framer-motion 13.4.0, `VisualElementDragControls.startAnimation`), with its
 * default `dragElastic`: a 0.75 s time constant, power 0.8, the bounce 200 / 40, at rest within 1 px and
 * 10 px/s. A node's Release offset runs on it when it's given none (ADR-0016, *Amendment (#140)*).
 */
export const DEFAULT_DRAG_TRANSITION: DragTransition = {
  power: 0.8,
  timeConstant: 0.75,
  bounceStiffness: 200,
  bounceDamping: 40,
  restDelta: 1,
  restSpeed: 10,
}

/**
 * A flight's transition, resolved at its start: a spring's options (its delay among them), or a
 * tween's timing, with the tween's own defaults where its transition gives none (#107).
 */
type FlightTiming =
  | { readonly kind: "spring"; readonly options: Spring.Resolved; readonly rest: Spring.Rest }
  | ({ readonly kind: "tween" } & Machine.ResolvedTween)

/**
 * Motion's layout progress spans 0 → 1000 (`create-projection-node.ts`'s `animationTarget`), this
 * one 0 → 1 (#344): a layout spring rests as Motion's does over 1000, its own `restDelta` and
 * `restSpeed` read in those units, both divided by it here.
 */
const MOTION_PROGRESS = 1000

/** A layout spring's options and its thresholds over Motion's progress (#344). */
const springTiming = (options: Spring.Resolved): FlightTiming => ({ kind: "spring", options, rest: Spring.restFor(options, MOTION_PROGRESS, MOTION_PROGRESS) })

/**
 * A layout animation's progress, 0 → 1 (ADR-0009 *Amendment (#171)*), on the transition resolved at its
 * start, Motion's: `position` is where it is (a spring's, past 1 on an overshoot; a tween's, eased),
 * `elapsed` its time so far, its delay included. Held at 0 through the delay. Stepped per frame, in place.
 */
interface Flight {
  position: number
  elapsed: number
  /** A spring's state, stepped toward 1; `undefined` for a tween. */
  spring: Spring.State | undefined
  readonly timing: FlightTiming
  /** Whether it has taken its first step: its start, for the app's callback (#191, ADR-0039). */
  started: boolean
  /** Whether it has landed on its own: its completion, for the app's callback and `onSettled` (#191). */
  landed: boolean
}

/**
 * A **Declared layout change**'s `onSettled` (#191, ADR-0039): the flights its end-of-task pass
 * started, each with its node, and the callbacks to call once every one has ended.
 */
interface Settling {
  readonly flights: ReadonlyArray<readonly [NodeState, Flight]>
  readonly callbacks: ReadonlyArray<() => void>
}

/**
 * A transition's timing for a flight. Once per (re)start; core decodes its bag once (#66), and one
 * it rejects throws its `SchemaError`.
 */
const timingOf = (transition: LayoutTransition): FlightTiming =>
  Match.value(transition).pipe(
    Match.discriminatorsExhaustive("type")({
      spring: (spring): FlightTiming => springTiming(Spring.resolve(spring)),
      tween: (tween): FlightTiming => ({ kind: "tween", ...Machine.resolveTween(tween) }),
    }),
  )

/** A flight already landed: what reduced motion starts (ADR-0029), at 1 with no delay, settling on its first step. */
const LANDED: FlightTiming = springTiming(Spring.resolve({}))

/** A flight at 1 on {@link LANDED}: it ends on its first step, the node on its new box. */
const landedFlight = (): Flight => ({ position: 1, elapsed: 0, spring: Spring.init({ from: 1 }), timing: LANDED, started: false, landed: false })


/**
 * What a Measure pass read of an ancestor whose transform moves a twin (ADR-0012, *Amendment
 * (#137)*): its transform origin on the page, with its transform held, and its transform then, as
 * a map. `undefined` map: the pass couldn't express it as a translate and a scale (a rotation or
 * skew, an individual `translate`/`scale`/`rotate` property, or a transform held by a running
 * transition), so a twin under it is converted as of the pass.
 */
interface AncestorRead {
  readonly origin: Point.Point
  readonly pass: PaintMap | undefined
}

/**
 * One ancestor of a twin whose transform moves it (ADR-0012, *Amendment (#137)*), in the twin's
 * frame: an element, by its origin and its transform at the pass, or a projection node, whose own
 * scale (#8) is drawn about its box's centre (`offset`: from the node's frame to the twin's).
 */
type PaintLink =
  | { readonly kind: "element"; readonly element: Element; readonly origin: Point.Point; readonly pass: PaintMap }
  | { readonly kind: "node"; readonly node: NodeState; readonly offset: Point.Point }

/** No links: an ancestor that doesn't move the twin, or the top of the chain. */
const NO_LINKS: ReadonlyArray<PaintLink> = []

/**
 * An axis-aligned map, `p → s·p + t` on each axis: a translate and a scale (ADR-0012, *Amendment
 * (#137)*). What a twin's ancestors' transforms do to its box, composed.
 */
interface PaintMap {
  readonly sx: number
  readonly sy: number
  readonly tx: number
  readonly ty: number
}

/**
 * A {@link PaintMap} being composed, outermost link first, written in place: a conversion allocates
 * this one map, not one per link (ADR-0025's per-frame forms).
 */
interface PaintAcc {
  sx: number
  sy: number
  tx: number
  ty: number
}

/** A translate `(tx, ty)` and a scale `(sx, sy)` about `origin`, as CSS composes them: `p → origin + t + s·(p − origin)`. Read phase. */
const mapAbout = (origin: Point.Point, tx: number, ty: number, sx: number, sy: number): PaintMap => ({
  sx,
  sy,
  tx: origin.x + tx - sx * origin.x,
  ty: origin.y + ty - sy * origin.y,
})

/** `acc`, then {@link mapAbout}'s map about `(ox, oy)`, written in place. Per frame: positional. */
const composeAbout = (acc: PaintAcc, ox: number, oy: number, tx: number, ty: number, sx: number, sy: number): void => {
  acc.tx += acc.sx * (ox + tx - sx * ox)
  acc.ty += acc.sy * (oy + ty - sy * oy)
  acc.sx *= sx
  acc.sy *= sy
}

/** `acc`, then `map`, written in place. Per frame. */
const composeMap = (acc: PaintAcc, map: PaintMap): void => {
  acc.tx += acc.sx * map.tx
  acc.ty += acc.sy * map.ty
  acc.sx *= map.sx
  acc.sy *= map.sy
}

/** One axis of `box` through `s·v + t`, min and max kept in order. */
const mapAxis = (axis: Box.Axis, s: number, t: number): Box.Axis => {
  const a = s * axis.min + t
  const b = s * axis.max + t
  return { min: Math.min(a, b), max: Math.max(a, b) }
}

/** `box` through `map`. Per frame. */
const mapBox = (map: PaintMap, box: Box.Box): Box.Box => ({ x: mapAxis(box.x, map.sx, map.tx), y: mapAxis(box.y, map.sy, map.ty) })

/** `box` back through `map`: its inverse, or `box` as it is when `map` collapses an axis. Per frame. */
const unmapBox = (map: PaintMap, box: Box.Box): Box.Box => {
  if (Math.abs(map.sx) < 1e-9) return box
  if (Math.abs(map.sy) < 1e-9) return box
  return { x: mapAxis(box.x, 1 / map.sx, -map.tx / map.sx), y: mapAxis(box.y, 1 / map.sy, -map.ty / map.sy) }
}

/** Whether a string ends in `px`: built once, since `Str.endsWith` builds its check per call. */
const endsWithPx = Str.endsWith("px")

/** A `px` string's number; `undefined` for any other unit. Per frame. */
const pxStringOf = (value: string): number | undefined => {
  if (endsWithPx(value)) return Number.parseFloat(value)
  return undefined
}

/** A translate value in px: absent (0), a number, or a `px` string; `undefined` for any other unit. Per frame. */
const pxOf = (value: unknown): number | undefined => {
  if (Predicate.isUndefined(value)) return 0
  if (Predicate.isNumber(value)) return value
  if (Predicate.isString(value)) return pxStringOf(value)
  return undefined
}

/** A scale value: absent (1), or a number; `undefined` for anything else. Per frame. */
const scaleOf = (value: unknown): number | undefined => {
  if (Predicate.isUndefined(value)) return 1
  if (Predicate.isNumber(value)) return value
  return undefined
}

/** The keys that would take a box out of axis alignment. */
const UNMAPPABLE_KEYS = ["rotate", "rotateX", "rotateY", "rotateZ", "skew", "skewX", "skewY"] as const
/** The keys a translate and a scale draw from (the renderer's order: translate, then scale). */
const MAPPABLE_KEYS = ["x", "y", "translateX", "translateY", "scale", "scaleX", "scaleY"] as const

/** Whether a value draws nothing: absent, or 0 in any unit. Per frame. */
const isZeroValue = (value: unknown): boolean => {
  if (Predicate.isUndefined(value)) return true
  if (Predicate.isNumber(value)) return value === 0
  if (Predicate.isString(value)) return Number.parseFloat(value) === 0
  return false
}

/** Whether `values` draw a rotation or a skew. Per frame. */
const drawsUnmappable = (values: Readonly<Record<string, unknown>>): boolean => {
  for (let i = 0; i < UNMAPPABLE_KEYS.length; i++) if (Bool.not(isZeroValue(values[UNMAPPABLE_KEYS[i]]))) return true
  return false
}

/** Whether `values` draw a translate or a scale: a transform of Wardic's. Per frame. */
const drawsTranslateOrScale = (values: Readonly<Record<string, unknown>>): boolean => {
  for (let i = 0; i < MAPPABLE_KEYS.length; i++) if (Predicate.isNotUndefined(values[MAPPABLE_KEYS[i]])) return true
  return false
}

/**
 * `acc`, then the translate and scale Wardic draws on an element from its `values`, about `origin`
 * (ADR-0012, *Amendment (#137)*). `false`, `acc` untouched, when its values draw none (no transform
 * key: not Wardic's) or one this can't map (a rotation or skew, a translate in another unit). Per
 * frame: each value checked in an early return.
 */
const composeValues = (acc: PaintAcc, values: Readonly<Record<string, unknown>>, origin: Point.Point): boolean => {
  if (drawsUnmappable(values)) return false
  if (Bool.not(drawsTranslateOrScale(values))) return false
  const x = pxOf(values.x)
  if (Predicate.isUndefined(x)) return false
  const y = pxOf(values.y)
  if (Predicate.isUndefined(y)) return false
  const translateX = pxOf(values.translateX)
  if (Predicate.isUndefined(translateX)) return false
  const translateY = pxOf(values.translateY)
  if (Predicate.isUndefined(translateY)) return false
  const scale = scaleOf(values.scale)
  if (Predicate.isUndefined(scale)) return false
  const scaleX = scaleOf(values.scaleX)
  if (Predicate.isUndefined(scaleX)) return false
  const scaleY = scaleOf(values.scaleY)
  if (Predicate.isUndefined(scaleY)) return false
  composeAbout(acc, origin.x, origin.y, x + translateX, y + translateY, scale * scaleX, scale * scaleY)
  return true
}

/** A number, or 0 when it isn't finite. */
const finiteOrZero = (n: number): number => Bool.match(Number.isFinite(n), { onTrue: () => n, onFalse: () => 0 })

/** One computed `transform-origin` component in px: 0 when it's missing. Read phase only. */
const originPxOf = (value: string | undefined): number =>
  UndefinedOr.match(value, { onUndefined: () => 0, onDefined: (s) => finiteOrZero(Number.parseFloat(s)) })

/** A computed `transform` as a matrix: `none` is the identity. Read phase only. */
const matrixOf = (transform: string): DOMMatrix =>
  Bool.match(transform === "none", { onTrue: () => new DOMMatrix(), onFalse: () => new DOMMatrix(transform) })

/** The element a link stands for: its own, or its node's. Read phase only. */
const linkElementOf = (link: PaintLink): Element =>
  Match.value(link).pipe(
    Match.discriminatorsExhaustive("kind")({
      node: (l) => l.node.element,
      element: (l) => l.element,
    }),
  )

/**
 * `box`, in `node`'s frame, as `node`'s ancestors paint it (ADR-0012, *Amendment (#136)*):
 * unchanged when none of them moves it. A twin whose chain the pass could map follows them as they
 * are now, its node ancestors' own scale included (*Amendment (#137)*); any other node, as the pass
 * found them. Per frame for a Follower.
 */
const paintedOf = (node: NodeState, box: Box.Box): Box.Box => {
  const live = node.paintMapNow
  if (Predicate.isNotUndefined(live)) return mapBox(live(), box)
  if (Predicate.isUndefined(node.paintDelta)) return box
  return Projection.applyBoxDelta(box, node.paintDelta)
}

/** A box as painted, in `node`'s frame: the inverse of {@link paintedOf}. */
const unpaintedOf = (node: NodeState, box: Box.Box): Box.Box => {
  const live = node.paintMapNow
  if (Predicate.isNotUndefined(live)) return unmapBox(live(), box)
  if (Predicate.isUndefined(node.unpaintDelta)) return box
  return Projection.applyBoxDelta(box, node.unpaintDelta)
}

/**
 * A box in twin `from`'s frame, in twin `to`'s (ADR-0012, *Amendment (#136)*): through
 * where it paints, so twins under different transforms meet on screen, and out of `from`'s fold
 * into `to`'s (*Amendment (#331)*), so twins in different scroll frames do too: a scrolled
 * container, or a `position: fixed` element, between them. The folds are the last pass's, sampled
 * with the page's scroll at `rootScroll`.
 */
const between = (from: NodeState, to: NodeState, box: Box.Box, rootScroll: Point.Point): Box.Box =>
  unpaintedOf(to, acrossFolds(from.fold, to.fold, paintedOf(from, box), rootScroll))

/**
 * `box` in a frame with `from` folded into it, moved into one with `to` (ADR-0012, *Amendment
 * (#331)*): `from`'s scroll taken out, `to`'s put in. `box` itself when the two add the same, as for
 * twins side by side. Per frame for a Follower.
 */
const acrossFolds = (from: Fold, to: Fold, box: Box.Box, rootScroll: Point.Point): Box.Box => {
  const fromRoot = rootShareOf(from, rootScroll)
  const toRoot = rootShareOf(to, rootScroll)
  const dx = to.x + toRoot.x - from.x - fromRoot.x
  const dy = to.y + toRoot.y - from.y - fromRoot.y
  if (dx === 0 && dy === 0) return box
  return offsetBox(box, { x: dx, y: dy })
}

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
   * The node's layout transition, read at each layout animation's (re)start (ADR-0009 *Amendment
   * (#171)*): a spring or a tween, or `None` for Motion's default,
   * {@link DEFAULT_LAYOUT_TRANSITION}.
   */
  readonly transition: () => Option.Option<LayoutTransition>
  /**
   * The app's `onLayoutAnimationStart` (#191, ADR-0039), read when it fires: at the frame where a
   * layout animation of this node takes its first step, once per animation (restarts in one task
   * are one). Not for a node that is a **Follower**: a handover is its Lead's. `None` when the app
   * has none.
   */
  readonly onLayoutAnimationStart?: () => Option.Option<() => void>
  /**
   * The app's `onLayoutAnimationComplete` (#191, ADR-0039), read when it fires: at the frame where
   * a layout animation of this node lands on its own. Not for one interrupted by a restart, finished
   * early by a window resize, or cut off by an unmount; not for a Follower. `None` when the app has
   * none.
   */
  readonly onLayoutAnimationComplete?: () => Option.Option<() => void>
  /**
   * The app's `onDragTransitionEnd` (#273, Motion's), read when it fires: once a drag's release (its
   * **Release offset**) comes to rest on its own, after that frame's flush; for a drag released in
   * place at rest, which starts none, from a microtask after the release. Not for one a grab stopped
   * and a drag took over, nor one an unmount or a resize ended. `None` when the app has none.
   */
  readonly onReleaseEnd?: () => Option.Option<() => void>
  /**
   * The node's drag transition, read at each release (ADR-0016, *Amendment (#140)*): what its Release
   * offset runs on, or `None` for Motion's, {@link DEFAULT_DRAG_TRANSITION}.
   */
  readonly dragTransition?: () => Option.Option<DragTransition>
  /**
   * Whether the node's layout animations honour reduced motion (ADR-0029), read at each
   * (re)start: `false` animates them whatever the system's `reducedMotion` says (a binding's
   * per-transition opt-out). Default `true`.
   */
  readonly respectReducedMotion?: () => boolean
  /**
   * The node's **Layout mode** (ADR-0009, *Amendment (#42)*), read at each layout animation's
   * start: which parts of a layout change it animates. Default `true`, position and size.
   */
  readonly layoutMode?: () => Projection.LayoutMode
  /**
   * The element's own scale per axis (ADR-0010 *Amendment (#8)*): its `scale` times its `scaleX` or
   * `scaleY`, which the renderer draws on top of its projection (`ownScaleOf`). Read at each
   * handover, and each frame a Follower is derived. Default `{ x: 1, y: 1 }`.
   */
  readonly ownScale?: () => Point.Point
  /**
   * The element's own translate (#363): its `x` plus `translateX` and `y` plus `translateY`, in
   * page pixels, which the renderer adds to its projection's (`ownTranslateOf`). Read where its own
   * scale is. Default `{ x: 0, y: 0 }`.
   */
  readonly ownTranslate?: () => Point.Point
  /**
   * The element's own `rotate` in degrees (ADR-0010 *Amendment (#166)*), which the renderer weaves
   * into its projection (`ownRotateOf`): what a handover blends a twin's rotation into, read each
   * frame of one. Default 0.
   */
  readonly ownRotate?: () => number
  /**
   * The element's own opacity (ADR-0010 *Amendment (#166)*, `ownOpacityOf`): what a Switch blends the
   * leaver's opacity into, read each frame of one, and a leaver's when it's already off the page.
   * Default 1.
   */
  readonly ownOpacity?: () => number
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
   * carries a raise the renderer emits as `z-index`, so it paints above its siblings, as
   * Motion's Reorder items do; then one last write drops it. It is `2` while dragged and
   * `1` once released, so the item under the pointer paints above one flying back
   * (*Amendment (velocity family)*, decision 6). A `<Reorder>` item sets it.
   */
  readonly raiseWhileDragged?: boolean
  /**
   * Where a presence child taking over from its leaver starts (#286, ADR-0048): the leaver's box in
   * the **Root frame**, as it painted ({@link ProjectionSystem.rootBoxOf}). The node's first measure
   * moves it from there to its own box, as a layout change, with no handover. A live twin to
   * crossfade from comes first; this comes before a Switch seed.
   */
  readonly enteredFrom?: Box.Box
  /**
   * Where the handover its first measure begins starts its fade (#286, ADR-0048): a keyed twin back
   * while its leaver crossfades out goes on from the factor that leaver had faded to
   * ({@link ProjectionSystem.dropLeaver}). Omitted, 0.
   */
  readonly fadeFrom?: number
}

/**
 * The drag seam (ADR-0016): a draggable LAYOUT node drives its drag through the
 * projection target, not a raw `x`/`y` transform: the node's own `x`/`y` are its
 * animations', drawn on top (#363). The binding's drag track
 * calls these so the dragged element follows the pointer and FLIPs to its slot on
 * release. A subset of {@link ProjectionNodeHandle}.
 */
export interface DragProjectionHandle {
  /**
   * Begin a drag: capture the grab-time slot box as the pointer anchor, from where a stopped
   * release left the node; hold the node active. A layout animation running at the grab runs
   * on under the drag.
   */
  readonly dragStart: () => void
  /**
   * The live pointer translate from the grab point — the node tracks `grabBox + delta`.
   * Re-derives the dragged group into the sink at once, so the gate's next flush paints it.
   */
  readonly dragMove: (delta: Point.Point) => void
  /**
   * End the drag: from the loop's next tick, the drag target's distance from where the layout
   * puts the node springs to zero on each axis (a **Release offset**), starting at `velocity`
   * (px/s; at rest when omitted) on top of the node's layout animation.
   */
  readonly dragEnd: (velocity?: Point.Point) => void
  /**
   * A grab (a press on the element): stop a running release where it is, as Motion's drag
   * stops its offset at the press. A drag that follows continues from there.
   */
  readonly stopRelease: () => void
  /** A press that ends with no drag: start a stopped release again, from rest. */
  readonly resumeRelease: () => void
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
  readonly layoutBox: () => Option.Option<Box.Box>
  /**
   * How far the node paints from its slot while dragged (the drag target minus the
   * slot, per axis, leaving out a layout animation the grab left running); `{ x: 0, y: 0 }`
   * otherwise, the release included.
   */
  readonly dragOffset: () => Point.Point
  /**
   * A count that rises with every Measure pass round that measures the node (a
   * blocked one included); 0 before the first. A **Reorder group** waits on it after
   * a reorder, as on Motion's former `layoutVersion` counter (removed in motion-dom
   * 13.4.5).
   */
  readonly layoutVersion: () => number
  /**
   * A **Keyboard reorder**'s lift (ADR-0037): `true` raises the node as a drag does (`2`) while it's
   * lifted, through the layout animations its steps start; `false` (its drop or cancel) leaves it
   * raised (`1`) until its last one lands, as a drag's release does, or drops the raise now at rest.
   */
  readonly lift: (on: boolean) => void
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
   * A **Declared layout change** (#4, ADR-0038): run `fn`, and animate the layout change it makes
   * from where every node is at the call, even where no trigger sees the change or a node's last
   * Measurement is out of date. Returns `fn`'s result; its error throws to the caller.
   *
   * - **The Measurements.** The first call in a task measures every node before `fn` runs. A
   *   Measure pass already due in the task runs then instead, so what triggered it animates as
   *   before, and its reads are the Measurements. Later calls in the task share them, so a node
   *   one call's change pushes animates from before the first change (Motion's
   *   `parallel-calls-intersecting`).
   * - **The pass.** The Measure pass at the end of the task animates every node that moved from
   *   those Measurements. A running animation `fn` moves restarts from where it paints (ADR-0013,
   *   *Amendment (#146)*); one it doesn't move carries on.
   * - **What stays as in any pass.** A **Resize block** wins: `fn` runs and nothing animates. A
   *   dragged subtree takes its slot-only update. A call from inside a pass's own flush uses the
   *   reads that pass just made.
   * - **Synchronous only.** A promise `fn` returns isn't awaited: a change after an `await` is in
   *   a later task. Such a call logs a warning.
   * - **`onSettled`** (#191, ADR-0039) is called once the change has settled: every layout animation
   *   the end-of-task pass started has ended, however each ended (landed, cut short by a resize or an
   *   unmount, or restarted by a later change), or at the end of that pass if it started none. Calls
   *   in one task share that pass, so they settle together.
   */
  readonly animateLayout: <A>(fn: () => A, options?: AnimateLayoutOptions) => A
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
  /**
   * Hand back the twins inside a leaving element that isn't a twin (ADR-0010 *Amendment (#181)*), for
   * a presence child {@link handleLeave} declined: each crossfades onto its other twin, following the
   * leaver's own exit. `onDone` once every handover has ended; the returned call drops them at once.
   * `None` when it held none, so presence runs its exit alone.
   */
  readonly handBackWithin: (el: HTMLElement, onDone: () => void) => Option.Option<() => void>
  /**
   * Register an element's values (ADR-0012, *Amendment (#137)*): a binding hands every element's,
   * read from what it last wrote, so a `layoutId` twin's flight follows the translate and scale
   * Wardic animates on its ancestors each frame, an element that isn't a projection node included.
   * Returns the unregistration, for the element's dispose.
   */
  readonly registerValues: (el: Element, read: () => Readonly<Record<string, unknown>>) => () => void
  /**
   * An element's box in the **Root frame** as it paints now, its transforms included (#286, ADR-0048):
   * where a presence child taking over from it starts ({@link RegisterNodeOptions.enteredFrom}).
   * `None` for one off the page.
   */
  readonly rootBoxOf: (el: HTMLElement) => Option.Option<Box.Box>
  /**
   * End a leaving Follower at once (#286, ADR-0048): a keyed presence child is back while its twin
   * crossfades out, and takes over. Its `onDone` is called, as at its handover's end. Returns the
   * crossfade factor it had faded to, for the child's new node to go on from
   * ({@link RegisterNodeOptions.fadeFrom}); `None` for an element that isn't one.
   */
  readonly dropLeaver: (el: HTMLElement) => Option.Option<number>
  /** Stop the coordinator's run + tear down the observer (wired into the provider's onCleanup). */
  readonly dispose: () => void
}

/** {@link ProjectionSystem.animateLayout}'s options (#191, ADR-0039). */
export interface AnimateLayoutOptions {
  /** Called once the change has settled: every layout animation it started has ended, however; at once after its pass if it started none. */
  readonly onSettled?: () => void
}

/** Per-node mutable state held by the system. */
interface NodeState {
  readonly id: string
  readonly element: HTMLElement
  readonly transition: () => Option.Option<LayoutTransition>
  /** The app's layout animation callbacks, read when they fire (#191, ADR-0039). */
  readonly onLayoutAnimationStart: () => Option.Option<() => void>
  readonly onLayoutAnimationComplete: () => Option.Option<() => void>
  /** The app's `onDragTransitionEnd`, read when it fires (#273). */
  readonly onReleaseEnd: () => Option.Option<() => void>
  /**
   * The value last written to the sink (#27): the coordinator's tick doesn't write one that draws the
   * same again, unless scale corrections go with it. `undefined` before the first write.
   */
  lastWritten: Projection.Value | undefined
  /** Whether the node's layout animations honour reduced motion, read at each (re)start (ADR-0029). */
  readonly respectReducedMotion: () => boolean
  /** The node's Layout mode, read at each layout animation's start (ADR-0009, *Amendment (#42)*). */
  readonly layoutMode: () => Projection.LayoutMode
  /** The element's own scale per axis, drawn on top of its projection (ADR-0010 *Amendment (#8)*). */
  readonly ownScale: () => Point.Point
  /** The element's own translate, in page pixels, drawn on top of its projection (#363). */
  readonly ownTranslate: () => Point.Point
  /** The element's own `rotate` and opacity, which a handover blends into (ADR-0010 *Amendment (#166)*). */
  readonly ownRotate: () => number
  readonly ownOpacity: () => number
  /**
   * What the node's handover blends from (ADR-0010 *Amendment (#166)*): the twin's radius, rotation
   * and, for a Switch, opacity, as they were drawn as it began. Eased into the node's own over the
   * handover's progress; cleared as it settles. `undefined` otherwise.
   */
  blend: Blend | undefined
  /** What a Switch seed handed to this node blends from (*Amendment (#166)*), taken with the seed. */
  seedBlend: Blend | undefined
  /** The node's look as it was drawn when it was disposed (*Amendment (#166)*): what its promoted twin blends from. */
  leftLook: Blend | undefined
  /** The opacity the node was last drawn at, as an absolute value (*Amendment (#166)*). */
  drawnOpacity: number | undefined
  /** Whether a blended radius was written, so the next write puts the node's own back (*Amendment (#166)*). */
  radiusBlended: boolean
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
  /** Where a presence take-over starts it (#286, {@link RegisterNodeOptions.enteredFrom}): consumed by its first measure. */
  enteredFrom: Box.Box | undefined
  /** Where the handover its first measure begins starts its fade (#286, {@link RegisterNodeOptions.fadeFrom}): consumed with it. */
  fadeFrom: number | undefined
  /**
   * How this `layoutId` node's ancestors that aren't nodes paint it, at its last pass
   * (ADR-0012, *Amendment (#136)*): the delta from its box (which carries no transform)
   * to the box as painted, and back. Twins are compared as painted, each converted
   * through its own. `undefined` when no such ancestor moves it, or for a plain node.
   */
  paintDelta: Projection.Delta | undefined
  unpaintDelta: Projection.Delta | undefined
  /**
   * A twin's ancestors' transforms as they are now (ADR-0012, *Amendment (#137)*): the translate
   * and scale Wardic animates on them read each call, any other as of the last pass. Set when the
   * pass could map them all, so it stands in for {@link paintDelta}; `undefined` otherwise.
   */
  paintMapNow: (() => PaintMap) | undefined
  /** The chain {@link paintMapNow} composes, kept for the leaver record (ADR-0010 *Amendment (#181)*). */
  paintChain: ReadonlyArray<PaintLink> | undefined
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
  /** How many Measure pass rounds have measured this node (the handle's `layoutVersion`). */
  layoutVersion: number
  /** Whether the node is raised while dragged (its `raiseWhileDragged` option). */
  readonly raiseWhileDragged: boolean
  /** Whether its projection carries the raise now: from its drag start until its release settles. */
  raised: boolean
  /** Whether a **Keyboard reorder** has it lifted (ADR-0037): raised as if dragged, its landings keeping the raise. */
  lifted: boolean
  /**
   * The Lead's crossfade factor when its crossfade (re)started, or `undefined` when its layout
   * animation isn't a shared-element handover (ADR-0010, *Note (velocity family)*). A handover
   * starts it at 0; a layout animation that interrupts it continues it from where it was.
   */
  crossfadeFrom: number | undefined
  /**
   * Whether its handover only moves, with no fade of its own (#5, ADR-0010 *Amendment (#5)*):
   * `true` when a projection ancestor was crossfading as it began, so the ancestor's fade decides
   * which twin shows (Motion's `path.some(hasOpacityCrossfade)`); `false` when it fades. `undefined`
   * until its first frame decides, once every promotion of its task has run: Solid disposes an
   * inner twin before its container.
   */
  handoverMoves: boolean | undefined
  /**
   * A Follower's crossfade factor when its Lead's handover (re)started (#5): where it fades out from.
   * `undefined` for one that joined after it began (a leaver `handleLeave` re-introduced), which
   * fades from 1, as the Lead it was.
   */
  exitFrom: number | undefined
  /** The crossfade factor its last projection write carried; `undefined` for none, at its own opacity. */
  fade: number | undefined
  /**
   * Its box and projection delta as the current Measure pass began (#146): where it painted, which a
   * restart in that pass starts from, read after the pass has changed both.
   */
  passBox: Box.Box | undefined
  passDelta: Projection.Delta
  /** Where it painted as the pass began, when it was active (derived every frame): its last target. */
  passPainted: Box.Box | undefined
  /** Marked a stable projection sub-root (ADR-0013): self-snaps, bounds the relative-parent search, persistent relativeParent. */
  readonly layoutRoot: boolean
  /** This node's relative-projection anchor (ADR-0013): a 0–1 Point, or `false` to force absolute. */
  readonly layoutAnchor: Point.Point | false | undefined
  /** Last measured untransformed box (the FLIP "First"); `undefined` until first measure. */
  retained: Box.Box | undefined
  /** Where the element appears at progress 0 (the box it animates FROM). */
  origin: Box.Box | undefined
  /** The element's real (current measured) box — the delta source + progress-1 target. */
  layoutBox: Box.Box | undefined
  /** Its layout animation's progress (0→1), a spring's or a tween's (ADR-0009 *Amendment (#171)*); `undefined` at rest. */
  flight: Flight | undefined
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
  /** Where a stopped release left the node at the grab, from its slot: the drag starts from there (zero otherwise). */
  grabOffset: Point.Point
  /**
   * Whether this node is coming to rest after a drag's release (set by `dragEnd`, cleared when
   * it settles or the node is grabbed again): it stays its subtree's relative parent until
   * then, as while dragged, so the whole subtree flies back with it.
   */
  releasing: boolean
  /** Its **Release offset** while one runs (ADR-0016, *Amendment (velocity family)*). */
  release: Release | undefined
}

/**
 * A **Release offset** (ADR-0016, *Amendment (velocity family)*): per axis, how far the
 * released node paints from where its layout puts it, `x` and `y` px, springing back to zero on
 * the node's **Drag transition** (*Amendment (#140)*): an inertia with both edges at zero, so it
 * starts past them and springs back on the bounce, as Motion's `dragSnapToOrigin` release does.
 * In px, as Motion's: its rest thresholds are px. Stopped by a grab (`stopped`), it holds where it
 * is until a drag takes it or the press ends, which starts it again from rest.
 */
interface Release {
  x: number
  y: number
  stateX: Inertia.State
  stateY: Inertia.State
  inertiaX: Inertia.Resolved
  inertiaY: Inertia.Resolved
  /** Its drag transition with both edges at zero, for a restart from rest. */
  readonly options: Machine.InertiaOptions
  stopped: boolean
  /** Whether its coming to rest has been told: once, at the first frame it's at rest (#273). */
  told: boolean
}

/** A node's last pass, what a re-introduction draws it from: its content-frame box and paint deltas (#136). */
interface LastPass {
  readonly box: Box.Box
  readonly paintDelta: Projection.Delta | undefined
  readonly unpaintDelta: Projection.Delta | undefined
  /** The scroll folded into `box` (ADR-0012, *Amendment (#331)*): a node re-introduced from it starts in its frame. */
  readonly fold: Fold
}

/**
 * A just-disposed layout node, held until the end of the current task (#221; ADR-0010 *Amendment
 * (#13)*, #169): what a presence `handleLeave` arriving after its dispose re-introduces it from (a
 * twin as a leaving Follower, a plain layout node as one its leaving container carries), and a
 * twin's Switch seed. One record per node, whatever it was. `reintroduced` records whether a
 * `handleLeave` brought it back.
 */
interface Leaver {
  readonly element: HTMLElement
  /** Its last pass; `undefined` when it never had one, and then it can't come back. */
  readonly last: LastPass | undefined
  /** Its Relative anchor, for a node its leaving container carries (#169). */
  readonly layoutAnchor: Point.Point | false | undefined
  /** What only a `layoutId` node has (ADR-0010); `undefined` for a plain layout node. */
  readonly twin: TwinLeaver | undefined
  reintroduced: boolean
}

/** A leaver's twin part (ADR-0010). */
interface TwinLeaver {
  readonly layoutId: string
  /**
   * Its chain at its last pass (ADR-0012 *Amendment (#137)*), and its frame's offset from the page's
   * as it went: a twin a leaving wrapper hands back keeps following it (ADR-0010 *Amendment (#181)*).
   */
  readonly chain: ReadonlyArray<PaintLink> | undefined
  readonly shift: Point.Point
  /**
   * Its Switch seed (ADR-0010 *Amendment (#13)*): held per `layoutId` for an enterer in the task,
   * handed straight to a twin that registered first and is unmeasured, or none (no box to seed from).
   */
  readonly seed: HeldSeed | "handed-off" | undefined
}

/**
 * A disposed twin's Switch seed, in the **Root frame**, held per `layoutId` until
 * the end of the current task (ADR-0010 *Amendment (#13)*). `consumed` records
 * whether an enterer picked it up at registration.
 */
interface HeldSeed {
  readonly box: Box.Box
  /** What the twin taking the seed blends from (ADR-0010 *Amendment (#166)*). */
  readonly blend: Blend
  consumed: boolean
}

/**
 * A twin's look as it was drawn when a handover began (ADR-0010 *Amendment (#166)*): its border
 * radius as drawn, under its own scale (a scale corrector's base, `undefined` for none), its
 * rotation in degrees, and its opacity,
 * which only a Switch blends (`undefined` when a live twin crossfades instead).
 */
interface Blend {
  readonly radius: unknown
  readonly rotate: number
  readonly opacity: number | undefined
}

/** A node with no Layout mode animates position and size (ADR-0009, *Amendment (#42)*). */
const ALWAYS_BOTH = (): Projection.LayoutMode => true

/** No own scale: a node the binding gives none, or a leaving one, which the renderer draws without its own values. */
const UNIT_SCALE: Point.Point = { x: 1, y: 1 }
const NO_OWN_SCALE = (): Point.Point => UNIT_SCALE
/** No own translate: a node the binding gives none, or a leaving one (#363). */
const NO_TRANSLATE: Point.Point = { x: 0, y: 0 }
const NO_OWN_TRANSLATE = (): Point.Point => NO_TRANSLATE
/** No own rotation or opacity of its own: a node the binding gives none, or a leaving one (*Amendment (#166)*). */
const NO_OWN_ROTATE = (): number => 0
const NO_OWN_OPACITY = (): number => 1
/** No drag transition of its own: a node releases on Motion's, {@link DEFAULT_DRAG_TRANSITION} (ADR-0016, *Amendment (#140)*). */
const NO_DRAG_TRANSITION = (): Option.Option<DragTransition> => Option.none()
/** What the shared ResizeObserver watches: the border box, which the engine measures (#21). */
const BORDER_BOX: ResizeObserverOptions = { box: "border-box" }

/** How far an observer's size may sit from a node's Measurement and still be it (#21), in px. */
const SIZE_EPSILON = 0.01

/** No layout animation callback: a node the binding gives none (#191). */
const NO_CALLBACK = (): Option.Option<() => void> => Option.none()
/** A call with no options. */
const NO_ANIMATE_LAYOUT_OPTIONS: AnimateLayoutOptions = {}

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

/** The root scroll a fold takes: all of it, unless a scroll root is on the way. Per frame. */
const rootShareOf = (fold: Fold, rootScroll: Point.Point): Point.Point => {
  if (fold.root) return rootScroll
  return ZERO_POINT
}

/** Each system's pass-end listeners ({@link onPassEnd}). */
const passEnds = new WeakMap<Omit<ProjectionSystem, "dispose">, Set<() => void>>()

/**
 * Run `listener` at the end of every Measure pass of `system`: once per pass, after
 * every round's boxes are stored (a blocked pass and one whose flush triggered more
 * rounds included). Returns the unsubscribe. A listener that
 * throws is logged and doesn't stop the pass or the others.
 *
 * @internal for the Reorder controller (ADR-0020): not exported from `@wardic/dom`, so
 * there is no public push hook (ADR-0020 decision 2).
 */
export const onPassEnd = (system: Omit<ProjectionSystem, "dispose">, listener: () => void): (() => void) => {
  const listeners = passEnds.get(system)
  if (Predicate.isUndefined(listeners)) return () => {}
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
   * A layout animation's progress at its (re)start (ADR-0009 *Amendment (#171)*): at 0, on its
   * transition read now, Motion's default with none, its delay held first, and with no velocity
   * (Motion's). When reduced motion applies to `node` (ADR-0029), at 1 with no delay, so the node
   * lands on its new box at once and the flight ends on its first step.
   */
  const startFlight = (node: NodeState): Flight =>
    Bool.match(Bool.and(node.respectReducedMotion(), reducedMotion()), {
      onTrue: landedFlight,
      onFalse: (): Flight => {
        // A transition core rejects (#66, ADR-0025 *Amendment (#66)*) is the app's defect, in
        // this one animation: reported, and the node lands, as reduced motion lands it.
        try {
          const timing = timingOf(Option.getOrElse(node.transition(), () => DEFAULT_LAYOUT_TRANSITION))
          return { position: 0, elapsed: 0, spring: Spring.init({}), timing, started: false, landed: false }
        } catch (defect) {
          runtime.runFork(reportFailure("wardic.projection: layout transition rejected", Cause.die(defect)))
          return landedFlight()
        }
      },
    })
  /**
   * A drag's Release offset (ADR-0016, *Amendment (#140)*) on its drag transition. One core rejects
   * (#66) is reported, and the release starts at rest on the slot: the node lands there.
   */
  const releaseOrLanded = (offset: Point.Point, velocity: Point.Point, transition: DragTransition): Release => {
    try {
      return releaseFrom(offset, velocity, transition)
    } catch (defect) {
      runtime.runFork(reportFailure("wardic.projection: drag transition rejected", Cause.die(defect)))
      return releaseFrom(ZERO_POINT, ZERO_POINT, DEFAULT_DRAG_TRANSITION)
    }
  }
  // {@link onPassEnd}'s listeners, run at the end of each Measure pass.
  const passEndListeners = new Set<() => void>()
  const nodes = new Set<NodeState>()
  const active = new Set<NodeState>()
  // Element -> node, for the DOM-ancestry parent walk.
  const elementToNode = new Map<HTMLElement, NodeState>()
  // Per-`layoutId` mount-order stack (ADR-0010): the newest live node is the Lead,
  // the rest are Followers. Crossfade is driven engine-side off this stack.
  const stacks = new Map<string, Array<NodeState>>()
  // One shared ResizeObserver for size triggers (created lazily; happy-dom/SSR-safe), each box on it
  // counted by the reasons it's watched for: a layout node, a page box, or both.
  let ro: ResizeObserver | undefined
  let watched: Watched | undefined
  // The page's boxes (#261, ADR-0018 *Amendment (#261)*): the body and its direct children, on the
  // shared observer. Whether each takes space in the flow (an absolutely or fixed positioned one moves
  // nothing), read once; the size each one that does had when the last Measure pass round read the
  // layout, so a delivery reporting it is that pass's echo; whether one removed since took space; and
  // how to stop watching the list.
  const pageBoxes = new Set<Element>()
  const pageFlow = new WeakMap<Element, boolean>()
  const pageSizes = new Map<Element, BoxSize>()
  let pageSpaceFreed = false
  let stopPage: () => void = constVoid
  // Whether the next Measure pass is a page-size refresh (#261).
  let refreshing = false
  // The layout nodes disposed this task, by element (#221), and the newest held Switch seed per
  // `layoutId`, in the Root frame (ADR-0010 *Amendment (#13)*): an enterer registering within the
  // task takes it (a twin already registered but unmeasured got it handed over directly). One
  // `wardic.projection.leaversHold` step at the end of the task expires them all. Plain `Map`s
  // keyed by element identity / string: nothing here is Effect-hashed.
  const leavers = new Map<HTMLElement, Leaver>()
  const seeds = new Map<string, HeldSeed>()
  let leaversHeld = false
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
  // Whether a **Declared layout change** in this task has taken its Measurements (#4): the end-of-task
  // pass, which animates from them, clears it.
  let declared = false
  // The app's layout animation callbacks (#191, ADR-0039): the nodes whose flight took its first step,
  // and whose flight landed, this tick, called after the tick's flush. Reused every tick.
  const flightStarts: Array<NodeState> = []
  const flightLands: Array<NodeState> = []
  // The nodes whose Release offset came to rest this tick (#273), told after the tick's flush.
  const releaseEnds: Array<NodeState> = []
  // This task's `animateLayout` onSettled callbacks, which its end-of-task pass takes, and the
  // settlings waiting on that pass's flights (#191).
  let settleCallbacks: Array<() => void> = []
  let settlings: ReadonlyArray<Settling> = []
  let disposed = false
  // The Resize block (ADR-0018 *Amendment (#39)*): the viewport width last seen (the
  // Environment's `Probe.viewport`, *Amendment (#45)*) and how to stop watching it, whether
  // the next Measure pass is blocked, and the wait that runs it if nothing else does: a fiber
  // in the engine's Scope (ADR-0025, *Amendment (#69)*, decision 4).
  let resizeListening = false
  let stopViewport: () => void = constVoid
  let lastWidth = 0
  let resizeBlocked = false
  const resizeWait = runtime.runSync(FiberHandle.make<void, never>().pipe(Scope.provide(scope)))

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
    const log = Effect.logDebug(`wardic.projection: ${event}`)
    runtime.runFork(UndefinedOr.match(annotations, { onUndefined: () => log, onDefined: (a) => log.pipe(Effect.annotateLogs(a)) }))
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
          // No call-site stack (ADR-0040, decision 2): pipeable, it's the third argument.
          Effect.withSpan(span, { attributes }, { captureStackTrace: false }),
        ),
      ),
    )
  }

  /**
   * A raised node's `z-index` (ADR-0016, *Amendment (velocity family)*, decision 6): `2` while
   * dragged or lifted by a **Keyboard reorder** (ADR-0037), `1` while it comes to rest after its
   * release or drop, so the item held paints above one flying back; none otherwise. Per frame.
   */
  const raiseOf = (node: NodeState): number | undefined => {
    if (Bool.not(node.raised)) return undefined
    if (node.dragging) return 2
    if (node.lifted) return 2
    return 1
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
   *
   * Every write to a Follower passes pointer input through it, and every write to a Lead
   * drops that, so the gate restores the element's own `pointer-events` (#165). Asked here,
   * not by the callers, so no path that writes a Follower (a twin's first measure in the
   * same task as its Lead's, a crossfade's frames, a rest) leaves it taking input.
   */
  const writeProjection = (
    node: NodeState,
    delta: Projection.Delta,
    treeScale: Point.Point,
    opacity?: number,
    corrected?: Record<string, string>,
  ): void => {
    node.fade = opacity
    const follower = isFollower(node)
    // A handover's blend (ADR-0010 *Amendment (#166)*): its rotation, and a Switch's opacity.
    const rotate = rotateOverrideOf(node, follower)
    const blendOpacity = switchOpacityOf(node, opacity, follower)
    node.drawnOpacity = drawnOpacityAt(node, opacity, blendOpacity)
    const value = projectionValue(delta, treeScale, opacity, raiseOf(node), follower, rotate, blendOpacity)
    // The render gate (#27, ADR-0009 *Amendment (#27)*, Motion's in `calcProjection`): inside the
    // coordinator's tick, a value that draws as the last one written isn't written again, such as a
    // `layout` child riding a parent that only translates. Since ADR-0033 the gate holds nothing a tick
    // wrote once the tick ends, so that write is on screen, or still pending and flushed at this tick's
    // end. A Measure pass or a drag's move always writes (ADR-0018, decision 12: a seed is applied with
    // its running ancestor), and so does a scale-corrected node, whose correction can change alone.
    const last = node.lastWritten
    if (inStep && Predicate.isUndefined(corrected) && !node.leaving && Predicate.isNotUndefined(last) && drawsSame(last, value)) return
    node.lastWritten = value
    const patch = projectionPatchOf(value, corrected)
    // A leaving Follower is driven directly: its gate registration is gone.
    if (node.leaving) {
      renderer.commit(node.element, renderer.project(patch))
      return
    }
    sink.write(node.id, patch)
  }

  /** Read this element's non-trivial scale-correction bases (ADR-0011), measure phase. */
  const readBases = (el: HTMLElement): NodeState["correctorBases"] => {
    const out: Array<{ corrector: ScaleCorrector; base: unknown }> = []
    for (const corrector of SCALE_CORRECTORS) {
      const base = corrector.read(el)
      if (Predicate.isNotUndefined(base)) out.push({ corrector, base })
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
    const radius = radiusOverrideOf(node)
    if (Predicate.isUndefined(radius) && !node.radiusBlended) return plainCorrectionsFor(node, sx, sy)
    // A blended radius (ADR-0010 *Amendment (#166)*) is written whatever the scale, corrected for it;
    // the write after the blend puts the node's own back, as the restore at unit scale does.
    const out = UndefinedOr.match(plainCorrectionsFor(node, sx, sy), { onUndefined: (): Record<string, string> => ({}), onDefined: identity })
    if (Predicate.isNotUndefined(radius)) {
      node.radiusBlended = true
      out[borderRadiusCorrector.key] = borderRadiusCorrector.correct(radius, sx, sy)
      return out
    }
    node.radiusBlended = false
    out[borderRadiusCorrector.key] = borderRadiusCorrector.correct(ownRadiusOrZero(node), sx, sy)
    return out
  }

  /** The scale-corrected style keys for `node`'s own bases (ADR-0011), as {@link correctionsFor}. Per frame. */
  const plainCorrectionsFor = (node: NodeState, sx: number, sy: number): Record<string, string> | undefined => {
    const bases = node.correctorBases
    if (Predicate.isUndefined(bases) || bases.length === 0) return undefined
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
    if (Predicate.isUndefined(stack) || stack.length === 0) return undefined
    return stack[stack.length - 1]
  }

  /** The node directly below `node` in its stack (the prior Lead it crossfades from), or undefined. */
  const priorLeadOf = (node: NodeState): NodeState | undefined => {
    if (Predicate.isUndefined(node.layoutId)) return undefined
    const stack = stacks.get(node.layoutId)
    if (Predicate.isUndefined(stack)) return undefined
    const i = stack.indexOf(node)
    if (i <= 0) return undefined
    return stack[i - 1]
  }

  /** Whether `node` is a Follower: in a `layoutId` stack but NOT its (newest-live) Lead. */
  const isFollower = (node: NodeState): boolean =>
    Predicate.isNotUndefined(node.layoutId) && leadOf(node.layoutId) !== node

  /**
   * Whether `lead`'s handover crossfades (#5): one runs, and it doesn't only move. The first frame
   * that asks decides whether it only moves, once; the decision is provisionally `false` while it's
   * made, so a cycle through its own `layoutId` ends. Its Followers don't count: a container closed
   * under presence crossfades once its leaver is re-introduced, which can come after the twins
   * inside it ask.
   */
  const crossfading = (lead: NodeState): boolean => {
    if (Predicate.isUndefined(lead.crossfadeFrom)) return false
    if (Predicate.isUndefined(lead.handoverMoves)) {
      lead.handoverMoves = false
      lead.handoverMoves = hasCrossfadingAncestor(lead)
    }
    return !lead.handoverMoves
  }

  /**
   * Whether a projection ancestor of `node` is crossfading (#5): it, or the Lead it follows, is in a
   * handover that crossfades (Motion's `path.some(hasOpacityCrossfade)`, which reads the Lead's values).
   */
  const hasCrossfadingAncestor = (node: NodeState): boolean => {
    let p = node.parent
    while (Predicate.isNotUndefined(p)) {
      if (Predicate.isNotUndefined(p.layoutId)) {
        const lead = leadOf(p.layoutId)
        if (Predicate.isNotUndefined(lead) && crossfading(lead)) return true
      }
      p = p.parent
    }
    return false
  }

  /**
   * A Lead's crossfade factor (ADR-0010, *Note (velocity family)*, *Amendment (#5)*): from where
   * its handover's fade (re)started to 1 along Motion's curve in ({@link fadeInAt}), while one fades;
   * 1 otherwise, so any other layout animation, its Release offset, or a handover that only moves
   * leaves it at its own opacity. Per frame.
   */
  const fadeOf = (node: NodeState): number => {
    const from = node.crossfadeFrom
    if (Predicate.isUndefined(from)) return 1
    const flight = node.flight
    if (Predicate.isUndefined(flight)) return 1
    if (node.handoverMoves === true) return 1
    return from + (1 - from) * fadeInAt(flight.position)
  }

  /** The crossfade factor for a LEAD ({@link fadeOf}) — only when it has Followers; else undefined. Per frame. */
  const leadOpacity = (node: NodeState): number | undefined => {
    if (Predicate.isUndefined(node.layoutId)) return undefined
    const stack = stacks.get(node.layoutId)
    if (Predicate.isUndefined(stack) || stack.length < 2 || stack[stack.length - 1] !== node) return undefined
    crossfading(node) // decides, on its first frame, whether its handover only moves
    return fadeOf(node)
  }

  /** Where a Follower fades out from: its factor as its Lead's handover (re)started, or 1. Per frame. */
  const exitFromOf = (node: NodeState): number => {
    const from = node.exitFrom
    if (Predicate.isUndefined(from)) return 1
    return from
  }

  /**
   * A Follower's crossfade factor (#5): from where it was as its Lead's handover (re)started to 0
   * along Motion's curve out ({@link fadeOutAt}), while that handover fades; held there while one
   * only moves; 0 at rest, or under any other layout animation of its Lead. Per frame.
   */
  const exitOf = (node: NodeState, lead: NodeState): number => {
    if (Predicate.isUndefined(lead.crossfadeFrom)) return 0
    const flight = lead.flight
    if (Predicate.isUndefined(flight)) return 0
    crossfading(lead) // decides, on its first frame, whether its handover only moves
    if (lead.handoverMoves === true) return exitFromOf(node)
    return exitFromOf(node) * (1 - fadeOutAt(flight.position))
  }

  /** Each Follower of `lead` fades out from where it is now (#5): set as a handover begins or a crossfade is interrupted. */
  const captureExits = (lead: NodeState): void => {
    if (Predicate.isUndefined(lead.layoutId)) return
    const stack = stacks.get(lead.layoutId)
    if (Predicate.isUndefined(stack)) return
    for (const f of stack) if (f !== lead) f.exitFrom = UndefinedOr.match(f.fade, { onUndefined: () => 1, onDefined: identity })
  }

  /**
   * A handover begins on `node` (ADR-0010): its fade starts at 0, whether it only moves is decided on
   * its first frame (#5), and its Followers fade from where they are.
   */
  const beginHandover = (node: NodeState): void => {
    node.crossfadeFrom = 0
    node.handoverMoves = undefined
    captureExits(node)
  }

  // --- A handover's blend (ADR-0010 *Amendment (#166)*): radius, rotation, a Switch's opacity ---

  /** A node's own border radius (its scale corrector's base, ADR-0011), `undefined` for none. */
  const ownRadiusOf = (node: NodeState): unknown => {
    const bases = node.correctorBases
    if (Predicate.isUndefined(bases)) return undefined
    for (const { corrector, base } of bases) if (corrector === borderRadiusCorrector) return base
    return undefined
  }

  /** {@link ownRadiusOf}, or no corner rounded. */
  const ownRadiusOrZero = (node: NodeState): unknown => {
    const radius = ownRadiusOf(node)
    if (Predicate.isUndefined(radius)) return ZERO_RADIUS
    return radius
  }

  /** How far `node`'s handover has run: its layout animation's progress, past 1 on a spring's overshoot; 1 at rest. Per frame. */
  const blendProgressOf = (node: NodeState): number => {
    const flight = node.flight
    if (Predicate.isUndefined(flight)) return 1
    return flight.position
  }

  /** `node`'s own radius as drawn: under its own scale (#8), px corners scaled. */
  const drawnOwnRadiusOf = (node: NodeState): unknown => {
    const scale = node.ownScale()
    return scaleRadius(ownRadiusOf(node), scale.x, scale.y)
  }

  /** A radius as drawn, as `node` writes it: its own scale divided out, as {@link undrawnFor} does a box. */
  const undrawnRadiusFor = (node: NodeState, radius: unknown): unknown => {
    const scale = node.ownScale()
    return scaleRadius(radius, invertScale(scale.x), invertScale(scale.y))
  }

  /**
   * Where a Lead's radius is drawn, its own scale included (#8): its blend's eased into its own, or
   * its own; `undefined` for none. Per frame.
   */
  const leadRadiusOf = (node: NodeState): unknown => {
    const own = drawnOwnRadiusOf(node)
    const blend = node.blend
    if (Predicate.isUndefined(blend)) return own
    if (Predicate.isUndefined(blend.radius) && Predicate.isUndefined(own)) return undefined
    return blendRadius(blend.radius, own, blendProgressOf(node))
  }

  /** Where a Lead's rotation is drawn: its blend's eased into its own, or its own. Per frame. */
  const leadRotateOf = (node: NodeState): number => {
    const own = node.ownRotate()
    const blend = node.blend
    if (Predicate.isUndefined(blend)) return own
    return blend.rotate + (own - blend.rotate) * blendProgressOf(node)
  }

  /** The Lead `node` follows, or `undefined` for a Lead or a node in no stack. Per frame. */
  const followedLeadOf = (node: NodeState): NodeState | undefined => {
    const lead = stackLeadOf(node)
    if (Predicate.isUndefined(lead)) return undefined
    if (lead === node) return undefined
    return lead
  }

  /** `node`'s look as a Lead draws it, with `opacity`: what a handover from it blends from. */
  const lookAsLeadOf = (node: NodeState, opacity: number | undefined): Blend => ({
    radius: leadRadiusOf(node),
    rotate: leadRotateOf(node),
    opacity,
  })

  /** `node`'s look as it's drawn now, a Follower's being its Lead's, with `opacity`. */
  const drawnLookOf = (node: NodeState, opacity: number | undefined): Blend =>
    lookAsLeadOf(UndefinedOr.match(followedLeadOf(node), { onUndefined: () => node, onDefined: identity }), opacity)

  /**
   * The opacity a leaver was drawn at as it went (Q4): read from the page while it's on it (one style
   * read, with the Switch seed's layout read), else as the engine last drew it.
   */
  const leavingOpacityOf = (node: NodeState): number => {
    if (node.element.isConnected) return Number(getComputedStyle(node.element).opacity)
    return drawnOpacityOf(node)
  }

  /** The rotation `node`'s projection draws in place of its own: a Follower's Lead's, a blending Lead's. Per frame. */
  const rotateOverrideOf = (node: NodeState, follower: boolean): number | undefined => {
    if (follower) return UndefinedOr.map(followedLeadOf(node), leadRotateOf)
    if (Predicate.isUndefined(node.blend)) return undefined
    return leadRotateOf(node)
  }

  /**
   * The radius `node`'s corrections write in place of its own: a Follower's Lead's (none rounded when
   * the Lead has none and it has one), a blending Lead's; `undefined` when neither applies. Per frame.
   */
  const radiusOverrideOf = (node: NodeState): unknown => {
    const lead = followedLeadOf(node)
    if (Predicate.isNotUndefined(lead)) {
      const radius = leadRadiusOf(lead)
      if (Predicate.isNotUndefined(radius)) return undrawnRadiusFor(node, radius)
      if (Predicate.isUndefined(ownRadiusOf(node))) return undefined
      return ZERO_RADIUS
    }
    if (Predicate.isUndefined(node.blend)) return undefined
    return undrawnRadiusFor(node, leadRadiusOf(node))
  }

  /**
   * A Switch's blended opacity: with no Follower to crossfade with (no factor), the leaver's eased into
   * the node's own, read live (Motion's `isOnlyMember` mix). Drawn as it is. Per frame.
   */
  const switchOpacityOf = (node: NodeState, factor: number | undefined, follower: boolean): number | undefined => {
    if (follower) return undefined
    if (Predicate.isNotUndefined(factor)) return undefined
    const blend = node.blend
    if (Predicate.isUndefined(blend)) return undefined
    const from = blend.opacity
    if (Predicate.isUndefined(from)) return undefined
    const mixed = from + (node.ownOpacity() - from) * blendProgressOf(node)
    return Math.min(1, Math.max(0, mixed))
  }

  /** The opacity `node` is drawn at, as an absolute value: a Switch's blend, or its own times its factor. Per frame. */
  const drawnOpacityAt = (node: NodeState, factor: number | undefined, blendOpacity: number | undefined): number => {
    if (Predicate.isNotUndefined(blendOpacity)) return blendOpacity
    const own = node.ownOpacity()
    if (Predicate.isUndefined(factor)) return own
    return own * factor
  }

  /** The opacity `node` was last drawn at, as an absolute value: its own before any write. */
  const drawnOpacityOf = (node: NodeState): number =>
    UndefinedOr.match(node.drawnOpacity, { onUndefined: () => node.ownOpacity(), onDefined: identity })

  /** Whether `look` differs from how `node` draws itself at rest: a Switch at an equal box with something to blend. */
  const looksOtherThan = (node: NodeState, look: Blend): boolean => {
    if (look.rotate !== node.ownRotate()) return true
    if (Predicate.isNotUndefined(look.opacity) && look.opacity !== node.ownOpacity()) return true
    const own = drawnOwnRadiusOf(node)
    if (Predicate.isUndefined(look.radius) && Predicate.isUndefined(own)) return false
    return JSON.stringify(look.radius) !== JSON.stringify(own)
  }

  /**
   * This node's ancestor projection deltas, ROOT-FIRST. Every projection-node
   * ancestor is included, past a layoutRoot too, as CSS composes them all and Motion's
   * `applyTreeDeltas` walks its whole path (ADR-0013, *Amendment (#33)*); a resting (or
   * settled) ancestor holds an identity delta, which is a no-op in applyTreeDeltas — so
   * this is the cumulative ancestor transform that CSS nesting applies to the node.
   */
  const ancestorDeltas = (node: NodeState): Array<Projection.Delta> => {
    const chain: Array<Projection.Delta> = []
    let p = node.parent
    while (Predicate.isNotUndefined(p)) {
      chain.push(p.lastDelta)
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
   * resting node, create-projection-node.ts:1262, :1484-1498 at 16c6122). One whose grab
   * left its layout animation running counts until the drag ends (*Amendment (velocity
   * family)*): that flight may scale it. And a dragged ancestor always counts for a layoutRoot,
   * whose target carries the drag (ADR-0013, *Amendment (#33)*): its descendants are placed
   * against it, so it is re-derived with each move.
   */
  const hasActiveAncestor = (node: NodeState): boolean => {
    let p = node.parent
    while (Predicate.isNotUndefined(p)) {
      if (active.has(p) && (!p.dragging || p.animating || node.layoutRoot)) return true
      if (p.layoutRoot) return false // boundary (ADR-0013): ancestors above a layoutRoot don't carry this node
      p = p.parent
    }
    return false
  }

  /**
   * A node's box: its layout box, or, for one that has never animated, the box it was last measured
   * at (a Follower that mounted at rest, #169). Per frame.
   */
  const boxOf = (node: NodeState | undefined): Box.Box | undefined => {
    if (Predicate.isUndefined(node)) return undefined
    const box = node.layoutBox
    if (Predicate.isNotUndefined(box)) return box
    return node.retained
  }

  /** The Lead of `node`'s stack, or undefined for a node with no `layoutId`. Per frame. */
  const stackLeadOf = (node: NodeState): NodeState | undefined => {
    if (Predicate.isUndefined(node.layoutId)) return undefined
    return leadOf(node.layoutId)
  }

  /** Whether `node` is a Follower whose Lead is moving: derived every frame, locked onto it (#169). Per frame. */
  const isMovingFollower = (node: NodeState): boolean => {
    const lead = stackLeadOf(node)
    return Predicate.isNotUndefined(lead) && lead !== node && active.has(lead)
  }

  /**
   * The nearest moving Follower above `node`, short of the next layoutRoot boundary (#169): what
   * carries it while it's locked on, so it's derived after that Follower each frame, corrected for
   * its lock as under any moving ancestor. Per frame.
   */
  const movingFollowerAbove = (node: NodeState): NodeState | undefined => {
    let p = node.parent
    while (Predicate.isNotUndefined(p)) {
      if (isMovingFollower(p)) return p
      if (p.layoutRoot) return undefined
      p = p.parent
    }
    return undefined
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
    for (let p = node.parent; Predicate.isNotUndefined(p); p = p.parent) {
      if ((p.dragging || p.releasing) && Predicate.isNotUndefined(p.layoutBox)) return p
      if (node.layoutAnchor === false) {
        // Opted out (Motion's layoutAnchor !== false gate): only a dragged ancestor,
        // below the next layoutRoot boundary, anchors it.
        if (p.layoutRoot) return undefined
        continue
      }
      // A layoutRoot is a persistent relative anchor AND the boundary — stop here.
      if (p.layoutRoot && Predicate.isNotUndefined(p.layoutBox)) return p
      if (p.layoutRoot) return undefined
      // A Follower locked onto its Lead carries what's inside it, placed in its lock (#169).
      if (isMovingFollower(p) && Predicate.isNotUndefined(boxOf(p))) return p
      if (active.has(p) && p.animating && Predicate.isNotUndefined(p.origin) && Predicate.isNotUndefined(p.layoutBox)) return p
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
  const dragTargetOf = (node: NodeState, slot: Box.Box): Box.Box => offsetBox(anchorOf(node, slot), dragOffsetOf(node))

  /** The drag's anchor: its grab box, at the slot's size about its centre once that differs. Per frame. */
  const anchorOf = (node: NodeState, slot: Box.Box): Box.Box => {
    const grab = UndefinedOr.getOrThrow(node.grabBox)
    if (sameSize(grab, slot)) return grab
    return resizeAboutCentre(grab, slot)
  }

  /** How far the drag moves its anchor: where a stopped release left it, plus the pointer's offset. Per frame. */
  const dragOffsetOf = (node: NodeState): Point.Point => ({
    x: node.grabOffset.x + node.dragDelta.x,
    y: node.grabOffset.y + node.dragDelta.y,
  })

  /** Whether the node has a layout animation running: its origin, target and flight. */
  const flying = (node: NodeState): boolean =>
    Bool.and(node.animating, Bool.and(Predicate.isNotUndefined(node.origin), Predicate.isNotUndefined(node.flight)))

  /** How far `node`'s layout animation has run: its flight's progress while it animates, else 1. Per frame. */
  const progressOf = (node: NodeState): number => {
    if (Bool.not(node.animating)) return 1
    const flight = node.flight
    if (Predicate.isUndefined(flight)) return 1
    return flight.position
  }

  /**
   * Where a dragged node paints (ADR-0016, *Amendment (velocity family)*, decision 4): its
   * drag target, or, while a layout animation its grab left running goes on, that flight
   * (toward the anchor) moved by the drag's offset. Per frame.
   */
  const dragPaintedOf = (node: NodeState, slot: Box.Box): Box.Box => {
    const origin = node.origin
    const flight = node.flight
    if (Predicate.isUndefined(origin)) return dragTargetOf(node, slot)
    if (Predicate.isUndefined(flight)) return dragTargetOf(node, slot)
    return offsetBox(Box.mix(origin, anchorOf(node, slot), flight.position), dragOffsetOf(node))
  }

  /**
   * How far `node`'s ancestors' transforms carry it (ADR-0013, *Amendment (#33)*): every released
   * one's Release offset, up to the nearest dragged one, whose drag target minus its slot ends it
   * (a drag target is where that node paints, so nothing above it adds); their layout animations
   * left out, so a layoutRoot isolates its subtree from those. Per frame.
   */
  const carryOf = (node: NodeState): Point.Point => carryFrom(node.parent, 0, 0)

  const carryFrom = (p: NodeState | undefined, x: number, y: number): Point.Point => {
    if (Predicate.isUndefined(p)) return { x, y }
    const grab = p.grabBox
    if (p.dragging && Predicate.isNotUndefined(grab)) {
      const slot = UndefinedOr.match(p.layoutBox, { onUndefined: () => grab, onDefined: identity })
      const drag = distanceBetween(slot, dragTargetOf(p, slot))
      return { x: x + drag.x, y: y + drag.y }
    }
    if (Predicate.isUndefined(p.release)) return carryFrom(p.parent, x, y)
    const offset = releaseOffsetOf(p)
    return carryFrom(p.parent, x + offset.x, y + offset.y)
  }

  /** `box` moved by `node`'s Release offset, while one runs. Per frame. */
  const releasedOf = (node: NodeState, box: Box.Box): Box.Box => {
    const release = node.release
    if (Predicate.isUndefined(release)) return box
    return offsetBox(box, { x: release.x, y: release.y })
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
    const box = boxOf(node)
    if (Predicate.isUndefined(box)) return

    // DRAGGING (ADR-0016): the target is the pointer's visual position — the grab-time
    // slot translated by the live pointer delta. Anchored at `grabBox` (not the current
    // `layoutBox`), so a mid-drag reorder that moves the slot keeps the item under the
    // pointer (the delta just recomputes against the new layoutBox). A layout animation the
    // grab left running carries the anchor until it lands (*Amendment (velocity family)*).
    if (node.dragging && Predicate.isNotUndefined(node.grabBox)) {
      const targetBox = dragPaintedOf(node, box)
      const { box: layoutCorrected, treeScale } = Projection.applyTreeDeltas(box, ancestorDeltas(node))
      const delta = Projection.calcBoxDelta(layoutCorrected, targetBox)
      node.lastTarget = targetBox
      node.lastDelta = delta
      const corrected = correctionsFor(node, delta.x.scale * treeScale.x, delta.y.scale * treeScale.y)
      writeProjection(node, delta, treeScale, leadOpacity(node), corrected)
      return
    }

    // Where its layout puts it, moved by its Release offset while one runs.
    const targetBox = releasedOf(node, layoutTargetOf(node, box))
    const { box: layoutCorrected, treeScale } = Projection.applyTreeDeltas(box, ancestorDeltas(node))
    // delta source is the element's REAL box pushed through ancestor transforms;
    // target is where it should appear.
    const delta = Projection.calcBoxDelta(layoutCorrected, targetBox)
    node.lastTarget = targetBox
    node.lastDelta = delta
    // A Lead with Followers carries the crossfade factor (fades IN over its handover's
    // progress); otherwise none (a plain/switch node — user opacity passes through).
    // Scale-correct border-radius/box-shadow at the true visual scale (ADR-0011).
    const corrected = correctionsFor(node, delta.x.scale * treeScale.x, delta.y.scale * treeScale.y)
    writeProjection(node, delta, treeScale, leadOpacity(node), corrected)
  }

  /**
   * Where `node`'s layout puts it this frame (its box `box`), its Release offset left out:
   *   - RELATIVE to an animating relativeParent;
   *   - ABSOLUTE, its own animation's mix;
   *   - CARRIED or at rest: its real box (applyTreeDeltas supplies the counter-transform).
   */
  const layoutTargetOf = (node: NodeState, box: Box.Box): Box.Box => {
    // ISOLATED (ADR-0013, *Amendment (#33)*): a layoutRoot sits at its new box, its projection
    // counter-acting its ancestors' layout animations; only their transforms carry it.
    if (node.layoutRoot) return offsetBox(box, carryOf(node))
    const rp = relativeParentOf(node)
    const rpBox = boxOf(rp)
    if (Predicate.isNotUndefined(rp) && Predicate.isNotUndefined(rpBox) && Predicate.isNotUndefined(rp.lastTarget)) {
      // RELATIVE: track the relativeParent (any scale, ADR-0013) at the node's
      // `layoutAnchor` (default top-left). Use the node's OWN progress while it
      // animates; once settled — or for a carried child — it sits at its final
      // relative offset and KEEPS tracking the parent (a fast child doesn't detach
      // from a slow one). For a static `layoutRoot` relativeParent (no own
      // animation), the parent's "from" box is just its layout box.
      const anchor = layoutAnchorOf(node)
      let rpFromBox = rpBox
      if (Predicate.isNotUndefined(rp.origin)) rpFromBox = rp.origin
      const progress = progressOf(node)
      const relTo = Projection.calcRelativeBox(box, rpBox, anchor)
      let relFrom = relTo
      if (Predicate.isNotUndefined(node.origin)) relFrom = Projection.calcRelativeBox(node.origin, rpFromBox, anchor)
      const relTarget = Box.mix(relFrom, relTo, progress)
      return Projection.placeRelativeBox(relTarget, rp.lastTarget, anchor)
    }
    // ABSOLUTE: own viewport interpolation (no animating pure-translate ancestor).
    if (flying(node)) return Box.mix(UndefinedOr.getOrThrow(node.origin), box, progressOf(node))
    // CARRIED under a SCALED ancestor / at rest: target the real box — applyTreeDeltas
    // supplies the counter-transform.
    return box
  }

  /** The point of a node's box its relativeParent tracks: its `layoutAnchor`, top-left by default. Per frame. */
  const layoutAnchorOf = (node: NodeState): Point.Point => {
    const anchor = node.layoutAnchor
    if (anchor === false || Predicate.isUndefined(anchor)) return ZERO_ANCHOR
    return anchor
  }

  /**
   * Derive a FOLLOWER (ADR-0010): lock it onto its Lead's CURRENT target box (so it
   * overlaps the lead) and fade it OUT as the lead's crossfade fades it in. Run AFTER the lead
   * (pass 2 of {@link deriveAll}) so `lead.lastTarget` is fresh; lead and follower
   * can live in unrelated subtrees, so this is NOT tree-depth ordered. `treeScale` +
   * the ancestor correction still apply to the follower's OWN box.
   */
  const deriveFollower = (node: NodeState): void => {
    if (Predicate.isUndefined(node.layoutId)) return
    const lead = leadOf(node.layoutId)
    if (Predicate.isUndefined(lead) || lead === node || Predicate.isUndefined(lead.lastTarget)) return
    const box = boxOf(node)
    if (Predicate.isUndefined(box)) return
    const { box: layoutCorrected, treeScale } = Projection.applyTreeDeltas(box, ancestorDeltas(node))
    // Lock onto the lead's box, where it paints (#136): the two may sit under different transforms.
    let target = between(lead, node, lead.lastTarget, passScroll)
    // A Follower whose mode animates position only keeps its own size, at its Lead's top-left
    // (ADR-0009, *Amendment (#42)*; Motion's applyTransformsToTarget). Plain calls: per frame.
    const leadBox = lead.layoutBox
    if (Predicate.isNotUndefined(leadBox) && Projection.animatesPositionOnly(node.layoutMode(), box, leadBox)) target = Projection.withSizeOf(target, box)
    // Drawn where its Lead is drawn (ADR-0010 *Amendment (#8)*, Motion's `lead.latestValues`): at
    // the Lead's own scale and translate, its own divided out and taken back (#363), so the two
    // overlap exactly.
    const leadOwn = lead.ownScale()
    const own = node.ownScale()
    const leadMoved = lead.ownTranslate()
    const moved = node.ownTranslate()
    target = translateBox(scaleAboutCentre(target, leadOwn.x * invertScale(own.x), leadOwn.y * invertScale(own.y)), leadMoved.x - moved.x, leadMoved.y - moved.y)
    const delta = Projection.calcBoxDelta(layoutCorrected, target)
    node.lastTarget = target
    node.lastDelta = delta
    const corrected = correctionsFor(node, delta.x.scale * treeScale.x, delta.y.scale * treeScale.y)
    writeProjection(node, delta, treeScale, exitOf(node, lead), corrected) // fades out as its Lead fades in (#5)
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
        if (isMovingFollower(n)) followers.push(n)
        continue
      }
      if (Predicate.isNotUndefined(movingFollowerAbove(n))) {
        followers.push(n)
        continue
      }
      if (active.has(n) || hasActiveAncestor(n)) leads.push(n)
    }
    leads.sort((a, b) => a.depth - b.depth)
    for (const node of leads) derive(node)
    deriveCarried(followers)
  }

  /**
   * The Followers, and what they carry, derived top-down (#5, #169): a twin or a layout node inside
   * a Follower reads its container's fresh lock. Per frame.
   */
  const deriveCarried = (followers: Array<NodeState>): void => {
    followers.sort((a, b) => a.depth - b.depth)
    for (const node of followers) {
      if (isFollower(node)) {
        deriveFollower(node)
        continue
      }
      derive(node)
    }
  }

  /**
   * Whether `node` is in a dragged subtree: it or an ancestor is being dragged. Such a
   * node is drag-blocked: a Measure pass starts or restarts no animation on it (Motion's
   * `isTreeAnimationBlocked`, create-projection-node.ts:633-639 at 16c6122).
   */
  const inDraggedTree = (node: NodeState): boolean => {
    for (let p: NodeState | undefined = node; Predicate.isNotUndefined(p); p = p.parent) if (p.dragging) return true
    return false
  }

  /** Whether `node` is a descendant of `ancestor`. */
  const isDescendantOf = (node: NodeState, ancestor: NodeState): boolean => {
    for (let p = node.parent; Predicate.isNotUndefined(p); p = p.parent) if (p === ancestor) return true
    return false
  }

  /** Whether an ancestor of `node` (up to and including a `layoutRoot` boundary) is in `changed`. */
  const hasChangedAncestor = (node: NodeState, changed: ReadonlySet<NodeState>): boolean => {
    for (let p = node.parent; Predicate.isNotUndefined(p); p = p.parent) {
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
      for (let p = node.parent; Predicate.isNotUndefined(p); p = p.parent) if (active.has(p)) root = p
      roots.add(root)
    }
    for (const node of nodes) {
      for (let p: NodeState | undefined = node; Predicate.isNotUndefined(p); p = p.parent) {
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
        const lead = stackLeadOf(n)
        if (Predicate.isNotUndefined(lead) && active.has(lead) && group.has(lead)) followers.push(n)
        continue
      }
      const carrier = movingFollowerAbove(n)
      if (Predicate.isNotUndefined(carrier)) {
        const lead = stackLeadOf(carrier)
        if (group.has(n) || (Predicate.isNotUndefined(lead) && group.has(lead))) followers.push(n)
        continue
      }
      if (group.has(n) && (active.has(n) || hasActiveAncestor(n))) leads.push(n)
    }
    leads.sort((a, b) => a.depth - b.depth)
    for (const node of leads) derive(node)
    deriveCarried(followers)
  }

  /** Recompute parent links + depth for every node by walking DOM ancestry. */
  const computeTree = (): void => {
    for (const node of nodes) {
      let el: HTMLElement | null = node.element.parentElement
      let parent: NodeState | undefined
      while (el !== null) {
        const candidate = elementToNode.get(el)
        if (Predicate.isNotUndefined(candidate)) {
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
      while (Predicate.isNotUndefined(p)) {
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
    if (Predicate.isUndefined(style)) {
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

  /** Every element's values, as its binding last wrote them (ADR-0012, *Amendment (#137)*). */
  const elementValues = new WeakMap<Element, () => Readonly<Record<string, unknown>>>()
  /** The elements this pass found moving nodes with a transform a running transition holds: not mapped. */
  const passUnheld = new Set<Element>()

  /**
   * `el`'s transform as the pass found it, as a matrix's scale and translate (ADR-0012, *Amendment
   * (#137)*), or `undefined` when it isn't a translate and a scale: a rotation or skew, a 3D one, or
   * an individual `translate`/`scale`/`rotate` property. Read before the hold. Read phase only.
   */
  const passTransformOf = (el: Element, style: TransformStyle): { readonly a: number; readonly d: number; readonly e: number; readonly f: number } | undefined => {
    if (style.moved.length !== 1) return undefined
    if (style.moved[0] !== "transform") return undefined
    const m = new DOMMatrix(computedOf(el).transform)
    if (Bool.not(m.is2D)) return undefined
    if (m.b !== 0) return undefined
    if (m.c !== 0) return undefined
    return { a: m.a, d: m.d, e: m.e, f: m.f }
  }

  /** `el`'s computed `transform-origin`, in px from its border box's top-left. Read phase only. */
  const transformOriginOf = (el: Element): Point.Point => {
    const [x, y] = computedOf(el).transformOrigin.split(" ")
    return { x: originPxOf(x), y: originPxOf(y) }
  }

  /** `map` in a frame `shift` away: conjugated by the translation, so it maps that frame's boxes. */
  const inFrame = (map: PaintMap, shift: Point.Point): PaintMap => ({
    sx: map.sx,
    sy: map.sy,
    tx: map.tx + shift.x - map.sx * shift.x,
    ty: map.ty + shift.y - map.sy * shift.y,
  })

  /** Whether `el` is where a twin's chain stops: the document's `<body>` or root. */
  const isDocumentTop = (el: Element): boolean => Bool.or(el === el.ownerDocument.body, el === el.ownerDocument.documentElement)

  /**
   * What ancestor `el` adds to a twin's chain (ADR-0012, *Amendment (#137)*), in the twin's frame
   * (`shift` from the page's): a node link, an element link the pass read, none when it doesn't move
   * the twin, or `undefined` when it moves it in a way that can't be mapped. Read phase only.
   */
  const linksAt = (el: HTMLElement, reads: ReadonlyMap<Element, AncestorRead>, shift: Point.Point, documentScroll: Point.Point): ReadonlyArray<PaintLink> | undefined => {
    const ancestor = elementToNode.get(el)
    if (Predicate.isNotUndefined(ancestor)) {
      const at = scrollOffset(ancestor, documentScroll)
      return [{ kind: "node", node: ancestor, offset: { x: shift.x - at.x, y: shift.y - at.y } }]
    }
    if (passUnheld.has(el)) return undefined
    const read = reads.get(el)
    if (Predicate.isUndefined(read)) return NO_LINKS
    return UndefinedOr.map(
      read.pass,
      (pass): ReadonlyArray<PaintLink> => [{ kind: "element", element: el, origin: { x: read.origin.x + shift.x, y: read.origin.y + shift.y }, pass: inFrame(pass, shift) }],
    )
  }

  /** The chain from `el` up to `<body>`, outermost first; `undefined` when a link in it can't be mapped. Read phase only. */
  const chainFrom = (el: HTMLElement | null, reads: ReadonlyMap<Element, AncestorRead>, shift: Point.Point, documentScroll: Point.Point): ReadonlyArray<PaintLink> | undefined => {
    if (Predicate.isNull(el)) return NO_LINKS
    if (isDocumentTop(el)) return NO_LINKS
    const above = chainFrom(el.parentElement, reads, shift, documentScroll)
    if (Predicate.isUndefined(above)) return undefined
    return UndefinedOr.map(linksAt(el, reads, shift, documentScroll), (own) => Arr.appendAll(above, own))
  }

  /**
   * The ancestors of twin `node` whose transforms move it, outermost first, in its frame (ADR-0012,
   * *Amendment (#137)*): each element this pass found moving it, and each projection node above it,
   * for its own scale (#8). `undefined` when one can't be mapped, so it's converted as of the pass
   * ({@link NodeState.paintDelta}). Read phase only.
   */
  const paintChainOf = (node: NodeState, reads: ReadonlyMap<Element, AncestorRead>, documentScroll: Point.Point): ReadonlyArray<PaintLink> | undefined =>
    chainFrom(node.element.parentElement, reads, scrollOffset(node, documentScroll), documentScroll)

  /**
   * `acc`, then a projection node's own scale (#8), drawn about its box's centre, and its own
   * translate (#363), in the twin's frame. Per frame.
   */
  const composeOwnTransform = (acc: PaintAcc, node: NodeState, offset: Point.Point): void => {
    const box = boxOf(node)
    if (Predicate.isUndefined(box)) return
    const own = node.ownScale()
    const moved = node.ownTranslate()
    composeAbout(acc, (box.x.min + box.x.max) / 2 + offset.x, (box.y.min + box.y.max) / 2 + offset.y, moved.x, moved.y, own.x, own.y)
  }

  /**
   * `acc`, then what one link does now (ADR-0012, *Amendment (#137)*): an element's translate and
   * scale from the values Wardic last wrote, when they draw it and can be mapped, else its transform
   * at the pass; a node's own scale and translate. Per frame.
   */
  const composeLink = (acc: PaintAcc, link: PaintLink): void => {
    if (link.kind === "node") {
      composeOwnTransform(acc, link.node, link.offset)
      return
    }
    const read = elementValues.get(link.element)
    if (Predicate.isUndefined(read)) {
      composeMap(acc, link.pass)
      return
    }
    if (composeValues(acc, read(), link.origin)) return
    composeMap(acc, link.pass)
  }

  /** A twin's chain composed now, outermost first, into one map. Per frame. */
  const composeLinks = (links: ReadonlyArray<PaintLink>): PaintMap => {
    const acc: PaintAcc = { sx: 1, sy: 1, tx: 0, ty: 0 }
    for (let i = 0; i < links.length; i++) composeLink(acc, links[i])
    return acc
  }

  const computedOf = (el: Element): CSSStyleDeclaration =>
    UndefinedOr.match(computedStyles.get(el), {
      onDefined: identity,
      onUndefined: () => {
        const style = getComputedStyle(el)
        computedStyles.set(el, style)
        return style
      },
    })

  /**
   * Whether `el` is `position: fixed` now (ADR-0012, *Amendment (#7)*): read from its live
   * declaration each pass, a property read, so an element switching it is seen. Read phase only.
   */
  const isFixedNow = (el: Element): boolean => computedOf(el).position === "fixed"

  /** The twins that carry paint deltas (ADR-0012, *Amendment (#136)*): a pass that moves one sets them again. */
  const painted = new Set<NodeState>()

  /**
   * The page's scroll as the last pass read it, which every node's fold was sampled with: what takes
   * a box between twins' frames outside a pass (ADR-0012, *Amendment (#331)*).
   */
  let passScroll: Point.Point = ZERO_POINT

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
    if (Predicate.isNotUndefined(hit)) return hit
    const node = elementToNode.get(el)
    // A `layoutScroll` node holds its own scroll and whether it's a scroll root; any other element is read.
    if (Predicate.isNotUndefined(node) && node.isScroll) return foldAt(el, memo, node.scroll, node.isScrollRoot)
    return foldAt(el, memo, readScrollOf(el), isFixedNow(el))
  }

  /** `el`'s fold, kept in `memo`: its scroll, if it scrolls, on top of the fold above it, unless it stops the walk. */
  const foldAt = (el: HTMLElement, memo: Map<Element, Fold>, scroll: Point.Point | undefined, stop: boolean): Fold => {
    const fold = withScroll(el, scroll, foldAbove(el, memo, stop))
    memo.set(el, fold)
    return fold
  }

  /** The fold above `el`: none past a scroll root. */
  const foldAbove = (el: HTMLElement, memo: Map<Element, Fold>, stop: boolean): Fold => {
    if (stop) return NO_FOLD
    return foldFrom(el.parentElement, memo)
  }

  /** `above`, with `el`'s scroll added when it has one. */
  const withScroll = (el: HTMLElement, scroll: Point.Point | undefined, above: Fold): Fold => {
    if (Predicate.isUndefined(scroll)) return above
    return { containers: [{ element: el, scroll }, ...above.containers], x: above.x + scroll.x, y: above.y + scroll.y, root: above.root }
  }

  /** An element's scroll, read, when its style lets it scroll. */
  const readScrollOf = (el: HTMLElement): Point.Point | undefined => {
    if (scrollStyleOf(el).scrollable) return measureScroll(el)
    return undefined
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
    const running = transitionRunning(el)
    if (Bool.not(running)) holds.push([el, style])
    if (running) passUnheld.add(el)
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

  /** Whether two folds fold the same scroll: the same containers, and the page's scroll or not. */
  const sameFrame = (a: Fold, b: Fold): boolean => {
    if (a.root !== b.root) return false
    if (a.containers.length !== b.containers.length) return false
    return Arr.every(Arr.zip(a.containers, b.containers), ([p, q]) => p.element === q.element)
  }

  /** A container's scroll this pass: as `current` sampled it, else read now, else as last sampled. Read phase only. */
  const scrollNowOf = (container: FoldedContainer, current: Fold): Point.Point => {
    for (const c of current.containers) if (c.element === container.element) return c.scroll
    if (container.element.isConnected) return measureScroll(container.element)
    return container.scroll
  }

  /** The scroll `old`'s containers, and the page if it folded, add at this pass's samples. Read phase only. */
  const shiftUnder = (old: Fold, current: Fold, documentScroll: Point.Point): Point.Point => {
    let x = 0
    let y = 0
    for (const c of old.containers) {
      const scroll = scrollNowOf(c, current)
      x += scroll.x
      y += scroll.y
    }
    if (old.root) {
      x += documentScroll.x
      y += documentScroll.y
    }
    return { x, y }
  }

  /**
   * Carry `node`'s stored boxes into the frame its fold now gives it (ADR-0012, *Amendment (#7)*,
   * Motion's `wasRoot`): when the scroll folded into its box changed, not by scrolling but by which
   * scroll folds (a `position: fixed` ancestor switched, a scrolled container gained or lost), its
   * boxes are moved by what the new frame adds over the old one at this pass's scroll. A switch
   * then reads as no move, and only a real one animates. Read phase only.
   */
  const carryAcrossFrames = (node: NodeState, old: Fold, documentScroll: Point.Point): void => {
    if (Predicate.isUndefined(node.retained)) return
    if (sameFrame(old, node.fold)) return
    const was = shiftUnder(old, node.fold, documentScroll)
    const now = scrollOffset(node, documentScroll)
    const by = { x: now.x - was.x, y: now.y - was.y }
    if (by.x === 0 && by.y === 0) return
    const carry = (box: Box.Box): Box.Box => offsetBox(box, by)
    node.retained = carry(node.retained)
    node.layoutBox = UndefinedOr.map(node.layoutBox, carry)
    node.origin = UndefinedOr.map(node.origin, carry)
    node.lastTarget = UndefinedOr.map(node.lastTarget, carry)
    node.seenBox = UndefinedOr.map(node.seenBox, carry)
    node.grabBox = UndefinedOr.map(node.grabBox, carry)
    debug("frame carried", { id: node.id, x: by.x, y: by.y })
  }

  /** `node`'s box this pass: its stored one when nothing moved it, else the box just read, folded. */
  const boxThisPass = (node: NodeState, moved: boolean, read: Box.Box, documentScroll: Point.Point): Box.Box => {
    if (Bool.not(moved)) return UndefinedOr.getOrThrow(node.retained)
    return foldScroll(node, read, documentScroll)
  }

  /** `node`'s fold this pass: nothing when it is itself a scroll root, else its ancestors'. */
  const foldOf = (node: NodeState, memo: Map<Element, Fold>): Fold => {
    if (isOwnRoot(node)) return NO_FOLD
    return foldFrom(node.element.parentElement, memo)
  }

  /** Whether `node` is itself a scroll root: a fixed `layoutScroll` node, or a plain one `position: fixed`, read live (ADR-0012, *Amendment (#7)*). */
  const isOwnRoot = (node: NodeState): boolean => {
    if (node.isScroll) return node.isScrollRoot
    return isFixedNow(node.element)
  }

  /**
   * The scroll the fold adds to `node`'s box (ADR-0012): its containers' scroll at
   * its last pass (Motion's `removeElementScroll` adds the offset back to undo the
   * scroll's visual effect; every container that can scroll counts, not only
   * `layoutScroll` ones), plus `rootScroll` unless a scroll root is on the way.
   */
  const scrollOffset = (node: NodeState, rootScroll: Point.Point): Point.Point => {
    const fold = node.fold
    const root = rootShareOf(fold, rootScroll)
    const dx = fold.x + root.x
    const dy = fold.y + root.y
    if (dx === 0 && dy === 0) return ZERO_POINT
    return { x: dx, y: dy }
  }

  /**
   * Fold scroll out of `box` (ADR-0012) → a scroll-stable (content-frame) box. No-op
   * on the non-scroll path (no container + zero root scroll ⇒ box unchanged), so it
   * never perturbs ordinary layout animation. `box` is the pass's freshly read box,
   * which nothing else holds, so it is moved in place: no allocation per node.
   */
  const foldScroll = (node: NodeState, box: Box.Box, rootScroll: Point.Point): Box.Box => {
    const fold = node.fold
    const root = rootShareOf(fold, rootScroll)
    const dx = fold.x + root.x
    const dy = fold.y + root.y
    if (dx === 0 && dy === 0) return box
    const fresh = box as { readonly x: { min: number; max: number }; readonly y: { min: number; max: number } }
    fresh.x.min += dx
    fresh.x.max += dx
    fresh.y.min += dy
    fresh.y.max += dy
    return box
  }

  /**
   * What takes a **Root frame** box into `node`'s Scroll-stable frame (ADR-0012, *Amendment
   * (#331)*): its containers' scroll put in, and the page's, which the Root frame always carries,
   * taken back out when its fold leaves it out (a scroll root on the way). `rootScroll` is the
   * pass's. The zero point when the two frames are the same, as for a node at the top level.
   */
  const rootFrameShift = (node: NodeState, rootScroll: Point.Point): Point.Point => {
    const own = scrollOffset(node, rootScroll)
    const dx = own.x - rootScroll.x
    const dy = own.y - rootScroll.y
    if (dx === 0 && dy === 0) return ZERO_POINT
    return { x: dx, y: dy }
  }

  /**
   * `node`'s box in the **Root frame** (CONTEXT.md; ADR-0012 *Amendment (#13)*): the
   * viewport box plus the root's scroll, containers' scroll left as rendered —
   * Motion's `measuredBox`. Inside a scroll root too (*Amendment (#331)*), so a twin there and one
   * outside compare directly. Where the twin paints, its own projection included (ADR-0010
   * *Amendment (#170)*), so a twin disposed mid-flight seeds from where it was seen. While the
   * element is connected it is read fresh, as painted, which costs the one forced layout the
   * binding's seed read used to. Once disconnected it is derived from where it last painted
   * (its box through every projection, {@link paintedNowOf}), put back where it painted through
   * its paint delta (ADR-0012 *Amendment (#136)*), by taking the containers' share of the fold
   * back out — at each container's LIVE scroll while it is still connected (its last-pass sample
   * otherwise), so a container scrolled since the last pass doesn't shift the seed. The root's
   * scroll needs no such care where its fold takes it: the Root frame carries it, so it cancels.
   * Where its fold leaves it out, the page's scroll now is added. `undefined` when there is
   * neither.
   */
  const rootFrameBox = (node: NodeState): Box.Box | undefined => {
    const el = node.element
    if (el.isConnected) {
      // As painted, its own projection included (#170): a twin disposed mid-flight seeds from
      // where it was seen, as Motion's `measuredBox` does.
      return offsetBox(Box.fromBounds(readLayoutBox(el)), measureDocumentScroll())
    }
    // As drawn, its own scale included (ADR-0010 *Amendment (#8)*).
    const stored = UndefinedOr.map(paintedNowOf(node), (box) => drawnOf(node, box))
    if (Predicate.isUndefined(stored)) return undefined
    // Where it painted: the stored box leaves its ancestors' transforms out (#136).
    const stable = paintedOf(node, stored)
    let dx = 0
    let dy = 0
    for (const container of node.fold.containers) {
      const scroll = containerScrollOf(container)
      dx -= scroll.x
      dy -= scroll.y
    }
    // The page's scroll, which the Root frame always carries, added where its fold leaves it out (#331).
    if (Bool.not(node.fold.root)) {
      const page = measureDocumentScroll()
      dx += page.x
      dy += page.y
    }
    if (dx === 0 && dy === 0) return stable
    return offsetBox(stable, { x: dx, y: dy })
  }

  /** A scroll container's scroll: read live while it's in the document, else as last read. */
  const containerScrollOf = (container: Fold["containers"][number]): Point.Point => {
    if (container.element.isConnected) return measureScroll(container.element)
    return container.scroll
  }

  /**
   * The twin a disposed node's Switch seed goes straight to: the newest other live
   * node in its stack that has registered but not yet been measured — it mounted
   * first (the register-then-dispose ordering), so it has no hold left to read at
   * registration. `undefined` when there is none.
   */
  const pendingTwinOf = (node: NodeState, layoutId: string): NodeState | undefined => {
    const stack = stacks.get(layoutId)
    if (Predicate.isUndefined(stack)) return undefined
    for (let i = stack.length - 1; i >= 0; i--) {
      const twin = stack[i]
      if (twin !== node && !twin.leaving && Predicate.isUndefined(twin.retained)) return twin
    }
    return undefined
  }

  /** `node`'s last pass, `undefined` when it never had one. */
  const lastPassOf = (node: NodeState): LastPass | undefined =>
    UndefinedOr.map(boxOf(node), (box): LastPass => ({ box, paintDelta: node.paintDelta, unpaintDelta: node.unpaintDelta, fold: node.fold }))

  /**
   * Hold `leaver` until the end of its task (#221). The first hold in a task schedules one
   * `wardic.projection.leaversHold` step, which expires every leaver held in it, so unmounting a
   * large layout list costs one map entry a node (#169), and annotates what became of them.
   */
  const hold = (leaver: Leaver): void => {
    leavers.set(leaver.element, leaver)
    if (leaversHeld) return
    leaversHeld = true
    endOfTask("wardic.projection.leaversHold", {}, () => {
      const held = Array.from(leavers.values())
      leavers.clear()
      leaversHeld = false
      return outcomeOf(held)
    })
  }

  /**
   * Hold a disposed layout node with no `layoutId` (#169): what a presence `handleLeave` re-introduces
   * it from, should it sit inside the leaver. Nothing to hold when it never had a pass.
   */
  const holdNode = (node: NodeState): void => {
    const last = lastPassOf(node)
    if (Predicate.isUndefined(last)) return
    hold({ element: node.element, last, layoutAnchor: node.layoutAnchor, twin: undefined, reintroduced: false })
  }

  /**
   * Hold a disposed `layoutId` node (ADR-0010 *Amendment (#13)*): the last pass a presence
   * `handleLeave` may re-introduce it from, and its Switch seed in the Root frame, handed straight
   * to a twin that registered first or held per `layoutId` for an enterer that registers within
   * this task. Nothing to hold when it has neither.
   */
  const holdLeaver = (node: NodeState, layoutId: string): void => {
    const last = lastPassOf(node)
    const shift = scrollOffset(node, measureDocumentScroll())
    const seedBox = rootFrameBox(node)
    // Its look as drawn as it goes (ADR-0010 *Amendment (#166)*): what a twin taking over blends from.
    const look = drawnLookOf(node, leavingOpacityOf(node))
    node.leftLook = look
    const seed = UndefinedOr.map(seedBox, (box) => seedOf(node, layoutId, box, look))
    if (Predicate.isUndefined(last) && Predicate.isUndefined(seedBox)) return
    hold({ element: node.element, last, layoutAnchor: node.layoutAnchor, twin: { layoutId, chain: node.paintChain, shift, seed }, reintroduced: false })
  }

  /**
   * A disposed twin's Switch seed (ADR-0010 *Amendment (#13)*): handed straight to the twin that
   * registered first and is still unmeasured, else held per `layoutId`, replacing one a leaver with
   * the same `layoutId` held earlier in the task.
   */
  const seedOf = (node: NodeState, layoutId: string, box: Box.Box, look: Blend): HeldSeed | "handed-off" =>
    UndefinedOr.match(pendingTwinOf(node, layoutId), {
      onDefined: (twin): HeldSeed | "handed-off" => {
        twin.seed = box
        twin.seedBlend = look
        return "handed-off"
      },
      onUndefined: () => {
        const held: HeldSeed = { box, blend: look, consumed: false }
        seeds.set(layoutId, held)
        return held
      },
    })

  /**
   * What became of a task's leavers, for its span: how many it held, how many a `handleLeave` brought
   * back, and each twin's Switch seed by `layoutId` (see {@link seedOutcomeOf}), when it held a twin.
   */
  const outcomeOf = (held: ReadonlyArray<Leaver>): Record<string, unknown> => {
    const twins = Arr.filter(Arr.map(held, (leaver) => leaver.twin), Predicate.isNotUndefined)
    const bySeed = Arr.reduce(twins, {} as Record<string, string>, (out, twin) => {
      const outcome = seedOutcomeOf(twin)
      out[twin.layoutId] = UndefinedOr.match(out[twin.layoutId], { onUndefined: () => outcome, onDefined: (earlier) => `${earlier}, ${outcome}` })
      return out
    })
    return {
      held: held.length,
      reintroduced: Arr.filter(held, (leaver) => leaver.reintroduced).length,
      ...Bool.match(Arr.isArrayNonEmpty(twins), { onTrue: () => ({ seeds: bySeed }), onFalse: () => ({}) }),
    }
  }

  /**
   * What became of a twin's Switch seed by the end of its task: `consumed` by an enterer, `expired`
   * (dropped now), `replaced` by a later leaver's with the same `layoutId`, `handed-off` straight to
   * a twin, or `none` when it had no box to seed from.
   */
  const seedOutcomeOf = (twin: TwinLeaver): string =>
    Match.value(twin.seed).pipe(
      Match.when(Match.undefined, () => "none"),
      Match.when("handed-off", (handedOff) => handedOff),
      Match.orElse((held) =>
        Bool.match(held.consumed, {
          onTrue: () => "consumed",
          onFalse: () =>
            Bool.match(seeds.get(twin.layoutId) === held, {
              onTrue: () => {
                seeds.delete(twin.layoutId)
                return "expired"
              },
              // A later leaver with the same layoutId took the slot.
              onFalse: () => "replaced",
            }),
        }),
      ),
    )

  // --- One round of the Measure pass (reads, then FLIP seeds), run inside the ---
  // sink's `flushPass`, which applies what it writes before returning. The
  // {@link measurePass} wraps its rounds in the `wardic.projection.measure` span.
  // Every node it (re)starts is added to `seeded`, counted on the pass's span; every node
  // of a dragged subtree whose box changed is added to `dragBlocked` instead.
  /**
   * A node with no box this pass (ADR-0009 *Amendment (#9)*: `display: contents`): nothing to
   * animate from or to, so any animation it ran stops, and its delta is the identity, so the nodes
   * inside it project as if it weren't there. It still counts as measured (`layoutVersion`).
   */
  const dropBox = (node: NodeState): void => {
    node.retained = undefined
    node.layoutBox = undefined
    node.seed = undefined
    node.origin = undefined
    node.flight = undefined
    node.release = undefined
    node.animating = false
    node.lastDelta = IDENTITY_DELTA
    node.lastTarget = undefined
    node.layoutVersion++
    active.delete(node)
  }

  /**
   * The slot-only update a blocked node takes (a dragged subtree's, or every node's
   * after a resize): its box becomes its slot, no animation starts or restarts, and a
   * running one keeps its delta (its origin moves with its box). A first measure writes
   * the identity projection. Returns whether the slot changed, so the node is
   * re-derived and flushed with its group.
   */
  const slotOnly = (node: NodeState, prev: Box.Box | undefined, newBox: Box.Box): boolean => {
    if (Predicate.isUndefined(prev)) {
      node.lastDelta = IDENTITY_DELTA
      writeProjection(node, IDENTITY_DELTA, TREE_SCALE_IDENTITY)
      return false
    }
    if (boxesEqual(prev, newBox)) return false
    if (!node.dragging && node.animating && Predicate.isNotUndefined(node.origin)) {
      const from = centreOf(definedOr(node.layoutBox, prev))
      const to = centreOf(newBox)
      node.origin = offsetBox(node.origin, { x: to.x - from.x, y: to.y - from.y })
    }
    node.layoutBox = newBox
    return true
  }

  /**
   * One round of a Measure pass. `blocked`: every node takes a slot-only update (a **Resize block**,
   * or a **Declared layout change**'s Measurements). `versioned`: each node's `layoutVersion` rises,
   * except for a Declared layout change's Measurements, which read the layout from before its change.
   */
  const runMeasurePass = (seeded: Set<NodeState>, dragBlocked: Set<NodeState>, blocked: boolean, versioned: boolean): void => {
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
      // A server's Appear animation not yet handed off (#245, ADR-0044 *Amendment (#245)*): its CSS
      // transform beats an inline one, but not an important one. Its timeline runs on; the restore
      // below gives the old value back, at its own priority.
      if (appearRuns(node.element)) node.element.style.setProperty("transform", "none", "important")
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
    // Each ancestor that moves a node with a transform: its origin, and its transform as a map (#137).
    const ancestorReads = new Map<Element, AncestorRead>()
    passUnheld.clear()
    let holds: ReadonlyArray<TransformHold> = []
    let documentScroll: Point.Point
    try {
      documentScroll = measureDocumentScroll()
      passScroll = documentScroll
      // The page's boxes as this round reads the layout (#261): a delivery reporting these sizes is its echo.
      Iter.forEach(pageBoxes, recordPageBox)
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
        if (Predicate.isUndefined(node.correctorBases)) node.correctorBases = readBases(node.element)
      }
      // Each node's fold (ADR-0012, *Amendment (Reorder)*), now every `layoutScroll`
      // sample is in: every container that can scroll, read once this pass.
      const before = Arr.map(ordered, (node) => node.fold)
      const folds = new Map<Element, Fold>()
      for (const node of ordered) node.fold = foldOf(node, folds)
      // A scroll root that switched, or a scrolled container gained or lost (ADR-0012, *Amendment
      // (#7)*): each node's stored boxes are carried into its new frame, so the switch moves nothing.
      for (const [node, old] of Arr.zip(ordered, before)) carryAcrossFrames(node, old, documentScroll)

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
        node.paintMapNow = undefined
        node.paintChain = undefined
        // Its paint deltas are this pass's to set again, below.
        if (painted.delete(node)) {
          node.paintDelta = undefined
          node.unpaintDelta = undefined
        }
        if (transformedFrom(node.element.parentElement, transformMemo, wanted)) under.push(i)
      }
      // --- WRITE: hold the ancestors that carry a transform at their identity. -----
      // Their transforms as they are, before the hold sets them to identity (ADR-0012, *Amendment (#137)*).
      const passTransforms = Arr.map(wanted, ([el, style]) => passTransformOf(el, style))
      holds = Arr.map(wanted, ([el, style]) => holdTransform(el, style))
      // --- READ: each one's box, held, and so its transform origin on the page. ------
      Arr.forEach(wanted, ([el], k) => {
        const box = el.getBoundingClientRect()
        const origin = transformOriginOf(el)
        ancestorReads.set(el, {
          origin: { x: box.left + origin.x, y: box.top + origin.y },
          pass: UndefinedOr.map(passTransforms[k], (m) => mapAbout({ x: box.left + origin.x, y: box.top + origin.y }, m.e, m.f, m.a, m.d)),
        })
      })
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

    // Each moved twin's chain of ancestors whose transforms move it (ADR-0012, *Amendment (#137)*): its
    // conversions follow the translate and scale Wardic animates on them, and its node ancestors' own
    // scale, each time they're made. One it can't map keeps the paint deltas above, as of this pass.
    Arr.forEach(ordered, (node, i) => {
      if (Predicate.isUndefined(node.layoutId)) return
      if (Bool.not(moved[i])) return
      const chain = paintChainOf(node, ancestorReads, documentScroll)
      node.paintChain = chain
      node.paintMapNow = UndefinedOr.map(chain, (links) => () => composeLinks(links))
    })

    // Each node's box and delta as the pass begins (#146): a restart starts from where its node,
    // and its relative parent, paint then, and the loop below changes both.
    for (const n of ordered) {
      n.passBox = n.retained
      n.passDelta = n.lastDelta
      n.passPainted = undefined
      if (active.has(n)) n.passPainted = n.lastTarget
    }

    // --- WRITE: FLIP detection + seeding, on the already-measured boxes. ------
    for (let i = 0; i < ordered.length; i++) {
      const node = ordered[i]
      // A `display: contents` element has no box (ADR-0009 *Amendment (#9)*): its rect is 0x0 at
      // the viewport's origin, which a scroll would read as a move. It never animates or carries a
      // delta, and what it holds projects as if it weren't there.
      if (isBoxless(node)) {
        dropBox(node)
        continue
      }
      // Store the box in the SCROLL-STABLE frame (ADR-0012), so a scroll change
      // between triggers doesn't leak into the delta. Every scroll offset was
      // sampled in the read phase, so the whole ancestor chain is available.
      // A node nothing moved keeps its stored box (#136): the box just read may still carry
      // what an ancestor's transform paints.
      const prev = node.retained
      const newBox = boxThisPass(node, moved[i], viewportBoxes[i], documentScroll)
      node.retained = newBox
      if (versioned) node.layoutVersion++
      // A Switch seed only ever serves a node's first measure (ADR-0010 *Amendment
      // (#13)*); take it now, whichever branch below handles the node.
      const seed = node.seed
      node.seed = undefined
      const seedBlend = node.seedBlend
      node.seedBlend = undefined
      // So do a presence take-over's (#286): where it starts, and where its fade does.
      const enteredFrom = node.enteredFrom
      node.enteredFrom = undefined
      const fadeFrom = node.fadeFrom
      node.fadeFrom = undefined

      // SELF-SNAP (ADR-0013): a layoutRoot never FLIPs its own layout. Publish its
      // stable box (layoutBox + lastTarget) so descendants project relative to it; a FLIP
      // restarting in its frame starts from where it paints there (*Amendments (#33)* and
      // *(#146)*); write identity — no spring, never `active`. Under an active ancestor it is
      // also re-derived with the pass's group, which places it (counter-acting the ancestor's
      // layout animation, carried by its drag or Release offset). A dragged layoutRoot follows
      // the pointer instead: it takes the drag-blocked update below, like any dragged node.
      if (node.layoutRoot && !node.dragging) {
        if (Predicate.isNotUndefined(prev) && !boxesEqual(prev, newBox)) {
          changed.add(node)
          if (inDraggedTree(node)) dragBlocked.add(node)
        }
        if (hasActiveAncestor(node)) changed.add(node)
        node.layoutBox = newBox
        node.lastTarget = newBox
        node.origin = undefined
        node.flight = undefined
        node.animating = false
        node.crossfadeFrom = undefined
        node.handoverMoves = undefined
        // A released layoutRoot's Release offset isn't a layout animation: it goes on from
        // its new slot, derived with the pass's group (ADR-0016, *Amendment (velocity family)*).
        if (Predicate.isNotUndefined(node.release)) {
          changed.add(node)
          continue
        }
        // One whose release has nothing left to run comes to rest here, its raise with this write,
        // unless a keyboard reorder still has it lifted (ADR-0037).
        node.releasing = false
        if (Bool.not(node.lifted)) node.raised = false
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

      if (Predicate.isUndefined(prev)) {
        // First measure — detection priority (ADR-0010):
        // (1) CROSSFADE: a LIVE prior twin already in this node's stack → animate
        //     FROM the prior lead's box (the prior twins become Followers locked
        //     onto us, fading out via the stack derive). Takes priority over the
        //     switch seed — the live twin's box is authoritative.
        // Where the prior Lead painted as the pass began (#170: mid-flight, released or dragged,
        // as seen), in this node's frame, through where it paints (#136).
        // As drawn, its own scale on top, and this node's own scale divided out, so it is drawn
        // there on its first frame (ADR-0010 *Amendment (#8)*).
        const priorBox = UndefinedOr.map(priorLeadOf(node), (lead) =>
          UndefinedOr.map(
            UndefinedOr.match(paintedAtPass(lead), {
              onDefined: identity,
              onUndefined: () => UndefinedOr.match(lead.layoutBox, { onDefined: identity, onUndefined: () => lead.retained }),
            }),
            (box) => undrawnFor(node, between(lead, node, drawnOf(lead, box), documentScroll)),
          ))
        if (Predicate.isNotUndefined(priorBox)) {
          // It blends from the prior Lead's look as drawn, and the prior Lead's own blend ends: it
          // follows this one now (ADR-0010 *Amendment (#166)*).
          UndefinedOr.map(priorLeadOf(node), (prior) => {
            node.blend = lookAsLeadOf(prior, undefined)
            prior.blend = undefined
          })
          // Shaped by its Layout mode; a handover crossfades even when that leaves nothing to
          // move, the twins' boxes equal (#5, Motion's: any `resumeFrom` animates).
          node.origin = shapedOrigin(node, priorBox, newBox)
          node.layoutBox = newBox
          node.flight = startFlight(node)
          // A handover: the crossfade fades the new Lead in from 0 (ADR-0010), or, for a keyed
          // twin back mid-crossfade, from where its leaver had faded to (#286).
          beginHandover(node)
          UndefinedOr.map(fadeFrom, (from) => {
            node.crossfadeFrom = from
          })
          node.animating = true
          active.add(node)
          start(node)
          continue
        }
        // (1b) TAKE-OVER (#286, ADR-0048): a presence child back under its key, its leaver gone. It
        //     moves from where the leaver painted, as a layout change, no handover: rebased as a
        //     Switch seed is, and drawn there on its first frame, its own scale divided out. A Switch
        //     seed the same leaving twin left is passed over: the key decides where it comes from.
        if (Predicate.isNotUndefined(enteredFrom)) {
          const origin = undrawnFor(node, unpaintedOf(node, offsetUnlessZero(enteredFrom, rootFrameShift(node, documentScroll))))
          if (Bool.not(boxesEqual(origin, newBox))) {
            node.origin = shapedOrigin(node, origin, newBox)
            node.layoutBox = newBox
            node.flight = startFlight(node)
            node.animating = true
            active.add(node)
            start(node)
            continue
          }
          node.lastDelta = IDENTITY_DELTA
          writeProjection(node, IDENTITY_DELTA, TREE_SCALE_IDENTITY)
          continue
        }
        // (2) SWITCH: a disposed twin left this node a seed — no live twin in the
        //     stack. The seed is in the Root frame; rebase it into this node's
        //     Scroll-stable frame by adding its containers' scroll (sampled this
        //     pass), taking the page's back out under a scroll root (#331), and taking
        //     out what its ancestors' transforms paint (#136), then FLIP from it to the
        //     measured box (a move, no crossfade — the leaver is gone). ADR-0012 /
        //     ADR-0010 *Amendment (#13)*.
        if (Predicate.isNotUndefined(seed)) {
          // Drawn there on its first frame, its own scale divided out (ADR-0010 *Amendment (#8)*).
          const origin = undrawnFor(node, unpaintedOf(node, offsetUnlessZero(seed, rootFrameShift(node, documentScroll))))
          // It blends from the leaver's look as drawn (ADR-0010 *Amendment (#166)*), so a Switch at an
          // equal box animates too when the two look different (Motion's: any `resumeFrom` animates).
          const differs = UndefinedOr.match(seedBlend, { onUndefined: constFalse, onDefined: (look) => looksOtherThan(node, look) })
          if (Bool.or(Bool.not(boxesEqual(origin, newBox)), differs)) {
            node.blend = seedBlend
            node.origin = shapedOrigin(node, origin, newBox)
            node.layoutBox = newBox
            node.flight = startFlight(node) // progress restarts at 0
            // A handover: a leaver re-introduced as a Follower (`handleLeave`) fades out with it.
            beginHandover(node)
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

      // Origin = where the element paints RIGHT NOW, mid-animation or at rest (smooth
      // interrupt, no jump), in the frame its placement now starts from (ADR-0013,
      // *Amendment (#146)*).
      // Shaped by its Layout mode (ADR-0009, *Amendment (#42)*): `"size"` moves it to the new box,
      // so a node at rest that only moved has nothing to animate.
      const origin = shapedOrigin(node, restartOriginOf(node, prev), newBox)
      // A node at rest that only moved with its layoutRoot (or its frame) has nothing of its own to animate.
      if (Bool.and(Bool.not(node.animating), boxesEqual(origin, newBox))) {
        node.layoutBox = newBox
        continue
      }

      // A crossfade this interrupts goes on from the factor it had (ADR-0010, *Note (velocity
      // family)*); any other restart is no handover, and leaves the factors alone.
      // Each twin goes on from the factor it had, along its own curve (#5).
      if (Predicate.isNotUndefined(node.crossfadeFrom)) {
        node.crossfadeFrom = fadeOf(node)
        captureExits(node)
      }
      // A blend this interrupts goes on from the look it was drawn with (ADR-0010 *Amendment (#166)*).
      node.blend = UndefinedOr.map(node.blend, (blend) => lookAsLeadOf(node, UndefinedOr.map(blend.opacity, () => drawnOpacityOf(node))))
      node.origin = origin
      node.layoutBox = newBox
      node.flight = startFlight(node) // progress restarts at 0 (velocity 0)
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
    // A Declared layout change's Measurements serve this pass, and the next task's call takes its own.
    declared = false
    const seeded = new Set<NodeState>()
    const dragBlocked = new Set<NodeState>()
    // The Resize block: this pass takes it and clears it. A page-size refresh is the same blocked pass (#261).
    const refreshed = refreshing
    refreshing = false
    const blocked = Bool.or(resizeBlocked, refreshed)
    resizeBlocked = false
    runtime.runFork(FiberHandle.clear(resizeWait))
    let rounds = 0
    inPass = true
    try {
      do {
        triggeredDuringPass = false
        rounds++
        sink.flushPass(() => runMeasurePass(seeded, dragBlocked, blocked, true))
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
    // This task's Declared layout changes settle once the flights this pass started have ended (#191).
    takeSettleCallbacks(seeded)
    if (triggeredDuringPass && !disposed) {
      triggeredDuringPass = false
      debug("measure round cap", { rounds })
      // The next task's pass: a real timer, whatever Scheduler is installed.
      FiberSet.addUnsafe(taskFibers, runtime.runFork(nextTask.pipe(Effect.andThen(Effect.sync(scheduleMeasure)))))
    }
    return Effect.annotateCurrentSpan({
      nodes: nodes.size,
      active: active.size,
      seeded: seeded.size,
      dragBlocked: dragBlocked.size,
      rounds,
      blocked,
      refresh: refreshed,
    })
  }).pipe(Effect.withSpan("wardic.projection.measure", undefined, { captureStackTrace: false }))

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

  /** Call an app's `callback` (#191): one that throws is reported, and the engine goes on. */
  const callApp = (callback: () => void, name: string): void => {
    try {
      callback()
    } catch (defect) {
      runtime.runFork(reportFailure(`wardic.projection: ${name} failed`, Cause.die(defect)))
    }
  }

  /** The app's callback, if it gave one: called as {@link callApp} calls it. */
  const callAppIfAny = (callback: Option.Option<() => void>, name: string): void => {
    if (Option.isSome(callback)) callApp(callback.value, name)
  }

  /** Whether `flight` still runs on `node`: not landed, not replaced by a restart, not cut short, not unmounted. */
  const stillFlying = ([node, flight]: readonly [NodeState, Flight]): boolean =>
    Bool.every([nodes.has(node), node.flight === flight, Bool.not(flight.landed)])

  /** Call the `onSettled` of each settling none of whose flights still runs (#191). */
  const checkSettlings = (): void => {
    if (Arr.isReadonlyArrayEmpty(settlings)) return
    const done = Arr.filter(settlings, (s) => Bool.not(Arr.some(s.flights, stillFlying)))
    if (Arr.isReadonlyArrayEmpty(done)) return
    settlings = Arr.filter(settlings, (s) => Arr.some(s.flights, stillFlying))
    for (const s of done) for (const callback of s.callbacks) callApp(callback, "onSettled")
  }

  /** A settling's ending outside a tick or a pass (an unmount): checked at the end of the task. */
  const checkSettlingsLater = (): void => {
    if (Arr.isReadonlyArrayEmpty(settlings)) return
    endOfTask("wardic.projection.settle", {}, () => {
      checkSettlings()
      return {}
    })
  }

  /**
   * The end-of-task pass takes its task's `onSettled` callbacks (#191, ADR-0039): they wait on the
   * flights it started (`seeded`), and are called at once if it started none.
   */
  const takeSettleCallbacks = (seeded: ReadonlySet<NodeState>): void => {
    if (Arr.isArrayNonEmpty(settleCallbacks)) {
      const flights: Array<readonly [NodeState, Flight]> = []
      for (const node of seeded) if (Predicate.isNotUndefined(node.flight)) flights.push([node, node.flight])
      settlings = Arr.append(settlings, { flights, callbacks: settleCallbacks })
      settleCallbacks = []
    }
    checkSettlings()
  }

  /**
   * After each tick's flush (#191, ADR-0039): the app's `onLayoutAnimationStart` for each flight that
   * took its first step, then `onLayoutAnimationComplete` for each that landed, then any `onSettled`
   * whose flights have all ended. The Frame loop calls its hooks in the order they were added, and the
   * provider adds its gate's first, so the frame is in the DOM. Per frame: nothing to do is two reads.
   */
  const afterTick = (): undefined => {
    if (Arr.isArrayNonEmpty(flightStarts)) {
      for (const node of flightStarts.splice(0)) callAppIfAny(node.onLayoutAnimationStart(), "onLayoutAnimationStart")
    }
    if (Arr.isArrayNonEmpty(flightLands)) {
      for (const node of flightLands.splice(0)) callAppIfAny(node.onLayoutAnimationComplete(), "onLayoutAnimationComplete")
    }
    if (Arr.isArrayNonEmpty(releaseEnds)) {
      for (const node of releaseEnds.splice(0)) callAppIfAny(node.onReleaseEnd(), "onDragTransitionEnd")
    }
    checkSettlings()
    return undefined
  }
  runtime.runSync(FrameLoop.FrameLoop.use((loop) => loop.afterTick(afterTick)).pipe(Scope.provide(scope)))

  /**
   * A **Declared layout change**'s Measurements (#4, ADR-0038): one slot-only round over every node at
   * the call, before its callback runs, so the end-of-task pass animates what the callback moves from
   * where each node is now. It starts nothing, and a running animation keeps its delta (the Resize
   * block's update, ADR-0018 *Amendment (#39)*). It isn't a pass a **Reorder group** waits on, since
   * the layout it reads is from before the change: no node's `layoutVersion` rises, and no pass-end
   * listener runs. Traced as `wardic.projection.declared`.
   */
  const declaredMeasure: Effect.Effect<void> = Effect.suspend(() => {
    inPass = true
    try {
      sink.flushPass(() => runMeasurePass(new Set(), new Set(), true, false))
    } finally {
      inPass = false
    }
    // A trigger from its flush is the end-of-task pass's, which the call queues.
    triggeredDuringPass = false
    return Effect.annotateCurrentSpan({ nodes: nodes.size, active: active.size })
  }).pipe(Effect.withSpan("wardic.projection.declared", undefined, { captureStackTrace: false }))

  /**
   * The Measurements a task's first **Declared layout change** takes (#4): a Measure pass already due
   * runs now, so what triggered it animates as it would have, and its reads stand; else the slot-only
   * read. None under a **Resize block**, which wins: the pass after the callback starts nothing. A
   * failure is reported, and the callback still runs.
   */
  const takeMeasurements = (): void => {
    declared = true
    if (resizeBlocked) return
    const measure = Bool.match(passQueued, { onTrue: () => measurePass, onFalse: () => declaredMeasure })
    const due = passQueued
    runtime.runSync(measure.pipe(Effect.catchCause((cause) => reportFailure("wardic.projection: animateLayout's measure failed", cause))))
    // The pass that ran was due at the end of the task: its queued fiber runs that pass now, after the callback.
    if (due) passQueued = true
    declared = true
  }

  const animateLayout: ProjectionSystem["animateLayout"] = (fn, options = NO_ANIMATE_LAYOUT_OPTIONS) => {
    if (Bool.not(Bool.some([disposed, declared, inPass]))) takeMeasurements()
    // Its end-of-task pass takes it, whatever `fn` does (#191).
    if (Bool.not(disposed)) UndefinedOr.map(options.onSettled, (onSettled) => settleCallbacks.push(onSettled))
    try {
      const result = fn()
      if (Predicate.isPromiseLike(result)) {
        runtime.runFork(Effect.logWarning("wardic.projection: animateLayout's callback returned a promise; only its synchronous part animates"))
      }
      return result
    } finally {
      scheduleMeasure()
    }
  }

  /**
   * Where a node (re)starting its layout animation in a Measure pass starts (ADR-0013, *Amendment
   * (#146)*): where it paints as the pass begins ({@link paintedAtPass}), its own Release offset
   * left out (that runs on top), in the frame its placement now starts from. Placed relative to a
   * parent, it keeps the offset it paints at from where that parent paints, in the parent's start
   * box (its origin, or its box): so a child at another progress than its parent, or at rest under
   * it, goes on from where it is, and a layoutRoot that moved carries it (*Amendment (#33)*). With
   * no relative parent, it starts where it paints, as Motion's snapshot of a node mid-animation is
   * its painted box. Run in the pass, after the relative parents' own updates.
   */
  const restartOriginOf = (node: NodeState, prev: Box.Box): Box.Box => {
    const own = ownStartOf(node, prev)
    const rp = relativeParentOf(node)
    if (Predicate.isUndefined(rp)) return own
    const rpPainted = paintedAtPass(rp)
    if (Predicate.isUndefined(rpPainted)) return own
    const rpFrom = startBoxOf(rp)
    if (Predicate.isUndefined(rpFrom)) return own
    const anchor = relativeAnchorOf(node)
    return Projection.placeRelativeBox(Projection.calcRelativeBox(own, rpPainted, anchor), rpFrom, anchor)
  }

  /**
   * Where a layout animation of `node` from `origin` to `to` starts, by its Layout mode
   * (ADR-0009, *Amendment (#42)*, Motion's snapshot shaping): `origin` itself for `true`.
   * Once per layout animation's start.
   */
  const shapedOrigin = (node: NodeState, origin: Box.Box, to: Box.Box): Box.Box => {
    const mode = node.layoutMode()
    if (mode === true) return origin
    return Projection.shapeOrigin(mode, origin, to)
  }

  /** Where `node` painted as the pass began (`prev` with no record of it), its own Release offset left out. Statement `if`s: once per restarting node. */
  const ownStartOf = (node: NodeState, prev: Box.Box): Box.Box => {
    const painted = paintedAtPass(node)
    if (Predicate.isUndefined(painted)) return prev
    if (Predicate.isUndefined(node.release)) return painted
    return offsetBox(painted, negate(releaseOffsetOf(node)))
  }

  /** The box a node's layout animation starts from: its origin while one runs, else its box. */
  const startBoxOf = (node: NodeState): Box.Box | undefined => {
    const origin = node.origin
    if (Predicate.isNotUndefined(origin)) return origin
    return node.layoutBox
  }

  /**
   * Where `node` painted as the current Measure pass began: its last target when it was active
   * (it is derived every frame, so that is where it paints); else its {@link NodeState.passBox}
   * through its ancestors' projections and its own ({@link NodeState.passDelta}), root-first, as
   * CSS composes them, or the box itself when every one of them is the identity (any pass from
   * rest); `undefined` with no box.
   */
  const paintedAtPass = (node: NodeState): Box.Box | undefined => {
    const target = node.passPainted
    if (Predicate.isNotUndefined(target)) return target
    const box = node.passBox
    if (Predicate.isUndefined(box)) return undefined
    if (restsAtPass(node)) return box
    const chain: Array<Projection.Delta> = []
    for (let p: NodeState | undefined = node; Predicate.isNotUndefined(p); p = p.parent) chain.push(p.passDelta)
    chain.reverse()
    return Projection.applyTreeDeltas(box, chain).box
  }

  /**
   * Where `node` paints now (#170, ADR-0010 *Amendment (#170)*): its box through its ancestors'
   * projections and its own as last written, root-first, as CSS composes them. That is everything
   * moving it on screen: its layout animation mid-flight, its Release offset, a drag, its carriers;
   * at rest, its box. What a handover outside a Measure pass starts from (a promotion, a Switch
   * seed); one inside a pass reads {@link paintedAtPass}. `undefined` with no box.
   */
  const paintedNowOf = (node: NodeState): Box.Box | undefined => {
    const box = boxOf(node)
    if (Predicate.isUndefined(box)) return undefined
    const chain: Array<Projection.Delta> = []
    for (let p: NodeState | undefined = node; Predicate.isNotUndefined(p); p = p.parent) chain.push(p.lastDelta)
    chain.reverse()
    return Projection.applyTreeDeltas(box, chain).box
  }

  /** Whether `node`'s pass delta and every ancestor's are the identity: nothing moved where it paints. */
  const restsAtPass = (node: NodeState): boolean => {
    for (let p: NodeState | undefined = node; Predicate.isNotUndefined(p); p = p.parent) if (Bool.not(isIdentityDelta(p.passDelta))) return false
    return true
  }

  /** A node's relative-projection anchor (ADR-0013): its `layoutAnchor`, top-left when it sets none. */
  const relativeAnchorOf = (node: NodeState): Point.Point => {
    const anchor = node.layoutAnchor
    if (Predicate.isUndefined(anchor)) return ZERO_ANCHOR
    if (anchor === false) return ZERO_ANCHOR
    return anchor
  }

  /** How far `node`'s Release offset has it from where its layout puts it now (zero with none). */
  const releaseOffsetOf = (node: NodeState): Point.Point =>
    UndefinedOr.match(node.release, {
      onUndefined: () => ZERO_POINT,
      onDefined: (release) => ({ x: release.x, y: release.y }),
    })

  /** Whether `n` is placed in `frame`'s frame: its relative parent is `frame`, or a running node that is. */
  const placedIn = (n: NodeState, frame: NodeState): boolean => {
    const rp = relativeParentOf(n)
    if (Predicate.isUndefined(rp)) return false
    if (rp === frame) return true
    if (Bool.not(rp.animating)) return false
    return placedIn(rp, frame)
  }

  /**
   * Move a released node's layout animation by `shift`, with the running descendants placed in
   * its frame (ADR-0016, *Amendment (velocity family)*), so none of them jumps. One placed in
   * another frame (a layoutRoot's inside this node) keeps its origin. Run before the node
   * stops being dragged, while it is its subtree's relative parent.
   */
  const shiftFlight = (node: NodeState, shift: Point.Point): void => {
    if (Bool.and(shift.x === 0, shift.y === 0)) return
    const running = Arr.filter(Arr.fromIterable(nodes), (n) =>
      Bool.every([n.animating, Predicate.isNotUndefined(n.origin), isDescendantOf(n, node), placedIn(n, node)]))
    Arr.forEach(running, (n) => {
      n.origin = offsetBox(UndefinedOr.getOrThrow(n.origin), shift)
    })
    node.origin = offsetBox(UndefinedOr.getOrThrow(node.origin), shift)
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

  /**
   * Note `node`'s flight after its step, for the app's callbacks (#191, ADR-0039): its first step is
   * its start, and the step it lands its completion, each once per flight. A Follower's flight is
   * marked too (a relegated twin can still be flying), so an `onSettled` waiting on it ends, but its
   * callbacks don't fire: a handover is its Lead's. Per frame: statement `if`s, no allocation.
   */
  const noteFlight = (node: NodeState, landed: boolean): void => {
    const flight = node.flight
    if (Predicate.isUndefined(flight)) return
    if (!flight.started) {
      flight.started = true
      if (!isFollower(node)) flightStarts.push(node)
    }
    if (!landed) return
    if (flight.landed) return
    flight.landed = true
    if (!isFollower(node)) flightLands.push(node)
  }

  // --- The coordinator (writes), one tick of the Clock. -----------------------
  const step = (dtRaw: number): void => {
    const dt = Math.min(dtRaw, Machine.MAX_DT)
    const settled: Array<NodeState> = []
    // 1) Step every active node's springs (no derive yet — the tree-aware derive needs
    //    ALL springs advanced before computing parent-first): its layout animation's
    //    progress, and its Release offset's two axes. It settles when both are at rest.
    for (const node of active) {
      // A dragging node (ADR-0016) follows the pointer — kept active + derived each frame,
      // never settled. A layout animation its grab left running goes on under it.
      if (node.dragging) {
        noteFlight(node, stepFlight(node, dt))
        continue
      }
      // Both stepped every tick; it settles once both are at rest. Statement `if`s: `Bool.and` is a
      // `dual`, a cost per node per frame (ADR-0025).
      const landed = stepFlight(node, dt)
      noteFlight(node, landed)
      const released = stepRelease(node, dt)
      if (released) noteRelease(node)
      if (!landed) continue
      if (!released) continue
      settled.push(node)
    }
    // 2) Derive all top-down (settled nodes are still in `active` here, so their
    //    progress=1 identity-ish delta is available to descendants this frame).
    deriveAll()
    finishSettled(settled)
  }

  /**
   * Step `node`'s layout animation, if one runs; whether it is at rest (ADR-0009 *Amendment (#171)*):
   * a spring stepped toward 1 (`Spring.step` holds its delay), or a tween's eased progress by its
   * time, held at 0 through its delay. Per frame: statement `if`s, written in place.
   */
  const stepFlight = (node: NodeState, dt: number): boolean => {
    const flight = node.flight
    if (Predicate.isUndefined(flight)) return true
    flight.elapsed += dt
    const timing = flight.timing
    if (timing.kind === "spring") {
      const r = Spring.step(UndefinedOr.getOrThrow(flight.spring), dt, 1, timing.options, timing.rest)
      flight.spring = r.state
      flight.position = r.state.position
      return r.done
    }
    const active = flight.elapsed - timing.delay
    if (active < 0) return false
    const t = Math.min(1, active / timing.duration)
    flight.position = timing.ease(t)
    return t >= 1
  }

  /** `node`'s Release offset at rest: its end told once, after this tick's flush (#273). Per frame: statement `if`s. */
  const noteRelease = (node: NodeState): void => {
    const release = node.release
    if (Predicate.isUndefined(release)) return
    if (release.told) return
    release.told = true
    releaseEnds.push(node)
  }

  /**
   * Step `node`'s Release offset back to zero on each axis, on its drag transition, if one runs
   * (ADR-0016, *Amendment (velocity family)*, *Amendment (#140)*); whether it is at rest. A stopped
   * one holds where it is. Reduced motion leaves it alone: it continues the gesture (ADR-0029). Per
   * frame: written in place.
   */
  const stepRelease = (node: NodeState, dt: number): boolean => {
    const release = node.release
    if (Predicate.isUndefined(release)) return true
    if (release.stopped) return false
    const x = Inertia.step(release.stateX, dt, release.inertiaX)
    const y = Inertia.step(release.stateY, dt, release.inertiaY)
    release.stateX = x.state
    release.stateY = y.state
    release.x = x.value
    release.y = y.value
    if (!x.done) return false
    return y.done
  }

  /** Finalise settled nodes (at rest, projection-owned at identity), finish their leavers, and stop at idle. */
  const finishSettled = (settled: ReadonlyArray<NodeState>): void => {
    // The running nodes placed in these landing nodes' frames go on from where they paint (#144).
    landFrames(settled)
    for (const node of settled) {
      node.releasing = false
      node.release = undefined
      node.animating = false
      node.flight = undefined
      node.origin = undefined
      node.crossfadeFrom = undefined
      node.handoverMoves = undefined
      node.lastDelta = IDENTITY_DELTA
      active.delete(node)
      // Its blend has run its course (ADR-0010 *Amendment (#166)*): one last write, at rest, draws its
      // own look again, so its own later rotate or opacity shows.
      const blended = Predicate.isNotUndefined(node.blend)
      node.blend = undefined
      // A raised node's release has settled: one last write, at rest, drops the raise; a node a
      // keyboard reorder still has lifted keeps it (ADR-0037).
      const unraises = node.raised && Bool.not(node.lifted)
      if (Bool.or(unraises, blended)) {
        if (unraises) node.raised = false
        derive(node)
      }
    }
    // A settled Lead's live Followers come to rest hidden, one write each (#5): a handover that only
    // moved held them at their own opacity until now.
    for (const node of settled) {
      if (Predicate.isUndefined(node.layoutId) || leadOf(node.layoutId) !== node) continue
      const stack = stacks.get(node.layoutId)
      if (Predicate.isNotUndefined(stack)) for (const f of stack) if (f !== node && !f.leaving) deriveFollower(f)
    }
    // 3b) A leaving Follower whose Lead just settled is done crossfading → remove it
    //     (fires onDone → presence removes the retained DOM node).
    for (const node of settled) {
      if (Predicate.isNotUndefined(node.layoutId) && leadOf(node.layoutId) === node) {
        const stack = stacks.get(node.layoutId)
        if (Predicate.isNotUndefined(stack)) for (const f of [...stack]) if (f.leaving) finishLeaver(f)
      }
    }
    if (active.size === 0) stopTicking()
  }

  /**
   * The running nodes whose relative parent's layout animation lands keep painting where they were
   * (ADR-0013, *Amendment (#144)*). One placed (through running nodes) in the nearest node of
   * `landing` is placed, from the next frame, in the frame that takes over: the next relative parent
   * above it that isn't landing (or none: its own frame). Its origin moves by the landing node's move
   * less the taking-over frame's, at the anchor of the node placed directly in the landing one, so
   * its start is where it was in the landed frame. Motion keeps the relative parent instead
   * (`relativeTargetOrigin` against its box once it lands), which paints the same. Run before the
   * landing nodes are cleared; once per landing, nothing when no landing node had a layout animation.
   */
  const landFrames = (landing: ReadonlyArray<NodeState>): void => {
    if (Arr.every(landing, (n) => Bool.not(flying(n)))) return
    const ends = new Set(landing)
    const moves = Arr.flatMap(Arr.fromIterable(active), (n) => {
      if (ends.has(n)) return []
      if (Bool.not(flying(n))) return []
      return UndefinedOr.match(landingMoveOf(n, ends), { onUndefined: () => [], onDefined: (move) => [[n, move] as const] })
    })
    Arr.forEach(moves, ([n, move]) => {
      n.origin = offsetBox(UndefinedOr.getOrThrow(n.origin), move)
    })
  }

  /** How far the nearest landing node in `n`'s chain of running relative parents moves `n`'s start, if one does. */
  const landingMoveOf = (n: NodeState, ends: ReadonlySet<NodeState>): Point.Point | undefined => {
    const rp = relativeParentOf(n)
    if (Predicate.isUndefined(rp)) return undefined
    if (ends.has(rp)) {
      const anchor = relativeAnchorOf(n)
      const landed = flightMoveOrZero(rp, anchor)
      const taker = takerMoveOf(rp, ends, anchor)
      return { x: landed.x - taker.x, y: landed.y - taker.y }
    }
    if (Bool.not(flying(rp))) return undefined
    return landingMoveOf(rp, ends)
  }

  /** How far the frame that takes the landing `node`'s over moves, at `anchor` (none, or one at rest: zero). */
  const takerMoveOf = (node: NodeState, ends: ReadonlySet<NodeState>, anchor: Point.Point): Point.Point => {
    const taker = takerOf(node, ends)
    if (Predicate.isUndefined(taker)) return ZERO_POINT
    return flightMoveOrZero(taker, anchor)
  }

  /** {@link flightMoveOf}, zero when `node` has no layout animation. */
  const flightMoveOrZero = (node: NodeState, anchor: Point.Point): Point.Point =>
    UndefinedOr.match(flightMoveOf(node, anchor), { onUndefined: () => ZERO_POINT, onDefined: identity })

  /** The relative parent that takes the landing `node`'s frame over: the next one above it that isn't landing. */
  const takerOf = (node: NodeState, ends: ReadonlySet<NodeState>): NodeState | undefined => {
    const rp = relativeParentOf(node)
    if (Predicate.isUndefined(rp)) return undefined
    if (ends.has(rp)) return takerOf(rp, ends)
    return rp
  }

  /** How far `node`'s layout animation moves its frame, at `anchor`: from its origin to its box. */
  const flightMoveOf = (node: NodeState, anchor: Point.Point): Point.Point | undefined => {
    const from = node.origin
    const to = node.layoutBox
    if (Predicate.isUndefined(from)) return undefined
    if (Predicate.isUndefined(to)) return undefined
    const a = anchorPointOf(from, anchor)
    const b = anchorPointOf(to, anchor)
    return { x: b.x - a.x, y: b.y - a.y }
  }

  /**
   * A viewport resize (ADR-0018 *Amendment (#39)*; Motion's resize listener,
   * create-projection-node.ts:459-487 at 16c61222c4166bbef5ff6ab0051192faa79fa8c8).
   * Only a width change counts, as Motion's: it finishes every running layout
   * animation but a dragged node's (which keeps following the pointer), and blocks the
   * next Measure pass for 250 ms, so the reflow the resize causes snaps instead of
   * animating from boxes measured before it. Motion only lifts its block at 250 ms;
   * here the timer runs the blocked pass itself if none ran, so the boxes are fresh
   * for the next trigger (and a drag start runs it at once, see `dragStart`).
   */
  const onResize = (width: number): void => {
    if (disposed) return
    if (width === lastWidth) return
    lastWidth = width
    const finished: Array<NodeState> = []
    for (const node of active) if (!node.dragging) finished.push(node)
    if (finished.length > 0) {
      // At rest on their slots, derived while still active (as a tick derives a node
      // before it settles), so each writes its resting projection; then settled.
      for (const node of finished) {
        node.origin = undefined
        node.flight = undefined
        node.animating = false
        node.release = undefined
      }
      deriveGroup(groupOf(new Set(finished)))
      finishSettled(finished)
      debug("resize finish", { finished: finished.length })
      // Their flights are cut short: a Declared layout change waiting on them has settled (#191).
      checkSettlings()
    }
    resizeBlocked = true
    // A later change restarts the wait.
    FiberHandle.setUnsafe(
      resizeWait,
      runtime.runFork(
        Effect.sleep(RESIZE_BLOCK).pipe(
          Effect.andThen(
            Effect.sync(() => {
              if (resizeBlocked) scheduleMeasure()
            }),
          ),
        ),
      ),
    )
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
   *
   * It runs in the loop's last lane (`runLast`, ADR-0027 *Amendment (#137)*): each tick it steps
   * after every spine leg, so what it reads of their values (an ancestor's translate and scale, a
   * twin's own scale, rotation and opacity) is what that tick paints, whichever was added first.
   */
  const ensureRunning = (): void => {
    if (coordinating() || active.size === 0) return
    FiberHandle.setUnsafe(
      coordinator,
      runtime.runFork(
        FrameLoop.FrameLoop.use((loop) => loop.runLast(coordinatorMachine(), ignoreFrame)).pipe(
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
    // From where the twin paints, not where it would rest (#170): a handover that interrupts
    // another goes on from where the twin was seen.
    // As drawn, its own scale included, and this twin's own scale divided out, so it is drawn
    // there on its first frame (ADR-0010 *Amendment (#8)*).
    const fromStored = paintedNowOf(from)
    if (Predicate.isUndefined(fromStored)) return
    if (Predicate.isUndefined(ownBox)) return
    const fromBox = undrawnFor(node, between(from, node, drawnOf(from, fromStored), passScroll))
    // A handover, even with nothing to move (#5, Motion's): a leaver `handleLeave` re-introduces
    // rides it, fading out as this twin fades in. With none, each frame writes this twin as the Lead
    // it is: shown, and taking its own pointer input (#165).
    // It blends from the leaver's look as drawn as it went (ADR-0010 *Amendment (#166)*): taken at its
    // dispose, or, handed back by presence first, read now, as the Lead it was.
    node.blend = UndefinedOr.match(from.leftLook, { onUndefined: () => lookAsLeadOf(from, leavingOpacityOf(from)), onDefined: identity })
    node.origin = shapedOrigin(node, fromBox, ownBox)
    node.layoutBox = ownBox
    node.flight = startFlight(node)
    // A handover: the promoted twin fades in from 0 as the one it takes over from fades out.
    beginHandover(node)
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
    UndefinedOr.map(watched, (w) => w.unobserve(node.element))
    elementToNode.delete(node.element)
    if (Predicate.isNotUndefined(node.layoutId)) {
      const stack = stacks.get(node.layoutId)
      if (Predicate.isNotUndefined(stack)) {
        const i = stack.indexOf(node)
        if (i >= 0) stack.splice(i, 1)
        if (stack.length === 0) stacks.delete(node.layoutId)
      }
    }
    active.delete(node)
    nodes.delete(node)
    painted.delete(node)
    // What it carried and brought back with it goes with it (#169).
    const within: Array<NodeState> = []
    for (const n of nodes) if (n.leaving && node.element.contains(n.element)) within.push(n)
    for (const n of within) if (n.leaving) finishLeaver(n)
    if (Predicate.isNotUndefined(cb)) cb()
  }

  /**
   * Build a transient leaving node for a re-introduced (already-disposed) one: a leaving Follower
   * with its `layoutId`, or with none a layout node its leaving container carries (#169). With a
   * `chain`, its conversions follow those ancestors live (ADR-0010 *Amendment (#181)*); without, as of
   * its last pass.
   */
  const makeLeavingNode = (
    el: HTMLElement,
    layoutId: string | undefined,
    recent: LastPass,
    onDone: (() => void) | undefined,
    layoutAnchor: Point.Point | false | undefined,
    chain: ReadonlyArray<PaintLink> | undefined,
  ): NodeState => ({
    id: "", // a leaving Follower is driven via the Renderer, not the gate — no id needed
    element: el,
    transition: Option.none,
    // A Follower's callbacks never fire: a handover is its Lead's (#191).
    onLayoutAnimationStart: NO_CALLBACK,
    onLayoutAnimationComplete: NO_CALLBACK,
    onReleaseEnd: NO_CALLBACK,
    lastWritten: undefined,
    respectReducedMotion: () => true,
    layoutMode: ALWAYS_BOTH,
    ownScale: NO_OWN_SCALE,
    ownTranslate: NO_OWN_TRANSLATE,
    ownRotate: NO_OWN_ROTATE,
    ownOpacity: NO_OWN_OPACITY,
    blend: undefined,
    seedBlend: undefined,
    leftLook: undefined,
    drawnOpacity: undefined,
    radiusBlended: false,
    layoutId,
    seed: undefined,
    enteredFrom: undefined,
    fadeFrom: undefined,
    paintDelta: recent.paintDelta,
    unpaintDelta: recent.unpaintDelta,
    paintMapNow: UndefinedOr.map(chain, (links) => () => composeLinks(links)),
    paintChain: chain,
    seenBox: undefined,
    retained: recent.box,
    origin: undefined,
    layoutBox: recent.box,
    flight: undefined,
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
    // Its box's frame as it was disposed (#331): one inside a scroll root folds no page scroll.
    fold: recent.fold,
    layoutVersion: 0,
    raiseWhileDragged: false,
    raised: false,
    lifted: false,
    crossfadeFrom: undefined,
    handoverMoves: undefined,
    exitFrom: undefined,
    fade: undefined,
    passBox: undefined,
    passDelta: IDENTITY_DELTA,
    passPainted: undefined,
    layoutRoot: false,
    layoutAnchor,
    dragging: false,
    grabBox: undefined,
    dragDelta: { x: 0, y: 0 },
    grabOffset: ZERO_POINT,
    releasing: false,
    release: undefined,
  })

  const doHandleLeave = (el: HTMLElement, onDone: () => void): boolean => {
    const live = elementToNode.get(el)
    const recent = leavers.get(el)
    // A live node's layoutId, else the one a leaver held as a twin.
    const layoutId = Option.getOrUndefined(
      Option.orElse(Option.flatMap(Option.fromUndefinedOr(live), (n) => Option.fromUndefinedOr(n.layoutId)), () =>
        Option.map(Option.flatMap(Option.fromUndefinedOr(recent), (r) => Option.fromUndefinedOr(r.twin)), (twin) => twin.layoutId)),
    )
    if (Predicate.isUndefined(layoutId)) return false
    debug("handleLeave", { layoutId, branch: Bool.match(Predicate.isNotUndefined(live), { onTrue: () => "live", onFalse: () => "reintroduce" }) })

    // (A) handleLeave BEFORE dispose — el's node is still live. Mark it leaving (its
    // later dispose then SKIPS removal), demote it to a Follower, and promote the twin.
    if (Predicate.isNotUndefined(live)) {
      const stack = stacks.get(layoutId)
      const isLead = leadOf(layoutId) === live
      const twin = Bool.match(isLead, { onTrue: () => priorLeadOf(live), onFalse: () => leadOf(layoutId) })
      if (Predicate.isUndefined(twin) || twin === live || Predicate.isUndefined(stack)) return false // lone leave
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
      if (Predicate.isNotUndefined(newLead) && active.has(newLead)) {
        deriveAll()
        return true
      }
      finishLeaver(live) // no animating lead to ride → finish promptly (already hidden)
      return true
    }

    // (B) dispose BEFORE handleLeave — el's node is gone; re-introduce it as a
    // transient leaving Follower from the recorded box (the re-introduce model).
    const lead = leadOf(layoutId)
    if (Predicate.isUndefined(lead) || lead.element === el || Predicate.isUndefined(recent)) return false
    const last = recent.last
    if (Predicate.isUndefined(last)) return false
    const stack = stacks.get(layoutId)
    if (Predicate.isUndefined(stack)) return false
    const follower = makeLeavingNode(el, layoutId, last, onDone, undefined, undefined)
    recent.reintroduced = true
    nodes.add(follower)
    elementToNode.set(el, follower)
    stack.splice(stack.length - 1, 0, follower) // insert below the Lead
    reintroduceWithin(el)
    computeTree()
    if (active.has(lead)) {
      deriveAll()
      return true
    }
    finishLeaver(follower)
    return true
  }

  /**
   * The twins inside a leaver presence re-introduced, disposed with it, come back too (#5): each
   * a leaving Follower of its own Lead, so a twin inside a closing container stays locked onto its
   * Lead, corrected for the container's scale, until the container goes. Motion keeps an exiting
   * subtree mounted, so its twins go on projecting; Solid disposes them before presence asks.
   * Only one whose Lead is in a handover, which removes it as it settles; a twin presence leaves
   * itself, or already re-introduced, is left alone. Its layout nodes with no `layoutId` come back
   * as nodes it carries, corrected for its lock, and go with it (#169).
   */
  const reintroduceWithin = (container: HTMLElement): void => {
    reintroduceTwinsWithin(container, () => undefined)
    reintroduceNodesWithin(container)
  }

  /**
   * The twins inside `container` re-introduced (#5): each a leaving Follower of its Lead in a
   * handover, spliced below it, with the chain `chainOf` gives it. The ones that came back.
   */
  const reintroduceTwinsWithin = (container: HTMLElement, chainOf: (held: TwinLeaver) => ReadonlyArray<PaintLink> | undefined): Array<NodeState> => {
    const twins: Array<NodeState> = []
    Arr.forEach(Array.from(leavers), ([inner, recent]) => {
      const held = recent.twin
      const last = recent.last
      if (Predicate.isUndefined(held)) return
      if (Predicate.isUndefined(last)) return
      if (inner === container) return
      if (recent.reintroduced) return
      if (Bool.not(container.contains(inner))) return
      const lead = leadOf(held.layoutId)
      const stack = stacks.get(held.layoutId)
      if (Predicate.isUndefined(lead)) return
      if (Predicate.isUndefined(stack)) return
      if (lead.element === inner) return
      if (Bool.not(active.has(lead))) return
      const twin = makeLeavingNode(inner, held.layoutId, last, () => undefined, undefined, chainOf(held))
      recent.reintroduced = true
      nodes.add(twin)
      elementToNode.set(inner, twin)
      stack.splice(stack.length - 1, 0, twin)
      twins.push(twin)
    })
    return twins
  }

  /**
   * The layout nodes with no `layoutId` inside `container` re-introduced as nodes it carries (#169),
   * derived under it each frame and finished with it.
   */
  const reintroduceNodesWithin = (container: HTMLElement): void =>
    Arr.forEach(Array.from(leavers), ([inner, recent]) => {
      const last = recent.last
      if (Predicate.isNotUndefined(recent.twin)) return
      if (Predicate.isUndefined(last)) return
      if (recent.reintroduced) return
      if (Bool.not(container.contains(inner))) return
      recent.reintroduced = true
      const carried = makeLeavingNode(inner, undefined, last, undefined, recent.layoutAnchor, undefined)
      nodes.add(carried)
      elementToNode.set(inner, carried)
    })

  /**
   * A leaving wrapper as a link of the twins it hands back (ADR-0010 *Amendment (#181)*): its origin
   * and its transform as they are now, in a frame `shift` from the page's. Read with the transform on,
   * its untransformed box solved from the drawn one (`drawn = O + t + s·(b − O)`, `O = b + origin`).
   * `undefined` when the transform isn't a translate and a positive scale. Read once, at the hand-back.
   */
  const wrapperLinkOf = (wrapper: HTMLElement, shift: Point.Point): PaintLink | undefined => {
    const style = getComputedStyle(wrapper)
    if (Arr.some(transformStyleFrom(style).moved, (property) => property !== "transform")) return undefined
    const m = matrixOf(style.transform)
    if (Bool.not(m.is2D)) return undefined
    if (m.b !== 0) return undefined
    if (m.c !== 0) return undefined
    if (m.a < 0) return undefined
    if (m.d < 0) return undefined
    const box = wrapper.getBoundingClientRect()
    const [ox, oy] = style.transformOrigin.split(" ")
    const o = { x: originPxOf(ox), y: originPxOf(oy) }
    const origin = { x: box.left - m.e + m.a * o.x, y: box.top - m.f + m.d * o.y }
    return { kind: "element", element: wrapper, origin: { x: origin.x + shift.x, y: origin.y + shift.y }, pass: inFrame(mapAbout(origin, m.e, m.f, m.a, m.d), shift) }
  }

  /**
   * `chain` with `link` for `element` in it by depth, after every link whose element holds it. It
   * replaces one the chain had for `element`: as of an older pass, or for its node, now disposed.
   */
  const withLink = (chain: ReadonlyArray<PaintLink>, link: PaintLink, element: Element): ReadonlyArray<PaintLink> => {
    const others = Arr.filter(chain, (l) => linkElementOf(l) !== element)
    const outer = Arr.filter(others, (l) => linkElementOf(l).contains(element))
    const inner = Arr.filter(others, (l) => Bool.not(linkElementOf(l).contains(element)))
    return Arr.appendAll(Arr.append(outer, link), inner)
  }

  /** Whether `el` is a twin held this task with a last pass, one a `handleLeave` may re-introduce itself. */
  const isHeldTwin = (el: HTMLElement): boolean =>
    UndefinedOr.match(leavers.get(el), {
      onUndefined: constFalse,
      onDefined: (leaver) => Bool.and(Predicate.isNotUndefined(leaver.twin), Predicate.isNotUndefined(leaver.last)),
    })

  /**
   * The twins inside a leaving element that isn't a twin handed back (ADR-0010 *Amendment (#181)*), as
   * {@link reintroduceWithin} does for a twin's: each a leaving Follower of its Lead, with the layout
   * nodes it carries (#169), and following the leaver's own transform as its exit draws it. `onDone`
   * once every one's handover has ended; the call returned drops them at once (an interrupted exit).
   * `undefined` when it held none.
   */
  const doHandBackWithin = (el: HTMLElement, onDone: () => void): (() => void) | undefined => {
    if (elementToNode.has(el)) return undefined
    if (isHeldTwin(el)) return undefined
    const twins = reintroduceTwinsWithin(el, (held) =>
      UndefinedOr.map(held.chain, (chain) =>
        UndefinedOr.match(wrapperLinkOf(el, held.shift), { onUndefined: () => chain, onDefined: (link) => withLink(chain, link, el) }),
      ),
    )
    if (Arr.isArrayEmpty(twins)) return undefined
    debug("handBackWithin", { twins: twins.length })
    // The handovers still running: `onDone` with the last.
    const running = new Set(twins)
    Arr.forEach(twins, (twin) => {
      twin.onLeaveDone = () => {
        running.delete(twin)
        if (running.size === 0) onDone()
      }
      reintroduceNodesWithin(twin.element)
    })
    computeTree()
    deriveAll()
    return () =>
      Arr.forEach(twins, (twin) => {
        if (Bool.not(twin.leaving)) return
        twin.onLeaveDone = undefined
        finishLeaver(twin)
      })
  }

  /**
   * Shared-element exit coupling, inside the `wardic.projection.handleLeave` span
   * (so the timeline shows the presence→engine hand-off; the `handleLeave` debug
   * log it emits attaches as a span event). The crossfade burst it kicks off runs
   * on the coordinator's own span.
   */
  const handleLeave: ProjectionSystem["handleLeave"] = (el, onDone) =>
    runtime.runSync(
      Effect.sync(() => doHandleLeave(el, onDone)).pipe(Effect.withSpan("wardic.projection.handleLeave", undefined, { captureStackTrace: false })),
    )

  const handBackWithin: ProjectionSystem["handBackWithin"] = (el, onDone) =>
    runtime.runSync(
      Effect.sync(() => Option.fromUndefinedOr(doHandBackWithin(el, onDone))).pipe(
        Effect.withSpan("wardic.projection.handBackWithin", undefined, { captureStackTrace: false }),
      ),
    )

  // As it paints, as a connected twin's Switch seed is read (#170), in the Root frame (#286).
  const rootBoxOf: ProjectionSystem["rootBoxOf"] = (el) => {
    if (Bool.not(el.isConnected)) return Option.none()
    return Option.some(offsetBox(Box.fromBounds(readLayoutBox(el)), measureDocumentScroll()))
  }

  // The factor it had faded to, then gone as at its handover's end (#286).
  const dropLeaver: ProjectionSystem["dropLeaver"] = (el) =>
    runtime.runSync(
      Effect.sync(() =>
        Option.flatMap(Option.filter(Option.fromUndefinedOr(elementToNode.get(el)), (node) => node.leaving), (node) => {
          const fade = UndefinedOr.match(node.fade, { onUndefined: () => 1, onDefined: identity })
          debug("dropLeaver", { layoutId: node.layoutId, fade })
          finishLeaver(node)
          return Option.some(fade)
        })
      ).pipe(Effect.withSpan("wardic.projection.dropLeaver", undefined, { captureStackTrace: false })),
    )

  /** Whether a page box takes space in the flow (#261): read the first time it's asked, then kept. */
  const takesSpace = (box: Element): boolean => {
    const known = pageFlow.get(box)
    if (Predicate.isNotUndefined(known)) return known
    const flows = takesFlowSpace(box)
    pageFlow.set(box, flows)
    return flows
  }

  /** Record a page box's size as a Measure pass round reads the layout (#261), if it takes space. */
  const recordPageBox = (box: Element): void => {
    if (takesSpace(box)) pageSizes.set(box, readBoxSize(box))
  }

  /** Whether a box has an area: an empty one moves nothing, coming or going. */
  const hasArea = (size: BoxSize): boolean => Bool.and(size.width > 0, size.height > 0)

  /**
   * Whether `entry` reports a page box whose size moved something since the last Measure pass round
   * read the layout (#261, ADR-0018 *Amendment (#261)*): one that takes space in the flow, at a size
   * other than the one recorded (read horizontally, as {@link alreadyMeasured} reads a node's), or with
   * none recorded and an area (one added since).
   */
  const pageMoved = (entry: ResizeObserverEntry): boolean => {
    const box = entry.target
    if (Bool.not(pageBoxes.has(box))) return false
    if (Bool.not(takesSpace(box))) return false
    const size = entry.borderBoxSize[0]
    if (Predicate.isUndefined(size)) return true
    const reported: BoxSize = { width: size.inlineSize, height: size.blockSize }
    return UndefinedOr.match(pageSizes.get(box), {
      onUndefined: () => hasArea(reported),
      onDefined: (recorded) =>
        Bool.or(Math.abs(reported.width - recorded.width) > SIZE_EPSILON, Math.abs(reported.height - recorded.height) > SIZE_EPSILON),
    })
  }

  /**
   * The page's boxes on the shared observer (#261), each tracked as one. One that took space in the
   * flow, removed, moved what followed it; its size changed nothing still watched, when the body is
   * sized to the window.
   */
  const pageWatch = (shared: Watched): Watched => ({
    observe: (box) => {
      pageBoxes.add(box)
      shared.observe(box)
    },
    unobserve: (box) => {
      if (UndefinedOr.match(pageSizes.get(box), { onUndefined: constFalse, onDefined: hasArea })) pageSpaceFreed = true
      pageBoxes.delete(box)
      pageSizes.delete(box)
      shared.unobserve(box)
    },
  })

  /** A change to the body's children (#261): one removed that took space refreshes; one added is the observer's to report. */
  const onPageChildren = (): void => {
    if (Bool.not(pageSpaceFreed)) return
    pageSpaceFreed = false
    refresh()
  }

  /**
   * A **page-size refresh** (#261, ADR-0018 *Amendment (#261)*): the page's content changed size since
   * the last Measure pass read it, so a node may have moved with nothing telling the engine. The Resize
   * block's pass runs now, inside the observer's delivery (after the frame's layout, before its paint):
   * every node takes the slot-only update, nothing starts, a running animation keeps its delta, and the
   * next layout animation starts from where its node is painted (Motion's snapshot at `willUpdate`).
   * Its `layoutVersion`s rise and its pass-end listeners run, as any pass's. None while a pass is due,
   * which reads every node and animates what moved as triggered, nor under a **Resize block**, whose
   * own pass does this once the resize settles.
   */
  const refresh = (): void => {
    if (Bool.some([disposed, inPass, passQueued, resizeBlocked, nodes.size === 0])) return
    refreshing = true
    runtime.runSync(measurePass.pipe(Effect.catchCause((cause) => reportFailure("wardic.projection: refresh failed", cause))))
  }

  /**
   * Whether the engine has already measured `entry`'s size (#21, ADR-0018 *Amendment (#21)*): its
   * node's last Measurement is the border box the observer reports, read horizontally (inline as
   * width, block as height), within {@link SIZE_EPSILON}. Anything else counts as unmeasured and runs
   * a pass, as every delivery did before:
   * - a vertical writing mode, where inline is height;
   * - an ancestor that scales the element without being a node, whose scale the Measurement carries
   *   and the observer's size doesn't;
   * - a node with no Measurement yet;
   * - a real resize.
   * An element that is no node any more (disposed, or a finished leaver) has nothing to measure.
   */
  const alreadyMeasured = (entry: ResizeObserverEntry): boolean => {
    const node = elementToNode.get(entry.target as HTMLElement)
    if (Predicate.isUndefined(node)) return true
    const box = node.retained
    const size = entry.borderBoxSize[0]
    if (Predicate.isUndefined(box) || Predicate.isUndefined(size)) return false
    return Bool.and(
      Math.abs(size.inlineSize - (box.x.max - box.x.min)) <= SIZE_EPSILON,
      Math.abs(size.blockSize - (box.y.max - box.y.min)) <= SIZE_EPSILON,
    )
  }

  /**
   * The shared observer's delivery (#21, ADR-0018 *Amendment (#21)*): a Measure pass only when an
   * entry reports a size the engine hasn't measured. Its first delivery for a node just mounted, and
   * its echo of a size a triggered pass already read, run none.
   */
  const onObserved = (entries: ReadonlyArray<ResizeObserverEntry>): void => {
    // A node's own resize runs a pass, which reads the page as well.
    if (Bool.not(Arr.every(entries, alreadyMeasured))) {
      scheduleMeasure()
      return
    }
    if (Arr.some(entries, pageMoved)) refresh()
  }

  const register: ProjectionSystem["register"] = (opts) => {
    // Read at each release, in `dragEnd` (ADR-0016, *Amendment (#140)*): kept off the node's state, which every frame reads.
    const dragTransition = UndefinedOr.match(opts.dragTransition, { onUndefined: () => NO_DRAG_TRANSITION, onDefined: identity })
    const node: NodeState = {
      id: opts.id,
      element: opts.element,
      transition: opts.transition,
      onLayoutAnimationStart: UndefinedOr.match(opts.onLayoutAnimationStart, { onUndefined: () => NO_CALLBACK, onDefined: identity }),
      onLayoutAnimationComplete: UndefinedOr.match(opts.onLayoutAnimationComplete, { onUndefined: () => NO_CALLBACK, onDefined: identity }),
      onReleaseEnd: UndefinedOr.match(opts.onReleaseEnd, { onUndefined: () => NO_CALLBACK, onDefined: identity }),
      lastWritten: undefined,
      respectReducedMotion: UndefinedOr.match(opts.respectReducedMotion, { onUndefined: () => constTrue, onDefined: identity }),
      layoutMode: UndefinedOr.match(opts.layoutMode, { onUndefined: () => ALWAYS_BOTH, onDefined: identity }),
      ownScale: UndefinedOr.match(opts.ownScale, { onUndefined: () => NO_OWN_SCALE, onDefined: identity }),
      ownTranslate: UndefinedOr.match(opts.ownTranslate, { onUndefined: () => NO_OWN_TRANSLATE, onDefined: identity }),
      ownRotate: UndefinedOr.match(opts.ownRotate, { onUndefined: () => NO_OWN_ROTATE, onDefined: identity }),
      ownOpacity: UndefinedOr.match(opts.ownOpacity, { onUndefined: () => NO_OWN_OPACITY, onDefined: identity }),
      blend: undefined,
      seedBlend: undefined,
      leftLook: undefined,
      drawnOpacity: undefined,
      radiusBlended: false,
      layoutId: opts.layoutId,
      seed: undefined,
      enteredFrom: opts.enteredFrom,
      fadeFrom: opts.fadeFrom,
      paintDelta: undefined,
      paintMapNow: undefined,
      paintChain: undefined,
      unpaintDelta: undefined,
      seenBox: undefined,
      retained: undefined,
      origin: undefined,
      layoutBox: undefined,
      flight: undefined,
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
        layoutVersion: 0,
      raiseWhileDragged: opts.raiseWhileDragged === true,
      raised: false,
      lifted: false,
      crossfadeFrom: undefined,
      handoverMoves: undefined,
      exitFrom: undefined,
      fade: undefined,
      passBox: undefined,
      passDelta: IDENTITY_DELTA,
      passPainted: undefined,
      layoutRoot: opts.layoutRoot === true,
      layoutAnchor: opts.layoutAnchor,
      dragging: false,
      grabBox: undefined,
      dragDelta: { x: 0, y: 0 },
      grabOffset: ZERO_POINT,
      releasing: false,
      release: undefined,
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
    if (Predicate.isNotUndefined(node.layoutId)) {
      let stack = stacks.get(node.layoutId)
      if (Predicate.isUndefined(stack)) {
        stack = []
        stacks.set(node.layoutId, stack)
      }
      stack.push(node)
      // Take the Switch seed a twin disposed earlier in this task left behind.
      const held = seeds.get(node.layoutId)
      if (Predicate.isNotUndefined(held)) {
        node.seed = held.box
        node.seedBlend = held.blend
        held.consumed = true
        seeds.delete(node.layoutId)
      }
    }
    // No observer on a server.
    const Observer = (globalThis as { readonly ResizeObserver?: typeof ResizeObserver }).ResizeObserver
    if (Predicate.isUndefined(ro) && Predicate.isNotUndefined(Observer)) {
      ro = new Observer(onObserved)
      const shared = counted(ro, BORDER_BOX)
      watched = shared
      stopPage = watchPage(pageWatch(shared), onPageChildren)
    }
    if (!resizeListening) {
      // The Environment's viewport (ADR-0018, *Amendment (#45)*): its Probe writes it inside the
      // resize event, and the registry calls this back inside that write, so the block is set
      // before the frame's Measure pass.
      resizeListening = true
      const probe = runtime.runSync(Probe.Probe)
      const registry = runtime.runSync(AtomRegistry.AtomRegistry)
      lastWidth = registry.get(probe.viewport).width
      stopViewport = registry.subscribe(probe.viewport, (viewport) => onResize(viewport.width))
    }
    UndefinedOr.map(watched, (w) => w.observe(node.element))
    // Seed retained + write the identity projection on the next frame.
    scheduleMeasure()

    return {
      notify: scheduleMeasure,
      // --- geometry (ADR-0016 *Amendment (Reorder)*): plain reads ------------------
      layoutBox: () => Option.orElse(Option.fromUndefinedOr(node.layoutBox), () => Option.fromUndefinedOr(node.retained)),
      dragOffset: () => {
        if (!node.dragging || Predicate.isUndefined(node.grabBox)) return ZERO_POINT
        const slot = definedOr(node.layoutBox, node.grabBox)
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
        node.grabBox = boxOf(node)
        if (Predicate.isUndefined(node.grabBox)) return // not measured yet — nothing to anchor
        debug("dragStart", { id: node.id })
        // A release the grab stopped hands the drag where it left the node, so it doesn't jump
        // (ADR-0016, *Amendment (velocity family)*, decision 4).
        node.grabOffset = releaseOffsetOf(node)
        node.release = undefined
        node.dragging = true
        node.releasing = false
        node.raised = node.raiseWhileDragged
        node.dragDelta = { x: 0, y: 0 }
        // A layout animation running at the grab runs on under the drag, toward the grab's
        // slot (decision 4; Motion's drag blocks new layout animations, not a running one).
        if (Bool.not(flying(node))) {
          node.flight = undefined
          node.origin = undefined
          node.animating = false
        }
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
      dragEnd: (velocity = ZERO_POINT) => {
        if (!node.dragging || Predicate.isUndefined(node.grabBox)) return
        debug("dragEnd", { id: node.id })
        const slot = definedOr(node.layoutBox, node.grabBox)
        const painted = dragPaintedOf(node, slot)
        // A layout animation the grab left running goes on, toward the slot now: it moves by
        // the anchor's distance to the slot, with the running descendants placed in its frame.
        if (flying(node)) shiftFlight(node, distanceBetween(anchorOf(node, slot), slot))
        node.dragging = false
        node.grabBox = undefined
        node.dragDelta = { x: 0, y: 0 }
        node.grabOffset = ZERO_POINT
        node.layoutBox = slot
        // The Release offset (ADR-0016, *Amendment (velocity family)*): how far the drag left
        // the node from where its layout puts it now, springing to zero per axis from the
        // loop's next tick, on top of that layout, as a Measure pass's FLIP is first stepped
        // (ADR-0033). Reduced motion leaves it as it is: it continues the gesture, as Motion's
        // release does (ADR-0029).
        const offset = distanceBetween(layoutTargetOf(node, slot), painted)
        if (Bool.and(releasesInPlace(offset, velocity), Bool.not(flying(node)))) {
          // Released in place, at rest: settle now. Write the resting projection first, so no
          // frame keeps an offset an earlier write left (a safety net: every pointer move writes
          // its offset, so the last write is normally the slot already).
          node.animating = false
          node.flight = undefined
          node.origin = undefined
          node.releasing = false
          node.raised = false
          deriveGroup(groupOf(new Set([node])))
          node.lastDelta = IDENTITY_DELTA
          active.delete(node)
          if (active.size === 0) stopTicking()
          // No release runs, so it has ended (#273): told from a microtask, as Motion's instant one resolves.
          queueMicrotask(() => {
            if (nodes.has(node)) callAppIfAny(node.onReleaseEnd(), "onDragTransitionEnd")
          })
          return
        }
        node.release = releaseOrLanded(offset, velocity, Option.getOrElse(dragTransition(), () => DEFAULT_DRAG_TRANSITION))
        node.releasing = true
        active.add(node)
        ensureRunning()
      },
      // --- keyboard lift (ADR-0037) --------------------------------------------
      lift: (on) => {
        if (node.lifted === on) return
        node.lifted = on
        if (on) node.raised = node.raiseWhileDragged
        // A running layout animation writes the raise each frame, and its landing drops it after a
        // drop; at rest, one write now raises it or drops it.
        if (active.has(node)) return
        if (Bool.not(on)) node.raised = false
        derive(node)
      },
      stopRelease: () => {
        const release = node.release
        if (Predicate.isUndefined(release)) return
        if (release.stopped) return
        // Where it is, at rest: a press drops the release's speed, as Motion's `stopAnimation` does.
        release.stopped = true
        restFrom(release)
      },
      resumeRelease: () => {
        const release = node.release
        if (Predicate.isUndefined(release)) return
        // From rest where the press stopped it, as Motion's `resumeAnimation` for `dragSnapToOrigin`.
        release.stopped = false
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
        if (Predicate.isNotUndefined(node.layoutId)) holdLeaver(node, node.layoutId)
        if (Predicate.isUndefined(node.layoutId)) holdNode(node)
        UndefinedOr.map(watched, (w) => w.unobserve(node.element))
        elementToNode.delete(node.element)
        active.delete(node)
        nodes.delete(node)
        painted.delete(node)
        // Stack relegation / promotion (ADR-0010): a leaving Lead promotes the new
        // newest node, animating it FROM the leaver's box (un-hide + move home).
        if (Predicate.isNotUndefined(node.layoutId)) {
          const stack = stacks.get(node.layoutId)
          if (Predicate.isNotUndefined(stack)) {
            const wasLead = stack[stack.length - 1] === node
            const i = stack.indexOf(node)
            if (i >= 0) stack.splice(i, 1)
            if (stack.length === 0) stacks.delete(node.layoutId)
            if (stack.length > 0 && wasLead) promoteFrom(stack[stack.length - 1], node)
          }
        }
        if (active.size === 0) stopTicking()
        // Its flight, if one ran, is cut off: a Declared layout change waiting on it may have settled (#191).
        checkSettlingsLater()
      },
    }
  }

  const dispose: ProjectionSystem["dispose"] = () => {
    debug("dispose system", { nodes: nodes.size })
    disposed = true
    passQueued = false
    if (resizeListening) {
      resizeListening = false
      stopViewport()
    }
    stopTicking()
    // Interrupt any end-of-task hold still pending, then drop what they held.
    runtime.runFork(Scope.close(scope, Exit.void))
    seeds.clear()
    leavers.clear()
    stopPage()
    stopPage = constVoid
    if (Predicate.isNotUndefined(ro)) ro.disconnect()
    ro = undefined
    watched = undefined
    pageBoxes.clear()
    pageSizes.clear()
    active.clear()
    nodes.clear()
    elementToNode.clear()
    passEndListeners.clear()
    // The provider and its app are gone: nothing is called back (#191).
    flightStarts.length = 0
    flightLands.length = 0
    settleCallbacks = []
    settlings = []
  }

  const registerValues: ProjectionSystem["registerValues"] = (el, read) => {
    elementValues.set(el, read)
    return () => {
      if (elementValues.get(el) === read) elementValues.delete(el)
    }
  }

  const system: ProjectionSystem = { register, notify: scheduleMeasure, animateLayout, handleLeave, handBackWithin, dispose, registerValues, rootBoxOf, dropLeaver }
  passEnds.set(system, passEndListeners)
  return system
}
