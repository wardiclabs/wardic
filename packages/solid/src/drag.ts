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
 * RECOGNITION (`drag()` + the `axisLock`/`withinBounds` shaping combinators) and
 * the decay PRIMITIVE (`decayVec`); the release driver, the gate writes, and the
 * snapshot sync are response concerns and live here (ADR-0004).
 *
 * STRUCTURE (ADR-0032): input is handled inside its event. Two consumers, each a
 * `Stream.runForEach` that applies what arrives in place, with no scheduler hop
 * between a pointer event and its gate write:
 *   - the drag's samples: a gesture's bookkeeping, then the direct-set, or at the
 *     "end" the release;
 *   - bare pointer-downs from the Primary pointer ("grabs"), which stop a running
 *     release, so a re-grab mid-release stops the tail where it is.
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
import * as Machine from "@wardic/core/Machine"
import * as Microtask from "@wardic/core/Microtask"
import type { DragProjectionHandle, FlushGate } from "@wardic/dom"
import * as Bool from "effect/Boolean"
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
   * `dragEnd` (FLIP to slot — the momentum/snap tail is skipped). Absent ⇒ free drag.
   */
  readonly projection?: DragProjectionHandle | undefined
  /**
   * The gesture's axis, read at each gesture's "start" and held until its "end"
   * (`true` = free), in place of `config.axis`'s lock (internal: a `<Reorder>` item,
   * whose group decides the axis per gesture, D5).
   */
  readonly axisAt?: (() => boolean | "x" | "y") | undefined
  /**
   * Each sample, after its projection write: after `dragMove` for "start" and
   * "move", after `dragEnd` for "end", so a reader of the handle's `dragOffset()`
   * sees this sample (internal: a `<Reorder>` item's group).
   */
  readonly onSample?: ((sample: Drag.Sample) => void) | undefined
}

/** `sample` with its off-axis offset, delta and velocity zeroed (core's `axisLock`, for one sample). */
const lockTo = (sample: Drag.Sample, axis: "x" | "y"): Drag.Sample => {
  const off = axis === "x" ? "y" : "x"
  return {
    ...sample,
    offset: { ...sample.offset, [off]: 0 },
    delta: { ...sample.delta, [off]: 0 },
    velocity: { ...sample.velocity, [off]: 0 },
  }
}

/**
 * The track's state: `base` is the rebase point, `position` the live absolute position,
 * `held` whether a gesture is on (from its "start" to its "end").
 */
interface DragTrackState {
  readonly base: Point.Point
  readonly position: Point.Point
  readonly held: boolean
}

/** The track's one cell, written by its handlers and by its release's sink, never at once. */
type TrackState = MutableRef.MutableRef<DragTrackState>

const ORIGIN: Point.Point = { x: 0, y: 0 }

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
 * marks the gesture held; "end" clears it and, for a projection node (ADR-0016), starts
 * the FLIP to the slot (`dragEnd`) and hands back `dragging`, then reports the sample.
 */
const settleGesture = (sample: Drag.Sample, state: TrackState, opts: RunDragTrackOptions): void =>
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
          projection.dragEnd()
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
 * Run the drag track for one element. Shape the `drag(element)` stream (axisLock /
 * withinBounds), then consume it and the element's bare pointer-down grabs, each in place
 * as it arrives (ADR-0032; the module doc). The WHOLE track runs under ONE fiber via
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
      const state: TrackState = MutableRef.make<DragTrackState>({ base: ORIGIN, position: ORIGIN, held: false })
      // The running release, if any: the next sample or grab interrupts it.
      const releasing = yield* FiberHandle.make<void>()

      const input = yield* InputSource.InputSource

      // Shape the drag samples BEFORE the track: axisLock first (zero the off
      // axis), then withinBounds (clamp the followed offset). Probe-free numeric
      // form (ADR-0004).
      let shaped: Stream.Stream<Drag.Sample, never, InputSource.InputSource> = Recognizer.drag(element)
      const axisAt = opts.axisAt
      if (axisAt !== undefined) {
        // The gesture's axis, read at its "start" and held to its "end" (one fiber reads
        // the samples in order, so a plain variable is enough).
        let gestureAxis: boolean | "x" | "y" = true
        shaped = shaped.pipe(
          Stream.map((s) => {
            if (s.phase === "start") gestureAxis = axisAt()
            const out = gestureAxis === "x" || gestureAxis === "y" ? lockTo(s, gestureAxis) : s
            if (s.phase === "end") gestureAxis = true
            return out
          }),
        )
      } else if (config.axis === "x" || config.axis === "y") shaped = shaped.pipe(Drag.axisLock(config.axis))
      if (config.constraints !== undefined) {
        shaped = shaped.pipe(
          Drag.withinBounds(
            config.constraints,
            config.elastic !== undefined ? { elastic: config.elastic } : undefined,
          ),
        )
      }

      // A free drag's "end" starts its release; a projection node's FLIP already began in
      // `settleGesture`, so its drag track skips the tail (ADR-0016, Q3c).
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
      // gesture, ADR-0019). The InputSource is a Shared source, so this shares the
      // recognizer's single listener-set (CONTEXT.md Shared source contract).
      const onGrab: Effect.Effect<void> = FiberHandle.clear(releasing).pipe(
        Effect.andThen(Effect.sync(() => {
          if (!MutableRef.get(state).held) opts.setDragging(false)
        })),
      )
      const grabs = input.pointer(element).pipe(Stream.filter(isGrab))

      // Started inline, in this order, so the samples subscribe before the grabs; a failure
      // of either, or of a release (`FiberHandle.join`), fails the track.
      yield* Effect.all(
        [
          Stream.runForEach(shaped, onSample),
          Stream.runForEach(grabs, () => onGrab),
          FiberHandle.join(releasing),
        ],
        { concurrency: "unbounded", discard: true },
      )
    }).pipe(Effect.scoped),
  )
}
