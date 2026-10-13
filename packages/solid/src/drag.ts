/**
 * `runDragTrack` — the binding-orchestrated drag track (ADR-0004 response half).
 *
 * DESIGN (locked via grilling, subtask 22c): on a drag-enabled element `x`/`y`
 * are DIRECT-SET by the pointer (1:1, NOT sprung) while the spring spine keeps
 * driving every OTHER key + `whileDrag`. Ownership of `x`/`y` is DYNAMIC: the
 * drag owns them while held AND during the release tail; once the release
 * settles, ownership returns to the spring (so a later `animate.x`/`y` or a
 * layout/Reorder FLIP can take over from the rested position).
 *
 * This module is the RESPONSE half (binding orchestration). Core ships the
 * RECOGNITION (`drag()`, kept to its axis and holding its **Drag claim**, + the
 * `withinBounds` shaping combinator) and the decay PRIMITIVE (`decayVec`); the
 * release driver, the gate writes, and the snapshot sync are response concerns and
 * live here (ADR-0004).
 *
 * STRUCTURE (ADR-0032): input is handled inside its event. Two consumers, each a
 * `Stream.runForEach` that applies what arrives in place, with no scheduler hop
 * between a pointer event and its gate write:
 *   - the drag's samples: a gesture's bookkeeping, then the direct-set, or at the
 *     "end" the release;
 *   - bare pointer-downs from the Primary pointer ("grabs"), which stop a running
 *     release, so a re-grab mid-release stops the tail where it is, and the ends of
 *     its presses, which let a projection node's release go on after a press that
 *     didn't drag.
 * No `merge` and no `switchMap`: a `merge` yields once per element, so a second
 * event in one task (a move and its up, a move and a scroll) waited a task, and
 * `switchMap` forked every sample's inner, a task more. The release runs in a
 * `FiberHandle`, started inline, so it is on the Frame loop before its task ends;
 * the next sample or grab interrupts it, which removes it from the loop at once.
 *
 * The samples subscribe before the grabs, so one event's samples reach the track
 * before its grab: a Stale gesture's "end" (ADR-0019, rule B) starts its release and
 * the grab of the same down stops it before its first frame, on every Environment.
 * The track's state is a plain `MutableRef`: each handler runs to completion, and a
 * release is stopped before the next handler changes the state.
 */
import * as Drag from "@wardic/core/Drag"
import type * as FrameLoop from "@wardic/core/FrameLoop"
import * as InputSource from "@wardic/core/InputSource"
import type * as Point from "@wardic/core/Point"
import * as Recognizer from "@wardic/core/Recognizer"
import type * as Values from "@wardic/core/Values"
import * as Velocity from "@wardic/core/Velocity"
import * as Machine from "@wardic/core/Machine"
import * as Microtask from "@wardic/core/Microtask"
import type { DragProjectionHandle, FlushGate } from "@wardic/dom"
import * as Bool from "effect/Boolean"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FiberHandle from "effect/FiberHandle"
import { constVoid } from "effect/Function"
import * as Match from "effect/Match"
import * as MutableRef from "effect/MutableRef"
import * as Predicate from "effect/Predicate"
import * as Stream from "effect/Stream"
import * as UndefinedOr from "effect/UndefinedOr"
import { runScoped, type WardicRuntime } from "./provider.tsx"

/**
 * The spine's mutable Snapshot object (the SAME object `runSpine` holds): each
 * key's last emitted value, a number or a string (ADR-0024), plus the numeric
 * velocities. The drag track reads `values.x`/`values.y` to continue from the
 * rested position and writes them (plus zeroed velocities) each direct-set frame
 * so the post-drag handoff continues from where the drag left the element.
 */
export interface DragSnapshot {
  values: Values.Values
  velocities: Record<string, number>
}

