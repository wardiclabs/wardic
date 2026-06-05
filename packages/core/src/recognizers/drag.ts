import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type { PointerLikeEvent } from "../services/InputSource.ts"
import { InputSource } from "../services/InputSource.ts"

/** A 2D vector — pointer position and the per-axis quantities derived from it. */
export interface Vec2 {
  readonly x: number
  readonly y: number
}

/**
 * One emission from the `drag` recognizer — an Effect-free, portable signal.
 *
 * - `point`: the current pointer position (environment coordinates).
 * - `offset`: `point - origin`, measured from the down-point that started the
 *   gesture (total displacement of the drag).
 * - `delta`: `point - lastPoint`, the change since the previous emitted event.
 * - `velocity`: a per-axis, time-windowed estimate in units per second.
 * - `phase`: `"start"` on activation, `"move"` while dragging, `"end"` on
 *   release/cancel.
 */
export interface DragSample {
  readonly point: Vec2
  readonly offset: Vec2
  readonly delta: Vec2
  readonly velocity: Vec2
  readonly phase: "start" | "move" | "end"
}

/**
 * Movement distance (px) from the down-origin required before a gesture
 * activates. Below this the pointer is treated as a tap-in-progress and no
 * samples are emitted; crossing it promotes the gesture to `"start"`.
 */
const THRESHOLD = 3

/**
 * Width (ms) of the trailing window used to estimate release velocity. Velocity
 * is computed from the oldest sample still inside `newest.t - VELOCITY_WINDOW_MS`
 * up to the newest, so a single stale frame can't skew the fling speed.
 */
const VELOCITY_WINDOW_MS = 30

/** A timestamped pointer position retained for the velocity window. */
interface HistorySample {
  readonly x: number
  readonly y: number
  readonly t: number
}

interface DragState {
  readonly phase: "idle" | "active"
  readonly ownerId: number | null
  readonly origin: Vec2
  readonly last: Vec2
  readonly history: ReadonlyArray<HistorySample>
}

const initState: DragState = {
  phase: "idle",
  ownerId: null,
  origin: { x: 0, y: 0 },
  last: { x: 0, y: 0 },
  history: [],
}

/** Euclidean distance between two points. */
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Push the newest sample and drop everything older than the window, keeping at
 * least the oldest entry still inside `newest.t - VELOCITY_WINDOW_MS`.
 */
const pushHistory = (
  history: ReadonlyArray<HistorySample>,
  sample: HistorySample,
): ReadonlyArray<HistorySample> => {
  const next = [...history, sample]
  const cutoff = sample.t - VELOCITY_WINDOW_MS
  // Keep every sample within the window; the boundary check uses `>=` so the
  // sample exactly at the cutoff is retained, guaranteeing a non-empty window.
  return next.filter((s) => s.t >= cutoff)
}

/**
 * Per-axis time-windowed velocity (units/sec) from the oldest in-window sample
 * to the newest. Guards a zero time span (single sample / same timestamp) -> 0.
 */
const windowVelocity = (history: ReadonlyArray<HistorySample>): Vec2 => {
  if (history.length < 2) return { x: 0, y: 0 }
  const oldest = history[0]!
  const newest = history[history.length - 1]!
  const dtSeconds = (newest.t - oldest.t) / 1000
  if (dtSeconds === 0) return { x: 0, y: 0 }
  return {
    x: (newest.x - oldest.x) / dtSeconds,
    y: (newest.y - oldest.y) / dtSeconds,
  }
}

/**
 * Fold one pointer event into the drag state, emitting zero or more samples.
 *
 * Zero-or-more output: activation/sub-threshold/non-owner events emit `[]`;
 * threshold crossing emits one `"start"`; subsequent moves emit one `"move"`;
 * release/cancel emits one `"end"`. This is the hot path — no logging here.
 */
