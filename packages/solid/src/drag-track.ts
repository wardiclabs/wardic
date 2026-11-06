/**
 * The binding-orchestrated drag track (ADR-0004 response half), Solid-free (#209): each binding
 * runs it through `driveDragTrack`, handing it a `watch` for its element's watch Scope, a `fork` for
 * its responses and a `setDragging` for its `dragging` signal. The Solid 1 binding's `runDragTrack`
 * (`drag.ts`) wraps it.
 *
 * DESIGN (locked via grilling, subtask 22c): on a drag-enabled element `x`/`y`
 * are DIRECT-SET by the pointer (1:1, NOT sprung) while the spring spine keeps
 * driving every OTHER key + `whileDrag`. Ownership of `x`/`y` is DYNAMIC: the
 * drag owns them while held AND during the release tail; once the release
 * settles, ownership returns to the spring (so a later `animate.x`/`y` or a
 * layout/Reorder FLIP can take over from the rested position). A Retarget that
 * changes `x` or `y` during the release takes them over sooner (#340, ADR-0016
 * *Amendment (#340)*), as a newer animation of Motion's value does: the release
 * stops where it is, tells no end, and the spring goes on from there, at the
 * release's velocity ({@link DragTrack.takeRelease}).
 *
 * This module is the RESPONSE half (binding orchestration). Core ships the
 * RECOGNITION (`drag()`, kept to its axis and holding its **Drag claim**), the
 * constraint (`Drag.constrain`) and the inertia PRIMITIVE (`inertia`, `inertiaVec`); the
 * constraints on the element's x/y, the release driver, the gate writes, and the
 * snapshot sync are response concerns and live here (ADR-0004, ADR-0016 *Amendment (#140)*).
 *
 * STRUCTURE (ADR-0032, ADR-0055 *Amendment (#379)*): input is handled inside its event, by two
 * watches in the element's watch Scope, with no fiber of the track's own at rest:
 *   - the drag's samples (`DragRecognizer.watchDrag`): a gesture's bookkeeping, then the direct-set,
 *     or at the "end" the release;
 *   - bare pointer-downs from the Primary pointer ("grabs", `InputFeed.watch`), which stop a
 *     running release, so a re-grab mid-release stops the tail where it is, and the ends of its
 *     presses, which let a projection node's release go on after a press that didn't drag.
 * Each response is an Effect, run by `fork` on the provider runtime: its fiber starts at once and
 * runs to its end inside the event (stopping a release interrupts a parked fiber in the caller's
 * stack), and a release it starts, in a `FiberHandle`, is forked from it, keeping the runtime's
 * scheduler, so it is on the Frame loop before its task ends. The next sample or grab interrupts it,
 * which removes it from the loop at once. A response that fails is reported, and the next event's
 * runs (ADR-0055 *Amendment (#379)*, Q4).
 *
 * **Drag controls** (#431, Motion's `useDragControls`) given to the element start its drag from a
 * pointer pressed elsewhere: the track hands it to the element's pointer feed
 * (`InputSource.adoptPointer`), whose adopted down the recognizer starts from as from a press on the
 * element, and its grab stops a running release. `snapToCursor` moves the element's centre under the
 * pointer there and then; `distanceThreshold` is that gesture's threshold. Their `stop` ends the drag
 * as a release would; `cancel` ends it where it is, with no release and no `onDragEnd`. With
 * `listen: false` (Motion's `dragListener={false}`) the element's own presses neither drag it nor stop
 * its release. The track subscribes to the controls while its watch Scope is open, so an element an
 * `<AnimatePresence>` is taking out (disposed) starts none, as Motion's doesn't.
 *
 * The samples subscribe before the grabs, so one event's samples reach the track
 * before its grab: a Stale gesture's "end" (ADR-0019, rule B) starts its release and
 * the grab of the same down stops it before its first frame, on every Environment.
 * The track's state is a plain `MutableRef`: each response runs to completion, and a
 * release is stopped before the next response changes the state.
 */
import * as Drag from "@wardic/core/Drag"
import type * as FrameLoop from "@wardic/core/FrameLoop"
import * as Inertia from "@wardic/core/Inertia"
import * as InputFeed from "@wardic/core/InputFeed"
import * as InputSource from "@wardic/core/InputSource"
import type * as Point from "@wardic/core/Point"
import * as DragRecognizer from "@wardic/core/DragRecognizer"
import type * as Values from "@wardic/core/Values"
import * as Machine from "@wardic/core/Machine"
import * as Microtask from "@wardic/core/Microtask"
import * as Probe from "@wardic/core/Probe"
import type * as FlushGate from "@wardic/dom/FlushGate"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Report from "@wardic/dom/Report"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FiberHandle from "effect/FiberHandle"
import { constFalse, constUndefined, constVoid, identity } from "effect/Function"
import * as Match from "effect/Match"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as UndefinedOr from "effect/UndefinedOr"
import type { DragContainer } from "./drag-constraints.ts"
import type { WardicServices } from "./runtime.ts"
import type { WardicTransformPoint } from "./config.ts"
import { subscribeDragControls, type WardicDragControls } from "./drag-controls.ts"
import { DEFAULT_DRAG_ELASTIC, dragTransitionOf, elasticOf } from "./drag-transition.ts"
import { pointMapOptionOf } from "./wardic-config-value.ts"


/**
 * The element's values as its drag reads and writes them: `values` and `velocities` by key, when `x`
 * and `y` last moved, and the clock's time. The drag goes on from where the element is, and leaves it
 * where the drag left it, its speed with it.
 */
// The spine's mutable Snapshot, the same object `runSpine` holds: each key's last value, a number or a
// string (ADR-0024).
export interface DragSnapshot {
  values: Values.Values
  velocities: Record<string, number>
  /** When the drag last moved `x` and `y`: their velocity holds 30 ms from then. */
  drawnAt: Record<string, number>
  /** The time now, on the element's provider's Clock. */
  readonly now: () => number
}