/** The static drag config (read ONCE, untracked, at setup — drag config is a document). */
export interface DragTrackConfig {
  /** `true` = free; `"x"`/`"y"` = axis-locked. */
  readonly axis: boolean | "x" | "y"
  /**
   * `true`: the drag takes no **Drag claim** and is never refused, so a draggable ancestor can
   * drag with it (Motion's `dragPropagation`, ADR-0019 *Amendment (#29)*). Default `false`.
   */
  readonly propagation?: boolean | undefined
  /** Optional numeric constraint box (per axis) applied to the drag offset. */
  readonly constraints?: Drag.Bounds | undefined
  /** Rubber-band resistance past `constraints` (0 = hard clamp). */
  readonly elastic?: number | undefined
  /** Fling on release under decay (default true). */
  readonly momentum?: boolean | undefined
  /** Spring back to the origin on release (overrides momentum). */
  readonly snapToOrigin?: boolean | undefined
  /** The spring options used for the snapToOrigin release. */
  readonly springOpts?: Machine.SpringOptions | undefined
}

/** Options for {@link runDragTrack}. */
export interface RunDragTrackOptions {
  /** The provider runtime the track's single fiber is forked on. */
  readonly runtime: WardicRuntime
  /** The provider-owned flush gate (ADR-0006); the drag writes `x`/`y` into `id`. */
  readonly gate: FlushGate
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
   * When the element is a projection node (ADR-0016), the drag feeds the projection
   * instead of writing raw `x`/`y` (which the renderer ignores for a projected
   * element): grab → `dragStart`, each sample → `dragMove(offset)`, release →
   * `dragEnd(velocity)` (its Release offset — the free tail is skipped), a press →
   * `stopRelease`, a press that ends with no drag → `resumeRelease`. Absent ⇒ free drag.
   */
  readonly projection?: DragProjectionHandle | undefined
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
}

/** A drag config's axis as core's: `true` (free) is `"xy"`. */
const toDragAxis = (axis: boolean | "x" | "y"): Drag.Axis =>
  Match.value(axis).pipe(
    Match.when("x", () => "x" as const),
    Match.when("y", () => "y" as const),
    Match.orElse(() => "xy" as const),
  )

/**
 * The track's state: `base` is the rebase point, `position` the live absolute position,
 * `held` whether a gesture is on (from its "start" to its "end"), and, for a projection
 * node, the gesture's last offsets, for its release's velocity.
 */
interface DragTrackState {
  readonly base: Point.Point
  readonly position: Point.Point
  readonly held: boolean
  readonly history: ReadonlyArray<Velocity.TimedPoint>
}

/** The track's one cell, written by its handlers and by its release's sink, never at once. */
type TrackState = MutableRef.MutableRef<DragTrackState>

const ORIGIN: Point.Point = { x: 0, y: 0 }

/** The window (ms) a projection node's release reads its velocity over: Motion's `getVelocity`'s (ADR-0016, *Amendment (velocity family)*). */
const RELEASE_VELOCITY_WINDOW_MS = 100

/** How many offsets the release's velocity keeps: enough for 100 ms of pointer events at 60–120 Hz (as the Reorder group's). */
const HISTORY = 12

/**
 * A projection node's gesture history with `sample`'s offset added, oldest first, its last
 * {@link HISTORY} kept; a free drag keeps none (its Fling reads the sample's own velocity).
 */
const recordOffset = (
  opts: RunDragTrackOptions,
  history: ReadonlyArray<Velocity.TimedPoint>,
  sample: Drag.Sample,
): ReadonlyArray<Velocity.TimedPoint> =>
  UndefinedOr.match(opts.projection, {
    onUndefined: () => history,
    onDefined: () =>
      Arr.takeRight(Arr.append(history, { x: sample.offset.x, y: sample.offset.y, timeStamp: sample.timeStamp }), HISTORY),
  })

/**
 * A projection node's release velocity (ADR-0016, *Amendment (velocity family)*, decision 2):
 * its gesture's offsets over the last 100 ms (`Velocity.trailing`, Motion's `getVelocity`), so a
 * release after moves more than 30 ms apart doesn't read zero; at rest with `dragMomentum={false}`.
 */
const releaseVelocity = (config: DragTrackConfig, history: ReadonlyArray<Velocity.TimedPoint>): Point.Point =>
  Bool.match(config.momentum === false, {
    onTrue: () => ORIGIN,
    onFalse: () => Velocity.trailing(history, RELEASE_VELOCITY_WINDOW_MS),
  })
