/**
 * The `Drag` module: a drag gesture's `Sample`, the shaping combinators over a stream of them
 * (`axisLock`, `withinBounds`, `dual`, the stream first), and `fling`, a drag with momentum: the
 * surface follows the pointer, and on release decays from the release velocity (CONTEXT.md's
 * Fling). `Recognizer.drag` recognizes the gesture.
 */
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as Clock from "./Clock.ts"
import * as InputSource from "./InputSource.ts"
import * as Machine from "./Machine.ts"
import type * as Point from "./Point.ts"
import * as Recognizer from "./Recognizer.ts"

/**
 * One emission from the `Recognizer.drag` recognizer — an Effect-free, portable signal.
 *
 * - `point`: the current pointer position (environment coordinates).
 * - `offset`: `point - origin`, measured from the down-point that started the
 *   gesture (total displacement of the drag).
 * - `delta`: `point - lastPoint`, the change since the previous emitted event.
 * - `velocity`: a per-axis, time-windowed estimate in units per second.
 * - `phase`: `"start"` on activation, `"move"` while dragging, `"end"` on
 *   release/cancel. A cancel ends at the last move's point with the moves' velocity
 *   (a `pointercancel`'s own coordinates aren't the pointer's: Chromium's carries
 *   (0, 0)). A **Stale gesture** (its release was lost, ADR-0019) also ends:
 *   at the owning pointer's first move with no button pressed, or its next down,
 *   with an `"end"` at the last pressed point, no delta and no velocity.
 * - `timeStamp`: the time (ms) of the event that produced it (a scroll-driven move
 *   carries the scroll's; a Stale gesture's end carries the event that ended it).
 */
export interface Sample {
  readonly point: Point.Point
  readonly offset: Point.Point
  readonly delta: Point.Point
  readonly velocity: Point.Point
  readonly phase: "start" | "move" | "end"
  readonly timeStamp: number
}

/**
 * A single-axis constraint on `offset`. Both bounds are optional, so a range can
 * be open on either side (`{ min: 0 }` clamps below 0 but allows any positive
 * offset). An `undefined` axis range passes that axis through untouched.
 */
export interface AxisRange {
  readonly min?: number
  readonly max?: number
}

/**
 * Per-axis constraints applied to a `Sample`'s `offset`. Either axis may be
 * omitted to leave it unconstrained.
 */
export interface Bounds {
  readonly x?: AxisRange
  readonly y?: AxisRange
}

/** The axis a drag is locked to; the other axis is zeroed. */
type Axis = "x" | "y"

/**
 * Lock a drag to a single `axis`, zeroing the off-axis component of `offset`,
 * `delta`, and `velocity` so the element only moves along `axis`. `point` (the
 * true pointer position) and `phase` are left unchanged.
 *
 * Pure and stateless: a `Stream.map`, `dual`, the stream first, that preserves the source
 * stream's `E`/`R`, so it pipes directly over `Recognizer.drag`'s output without widening its
 * dependency surface (see ADR-0004 — shaping combinators stay Probe-free).
 *
 * @example
 * Recognizer.drag(el).pipe(Drag.axisLock("x")) // offset.y, delta.y, velocity.y forced to 0
 */
export const axisLock: {
  (axis: Axis): <E, R>(stream: Stream.Stream<Sample, E, R>) => Stream.Stream<Sample, E, R>
  <E, R>(stream: Stream.Stream<Sample, E, R>, axis: Axis): Stream.Stream<Sample, E, R>
} = dual(2, <E, R>(stream: Stream.Stream<Sample, E, R>, axis: Axis): Stream.Stream<Sample, E, R> => {
  const off: Axis = Bool.match(axis === "x", { onTrue: () => "y", onFalse: () => "x" })
  return Stream.map(stream, (sample) => ({
    ...sample,
    offset: { ...sample.offset, [off]: 0 },
    delta: { ...sample.delta, [off]: 0 },
    velocity: { ...sample.velocity, [off]: 0 },
  }))
})

