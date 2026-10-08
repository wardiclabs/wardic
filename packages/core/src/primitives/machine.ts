import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { Clock } from "../services/Clock.ts"
import type { Frame } from "./frame.ts"

/**
 * A Primitive's motion as a value (ADR-0027): what a Primitive does on each tick, apart from how
 * the ticks reach it. Two drivers run the same machine, so its Frames are the same either way:
 * - its `Stream` (Tier 2, ADR-0001), which runs it over `Clock.ticks`, one fiber per subscriber;
 * - the **Frame loop** (`FrameLoop.run`), which steps every running machine in one pass per tick.
 *
 * Tier 2 (ADR-0008): for binding and Environment authors.
 */
export interface Machine<F extends Frame<unknown>> {
  /**
   * One run: a step from each tick's `dt` (seconds, as the Clock reports it) to that tick's
   * Frame. Each run holds its own state, so a machine can be started any number of times.
   */
  readonly start: () => (dt: number) => F
  /**
   * Whether a run ends at its first settled Frame. `chase` doesn't: its Frame reports rest, but
   * the run goes on until it's removed.
   */
  readonly settles: boolean
  /** The span a run on the Frame loop gets: its Primitive's name and attributes (ADR-0027, decision 3). */
  readonly span: MachineSpan
}

/** A machine's span name and attributes. */
export interface MachineSpan {
  readonly name: string
  readonly attributes: Readonly<Record<string, unknown>>
}

/** A settled Frame: a settling machine's run ends at its first. */
const isSettled = (frame: Frame<unknown>): boolean => frame.done

/**
 * Run `machine` over `Clock.ticks`: one Frame per tick, through its first settled Frame when it
 * settles. Each subscription starts its own run. No span or log of its own: each Primitive's
 * `Stream` adds its own, as before ADR-0027.
 */
export const toStream = <F extends Frame<unknown>>(machine: Machine<F>): Stream.Stream<F, never, Clock> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const clock = yield* Clock
      const frames = clock.ticks.pipe(Stream.map(machine.start()))
      return Bool.match(machine.settles, {
        onTrue: () => frames.pipe(Stream.takeUntil(isSettled)),
        onFalse: () => frames,
      })
    }),
  )

/** `machine` with each Frame mapped by `f`, under `span`. `f` is on the per-frame path (ADR-0025). */
export const mapFrames = <F extends Frame<unknown>, G extends Frame<unknown>>(
  machine: Machine<F>,
  f: (frame: F) => G,
  span: MachineSpan,
): Machine<G> => ({
  settles: machine.settles,
  span,
  start: () => {
    const step = machine.start()
    return (dt) => f(step(dt))
  },
})

/**
 * Segments played one after another, as one run: `Stream.concat`'s seam, reproduced exactly
 * (ADR-0027, decision 4). A segment's settled Frame is re-stamped `done: false` unless it's the
 * last segment's, and the next segment starts on the next tick from its beginning, with no
 * leftover time carried over.
 */
export const inSequence = <V>(
  segments: Arr.NonEmptyReadonlyArray<Machine<Frame<V>>>,
  span: MachineSpan,
): Machine<Frame<V>> => ({
  settles: true,
  span,
  start: () => {
    const last = segments.length - 1
    let index = 0
    let step = Arr.headNonEmpty(segments).start()
    // Per frame (ADR-0025): a statement `if`, and one Frame re-stamped at each seam.
    return (dt) => {
      const frame = step(dt)
      if (index === last || !frame.done) return frame
      index++
      step = Arr.getUnsafe(segments, index).start()
      return { value: frame.value, done: false }
    }
  },
})

/**
 * Segments cycled without end (an infinite `repeat`): every Frame is re-stamped `done: false`, as
 * `Stream.forever` over the re-stamped segments does, and each segment starts on the tick after
 * the previous one settles.
 */
export const cycle = <V>(segments: Arr.NonEmptyReadonlyArray<Machine<Frame<V>>>, span: MachineSpan): Machine<Frame<V>> => ({
  settles: true,
  span,
  start: () => {
    let index = 0
    let step = Arr.headNonEmpty(segments).start()
    // Per frame (ADR-0025): a statement `if`, and the re-stamped Frame `withDone` built before.
    return (dt) => {
      const frame = step(dt)
      if (frame.done) {
        index = (index + 1) % segments.length
        step = Arr.getUnsafe(segments, index).start()
      }
      return { value: frame.value, done: false }
    }
  },
})