/**
 * Read the current rested `x`/`y` off the snapshot (defaulting to 0, as for a string
 * translate the drag can't continue from). Captured at a drag's "start" so a drag (or a
 * re-grab mid-release) continues from where the element currently sits instead of
 * snapping to origin.
 */
const snapshotPos = (snapshot: DragSnapshot): Point.Point => {
  const { x, y } = snapshot.values
  return { x: typeof x === "number" ? x : 0, y: typeof y === "number" ? y : 0 }
}

/**
 * Direct-set `x`/`y` onto the element + the shared snapshot for one drag frame.
 * The drag is the SOLE owner of `x`/`y` while dragging, so it sets them on the
 * snapshot with zeroed velocities (the spring never fights them — the spine
 * strips the translate keys from its target while `dragging()` is true).
 */
const directSet = (opts: RunDragTrackOptions, p: Point.Point): void => {
  // Projection node (ADR-0016): feed the live pointer offset to the projection —
  // the renderer ignores a projected element's raw x/y, so writing them is moot.
  // The snapshot x/y stays 0 (projection owns position), so `base` stays 0 and
  // `position` is the pure pointer offset, which IS the dragDelta.
  if (opts.projection !== undefined) {
    opts.projection.dragMove({ x: p.x, y: p.y })
    return
  }
  opts.gate.write(opts.id, { x: p.x, y: p.y })
  opts.snapshot.values.x = p.x
  opts.snapshot.values.y = p.y
  opts.snapshot.velocities.x = 0
  opts.snapshot.velocities.y = 0
  opts.recordFrame({ x: p.x, y: p.y })
}

/**
 * A gesture's bookkeeping, run as each sample arrives, before its response: "start"
 * marks the gesture held; each sample keeps a projection node's offset for its release's
 * velocity; "end" clears both and, for a projection node (ADR-0016), starts its Release
 * offset at that velocity (`dragEnd`) and hands back `dragging`, then reports the sample.
 */
const settleGesture = (sample: Drag.Sample, state: TrackState, opts: RunDragTrackOptions): void =>
  Match.value(sample.phase).pipe(
    Match.when("start", () => {
      MutableRef.update(state, (st) => ({ ...st, held: true, history: recordOffset(opts, [], sample) }))
    }),
    Match.when("move", () => {
      MutableRef.update(state, (st) => ({ ...st, history: recordOffset(opts, st.history, sample) }))
    }),
    Match.when("end", () => {
      const history = recordOffset(opts, MutableRef.get(state).history, sample)
      MutableRef.update(state, (st) => ({ ...st, held: false, history: [] }))
      UndefinedOr.match(opts.projection, {
        onUndefined: constVoid,
        onDefined: (projection) => {
          projection.dragEnd(releaseVelocity(opts.config, history))
          opts.setDragging(false)
        },
      })
      reportSample(opts, sample)
    }),
    Match.exhaustive,
  )

/** A down from the Primary pointer: a grab, which stops a running release where it is. */
const isGrab: Predicate.Predicate<InputSource.PointerLikeEvent> = Predicate.and(
  (e: InputSource.PointerLikeEvent) => e.type === "down",
  InputSource.isPrimaryPointer,
)

/**
 * The end of a Primary pointer's press: its up, its cancel, or a move with no button pressed
 * (its release was lost, ADR-0019). A press with no drag lets a projection node's stopped
 * release go on; any other unpressed move (a hover) finds none stopped.
 */
const isPressEnd: Predicate.Predicate<InputSource.PointerLikeEvent> = Predicate.and(
  (e: InputSource.PointerLikeEvent) =>
    Bool.some([e.type === "up", e.type === "cancel", Bool.and(e.type === "move", e.buttons === 0)]),
  InputSource.isPrimaryPointer,
)

/** Hand `sample` to `onSample`, when there is one (a `<Reorder>` item's group). */
const reportSample = (opts: RunDragTrackOptions, sample: Drag.Sample): void =>
  UndefinedOr.match(opts.onSample, { onUndefined: constVoid, onDefined: (onSample) => onSample(sample) })

/**
 * Follow the pointer for a "start" or "move" sample: absolute position = base + drag
 * offset. A "start" rebases to wherever the element currently rests (the snapshot's
 * x/y); for a projection node the snapshot x/y stays 0 (the projection owns position),
 * so `base` stays the origin, and the "start" begins the projection's drag first, so
 * `dragStart` runs before the first `dragMove`.
 */