const step = (state: DragState, event: PointerLikeEvent): readonly [DragState, ReadonlyArray<DragSample>] => {
  const point: Vec2 = { x: event.x, y: event.y }

  // --- Activation: first "down" claims the gesture. ---
  if (event.type === "down") {
    if (state.ownerId !== null) {
      // Already owned (e.g. a second pointer pressing) — ignore.
      return [state, []] as const
    }
    return [
      {
        phase: "idle",
        ownerId: event.pointerId,
        origin: point,
        last: point,
        history: [{ x: point.x, y: point.y, t: event.timeStamp }],
      },
      [],
    ] as const
  }

  // No owner yet, or event from a non-owning pointer — ignore.
  if (state.ownerId === null || event.pointerId !== state.ownerId) {
    return [state, []] as const
  }

  // --- Release / cancel from the owner: emit final "end", reset. ---
  if (event.type === "up" || event.type === "cancel") {
    // Only an active (already started) gesture produces an "end" sample; a
    // release before threshold is a tap and emits nothing.
    if (state.phase === "active") {
      const history = pushHistory(state.history, { x: point.x, y: point.y, t: event.timeStamp })
      const sample: DragSample = {
        point,
        offset: { x: point.x - state.origin.x, y: point.y - state.origin.y },
        delta: { x: point.x - state.last.x, y: point.y - state.last.y },
        velocity: windowVelocity(history),
        phase: "end",
      }
      return [initState, [sample]] as const
    }
    return [initState, []] as const
  }

  // --- Movement from the owner. ---
  if (event.type === "move") {
    const history = pushHistory(state.history, { x: point.x, y: point.y, t: event.timeStamp })
    const offset: Vec2 = { x: point.x - state.origin.x, y: point.y - state.origin.y }
    const delta: Vec2 = { x: point.x - state.last.x, y: point.y - state.last.y }

    if (state.phase === "idle") {
      // Below threshold: keep origin fixed, advance last/history so velocity is
      // primed, but suppress output.
      if (dist(state.origin, point) <= THRESHOLD) {
        return [{ ...state, last: point, history }, []] as const
      }
      // Crossing the threshold promotes the gesture and emits "start".
      const sample: DragSample = {
        point,
        offset,
        delta,
        velocity: windowVelocity(history),
        phase: "start",
      }
      return [{ ...state, phase: "active", last: point, history }, [sample]] as const
    }

    // Active: every move emits.
    const sample: DragSample = {
      point,
      offset,
      delta,
      velocity: windowVelocity(history),
      phase: "move",
    }
    return [{ ...state, last: point, history }, [sample]] as const
  }

  // "enter"/"leave" and anything else: no-op for drag.
  return [state, []] as const
}

/**
 * Recognize a drag gesture on `target`, emitting a `DragSample` stream.
 *
 * Built like the scalar primitives (`scalar.ts`/`chase.ts`): a `Stream.unwrap`
 * over an `Effect.gen` that resolves `InputSource`, logs subscribe (annotated),
 * and folds the pointer stream with `Stream.mapAccum`. The whole stream runs in
 * a `wardic.drag` span; per-sample folding stays silent (hot path).
 *
 * Velocity is a time-windowed (~30ms) per-axis estimate read from event
 * `timeStamp`s, so the recognizer needs no `Clock` — only `InputSource`.
 */
export const drag = (target: unknown): Stream.Stream<DragSample, never, InputSource> => {
  const attributes = { threshold: THRESHOLD, velocityWindowMs: VELOCITY_WINDOW_MS }
  return Stream.unwrap(
    Effect.gen(function* () {
      const input = yield* InputSource
      yield* Effect.logDebug("wardic.drag: subscribe").pipe(Effect.annotateLogs(attributes))
      return input.pointer(target).pipe(Stream.mapAccum(() => initState, step))
    }).pipe(Effect.annotateLogs(attributes)),
  ).pipe(Stream.withSpan("wardic.drag", { attributes }))
}