/** `v` past the range's `min`, pulled back toward it by `elastic`; `None` within it. */
const belowMin = (v: number, range: AxisRange, elastic: number): Option.Option<number> =>
  Option.fromNullishOr(range.min).pipe(
    Option.filter((min) => v < min),
    Option.map((min) => min - (min - v) * elastic),
  )

/** `v` past the range's `max`, pulled back toward it by `elastic`; `None` within it. */
const aboveMax = (v: number, range: AxisRange, elastic: number): Option.Option<number> =>
  Option.fromNullishOr(range.max).pipe(
    Option.filter((max) => v > max),
    Option.map((max) => max + (v - max) * elastic),
  )

/**
 * Constrain a single scalar to `range` with optional `elastic` resistance.
 *
 * - No `range`: pass through.
 * - Below `range.min`: `min - (min - v) * elastic`.
 * - Above `range.max`: `max + (v - max) * elastic`.
 * - In range: unchanged.
 *
 * So `elastic = 0` is a hard clamp (snaps to the bound) and `elastic = 1` is
 * free (no resistance — the value passes through). Values in `(0, 1)` rubber-
 * band: the overshoot past the bound is scaled by `elastic`.
 */
const constrain = (v: number, range: AxisRange | undefined, elastic: number): number =>
  Option.fromUndefinedOr(range).pipe(
    Option.flatMap((r) => Option.orElse(belowMin(v, r, elastic), () => aboveMax(v, r, elastic))),
    Option.getOrElse(() => v),
  )

/**
 * Constrain a drag's `offset` to a static numeric region, per axis, with
 * optional `elastic` rubber-band resistance past the bounds (`elastic` defaults
 * to `0` — a hard clamp). An omitted axis range passes that axis through.
 *
 * Pure and stateless: a `Stream.map`, `dual`, the stream first, that preserves the source
 * stream's `E`/`R` (Probe-free per ADR-0004 — this is the numeric form, not the
 * element-relative one).
 *
 * Only `offset` is transformed. `delta` and `velocity` are intentionally left
 * as the raw pointer-derived values: the binding positions the element from
 * `offset`, while `delta`/`velocity` remain a faithful record of pointer motion
 * (keeping the combinator pure and stateless — clamping them would require
 * tracking prior emitted state).
 *
 * @example
 * Recognizer.drag(el).pipe(Drag.withinBounds({ x: { min: 0, max: 200 } }, { elastic: 0.5 }))
 */
export const withinBounds: {
  (
    bounds: Bounds,
    options?: { readonly elastic?: number },
  ): <E, R>(stream: Stream.Stream<Sample, E, R>) => Stream.Stream<Sample, E, R>
  <E, R>(
    stream: Stream.Stream<Sample, E, R>,
    bounds: Bounds,
    options?: { readonly elastic?: number },
  ): Stream.Stream<Sample, E, R>
} = dual(
  (args) => Stream.isStream(args[0]),
  <E, R>(
    stream: Stream.Stream<Sample, E, R>,
    bounds: Bounds,
    options: { readonly elastic?: number } = {},
  ): Stream.Stream<Sample, E, R> => {
    const elastic = Option.getOrElse(Option.fromNullishOr(options.elastic), () => 0)
    return Stream.map(stream, (sample) => ({
      ...sample,
      offset: {
        x: constrain(sample.offset.x, bounds.x, elastic),
        y: constrain(sample.offset.y, bounds.y, elastic),
      },
    }))
  },
)

/**
 * Options for {@link fling}. Shaping (`axis`, `bounds`, `elastic`) is
 * applied to the internal drag samples *before* the fling math runs, so a locked
 * axis or a bounded drag carries through into the release velocity and decay.
 * The remaining `Machine.DecayOptions` (`friction`, `restVelocity`, `delay`) tune the
 * post-release tail.
 */
export interface FlingOptions extends Machine.DecayOptions {
  /** Lock dragging to a single axis; the other axis is zeroed. */
  readonly axis?: "x" | "y"
  /** Constrain the drag offset to a static region (per axis). */
  readonly bounds?: Bounds
  /** Rubber-band resistance past `bounds` (0 = hard clamp, 1 = free). */
  readonly elastic?: number
}