const follow = (sample: Drag.Sample, state: TrackState, opts: RunDragTrackOptions): void => {
  const st = MutableRef.get(state)
  const starts = sample.phase === "start"
  const base = Bool.match(starts, { onTrue: () => snapshotPos(opts.snapshot), onFalse: () => st.base })
  const p: Point.Point = { x: base.x + sample.offset.x, y: base.y + sample.offset.y }
  MutableRef.set(state, { ...st, base, position: p })
  opts.setDragging(true)
  if (starts) UndefinedOr.match(opts.projection, { onUndefined: constVoid, onDefined: (projection) => projection.dragStart() })
  directSet(opts, p)
  reportSample(opts, sample)
}

/**
 * The pluggable release driver (ADR-0004 binding orchestration), seeded from the
 * release position + velocity:
 *   - `snapToOrigin`: spring `x`/`y` back to `{0,0}` (deterministic target).
 *   - else `momentum: false`: rest in place: commit the exact release position once (so
 *     the element rests at the pointer-up point, not the last move), and hand `x`/`y` back
 *     at the end of the release's task.
 *   - else: fling under `decayVec`.
 *
 * Each release frame taps `gate.write` + snapshot sync + recordFrame, and the track's
 * state, so a re-grab mid-tail rebases from where the tail reached. On completion
 * `setDragging(false)` hands ownership of `x`/`y` back to the spring. The spring and the
 * fling run on the Frame loop (ADR-0027); interrupting the release removes its run from
 * the loop at once, before the next handler touches the state.
 */
const release = (
  opts: RunDragTrackOptions,
  state: TrackState,
  position: Point.Point,
  velocity: Point.Point,
): Effect.Effect<void, never, FrameLoop.FrameLoop> => {
  const cfg = opts.config

  // A run's sink on the Frame loop is a plain call (ADR-0027, decision 8).
  const tapFrame = (p: Point.Point): undefined => {
    MutableRef.update(state, (s) => ({ ...s, position: p }))
    directSet(opts, p)
    return undefined
  }

  const done = Effect.sync(() => opts.setDragging(false))

  return Match.value(cfg).pipe(
    Match.when({ snapToOrigin: true }, () =>
      Machine.springValues({ x: 0, y: 0 }, cfg.springOpts, { x: position.x, y: position.y }, { x: velocity.x, y: velocity.y }).pipe(
        Machine.run((frame) => tapFrame({ x: UndefinedOr.getOrThrow(frame.value.x), y: UndefinedOr.getOrThrow(frame.value.y) })),
        Effect.andThen(done),
      )),
    // The position now; the hand-back at the end of the release's task, once every other
    // consumer of the same event has handled it: a press that ends with the drag (`whileTap`)
    // then finds `x`/`y` still the drag's, so a key the drag moved stays where it was dropped.
    Match.when({ momentum: false }, () =>
      Effect.sync(() => directSet(opts, position)).pipe(Effect.andThen(Microtask.next), Effect.andThen(done))),
    Match.orElse(() => Machine.decayVec(position, velocity, {}).pipe(Machine.run((frame) => tapFrame(frame.value)), Effect.andThen(done))),
  )
}

/**
 * Run the drag track for one element. Recognize `drag(element)` on its axis (read at
 * each gesture's start for a `<Reorder>` item) with its **Drag claim** (none with
 * `propagation`), shape it (withinBounds), then consume it and the element's bare
 * pointer-down grabs, each in place as it arrives (ADR-0032; the module doc). A drag
 * refused its claim emits nothing, so a draggable ancestor of the element that claimed
 * neither follows the pointer nor turns `whileDrag` on; its grab still stops its running
 * release (ADR-0019, *Amendment (#29)*). The WHOLE track runs under ONE fiber via
 * `runScoped`, so the caller's `onCleanup` interrupts it (dropping the Shared-source
 * ref-count and stopping any in-flight release); a failure of either consumer or of a
 * release fails it.
 *
 * The drag config is read ONCE at setup (the caller passes a static
 * {@link DragTrackConfig} — drag config is a document, not reactive); only the
 * `dragging` signal the spine reads is reactive.
 */
