/**
 * A token that ends many runs at once without interrupting them: give it to each run you might replace,
 * `Machine.run(machine, sink, { supersede: token })`, then `end` it, and each run still going leaves the
 * Frame loop and succeeds with `Superseded`, neither settled nor failed. It costs about a sixth of
 * interrupting each run's fiber, which counts when one change replaces thousands of runs.
 *
 * @example
 * import * as Supersede from "@wardic/core/Supersede"
 *
 * const token = Supersede.make()
 * // each run a later change replaces:
 * Machine.run(machine, sink, { supersede: token }) // succeeds with Supersede.Superseded once ended
 * // the change:
 * Supersede.end(token)
 */
// #200, ADR-0027 *Amendment (#200)*: it leaves the loop as an interrupted run does (ADR-0027, decision
// 5). An interrupt costs about six times as much as ending the same fiber normally: Effect combines the
// interrupted cause at each finalizer and de-duplicates its reasons by structural hash (about 5 µs a
// fiber through a run's layers, against 0.9; the amendment's *Measured*). The binding's Retargets and
// unmounts end thousands of runs a time, so they supersede. Tier 2 (ADR-0008): for binding authors.
import * as Arr from "effect/Array"
import * as Deferred from "effect/Deferred"
import * as Exit from "effect/Exit"
import * as Inspectable from "effect/Inspectable"
import { type Pipeable, pipeArguments } from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import type * as Frame from "./Frame.ts"

const TypeId = "~@wardic/core/Supersede"

/** What a superseded run succeeds with, where a settled one succeeds with its settled Frame. */
export const Superseded: unique symbol = Symbol.for("@wardic/core/Supersede/Superseded")

/** The type of {@link Superseded}. */
export type Superseded = typeof Superseded

/** Whether a run's outcome is {@link Superseded}. */
export const isSuperseded = (u: unknown): u is Superseded => u === Superseded

/** A run a token can end: the Frame loop's entry for it. */
export interface Run {
  /** Whether it has left the Frame loop. */
  removed: boolean
  /** Its fiber's outcome: its settled frame, or `Superseded`. */
  readonly settled: Deferred.Deferred<Frame.Frame<unknown> | Superseded>
}

/** A token for the runs a caller may replace together: each run given it joins it, and `end` ends them all. */
// One per Retarget, in the binding.
export interface Supersede extends Pipeable, Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId
  /** The runs given this token and not yet ended by it. The Frame loop adds to it. */
  readonly runs: Array<Run>
}

const Proto = {
  [TypeId]: TypeId,
  ...Inspectable.BaseProto,
  toJSON(this: Supersede) {
    return { _id: "Supersede", runs: this.runs.length }
  },
  pipe() {
    return pipeArguments(this, arguments)
  },
}

/** A fresh token, with no runs. */
// Built in place: the binding makes one per Leg (#325).
export const make = (): Supersede => {
  const token = Object.create(Proto)
  token.runs = []
  return token
}

/** Whether `u` is a token. */
export const isSupersede = (u: unknown): u is Supersede => Predicate.hasProperty(u, TypeId)

/** The one outcome every superseded run's fiber resumes with. */
const SUPERSEDED: Exit.Exit<Superseded> = Exit.succeed(Superseded)

/** End one run: off the loop, and its fiber resumed with `Superseded`. Built once, so `end` allocates nothing. */
const endRun = (run: Run): void => {
  if (run.removed) return
  run.removed = true
  Deferred.doneUnsafe(run.settled, SUPERSEDED)
}

/**
 * End every run given `token` that's still on the Frame loop, at once: each leaves the loop (a run
 * ended during a tick gets no Frame from it), and its fiber resumes with `Superseded`. A run that
 * already settled, failed or was interrupted is left as it ended. The token is empty after, and
 * a run given it later joins it again. Calling `end` again is harmless.
 */
export const end = (token: Supersede): void => {
  Arr.forEach(token.runs, endRun)
  token.runs.length = 0
}