/** A drag's config, read once as it starts: the `drag` props of a Wardic element. */
export interface DragTrackConfig {
  /** `true` = free; `"x"`/`"y"` = axis-locked. */
  readonly axis: boolean | "x" | "y"
  /**
   * `true`: the drag takes no **Drag claim** and is never refused, so a draggable ancestor can
   * drag with it (Motion's `dragPropagation`). Default `false`.
   */
  readonly propagation?: boolean | undefined
  /**
   * Optional numeric constraints (per axis) on the element's x/y, whichever gesture moved it there
   * (Motion's): the drag keeps it within them, and a Fling springs back
   * to an edge it would cross. A projection node's x/y is its drag offset.
   */
  readonly constraints?: Drag.Bounds | undefined
  /** Rubber-band resistance past `constraints`: 0 a hard clamp. Default {@link DEFAULT_DRAG_ELASTIC}. */
  readonly elastic?: number | undefined
  /** Fling on release (default true); `false` releases with no velocity. */
  readonly momentum?: boolean | undefined
  /** Spring back to the origin on release: both edges at 0. */
  readonly snapToOrigin?: boolean | undefined
  /**
   * Motion's `dragDirectionLock`: each gesture starts once it passes 10 px on one
   * axis, and drags, claims and releases on that axis alone (`DragRecognizer.drag`'s `lock`).
   */
  readonly directionLock?: boolean | undefined
  /** What the release runs on: the element's drag transition, resolved ({@link dragTransitionOf}). */
  readonly transition: ProjectionSystem.DragTransition
  /**
   * Motion's `dragListener`: `false`, the element's own presses start no drag and stop no
   * release; only its **Drag controls**' starts do. Default `true`.
   */
  readonly listen?: boolean | undefined
}

/** What the track's watches and responses run with: the provider's services and the gestures' input (#511). */
export type TrackServices = WardicServices | InputSource.InputSource

/** Options for {@link driveDragTrack}. */
export interface DragTrackOptions {
  /**
   * Runs the track in the element's watch Scope: its watches subscribed now, with no
   * fiber, until the element goes and the Scope closes, which stops a running release. A throw from a
   * watch's fold goes to the `onDefect` it's given (#209: each binding's Solid owns the Scope).
   */
  readonly watch: (track: (onDefect: InputFeed.OnDefect) => Effect.Effect<void, never, Scope.Scope | TrackServices>) => void
  /**
   * Runs a response forked on the provider runtime: its fiber starts at once and runs to its
   * end inside the event. A release it forks keeps the runtime's scheduler, a host's if it gave one,
   * not a `runSync`'s sync one, which would resume
   * the release's yields on a microtask.
   */
  readonly fork: (response: Effect.Effect<void, never, TrackServices>) => void
  /** The provider-owned flush gate; the drag writes `x`/`y` into `id`. */
  readonly gate: FlushGate.Shape
  /** The element's gate id (shared with the spine, so writes merge). */
  readonly id: string
  /** The live element the drag recognizer attaches to. */
  readonly element: HTMLElement
  /** The spine's Snapshot object (shared — see {@link DragSnapshot}). */
  readonly snapshot: DragSnapshot
  /** Merge a value-map into the presence snapshot (mirrors the spine's recordFrame). */
  readonly recordFrame: (value: Values.Values) => void
  /** Flip the reactive `dragging` signal the spine reads for `whileDrag` + key stripping. */
  readonly setDragging: (dragging: boolean) => void
  /** The static drag config (read once at setup). */
  readonly config: DragTrackConfig
  /**
   * When the element is a projection node, the drag feeds the projection
   * instead of writing raw `x`/`y`, which stay the element's own, drawn on top:
   * grab → `dragStart`, each sample → `dragMove(offset)`, release →
   * `dragEnd(velocity)` (its Release offset — the free tail is skipped), a press →
   * `stopRelease`, a press that ends with no drag → `resumeRelease`. Absent ⇒ free drag.
   */
  readonly projection?: ProjectionSystem.DragHandle | undefined
  /**
   * The gesture's axis, read at each gesture's "start" and held until its "end"
   * (`true` = free), in place of `config.axis`: the axis it moves on and claims
   * (internal: a `<Reorder>` item, whose group decides the axis per gesture, D5).
   */
  readonly axisAt?: (() => boolean | "x" | "y") | undefined
  /**
   * Each sample, after its projection write: after `dragMove` for "start" and
   * "move", after `dragEnd` for "end", so a reader of the handle's `dragOffset()`
   * sees this sample (internal: a `<Reorder>` item's group).
   */
  readonly onSample?: ((sample: Drag.Sample) => void) | undefined
  /**
   * The release came to rest on its own (Motion's `onDragTransitionEnd`): its momentum or its
   * spring back finished, or it was dropped where it rests. Told after the gate's flush of the rest
   * value. Not for one a grab stopped. A free drag's only: a layout node's release is its Release
   * offset, which the projection tells.
   */
  readonly onReleaseEnd?: (() => void) | undefined
  /**
   * Whether its animations are skipped (its nearest `WardicConfig`'s `skipAnimations`), read at
   * each release: a skipped one lands at once where it would come to rest. Omitted, never.
   */
  readonly skipAnimations?: (() => boolean) | undefined
  /**
   * An element constraint (Motion's `dragConstraints={ref}`): the container whose box
   * the element's must stay inside, in place of `config.constraints`. It's measured at each drag's
   * start, and again when the element or the container resizes; a resize that changes the bounds
   * moves an element at rest (or releasing, which it stops) to keep its place within them (Motion's
   * `scalePositionWithinConstraints`). A container not there at a drag's start leaves it unconstrained.
   */
  readonly container?: DragContainer | undefined
  /**
   * The **Drag controls** given to the element (Motion's `dragControls`): the track subscribes to
   * them while its watch Scope is open.
   */
  readonly controls?: WardicDragControls | undefined
  /**
   * Where the drag's points are (its nearest `WardicConfig`'s `transformPagePoint`): read at
   * each down, and applied to its every point and to the box its snap to the cursor measures.
   * Omitted, as they are.
   */
  readonly mapPoint?: (() => WardicTransformPoint | undefined) | undefined
}

/** A point mapping now (#443): the config's, else the point as it is. */
const mapPointOf = (mapPoint: DragTrackOptions["mapPoint"]): WardicTransformPoint =>
  UndefinedOr.match(UndefinedOr.match(mapPoint, { onUndefined: constUndefined, onDefined: (read) => read() }), { onUndefined: () => identity, onDefined: identity })

