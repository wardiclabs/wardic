import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import type { DecayOptions } from "../options.ts"
import { MAX_DT } from "../primitives/frame.ts"
import { decayStep, initDecay } from "../primitives/stepper.ts"
import { Clock } from "../services/Clock.ts"
import { InputSource, isPrimaryPointer } from "../services/InputSource.ts"
import { drag, type Vec2 } from "./drag.ts"
import { axisLock, type DragBounds, withinBounds } from "./shaping.ts"

/**
 * Two-axis decay: one stepper pass per `Clock` tick advancing **both** axes, so
 * a fling emits exactly one `Vec2` per tick and completes only when *both* axes
 * are at rest. This replaces fusing two scalar `decay` streams with
 * `zipLatestWith` — that double-emitted per tick (firing on either axis, with a
 * transiently-stale partner) and risked early-termination with plain `zip`.
 * Mirrors `scalar.ts`'s `fromClock`/`decay` shape (same `MAX_DT` clamp,
 * `initDecay`/`decayStep`), specialised to a `Vec2`.
 *
 * Public 2D decay primitive — seeded position + velocity, `Clock`-driven,
 * completes when both axes rest. Consumed by `withMomentum` here and by the
 * Solid binding's release orchestration (the Fling tail).
 */
export const decayVec = (
  initial: Vec2,
  velocity: Vec2,
  options: DecayOptions,
): Stream.Stream<Vec2, never, Clock> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const clock = yield* Clock
      return clock.ticks.pipe(
        Stream.mapAccum(
          () => ({ x: initDecay(initial.x, velocity.x), y: initDecay(initial.y, velocity.y) }),
          (state, dt) => {
            const clampedDt = dt > MAX_DT ? MAX_DT : dt
            const rx = decayStep(state.x, clampedDt, options)
            const ry = decayStep(state.y, clampedDt, options)
            const frame = { value: { x: rx.value, y: ry.value } as Vec2, done: rx.done && ry.done }
            return [{ x: rx.state, y: ry.state }, [frame]] as const
          },
        ),
        Stream.takeUntil((frame: { value: Vec2; done: boolean }) => frame.done),
        Stream.map((frame) => frame.value),
      )
    }),
  )

/**
 * Options for {@link withMomentum}. Shaping (`axis`, `bounds`, `elastic`) is
 * applied to the internal drag samples *before* the fling math runs, so a locked
 * axis or a bounded drag carries through into the release velocity and decay.
 * The remaining `DecayOptions` (`friction`, `restVelocity`, `delay`) tune the
 * post-release tail.
 */
export interface MomentumOptions extends DecayOptions {
  /** Lock dragging to a single axis; the other axis is zeroed. */
  readonly axis?: "x" | "y"
  /** Constrain the drag offset to a static region (per axis). */
  readonly bounds?: DragBounds
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
  readonly position: Vec2
  readonly base: Vec2
  readonly mode: MomentumMode
}

const ORIGIN: Vec2 = { x: 0, y: 0 }
const initial: MomentumState = { position: ORIGIN, base: ORIGIN, mode: "idle" }

/**
 * The merged event the machine switches over: either a fresh drag sample, or a
 * bare "grab" (a pointer-down) used purely to interrupt any fling.
 */
