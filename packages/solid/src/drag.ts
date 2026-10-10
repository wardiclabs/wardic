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
 * STRUCTURE — it mirrors core's `momentum.ts`: a `merge(drag-samples,
 * pointer-down grabs)` switched over with `Stream.switchMap`, one local
 * `Ref<{ base; position }>`, pure `Ref` updates + effects-in-inners. That is what
 * makes the plain `Ref` interruption-safe (see `momentum.ts`'s INVARIANT
 * comment): `switchMap` serializes inners and interrupts the running one before
 * the next starts, so the single ref is never touched concurrently and a re-grab
 * mid-release interrupts the release inner — exactly what stops the tail.
 *
 * The differences from `momentum.ts`: the inners do SIDE EFFECTS (gate.write,
 * snapshot sync, recordFrame, setDragging) instead of emitting, the release is
 * PLUGGABLE (decay momentum / snapToOrigin spring / rest-in-place), and a gesture's
 * start/end bookkeeping runs as each sample passes (`settleGesture`), since a grab
 * can interrupt an inner before it runs.
 */
import * as Drag from "@wardic/core/Drag"
import type * as FrameLoop from "@wardic/core/FrameLoop"
import * as InputSource from "@wardic/core/InputSource"
import type * as Point from "@wardic/core/Point"
import * as Recognizer from "@wardic/core/Recognizer"
import type * as Values from "@wardic/core/Values"
import * as Machine from "@wardic/core/Machine"
import type { DragProjectionHandle } from "@wardic/dom"
import * as Effect from "effect/Effect"
import * as MutableRef from "effect/MutableRef"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as UndefinedOr from "effect/UndefinedOr"
import type { FlushGate } from "./gate.ts"
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
 * Single-ref state: `base` is the rebase point, `position` the live absolute position,
 * `held` whether a gesture is on (from its "start" to its "end").
 */
interface DragTrackState {
  readonly base: Point.Point
  readonly position: Point.Point
  readonly held: boolean
}

const ORIGIN: Point.Point = { x: 0, y: 0 }

/**
 * The merged event the track switches over: a fresh drag sample, or a bare
 * "grab" (pointer-down) used purely to interrupt a running release.
 */
type Event = { readonly _tag: "sample"; readonly s: Drag.Sample } | { readonly _tag: "grab" }

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
 * The inner stream for one merged event — the ONLY place effects run (the
 * `momentum.ts` INVARIANT applies verbatim: pure `Ref` updates + effects-in-
 * inners + `switchMap` serialization = interruption-safe with a plain `Ref`).
 */
const inner = (
  event: Event,
  ref: Ref.Ref<DragTrackState>,
  opts: RunDragTrackOptions,
): Stream.Stream<never, never, FrameLoop.FrameLoop> => {
  if (event._tag === "grab") {
    // Interrupt any running release — `switchMap` cancels the previous inner. No
    // emission, no jump. With no gesture held, the interrupted release (or the one a
    // same-down "end" never got to start) hands `x`/`y` back to the spring; a drag that
    // follows takes them again at its "start". The drag rebases at that "start" sample
    // below, not here: a new down from a pointer whose release was lost also ends the
    // old gesture (a Stale gesture, ADR-0019), and that "end" and this grab arrive in
    // either order. `dragStart` is driven off the "start" SAMPLE too — the two race on
    // pointerdown and switchMap can interrupt the grab inner before it runs (ADR-0016).
    return Stream.fromEffect(
      Ref.get(ref).pipe(
        Effect.tap((st) =>
          Effect.sync(() => {
            if (!st.held) opts.setDragging(false)
          })
        ),
      ),
    ).pipe(Stream.drain)
  }

  const sample = event.s

  if (sample.phase === "start" || sample.phase === "move") {
    // Direct-set: absolute position = base + drag offset. A "start" rebases to wherever
    // the element currently rests (the snapshot's x/y). For a projection node the
    // snapshot x/y stays 0 (the projection owns position), so `base` stays the origin.
    return Stream.fromEffect(
      Ref.modify(ref, (st) => {
        const base = sample.phase === "start" ? snapshotPos(opts.snapshot) : st.base
        const p: Point.Point = { x: base.x + sample.offset.x, y: base.y + sample.offset.y }
        return [p, { ...st, base, position: p }] as const
      }).pipe(
        Effect.tap((p) =>
          Effect.sync(() => {
            opts.setDragging(true)
            // Projection node (ADR-0016): begin the drag on the "start" sample (not
            // the racing grab event) so `dragStart` reliably runs before the first
            // `dragMove`; `directSet` then routes the offset to `dragMove`.
            if (opts.projection !== undefined && sample.phase === "start") opts.projection.dragStart()
            directSet(opts, p)
            opts.onSample?.(sample)
          }),
        ),
      ),
    ).pipe(Stream.drain)
  }

  // phase === "end": projection node (ADR-0016) → the FLIP to the current slot already
  // began as the sample passed (see `settleGesture`); the free-drag tail is skipped.
  if (opts.projection !== undefined) return Stream.empty

  // phase === "end" (free drag): run the PLUGGABLE release seeded from the release
  // position + velocity. The release inner's effects live here, so a re-grab
  // interrupts them (switchMap), stopping the tail — the momentum.ts handoff guarantee.
  return Stream.unwrap(
    Ref.get(ref).pipe(
      Effect.map((st) => {
        const releasePos: Point.Point = { x: st.base.x + sample.offset.x, y: st.base.y + sample.offset.y }
        return release(opts, ref, releasePos, sample.velocity)
      }),
    ),
  )
}

/**
 * A gesture's bookkeeping, run as each sample passes, before the merge with the grabs:
 * the one effect outside the inners. A Stale gesture's "end" and the grab of the down
 * that ended it (ADR-0019, rule B) reach `switchMap` together, and the grab can
 * interrupt the "end" inner before it runs, so what must happen at every end can't
 * live there. "start" marks the gesture held; "end" clears it and, for a projection
 * node (ADR-0016), starts the FLIP to the slot (`dragEnd`) and hands back `dragging`.
 */
const settleGesture = (
  sample: Drag.Sample,
  ref: Ref.Ref<DragTrackState>,
  opts: RunDragTrackOptions,
): Effect.Effect<void> => {
  if (sample.phase === "start") return Ref.update(ref, (st) => ({ ...st, held: true }))
  if (sample.phase !== "end") return Effect.void
  return Ref.update(ref, (st) => ({ ...st, held: false })).pipe(
    Effect.andThen(
      Effect.sync(() => {
        if (opts.projection !== undefined) {
          opts.projection.dragEnd()
          opts.setDragging(false)
        }
        opts.onSample?.(sample)
      }),
    ),
  )
}

/**
 * The pluggable release driver (ADR-0004 binding orchestration):
 *   - `snapToOrigin`: spring `x`/`y` back to `{0,0}` (deterministic target),
 *     seeded from the release position + velocity.
 *   - else `momentum !== false`: fling under `decayVec` from the release position
 *     + velocity.
 *   - else: rest in place immediately.
 *
 * Each release frame taps `gate.write` + snapshot sync + recordFrame; on
 * completion `setDragging(false)` so ownership of `x`/`y` returns to the spring.
 * The spring and the fling run on the Frame loop (ADR-0027); the track stays a fiber.
 */
const release = (
  opts: RunDragTrackOptions,
  ref: Ref.Ref<DragTrackState>,
  position: Point.Point,
  velocity: Point.Point,
): Stream.Stream<never, never, FrameLoop.FrameLoop> => {
  const cfg = opts.config

  // Tap one released Point into the gate + snapshot + ref (so a re-grab mid-tail
  // rebases from where the tail reached). A plain call, as a run's sink on the Frame loop
  // must be, so it writes the ref's cell in place, as `Ref.update` does. The INVARIANT
  // holds: a re-grab interrupts the run (switchMap), which removes it from the loop at once,
  // before the next inner touches the ref.
  const tapFrame = (p: Point.Point): undefined => {
    MutableRef.update(ref.ref, (s) => ({ ...s, position: p }))
    directSet(opts, p)
    return undefined
  }

  const done: Stream.Stream<never, never, never> = Stream.fromEffect(
    Effect.sync(() => opts.setDragging(false)),
  ).pipe(Stream.drain)

  // The release's run, then `done` once it settles.
  const settling = (run: Effect.Effect<unknown, never, FrameLoop.FrameLoop>): Stream.Stream<never, never, FrameLoop.FrameLoop> =>
    Stream.fromEffect(run).pipe(Stream.drain, Stream.concat(done))

  if (cfg.snapToOrigin === true) {
    // snapToOrigin: spring x/y -> {0,0}, seeded from the release pos + velocity.
    return settling(
      Machine.springValues({ x: 0, y: 0 }, cfg.springOpts, { x: position.x, y: position.y }, { x: velocity.x, y: velocity.y }).pipe(
        Machine.run((frame) => tapFrame({ x: UndefinedOr.getOrThrow(frame.value.x), y: UndefinedOr.getOrThrow(frame.value.y) })),
      ),
    )
  }

  if (cfg.momentum !== false) {
    // Fling: decay from the release position at the release velocity.
    return settling(Machine.decayVec(position, velocity, {}).pipe(Machine.run((frame) => tapFrame(frame.value))))
  }

  // Rest in place: commit the exact release position once (so the element rests
  // at the pointer-up point, not the last move), then hand ownership back.
  return Stream.fromEffect(Effect.sync(() => directSet(opts, position))).pipe(
    Stream.drain,
    Stream.concat(done),
  )
}

/**
 * Run the drag track for one element. Mirrors `Drag.fling`'s shape: shape the
 * `drag(element)` stream (axisLock / withinBounds), merge it with bare pointer-
 * down grabs, and `switchMap` over the merge so each new event interrupts the
 * running inner. The WHOLE track runs as ONE fiber via `runScoped(...runDrain)`,
 * so the caller's `onCleanup` interrupts it (dropping the Shared-source
 * ref-count and stopping any in-flight release).
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
      const ref = yield* Ref.make<DragTrackState>({ base: ORIGIN, position: ORIGIN, held: false })

      const input = yield* InputSource.InputSource

      // Shape the drag samples BEFORE the track: axisLock first (zero the off
      // axis), then withinBounds (clamp the followed offset). Same fixed order as
      // momentum.ts / sensors.ts. Probe-free numeric form (ADR-0004).
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

      const samples = shaped.pipe(
        Stream.tap((s) => settleGesture(s, ref, opts)),
        Stream.map((s) => ({ _tag: "sample" as const, s })),
      )
      // Bare pointer-downs from the Primary pointer interrupt a running release. The
      // InputSource is a Shared source, so this shares the recognizer's single
      // listener-set (no extra listeners — CONTEXT.md Shared source contract).
      const grabs = input.pointer(element).pipe(
        Stream.filter((e) => e.type === "down" && InputSource.isPrimaryPointer(e)),
        Stream.map(() => ({ _tag: "grab" as const })),
      )

      yield* Stream.merge(samples, grabs).pipe(
        Stream.switchMap((event: Event) => inner(event, ref, opts)),
        Stream.runDrain,
      )
    }),
  )
}