/** A drag config's axis as core's: `true` (free) is `"xy"`. */
const toDragAxis = (axis: boolean | "x" | "y"): Drag.Axis =>
  Match.value(axis).pipe(
    Match.when("x", () => "x" as const),
    Match.when("y", () => "y" as const),
    Match.orElse(() => "xy" as const),
  )

/**
 * The track's state: `base` is the rebase point, `position` the live absolute position,
 * `held` whether a gesture is on (from its "start" to its "end"), `axis` the axes it
 * moves on, read at its "start", `bounds` the constraints: the config's, or an element
 * constraint's as last measured (#273), and whether a release runs, or a grab stopped one (#279).
 */
interface DragTrackState {
  readonly base: Point.Point
  readonly position: Point.Point
  readonly held: boolean
  readonly axis: Drag.Axis
  readonly bounds: Drag.Bounds | undefined
  /** A free drag's release runs (#279): set at its start, cleared at its rest. */
  readonly releasing: boolean
  /** A grab stopped that release (#279): a press that ends with no drag starts it again, from rest. */
  readonly stopped: boolean
  /**
   * A layout node's snap to the cursor at its controls' start (#431): its drag offset, the projection's
   * drag begun there, until the gesture starts from it or the press ends with none.
   */
  readonly snapped: Point.Point | undefined
}

/** The track's one cell, written by its handlers and by its release's sink, never at once. */
type TrackState = MutableRef.MutableRef<DragTrackState>

const ORIGIN: Point.Point = { x: 0, y: 0 }

/**
 * A projection node's release velocity (ADR-0016, *Amendment (velocity family)*, decision 2):
 * the "end" sample's, the pointer's over its last 100 ms (ADR-0004, *Amendment (#139)*); at
 * rest with `dragMomentum={false}`.
 */
const releaseVelocity = (config: DragTrackConfig, velocity: Point.Point): Point.Point =>
  Bool.match(config.momentum === false, {
    onTrue: () => ORIGIN,
    onFalse: () => velocity,
  })

/**
 * Where the drag puts the element: `p`, kept within the constraints on each axis the gesture moves,
 * pulled back past an edge by `dragElastic` (Motion's `applyConstraints`). They bound the element's
 * x/y, whichever gesture moved it there (ADR-0016, *Amendment (#140)*); an axis it doesn't move stays
 * where it is. Per pointer event: statement `if`s.
 */
const constrainedTo = (p: Point.Point, axis: Drag.Axis, bounds: Drag.Bounds | undefined, config: DragTrackConfig): Point.Point => {
  if (Predicate.isUndefined(bounds)) return p
  const elastic = elasticOf(config.elastic)
  let x = p.x
  let y = p.y
  if (axis !== "y") x = Drag.constrain(p.x, bounds.x, elastic)
  if (axis !== "x") y = Drag.constrain(p.y, bounds.y, elastic)
  return { x, y }
}

/** Both edges at the origin: what `dragSnapToOrigin` releases toward (Motion's `{ min: 0, max: 0 }`). */
const AT_ORIGIN: Drag.Bounds = { x: { min: 0, max: 0 }, y: { min: 0, max: 0 } }
const NO_EDGES: Drag.Bounds = {}

/** The edges a release springs back to: both at the origin with `snapToOrigin`, else the constraints. */
const edgesOf = (config: DragTrackConfig, bounds: Drag.Bounds | undefined): Drag.Bounds =>
  Bool.match(config.snapToOrigin === true, {
    onTrue: () => AT_ORIGIN,
    onFalse: () => UndefinedOr.match(bounds, { onUndefined: () => NO_EDGES, onDefined: identity }),
  })

/** Whether `v` sits within `range`, or there's none: a hard clamp leaves it where it is. */
const within = (v: number, range: Drag.AxisRange | undefined): boolean => Drag.constrain(v, range, 0) === v

/**
 * Whether a release with `velocity` from `position` rests where it was dropped: no speed, no
 * `modifyTarget` to move it, and within its edges on each axis it moves. Motion's inertia is done on
 * its first frame then; Wardic commits it at once.
 */
const restsWhereDropped = (position: Point.Point, velocity: Point.Point, axis: Drag.Axis, edges: Drag.Bounds, transition: ProjectionSystem.DragTransition): boolean =>
  Bool.every([
    velocity.x === 0,
    velocity.y === 0,
    Predicate.isUndefined(transition.modifyTarget),
    Bool.or(axis === "y", within(position.x, edges.x)),
    Bool.or(axis === "x", within(position.y, edges.y)),
  ])
/**
 * Read the current rested `x`/`y` off the snapshot (defaulting to 0, as for a string
 * translate the drag can't continue from). Captured at a drag's "start" so a drag (or a
 * re-grab mid-release) continues from where the element currently sits instead of
 * snapping to origin.
 */
const snapshotPos = (snapshot: DragSnapshot): Point.Point => {
  const { x, y } = snapshot.values
  return { x: numberOrZero(x), y: numberOrZero(y) }
}

/** A value that's a number, else 0. Built once, at module load. */
const numberOrZero: (value: unknown) => number = Match.type<unknown>().pipe(
  Match.when(Match.number, (n) => n),
  Match.orElse(() => 0),
)

/**
 * Direct-set `x`/`y` onto the element + the shared snapshot for one drag frame.
 * The drag is the SOLE owner of `x`/`y` while dragging, so it sets them on the
 * snapshot with zeroed velocities (the spring never fights them — the spine
 * strips the translate keys from its target while `dragging()` is true).
 */
const directSet = (opts: DragTrackOptions, p: Point.Point): void => {
  // Projection node (ADR-0016): feed the live pointer offset to the projection, whose
  // target moves the node; its own x/y are its animations', drawn on top (#363), so
  // the drag leaves them be. `base` stays 0 and `position` is the pure pointer offset,
  // which IS the dragDelta.
  if (Predicate.isNotUndefined(opts.projection)) {
    opts.projection.dragMove({ x: p.x, y: p.y })
    return
  }
  opts.gate.write(opts.id, { x: p.x, y: p.y })
  opts.snapshot.values.x = p.x
  opts.snapshot.values.y = p.y
  opts.snapshot.velocities.x = 0
  opts.snapshot.velocities.y = 0
  // Moved now (#464): its release's velocity holds from here.
  const now = opts.snapshot.now()
  opts.snapshot.drawnAt.x = now
  opts.snapshot.drawnAt.y = now
  opts.recordFrame({ x: p.x, y: p.y })
}