type Event = { readonly _tag: "sample"; readonly s: import("./drag.ts").DragSample } | { readonly _tag: "grab" }

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
  options: MomentumOptions,
): Stream.Stream<Vec2, never, Clock> => {
  if (event._tag === "grab") {
    // Returning an empty inner cancels any in-flight decay (switchMap interrupts
    // the previous inner), so the fling stops where it reached. Position is held —
    // no emission, no jump. The next drag rebases at its "start", not here: a new
    // down from a pointer whose release was lost also ends the old gesture (a Stale
    // gesture, ADR-0019), and that "end" and this grab arrive in either order.
    return Stream.fromEffect(Ref.update(ref, (st) => ({ ...st, mode: "idle" as const }))).pipe(Stream.drain)
  }

  const sample = event.s

  if (sample.phase === "start" || sample.phase === "move") {
    // Absolute position = base + the drag's accumulated offset. A "start" rebases to
    // wherever the surface sits now, so the drag continues from there.
    return Stream.fromEffect(
      Ref.modify(ref, (st) => {
        const base = sample.phase === "start" ? st.position : st.base
        const p: Vec2 = { x: base.x + sample.offset.x, y: base.y + sample.offset.y }
        return [p, { base, position: p, mode: "drag" as const }] as const
      }),
    )
  }

  // phase === "end": fling from the release position at the release velocity via
  // the two-axis decayVec (one Vec2 per tick), tapping each position back into
  // the ref so a mid-fling re-grab can rebase from where the fling reached.
  return Stream.unwrap(
    Ref.get(ref).pipe(
      Effect.map((st) => {
        const releasePos: Vec2 = { x: st.base.x + sample.offset.x, y: st.base.y + sample.offset.y }
        return decayVec(releasePos, sample.velocity, options).pipe(
          Stream.tap((p) => Ref.update(ref, (s) => ({ ...s, position: p, mode: "fling" as const }))),
          // On completion (both axes settled) drop back to idle so a later grab
          // rebases from the resting position.
          Stream.concat(
            Stream.fromEffect(Ref.update(ref, (s) => ({ ...s, mode: "idle" as const }))).pipe(Stream.drain),
          ),
        )
      }),
    ),
  )
}

/**
 * Draggable-with-momentum recognizer: tracks a drag and, on release, flings the
 * surface with a decaying tail. Emits the **absolute** position `{ x, y }` of the
 * surface — during the drag it follows the pointer (rebased onto the prior
 * resting position), and after release it continues under decay.
 *
 * Built as a `Stream.unwrap` over an `Effect.gen` that resolves `InputSource`,
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
 * Dependency surface is `InputSource | Clock`: `drag` brings `InputSource`, the
 * decay tail brings `Clock`. (Element-bounds shaping would add `Probe`, but the
 * numeric `bounds` form used here stays Probe-free — see ADR-0004.)
 */
export const withMomentum = (
  target: unknown,
  options: MomentumOptions = {},
): Stream.Stream<Vec2, never, InputSource | Clock> => {
  const attributes = {
    axis: options.axis ?? "free",
    bounded: options.bounds !== undefined,
    elastic: options.elastic ?? 0,
  }
  return Stream.unwrap(
    Effect.gen(function* () {
      const input = yield* InputSource
      yield* Effect.logDebug("wardic.momentum: subscribe").pipe(Effect.annotateLogs(attributes))
      const ref = yield* Ref.make<MomentumState>(initial)

      // Shape the drag samples *before* the fling fusion, so axis-lock / bounds
      // affect both the live drag and the release velocity that seeds decay.
      let shaped = drag(target)
      if (options.axis !== undefined) shaped = shaped.pipe(axisLock(options.axis))
      if (options.bounds !== undefined) {
        shaped = shaped.pipe(
          withinBounds(options.bounds, options.elastic === undefined ? {} : { elastic: options.elastic }),
        )
      }

      const samples = shaped.pipe(Stream.map((s) => ({ _tag: "sample" as const, s })))
      const grabs = input.pointer(target).pipe(
        Stream.filter((e) => e.type === "down" && isPrimaryPointer(e)),
        Stream.map(() => ({ _tag: "grab" as const })),
      )

      return Stream.merge(samples, grabs).pipe(
        Stream.switchMap((event: Event) => inner(event, ref, options)),
      )
    }).pipe(Effect.annotateLogs(attributes)),
  ).pipe(Stream.withSpan("wardic.momentum", { attributes }))
}

/**
 * Alias for {@link withMomentum}. `draggable(target, options)` reads naturally at
 * the call site when the intent is "make this element draggable with a fling".
 */
export const draggable = withMomentum