/** The phase of the momentum machine — drives nothing on its own; recorded for
 * observability and so the decay tail can mark settle. */
type MomentumMode = "idle" | "drag" | "fling"

/**
 * The *entire* state of a momentum surface, held in a single Ref.
 *
 * - `position`: the live absolute position emitted to consumers.
 * - `base`: the position the current drag's `offset` is measured from. Captured
 *   at each drag's `"start"`, so a drag (or a drag that interrupts a fling)
 *   continues from where the surface currently sits instead of snapping back to
 *   origin.
 * - `mode`: idle / drag / fling — bookkeeping only.
 */
interface MomentumState {
  readonly position: Point.Point
  readonly base: Point.Point
  readonly mode: MomentumMode
}

const ORIGIN: Point.Point = { x: 0, y: 0 }
const initial: MomentumState = { position: ORIGIN, base: ORIGIN, mode: "idle" }

/**
 * The merged event the machine switches over: either a fresh drag sample, or a
 * bare "grab" (a pointer-down) used purely to interrupt any fling.
 */
type Event = { readonly _tag: "sample"; readonly s: Sample } | { readonly _tag: "grab" }

/**
 * The inner stream for one merged event. This is the *only* place effects run:
 *
 * INVARIANT: one ref + pure updates + effects-in-inners — this is what makes
 * plain Ref interruption-safe here. Pure `Ref.modify`/`Ref.update` are
 * synchronous and uninterruptible, so a state mutation can never be torn
 * half-done by `switchMap` cancelling an inner. `switchMap` serializes inners
 * (a new event interrupts the running one before the next starts), so the single
 * ref is never touched concurrently. The decay tail's effects live inside the
 * "end" inner — when a re-grab arrives, switchMap interrupts that inner, which
 * is exactly what stops the fling. Splitting the ref across multiple cells, or
 * making any update effectful (e.g. reading the ref *inside* a decay step),
 * breaks this guarantee — reach for SynchronizedRef/STM if you must.
 */
const inner = (
  event: Event,
  ref: Ref.Ref<MomentumState>,
  options: FlingOptions,
): Stream.Stream<Point.Point, never, Clock.Clock> =>
  Match.value(event).pipe(
    // Returning an empty inner cancels any in-flight decay (switchMap interrupts
    // the previous inner), so the fling stops where it reached. Position is held —
    // no emission, no jump. The next drag rebases at its "start", not here: a new
    // down from a pointer whose release was lost also ends the old gesture (a Stale
    // gesture, ADR-0019), and that "end" and this grab arrive in either order.
    Match.tag("grab", () => Stream.fromEffect(Ref.update(ref, (st) => ({ ...st, mode: "idle" as const }))).pipe(Stream.drain)),
    Match.tag("sample", ({ s: sample }) =>
      Match.value(sample.phase).pipe(
        // Absolute position = base + the drag's accumulated offset. A "start" rebases to
        // wherever the surface sits now, so the drag continues from there.
        Match.when(Match.is("start", "move"), (phase) =>
          Stream.fromEffect(
            Ref.modify(ref, (st) => {
              const base = Bool.match(phase === "start", { onTrue: () => st.position, onFalse: () => st.base })
              const p: Point.Point = { x: base.x + sample.offset.x, y: base.y + sample.offset.y }
              return [p, { base, position: p, mode: "drag" as const }] as const
            }),
          ),
        ),
        // "end": fling from the release position at the release velocity via the two-axis
        // `Machine.decayVec` (one Point.Point per tick), tapping each position back into the ref so a
        // mid-fling re-grab can rebase from where the fling reached.
        Match.when("end", () =>
          Stream.unwrap(
            Ref.get(ref).pipe(
              Effect.map((st) => {
                const releasePos: Point.Point = { x: st.base.x + sample.offset.x, y: st.base.y + sample.offset.y }
                return Machine.toStream(Machine.decayVec(releasePos, sample.velocity, options)).pipe(
                  Stream.map((frame) => frame.value),
                  Stream.tap((p) => Ref.update(ref, (s) => ({ ...s, position: p, mode: "fling" as const }))),
                  // On completion (both axes settled) drop back to idle so a later grab
                  // rebases from the resting position.
                  Stream.concat(
                    Stream.fromEffect(Ref.update(ref, (s) => ({ ...s, mode: "idle" as const }))).pipe(Stream.drain),
                  ),
                )
              }),
            ),
          ),
        ),
        Match.exhaustive,
      ),
    ),
    Match.exhaustive,
  )