/**
 * A gesture's bookkeeping, run as each sample arrives, before its response: "start"
 * marks the gesture held; "end" clears it and, for a projection node (ADR-0016), starts its
 * Release offset at the sample's velocity (`dragEnd`) and hands back `dragging`. The "end" is
 * reported after its response, once the release runs, as Motion's `onDragEnd` comes after its
 * release starts: a target for `x`/`y` the app sets there takes it over (#340).
 */
const settleGesture = (sample: Drag.Sample, state: TrackState, opts: DragTrackOptions): void =>
  Match.value(sample.phase).pipe(
    Match.when("start", () => {
      MutableRef.update(state, (st) => ({ ...st, held: true }))
    }),
    Match.when("move", constVoid),
    Match.when("end", () => {
      MutableRef.update(state, (st) => ({ ...st, held: false }))
      UndefinedOr.match(opts.projection, {
        onUndefined: constVoid,
        onDefined: (projection) => {
          projection.dragEnd(releaseVelocity(opts.config, sample.velocity))
          opts.setDragging(false)
        },
      })
    }),
    Match.exhaustive,
  )

/** A down from the Primary pointer: a grab, which stops a running release where it is. */
const isGrab: Predicate.Predicate<InputSource.PointerLikeEvent> = Predicate.and(
  (e: InputSource.PointerLikeEvent) => e.type === "down",
  InputSource.isPrimaryPointer,
)

/** A down the element adopted from its **Drag controls** (#431). */
const isAdopted: Predicate.Predicate<InputSource.PointerLikeEvent> = (e) => e.adopted === true

/**
 * A layout node's snap to the cursor ended with no drag (#431): its drag ended at rest, back to its
 * slot. Whether there was one. A module's, not a track's (#507): a track given no Drag controls never
 * snaps, and makes nothing for it.
 */
const unsnap = (state: TrackState, projection: ProjectionSystem.DragHandle): boolean => {
  if (Predicate.isUndefined(MutableRef.get(state).snapped)) return false
  MutableRef.update(state, (s) => ({ ...s, snapped: undefined }))
  projection.dragEnd(ORIGIN)
  return true
}

/**
 * Snap the element's centre under `down`'s point (#431, Motion's `snapToCursor`), on the axes it drags,
 * measured from its box now: a plain element's x/y moved by the difference, a layout node's projection
 * drag begun at it. A module's (#507), as {@link unsnap} is.
 */