export const runDragTrack = (opts: RunDragTrackOptions): void => {
  const { config, element, runtime } = opts

  runScoped(
    runtime,
    Effect.gen(function* () {
      const state: TrackState = MutableRef.make<DragTrackState>({ base: ORIGIN, position: ORIGIN, held: false, history: [] })
      // The running release, if any: the next sample or grab interrupts it.
      const releasing = yield* FiberHandle.make<void>()

      const input = yield* InputSource.InputSource

      // The gesture's axis, read by the recognizer at each start: a `<Reorder>` item's group
      // decides it per gesture (D5). Then the numeric shaping (Probe-free, ADR-0004).
      const axisAt = opts.axisAt
      const axis: Drag.Axis | (() => Drag.Axis) = UndefinedOr.match(axisAt, {
        onUndefined: () => toDragAxis(config.axis),
        onDefined: (at) => () => toDragAxis(at()),
      })
      const { propagation = false } = config
      let shaped: Stream.Stream<Drag.Sample, never, InputSource.InputSource> = Recognizer.drag(element, {
        axis,
        claim: Bool.not(propagation),
      })
      if (config.constraints !== undefined) {
        shaped = shaped.pipe(
          Drag.withinBounds(
            config.constraints,
            config.elastic !== undefined ? { elastic: config.elastic } : undefined,
          ),
        )
      }

      // A free drag's "end" starts its release; a projection node's Release offset already
      // began in `settleGesture`, so its drag track skips the tail (ADR-0016, Q3c).
      const releaseFrom = (sample: Drag.Sample): Effect.Effect<void, never, FrameLoop.FrameLoop> =>
        UndefinedOr.match(opts.projection, {
          onDefined: () => Effect.void,
          onUndefined: () => {
            const { base } = MutableRef.get(state)
            const position: Point.Point = { x: base.x + sample.offset.x, y: base.y + sample.offset.y }
            return FiberHandle.run(releasing, release(opts, state, position, sample.velocity)).pipe(Effect.asVoid)
          },
        })

      // Each sample: its bookkeeping, then its response. A "start" or "move" stops a running
      // release first, as each new event did under `switchMap`.
      const onSample = (sample: Drag.Sample): Effect.Effect<void, never, FrameLoop.FrameLoop> =>
        Effect.suspend(() => {
          settleGesture(sample, state, opts)
          return Match.value(sample.phase).pipe(
            Match.when(Match.is("start", "move"), () =>
              FiberHandle.clear(releasing).pipe(Effect.andThen(Effect.sync(() => follow(sample, state, opts))))),
            Match.when("end", () => releaseFrom(sample)),
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
          UndefinedOr.match(opts.projection, { onUndefined: constVoid, onDefined: (projection) => projection.stopRelease() })
          if (!MutableRef.get(state).held) opts.setDragging(false)
        })),
      )
      // The samples subscribe first, so a drag's own up has ended its gesture by now: only a
      // press that never dragged finds no gesture held.
      const onPressEnd: Effect.Effect<void> = Effect.sync(() => {
        if (MutableRef.get(state).held) return
        UndefinedOr.match(opts.projection, { onUndefined: constVoid, onDefined: (projection) => projection.resumeRelease() })
      })
      const presses = input.pointer(element).pipe(Stream.filter(Predicate.or(isGrab, isPressEnd)))
      const onPress = (event: InputSource.PointerLikeEvent): Effect.Effect<void> =>
        Bool.match(isGrab(event), { onTrue: () => onGrab, onFalse: () => onPressEnd })

      // Started inline, in this order, so the samples subscribe before the grabs. Once both
      // inputs end (a test's script), the track ends when its release does; a failure of
      // either input, or of a release (`FiberHandle.join`), fails the track.
      const inputs = Effect.all([Stream.runForEach(shaped, onSample), Stream.runForEach(presses, onPress)], {
        concurrency: "unbounded",
        discard: true,
      })
      yield* Effect.raceFirst(inputs.pipe(Effect.andThen(FiberHandle.awaitEmpty(releasing))), FiberHandle.join(releasing))
    }).pipe(Effect.scoped),
  )
}