/** A primary pointer's down: a grab, which stops a fling where it reached. */
const isGrab: Predicate.Predicate<InputSource.PointerLikeEvent> = Predicate.and((e: InputSource.PointerLikeEvent) => e.type === "down", InputSource.isPrimaryPointer)

/**
 * Draggable-with-momentum recognizer: tracks a drag and, on release, flings the
 * surface with a decaying tail. Emits the **absolute** position `{ x, y }` of the
 * surface — during the drag it follows the pointer (rebased onto the prior
 * resting position), and after release it continues under decay.
 *
 * Built as a `Stream.unwrap` over an `Effect.gen` that resolves `InputSource.InputSource`,
 * creates the single state ref, and merges two derived streams:
 *   - `samples`: the (optionally shaped) `drag(target)` output, tagged.
 *   - `grabs`: bare pointer-downs from the **Primary pointer**, used to interrupt a
 *     fling.
 *
 * `Stream.switchMap` over the merge gives the core behaviour: each new event's
 * inner replaces the running one. A re-grab mid-fling therefore *interrupts* the
 * decay inner (stopping the fling), and the next drag's `"start"` rebases onto the
 * position the fling had reached — no snap back to origin, no continued decay.
 *
 * Dependency surface is `InputSource.InputSource | Clock.Clock`: `drag` brings `InputSource.InputSource`, the
 * decay tail brings `Clock`. (Element-bounds shaping would add `Probe`, but the
 * numeric `bounds` form used here stays Probe-free — see ADR-0004.)
 */
export const fling = (
  target: unknown,
  options: FlingOptions = {},
): Stream.Stream<Point.Point, never, InputSource.InputSource | Clock.Clock> => {
  const attributes = {
    axis: Option.getOrElse(Option.fromNullishOr(options.axis), (): "x" | "y" | "free" => "free"),
    bounded: Predicate.isNotUndefined(options.bounds),
    elastic: Option.getOrElse(Option.fromNullishOr(options.elastic), () => 0),
  }
  return Stream.unwrap(
    Effect.gen(function* () {
      const input = yield* InputSource.InputSource
      yield* Effect.logDebug("wardic.momentum: subscribe").pipe(Effect.annotateLogs(attributes))
      const ref = yield* Ref.make<MomentumState>(initial)

      // Shape the drag samples *before* the fling fusion, so axis-lock / bounds
      // affect both the live drag and the release velocity that seeds decay.
      const dragged = Recognizer.drag(target)
      const locked = Option.match(Option.fromUndefinedOr(options.axis), {
        onNone: () => dragged,
        onSome: (axis) => dragged.pipe(axisLock(axis)),
      })
      const shaped = Option.match(Option.fromUndefinedOr(options.bounds), {
        onNone: () => locked,
        onSome: (bounds) =>
          locked.pipe(
            withinBounds(
              bounds,
              Option.match(Option.fromUndefinedOr(options.elastic), { onNone: () => ({}), onSome: (elastic) => ({ elastic }) }),
            ),
          ),
      })

      const samples = shaped.pipe(Stream.map((s) => ({ _tag: "sample" as const, s })))
      const grabs = input.pointer(target).pipe(
        Stream.filter(isGrab),
        Stream.map(() => ({ _tag: "grab" as const })),
      )

      return Stream.merge(samples, grabs).pipe(
        Stream.switchMap((event: Event) => inner(event, ref, options)),
      )
    }).pipe(Effect.annotateLogs(attributes)),
  ).pipe(Stream.withSpan("wardic.momentum", { attributes }))
}