const snapTo = (opts: DragTrackOptions, state: TrackState, down: InputSource.PointerLikeEvent): void => {
  const box = opts.element.getBoundingClientRect()
  const axis = UndefinedOr.match(opts.axisAt, { onUndefined: () => toDragAxis(opts.config.axis), onDefined: (at) => toDragAxis(at()) })
  // The pointer and the box's centre, each mapped as the drag's points are (#443, Motion's).
  const map = mapPointOf(opts.mapPoint)
  const cursor = map({ x: down.x, y: down.y })
  const centre = map({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
  const by = onAxes({ x: cursor.x - centre.x, y: cursor.y - centre.y }, axis)
  UndefinedOr.match(opts.projection, {
    onUndefined: () => {
      const from = snapshotPos(opts.snapshot)
      const to = { x: from.x + by.x, y: from.y + by.y }
      MutableRef.update(state, (s) => ({ ...s, position: to }))
      directSet(opts, to)
    },
    onDefined: (projection) => {
      const was = MutableRef.get(state).snapped
      const at = UndefinedOr.match(was, { onUndefined: () => by, onDefined: (prev) => ({ x: prev.x + by.x, y: prev.y + by.y }) })
      if (Predicate.isUndefined(was)) projection.dragStart()
      projection.dragMove(at)
      MutableRef.update(state, (s) => ({ ...s, snapped: at }))
    },
  })
}

/**
 * The end of a Primary pointer's press: its up, its cancel, or a move with no button pressed
 * (its release was lost, ADR-0019). A press with no drag lets a projection node's stopped
 * release go on; any other unpressed move (a hover) finds none stopped.
 */
const isPressEnd: Predicate.Predicate<InputSource.PointerLikeEvent> = Predicate.and(
  (e: InputSource.PointerLikeEvent) =>
    Bool.some([e.type === "up", e.type === "cancel", Bool.and(e.type === "move", Bool.not(e.pressed))]),
  InputSource.isPrimaryPointer,
)

/** Hand `sample` to `onSample`, when there is one (a `<Reorder>` item's group). */
const reportSample = (opts: DragTrackOptions, sample: Drag.Sample): void =>
  UndefinedOr.match(opts.onSample, { onUndefined: constVoid, onDefined: (onSample) => onSample(sample) })

/**
 * Where a drag starts from (ADR-0004, ADR-0016): wherever a plain element rests (the snapshot's
 * x/y); a projection node's slot, the origin, since its drag offset moves its projection target
 * from its slot, and its own x/y are drawn on top of that (#363), or where a snap to the cursor put
 * it (#431).
 */
const startOf = (opts: DragTrackOptions, st: DragTrackState): Point.Point =>
  UndefinedOr.match(opts.projection, {
    onUndefined: () => snapshotPos(opts.snapshot),
    onDefined: () => UndefinedOr.match(st.snapped, { onUndefined: () => ORIGIN, onDefined: identity }),
  })

/**
 * Follow the pointer for a "start" or "move" sample: absolute position = base + drag
 * offset, kept within the constraints. A "start" rebases to where the drag starts from
 * ({@link startOf}); for a projection node, the origin, and the "start" begins the
 * projection's drag first, so `dragStart` runs before the first `dragMove`, unless a snap to the
 * cursor began it (#431).
 */
const follow = (sample: Drag.Sample, state: TrackState, opts: DragTrackOptions): void => {
  const st = MutableRef.get(state)
  const starts = sample.phase === "start"
  const base = Bool.match(starts, { onTrue: () => startOf(opts, st), onFalse: () => st.base })
  // The axes the gesture moves on, as the recognizer read them at its start: a `<Reorder>` item's
  // group decides them per gesture (D5), a direction lock at its lock (#273).
  const axis = Bool.match(starts, { onTrue: () => sample.axis, onFalse: () => st.axis })
  const p = constrainedTo({ x: base.x + sample.offset.x, y: base.y + sample.offset.y }, axis, st.bounds, opts.config)
  MutableRef.set(state, { ...st, base, position: p, axis, snapped: undefined })
  opts.setDragging(true)
  if (Bool.and(starts, Predicate.isUndefined(st.snapped))) UndefinedOr.match(opts.projection, { onUndefined: constVoid, onDefined: (projection) => projection.dragStart() })
  directSet(opts, p)
  reportSample(opts, sample)
}

/**
 * The release driver (ADR-0004 binding orchestration; ADR-0016, *Amendment (#140)*), Motion's: an
 * inertia on the drag transition on each axis the gesture moved, from the release position and
 * velocity (none with `momentum: false`), toward its edges: both at the origin with `snapToOrigin`,
 * else the constraints. A Fling glides on and springs back to an edge it would cross, or starts past.
 * One that rests where it was dropped (no velocity, within its edges) commits the exact release
 * position once (so the element rests at the pointer-up point, not the last move), and hands `x`/`y`
 * back at the end of the release's task.
 *
 * Each release frame taps `gate.write` + snapshot sync + recordFrame, and the track's
 * state, so a re-grab mid-tail rebases from where the tail reached. On completion
 * `setDragging(false)` hands ownership of `x`/`y` back to the spring. The inertia runs on the
 * Frame loop (ADR-0027); interrupting the release removes its run from the loop at once,
 * before the next handler touches the state.
 *
 * A release that dies, on a drag transition core rejects (#66, ADR-0025 *Amendment (#66)*) or a
 * throw in its frames, fails alone: reported, the element rests where it was dropped, and the track
 * goes on to the next drag.
 *
 * Its velocity stays on the Snapshot, each frame's, from the release's own at its start; and once
 * `taken` is done (#340, {@link DragTrack.takeRelease}), it stops where it is and tells no end: a
 * Retarget has `x`/`y`, from that position and velocity.
 */
const release = (
  opts: DragTrackOptions,
  state: TrackState,
  position: Point.Point,
  velocity: Point.Point,
  taken: Deferred.Deferred<void>,
): Effect.Effect<void, never, FrameLoop.FrameLoop> => {
  const cfg = opts.config

  // A run's sink on the Frame loop is a plain call (ADR-0027, decision 8). One a takeover beat to
  // the loop writes nothing: the fiber's interruption comes through the scheduler (#340).
  const tapFrame = (p: Point.Point, v: Point.Point): undefined => {
    if (Bool.not(MutableRef.get(state).releasing)) return undefined
    MutableRef.update(state, (s) => ({ ...s, position: p }))
    directSet(opts, p)
    keepVelocity(opts, v)
    return undefined
  }

  // At rest, the drag hands back, then its release's end is told (#273) after the gate's next flush,
  // with the rest value on the element, as Motion's comes with it set: only here, so a release a
  // grab interrupted tells nothing.
  const done = Effect.sync(() => {
    MutableRef.update(state, (s) => ({ ...s, releasing: false }))
    opts.setDragging(false)
    UndefinedOr.map(opts.onReleaseEnd, (ended) => opts.gate.afterFlush(ended))
  })
  const { axis, bounds } = MutableRef.get(state)
  const edges = edgesOf(cfg, bounds)
  const v = releaseVelocity(cfg, velocity)
  const transition = cfg.transition
  // Before its first frame, a takeover starts from the release's velocity, on the axes it runs on.
  keepVelocity(opts, onAxes(v, axis))

  // The position now; the hand-back at the end of the release's task, once every other
  // consumer of the same event has handled it: a press that ends with the drag (`whileTap`)
  // then finds `x`/`y` still the drag's, so a key the drag moved stays where it was dropped.
  // A takeover ends the release at once, its end untold (#340).
  const untilTaken = (run: Effect.Effect<void, never, FrameLoop.FrameLoop>) => Effect.raceFirst(run, Deferred.await(taken))
  if (restsWhereDropped(position, v, axis, edges, transition)) {
    return untilTaken(
      Effect.sync(() => {
        if (MutableRef.get(state).releasing) directSet(opts, position)
      }).pipe(Effect.andThen(Microtask.next), Effect.andThen(done)),
    )
  }
  // Skipped (#468): it lands at once where its inertia would come to rest, on each axis it runs on,
  // with no velocity. Motion's skipped release goes to its keyframes' last, the drag's origin; Wardic's
  // lands where the release would. Its end is told as a release's at rest.
  if (UndefinedOr.match(opts.skipAnimations, { onUndefined: constFalse, onDefined: (skips) => skips() })) {
    return untilTaken(
      Effect.sync(() => {
        keepVelocity(opts, ORIGIN)
        if (MutableRef.get(state).releasing) directSet(opts, restOfRelease(position, v, axis, edges, transition))
      }).pipe(
        Effect.catchDefect((defect) => Report.failure("wardic.drag: a release failed", Cause.die(defect)).pipe(Effect.andThen(Effect.sync(() => tapFrame(position, ORIGIN))))),
        Effect.andThen(Microtask.next),
        Effect.andThen(done),
      ),
    )
  }
  // Only the axes the gesture moved run (Motion's `shouldDrag`): the other stays where it is.
  return untilTaken(
    Match.value(axis).pipe(
      Match.when("x", () =>
        Machine.inertia(position.x, v.x, { ...transition, ...edges.x }).pipe(
          Machine.run((frame) => tapFrame({ x: frame.value, y: position.y }, { x: frame.velocity, y: 0 })),
        )),
      Match.when("y", () =>
        Machine.inertia(position.y, v.y, { ...transition, ...edges.y }).pipe(
          Machine.run((frame) => tapFrame({ x: position.x, y: frame.value }, { x: 0, y: frame.velocity })),
        )),
      Match.orElse(() => Machine.inertiaVec(position, v, { ...transition, ...edges }).pipe(Machine.run((frame) => tapFrame(frame.value, frame.velocity)))),
      Effect.catchDefect((defect) =>
        Report.failure("wardic.drag: a release failed", Cause.die(defect)).pipe(Effect.andThen(Effect.sync(() => tapFrame(position, ORIGIN))))),
      Effect.andThen(done),
    ),
  )
}

/**
 * Where a release from `position` at `v` comes to rest (#468): each axis it runs on where its inertia
 * would ({@link Inertia.restOf}), the other where it is.
 */
const restOfRelease = (position: Point.Point, v: Point.Point, axis: Drag.Axis, edges: Drag.Bounds, transition: ProjectionSystem.DragTransition): Point.Point =>
  Match.value(axis).pipe(
    Match.when("x", () => ({ x: Inertia.restOf(position.x, v.x, { ...transition, ...edges.x }), y: position.y })),
    Match.when("y", () => ({ x: position.x, y: Inertia.restOf(position.y, v.y, { ...transition, ...edges.y }) })),
    Match.orElse(() => ({ x: Inertia.restOf(position.x, v.x, { ...transition, ...edges.x }), y: Inertia.restOf(position.y, v.y, { ...transition, ...edges.y }) })),
  )

/** `v` on the axes a release runs on, 0 on the other. */
const onAxes = (v: Point.Point, axis: Drag.Axis): Point.Point =>
  Match.value(axis).pipe(
    Match.when("x", () => ({ x: v.x, y: 0 })),
    Match.when("y", () => ({ x: 0, y: v.y })),
    Match.orElse(() => v),
  )

/** Whether `retargeted` names an axis a release on `axis` runs on (#340). */
const onReleaseAxis = (axis: Drag.Axis, retargeted: { readonly x: boolean; readonly y: boolean }): boolean =>
  Match.value(axis).pipe(
    Match.when("x", () => retargeted.x),
    Match.when("y", () => retargeted.y),
    Match.orElse(() => Bool.or(retargeted.x, retargeted.y)),
  )

/** A release's velocity on the Snapshot, after its direct-set zeroed it (#340). */
const keepVelocity = (opts: DragTrackOptions, v: Point.Point): void => {
  opts.snapshot.velocities.x = v.x
  opts.snapshot.velocities.y = v.y
  const now = opts.snapshot.now()
  opts.snapshot.drawnAt.x = now
  opts.snapshot.drawnAt.y = now
}

/** A running drag track, for the spine's Retargets (#340). */
export interface DragTrack {
  /**
   * Take `x`/`y` from a free drag's running release (#340) for a Retarget that gives `retargeted`
   * new targets, as a newer animation of Motion's value stops the one running: the release stops
   * where it is and tells no end, and `dragging` is handed back at the end of the task (not in the
   * caller's Retarget, which reads it). `false`, and nothing done, when no release runs, a gesture
   * is on, or none of `retargeted` is an axis the release runs on (Motion's runs one per axis).
   */
  readonly takeRelease: (retargeted: { readonly x: boolean; readonly y: boolean }) => boolean
}

/**
 * Run the drag track for one element. Recognize `drag(element)` on its axis (read at
 * each gesture's start for a `<Reorder>` item) with its **Drag claim** (none with
 * `propagation`), then consume it, kept within its constraints, and the element's bare
 * pointer-down grabs, each in place as it arrives (ADR-0032; the module doc). A drag
 * refused its claim emits nothing, so a draggable ancestor of the element that claimed
 * neither follows the pointer nor turns `whileDrag` on; its grab still stops its running
 * release (ADR-0019, *Amendment (#29)*). The track runs in the element's watch Scope
 * (`opts.watch`, #379), with no fiber at rest: closing it stops the watches (dropping the
 * shared feed's count) and any in-flight release. A response that fails, or a release, is
 * reported, and the track goes on.
 *
 * The drag config is read ONCE at setup (the caller passes a static
 * {@link DragTrackConfig} — drag config is a document, not reactive); only the
 * `dragging` signal the spine reads is reactive.
 */
export const driveDragTrack = (opts: DragTrackOptions): DragTrack => {
  const { config, element } = opts
  const state: TrackState = MutableRef.make<DragTrackState>({
    base: ORIGIN,
    position: ORIGIN,
    held: false,
    axis: "xy",
    bounds: config.constraints,
    releasing: false,
    stopped: false,
    snapped: undefined,
  })
  // The running release's takeover (#340): done by `takeRelease`, from outside the track's responses.
  let taken: Deferred.Deferred<void> = Deferred.makeUnsafe<void>()

  opts.watch((onDefect) =>
    Effect.gen(function* () {
      // The running release, if any: the next sample or grab interrupts it.
      const releasing = yield* FiberHandle.make<void>()
      const probe = yield* Probe.Probe

      // --- An element constraint (#273, ADR-0047) ------------------------------------------------
      // Measured at each drag's start, and when the element or its container resizes: the observers'
      // fiber, one container at a time, from the first time the container is there.
      const watching = yield* FiberHandle.make<void>()
      let watched: Element | undefined = undefined
      let warned = false
      const setBounds = (bounds: Drag.Bounds | undefined): void => {
        MutableRef.update(state, (st) => ({ ...st, bounds }))
      }
      /** The bounds measured against `container`'s `box`; none, reported, if measuring throws (an app's `onMeasureDragConstraints`). */
      const measured = (container: DragContainer, box: Element): Effect.Effect<Drag.Bounds | undefined> =>
        Effect.sync((): Drag.Bounds | undefined => container.bounds(box)).pipe(
          Effect.catchDefect((defect) => Report.failure("wardic.drag: measuring dragConstraints failed", Cause.die(defect)).pipe(Effect.as(undefined))),
        )
      /**
       * A resize of the element or its container: the bounds measured again. The first measure only
       * records them; a later one that changed them moves an element at rest, or releasing (stopped),
       * to keep its place within them (Motion's `scalePositionWithinConstraints`). A held drag, or a
       * layout node (back on its slot at rest), only takes the new bounds.
       */
      const resized = (container: DragContainer, box: Element): Effect.Effect<void> =>
        measured(container, box).pipe(
          Effect.flatMap((next) => {
            const st = MutableRef.get(state)
            if (Bool.or(Predicate.isUndefined(next), Predicate.isUndefined(st.bounds))) return Effect.sync(() => setBounds(next))
            const from = st.bounds as Drag.Bounds
            const to = next as Drag.Bounds
            if (Drag.sameBounds(from, to)) return Effect.void
            if (Bool.or(st.held, Predicate.isNotUndefined(opts.projection))) return Effect.sync(() => setBounds(to))
            return FiberHandle.clear(releasing).pipe(
              Effect.andThen(Effect.sync(() => {
                const kept = Drag.keepPlace(snapshotPos(opts.snapshot), toDragAxis(config.axis), from, to)
                MutableRef.update(state, (s) => ({ ...s, bounds: to, position: kept }))
                directSet(opts, kept)
                opts.setDragging(false)
              })),
            )
          }),
        )
      /** Watch the element and `box` for resizes, from now on: once per container. */
      const watchResizes = (container: DragContainer, box: Element): Effect.Effect<void> =>
        Effect.suspend(() => {
          if (watched === box) return Effect.void
          watched = box
          return FiberHandle.run(
            watching,
            Stream.runForEach(Stream.merge(probe.observeResize(element), probe.observeResize(box)), () => resized(container, box)),
          ).pipe(Effect.asVoid)
        })
      /** At a drag's start: the bounds measured against the container, which is watched from then on; none if it isn't there. */
      const measureAtStart: Effect.Effect<void> = UndefinedOr.match(opts.container, {
        onUndefined: () => Effect.void,
        onDefined: (container) =>
          Effect.suspend(() =>
            UndefinedOr.match(container.element(), {
              onUndefined: () =>
                Effect.sync(() => setBounds(undefined)).pipe(
                  Effect.andThen(Bool.match(warned, {
                    onTrue: () => Effect.void,
                    onFalse: () => {
                      warned = true
                      return Effect.logWarning("wardic.drag: dragConstraints' container isn't there at a drag's start, so it drags unconstrained")
                    },
                  })),
                ),
              onDefined: (box) => measured(container, box).pipe(Effect.tap((bounds) => Effect.sync(() => setBounds(bounds))), Effect.andThen(watchResizes(container, box))),
            })
          ),
      })
      // A container already there is watched from the start: its first delivery records the bounds.
      // Forked, so its fiber runs on the runtime's scheduler, not this setup's `runSync`'s.
      UndefinedOr.match(opts.container, {
        onUndefined: constVoid,
        onDefined: (container) => UndefinedOr.match(container.element(), { onUndefined: constVoid, onDefined: (box) => opts.fork(watchResizes(container, box)) }),
      })

      const input = yield* InputSource.InputSource

      // The gesture's axis, read by the recognizer at each start: a `<Reorder>` item's group
      // decides it per gesture (D5). Then the numeric shaping (Probe-free, ADR-0004).
      const axisAt = opts.axisAt
      const axis: Drag.Axis | (() => Drag.Axis) = UndefinedOr.match(axisAt, {
        onUndefined: () => toDragAxis(config.axis),
        onDefined: (at) => () => toDragAxis(at()),
      })
      const { propagation = false } = config
      const listens = config.listen !== false

      // --- Drag controls (#431), only for an element given them (#507) ----------------------------
      const controlled = Predicate.isNotUndefined(opts.controls)
      // The threshold of the gesture an adopted down claims: its controls' `distanceThreshold`, set for
      // the length of the start that adopts it. Any other down's is the recognizer's own, and a track
      // with no controls has none to set.
      let adoptedThreshold: number | undefined = undefined
      let threshold: ((down: InputSource.PointerLikeEvent) => Option.Option<number>) | undefined
      if (controlled) {
        threshold = (down) => {
          if (down.adopted === true) return Option.fromUndefinedOr(adoptedThreshold)
          return Option.none()
        }
      }

      /** A free drag's release from `position` with `velocity`, run in `releasing` (#279: recorded as running). */
      const startRelease = (position: Point.Point, velocity: Point.Point): Effect.Effect<void, never, FrameLoop.FrameLoop> =>
        Effect.sync(() => {
          MutableRef.update(state, (s) => ({ ...s, releasing: true, stopped: false }))
          taken = Deferred.makeUnsafe<void>()
          return taken
        }).pipe(
          Effect.flatMap((ended) => FiberHandle.run(releasing, release(opts, state, position, velocity, ended))),
          Effect.asVoid,
        )

      // A free drag's "end" starts its release; a projection node's Release offset already
      // began in `settleGesture`, so its drag track skips the tail (ADR-0016, Q3c).
      const releaseFrom = (sample: Drag.Sample): Effect.Effect<void, never, FrameLoop.FrameLoop> =>
        UndefinedOr.match(opts.projection, {
          onDefined: () => Effect.void,
          onUndefined: () => {
            const { axis, base, bounds } = MutableRef.get(state)
            const position = constrainedTo({ x: base.x + sample.offset.x, y: base.y + sample.offset.y }, axis, bounds, config)
            return startRelease(position, sample.velocity)
          },
        })

      // Each sample: its bookkeeping, then its response. A "start" or "move" stops a running
      // release first, as each new event did under `switchMap`.
      const onSample = (sample: Drag.Sample): Effect.Effect<void, never, FrameLoop.FrameLoop> =>
        Effect.suspend(() => {
          settleGesture(sample, state, opts)
          return Match.value(sample.phase).pipe(
            // A start measures an element constraint first (#273), so it follows within this drag's bounds.
            Match.when("start", () =>
              FiberHandle.clear(releasing).pipe(Effect.andThen(measureAtStart), Effect.andThen(Effect.sync(() => follow(sample, state, opts))))),
            Match.when("move", () =>
              FiberHandle.clear(releasing).pipe(Effect.andThen(Effect.sync(() => follow(sample, state, opts))))),
            // A cancelled end (#431) stays where it is: no release, `x`/`y` handed back.
            Match.when("end", () =>
              Bool.match(sample.cancelled === true, {
                onTrue: () => Effect.sync(() => UndefinedOr.match(opts.projection, { onUndefined: () => opts.setDragging(false), onDefined: constVoid })),
                onFalse: () => releaseFrom(sample),
              }).pipe(Effect.andThen(Effect.sync(() => reportSample(opts, sample))))),
            Match.exhaustive,
          )
        })

      // A grab stops a running release where it is. With no gesture held, the stopped
      // release (or the one a same-down "end" just started) hands `x`/`y` back to the
      // spring; a drag that follows takes them again at its "start", where it rebases (a
      // new down from a pointer whose release was lost also ends the old gesture, a Stale
      // gesture, ADR-0019). A projection node's Release offset stops where it is too, and a
      // drag that follows starts from there; a press that ends with no drag lets it go on,
      // from rest (Motion's `stopAnimation` at the press and `resumeAnimation`, ADR-0016,
      // *Amendment (velocity family)*). The InputSource is a Shared source, so this shares
      // the recognizer's single listener-set (CONTEXT.md Shared source contract).
      const onGrab: Effect.Effect<void> = FiberHandle.clear(releasing).pipe(
        Effect.andThen(Effect.sync(() => {
          // A free drag's release this grab stopped, to start again if the press ends with no drag (#279).
          MutableRef.update(state, (s) => ({ ...s, stopped: s.releasing, releasing: false }))
          UndefinedOr.match(opts.projection, { onUndefined: constVoid, onDefined: (projection) => projection.stopRelease() })
          if (!MutableRef.get(state).held) opts.setDragging(false)
        })),
      )
      /**
       * A free drag's release a grab stopped, started again from rest where it stopped, toward its edges
       * (#279, Motion's `resumeAnimation`): only with `snapToOrigin` or constraints, which give it
       * somewhere to go. Motion's starts one at any press that ends with no drag, so a click at rest on
       * a constrained element tells `onDragTransitionEnd`; this only starts the one the grab stopped, as
       * a layout node's `resumeRelease` does.
       */
      const resumeFree: Effect.Effect<void, never, FrameLoop.FrameLoop> = Effect.suspend(() => {
        const st = MutableRef.get(state)
        if (Bool.not(st.stopped)) return Effect.void
        MutableRef.update(state, (s) => ({ ...s, stopped: false }))
        if (Bool.and(config.snapToOrigin !== true, Predicate.isUndefined(st.bounds))) return Effect.void
        return startRelease(st.position, ORIGIN)
      })
      // The samples subscribe first, so a drag's own up has ended its gesture by now: only a
      // press that never dragged finds no gesture held.
      // A layout node a snap to the cursor moved (#431) goes back to its slot instead.
      const onPressEnd: Effect.Effect<void, never, FrameLoop.FrameLoop> = Effect.suspend(() => {
        if (MutableRef.get(state).held) return Effect.void
        return UndefinedOr.match(opts.projection, {
          onUndefined: () => resumeFree,
          onDefined: (projection) =>
            Effect.sync(() => {
              if (unsnap(state, projection)) return
              projection.resumeRelease()
            }),
        })
      })

      /**
       * A response, run inside its event (`opts.fork`): one that fails is reported, and the next
       * event's runs (ADR-0055 *Amendment (#379)*, Q4). A release reports its own (#66).
       */
      const respond = (response: Effect.Effect<void, never, FrameLoop.FrameLoop>): void =>
        opts.fork(response.pipe(Effect.catchCause((cause) => Report.failure("wardic.drag: a response failed", cause))))

      // Subscribed in this order, so the samples hear an event before the grabs. The constraints
      // bound the element's x/y, so they're applied where the gesture's offset meets its base, in
      // `follow` and at the release (ADR-0016, *Amendment (#140)*).
      const drag = yield* DragRecognizer.watchDrag(element, { axis, claim: Bool.not(propagation), lock: config.directionLock === true, listen: listens, adoptable: controlled, threshold, mapPoint: UndefinedOr.map(opts.mapPoint, pointMapOptionOf) }, {
        on: (sample) => respond(onSample(sample)),
        onDefect,
      })
      // A down grabs when the drag listens to it (#431): with `listen: false`, only an adopted one.
      const grabs = Bool.match(listens, { onTrue: () => isGrab, onFalse: () => Predicate.and(isGrab, isAdopted) })
      // The adoptable feed with controls (#507), so a grab hears an adopted down; the plain one without.
      const pointerFeed = Bool.match(controlled, { onTrue: () => InputSource.adoptablePointerOf(input, element), onFalse: () => input.pointer(element) })
      yield* InputFeed.watch(pointerFeed, {
        on: (event) => {
          if (grabs(event)) return respond(onGrab)
          if (isPressEnd(event)) respond(onPressEnd)
        },
        onDefect,
      })

      // Its controls, subscribed until the Scope closes (#431). A start adopts the pointer, whose down
      // the recognizer claims and the grabs stop a release at, inside the call; then the snap.
      if (Predicate.isNotUndefined(opts.controls)) {
        /** A layout node's snap that no gesture took, ended once its controls end the drag. */
        const unsnapped = (): void => UndefinedOr.match(opts.projection, { onUndefined: constVoid, onDefined: (projection) => void unsnap(state, projection) })
        const unsubscribe = subscribeDragControls(opts.controls, {
          start: (event, options) => {
            adoptedThreshold = options.distanceThreshold
            const down = input.adoptPointer(element, event)
            adoptedThreshold = undefined
            if (Option.isNone(down)) return
            if (options.snapToCursor === true) snapTo(opts, state, down.value)
          },
          stop: () => {
            drag.stop()
            unsnapped()
          },
          cancel: () => {
            drag.cancel()
            unsnapped()
          },
        })
        yield* Effect.addFinalizer(() => Effect.sync(unsubscribe))
      }
    }),
  )

  return {
    takeRelease: (retargeted) => {
      const st = MutableRef.get(state)
      if (Bool.or(st.held, Bool.not(st.releasing))) return false
      if (Bool.not(onReleaseAxis(st.axis, retargeted))) return false
      MutableRef.update(state, (s) => ({ ...s, releasing: false }))
      Deferred.doneUnsafe(taken, Exit.void)
      // A gesture begun since, in this task, keeps `dragging`.
      queueMicrotask(() => {
        if (Bool.not(MutableRef.get(state).held)) opts.setDragging(false)
      })
      return true
    },
  }
}
