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
 * STRUCTURE — it mirrors core's `momentum.ts` exactly: a `merge(drag-samples,
 * pointer-down grabs)` switched over with `Stream.switchMap`, one local
 * `Ref<{ base; position }>`, pure `Ref` updates + effects-in-inners. That is what
 * makes the plain `Ref` interruption-safe (see `momentum.ts`'s INVARIANT
 * comment): `switchMap` serializes inners and interrupts the running one before
 * the next starts, so the single ref is never touched concurrently and a re-grab
 * mid-release interrupts the release inner — exactly what stops the tail.
 *
 * The one difference from `momentum.ts`: the inners do SIDE EFFECTS (gate.write,
 * snapshot sync, recordFrame, setDragging) instead of emitting, and the release
 * is PLUGGABLE (decay momentum / snapToOrigin spring / rest-in-place).
 */
import {
  axisLock,
  Clock,
  decayVec,
  drag as dragRecognizer,
  type DragBounds,
  type DragSample,
  InputSource,
  type SpringOptions,
  springValues,
  type Values,
  type Vec2,
  withinBounds,
} from "@wardic/core"
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import type { FlushGate } from "./gate.ts"
import { runScoped, type WardicRuntime } from "./provider.tsx"

/**
 * The spine's mutable Snapshot object (the SAME object `runSpine` holds): the
 * last emitted spring frame's per-key values + velocities. The drag track reads
 * `values.x`/`values.y` to continue from the rested position and writes them
 * (plus zeroed velocities) each direct-set frame so the post-drag handoff
 * continues from where the drag left the element.
 */
export interface DragSnapshot {
  values: Record<string, number>
  velocities: Record<string, number>
}

/** The static drag config (read ONCE, untracked, at setup — drag config is a document). */
export interface DragTrackConfig {
  /** `true` = free; `"x"`/`"y"` = axis-locked. */
  readonly axis: boolean | "x" | "y"
  /** Optional numeric constraint box (per axis) applied to the drag offset. */
  readonly constraints?: DragBounds | undefined
  /** Rubber-band resistance past `constraints` (0 = hard clamp). */
  readonly elastic?: number | undefined
  /** Fling on release under decay (default true). */
  readonly momentum?: boolean | undefined
  /** Spring back to the origin on release (overrides momentum). */
  readonly snapToOrigin?: boolean | undefined
  /** The spring options used for the snapToOrigin release. */
  readonly springOpts?: SpringOptions | undefined
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
  readonly recordFrame: (value: Values) => void
  /** Flip the reactive `dragging` signal the spine reads for `whileDrag` + key stripping. */
  readonly setDragging: (dragging: boolean) => void
  /** The static drag config (read once at setup). */
  readonly config: DragTrackConfig
}

/** Single-ref state: `base` is the rebase point, `position` the live absolute position. */
interface DragTrackState {
  readonly base: Vec2
  readonly position: Vec2
}

const ORIGIN: Vec2 = { x: 0, y: 0 }

/**
 * The merged event the track switches over: a fresh drag sample, or a bare
 * "grab" (pointer-down) used purely to rebase + interrupt a running release.
 */
type Event = { readonly _tag: "sample"; readonly s: DragSample } | { readonly _tag: "grab" }

/**
 * Read the current rested `x`/`y` off the snapshot (defaulting to 0). Captured at
 * grab so a drag (or a re-grab mid-release) continues from where the element
 * currently sits instead of snapping to origin.
 */
const snapshotPos = (snapshot: DragSnapshot): Vec2 => ({
  x: snapshot.values.x ?? 0,
  y: snapshot.values.y ?? 0,
})

/**
 * Direct-set `x`/`y` onto the element + the shared snapshot for one drag frame.
 * The drag is the SOLE owner of `x`/`y` while dragging, so it sets them on the
 * snapshot with zeroed velocities (the spring never fights them — the spine
 * strips the translate keys from its target while `dragging()` is true).
 */
const directSet = (opts: RunDragTrackOptions, p: Vec2): void => {
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
): Stream.Stream<never, never, Clock> => {
  if (event._tag === "grab") {
    // Rebase to wherever the element currently rests (the snapshot's x/y) and
    // interrupt any running release — `switchMap` cancels the previous inner, so
    // returning a drained one-shot effect is enough. No emission, no jump.
    return Stream.fromEffect(
      Ref.update(ref, () => {
        const at = snapshotPos(opts.snapshot)
        return { base: at, position: at }
      }),
    ).pipe(Stream.drain)
  }

  const sample = event.s

  if (sample.phase === "start" || sample.phase === "move") {
    // Direct-set: absolute position = base (captured at grab) + drag offset.
    return Stream.fromEffect(
      Ref.modify(ref, (st) => {
        const p: Vec2 = { x: st.base.x + sample.offset.x, y: st.base.y + sample.offset.y }
        return [p, { ...st, position: p }] as const
      }).pipe(
        Effect.tap((p) =>
          Effect.sync(() => {
            opts.setDragging(true)
            directSet(opts, p)
          }),
        ),
      ),
    ).pipe(Stream.drain)
  }

  // phase === "end": run the PLUGGABLE release seeded from the release position +
  // velocity. The release inner's effects live here, so a re-grab interrupts them
  // (switchMap), stopping the tail — exactly the momentum.ts handoff guarantee.
  return Stream.unwrap(
    Ref.get(ref).pipe(
      Effect.map((st) => {
        const releasePos: Vec2 = { x: st.base.x + sample.offset.x, y: st.base.y + sample.offset.y }
        return release(opts, ref, releasePos, sample.velocity)
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
 */
const release = (
  opts: RunDragTrackOptions,
  ref: Ref.Ref<DragTrackState>,
  position: Vec2,
  velocity: Vec2,
): Stream.Stream<never, never, Clock> => {
  const cfg = opts.config

  // Tap one released Vec2 into the gate + snapshot + ref (so a re-grab mid-tail
  // rebases from where the tail reached).
  const tapFrame = (p: Vec2): Effect.Effect<void> =>
    Ref.update(ref, (s) => ({ ...s, position: p })).pipe(
      Effect.tap(() => Effect.sync(() => directSet(opts, p))),
    )

  const done: Stream.Stream<never, never, never> = Stream.fromEffect(
    Effect.sync(() => opts.setDragging(false)),
  ).pipe(Stream.drain)

  if (cfg.snapToOrigin === true) {
    // snapToOrigin: spring x/y -> {0,0}, seeded from the release pos + velocity.
    return springValues(
      { x: 0, y: 0 },
      cfg.springOpts ?? {},
      { x: position.x, y: position.y },
      { x: velocity.x, y: velocity.y },
    ).pipe(
      Stream.tap((frame) => tapFrame({ x: frame.value.x ?? 0, y: frame.value.y ?? 0 })),
      Stream.drain,
      Stream.concat(done),
    )
  }

  if (cfg.momentum !== false) {
    // Fling: decay from the release position at the release velocity.
    return decayVec(position, velocity, {}).pipe(
      Stream.tap((p) => tapFrame(p)),
      Stream.drain,
      Stream.concat(done),
    )
  }

  // Rest in place: commit the exact release position once (so the element rests
  // at the pointer-up point, not the last move), then hand ownership back.
  return Stream.fromEffect(Effect.sync(() => directSet(opts, position))).pipe(
    Stream.drain,
    Stream.concat(done),
  )
}

/**
 * Run the drag track for one element. Mirrors `withMomentum`'s shape: shape the
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
      const ref = yield* Ref.make<DragTrackState>({ base: ORIGIN, position: ORIGIN })

      const input = yield* InputSource

      // Shape the drag samples BEFORE the track: axisLock first (zero the off
      // axis), then withinBounds (clamp the followed offset). Same fixed order as
      // momentum.ts / sensors.ts. Probe-free numeric form (ADR-0004).
      let shaped: Stream.Stream<DragSample, never, InputSource> = dragRecognizer(element)
      if (config.axis === "x" || config.axis === "y") shaped = shaped.pipe(axisLock(config.axis))
      if (config.constraints !== undefined) {
        shaped = shaped.pipe(
          withinBounds(
            config.constraints,
            config.elastic !== undefined ? { elastic: config.elastic } : undefined,
          ),
        )
      }

      const samples = shaped.pipe(Stream.map((s) => ({ _tag: "sample" as const, s })))
      // Bare pointer-downs rebase + interrupt a running release. The InputSource
      // is a Shared source, so this shares the recognizer's single listener-set
      // (no extra listeners — CONTEXT.md Shared source contract).
      const grabs = input.pointer(element).pipe(
        Stream.filter((e) => e.type === "down"),
        Stream.map(() => ({ _tag: "grab" as const })),
      )

      yield* Stream.merge(samples, grabs).pipe(
        Stream.switchMap((event: Event) => inner(event, ref, opts)),
        Stream.runDrain,
      )
    }),
  )
}
