/**
 * An Environment's **Frame effects** (CONTEXT.md): an app's own code, run at the end of each frame the
 * Environment draws, after Wardic's writes for it, in the order the effects were added. A scene runs
 * them in its Host loop before it renders; the DOM before paint. The Environment calls {@link
 * FrameEffects.run} at its frame's end, and gives `make` its way to ask for a frame, so an effect whose
 * inputs changed is run on a frame nothing else asked for.
 *
 * @example
 * import * as FrameEffects from "@wardic/core/unstable/FrameEffects"
 *
 * const effects = FrameEffects.make({ requestFrame: () => host.wantFrame(), report: console.error })
 * const remove = effects.add((time) => controls.update())
 * effects.run(time) // the Environment's, at its frame's end
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #882 (ADR-0073, *Amendment (#882)*, Q3): the slot for decision 19's Frame
// effects, one for every Environment. Not a phase of the Frame loop or of the gate: the loop ticks only
// while an animation runs, and the gate flushes only what was written, so a frame where an effect's only
// input moved (`createTime()`, an every-frame `controls.update()`) has neither.
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import * as Clock from "../Clock.ts"
import * as FrameLoop from "../FrameLoop.ts"
import * as RefreshFrameSource from "../RefreshFrameSource.ts"

/** What an Environment gives its Frame effects. */
export interface FrameEffectsOptions {
  /** Asks the Environment for a frame, whose end runs the effects. Called once a request, until the run. */
  readonly requestFrame: () => void
  /**
   * What an effect that throws reports, at the first frame of a run of throws: its next frame that
   * returns ends the run. The rest of the frame's effects still run.
   */
  readonly report: (defect: unknown) => void
}

/** An Environment's Frame effects: an ordered list it runs at each frame's end. */
export interface FrameEffects {
  /** Run `effect` at the end of each frame from now on, after those added before it. Returns its remover. */
  readonly add: (effect: (time: number) => void) => () => void
  /** Ask for a frame whose end runs the effects, though nothing else asks for one: an input of one changed. */
  readonly request: () => void
  /** Whether a frame is asked for: a `request()` since the last `run`. */
  readonly requested: () => boolean
  /** The Environment's call at its frame's end, `time` in ms: every effect added before it, in order. */
  readonly run: (time: number) => void
}

/** An effect in the list, and whether it's still in it. */
interface Entry {
  readonly effect: (time: number) => void
  live: boolean
}

/**
 * An Environment's Frame effects, asking it for frames through `options.requestFrame`. An effect added
 * while they run waits for the next frame's run, as a Refresh frame's callbacks do; one removed while
 * they run, before its turn, isn't run.
 */
export const make = (options: FrameEffectsOptions): FrameEffects => {
  const { requestFrame, report } = options
  // In order: the per-frame path, a plain array and loops, nothing allocated a frame.
  const entries: Array<Entry> = []
  let running = false
  let removedInRun = 0
  let asked = false
  // #979 group I, row 22 (ADR-0074 decision 3): a run of throws is reported once, at its first. A throw is
  // its run's first unless the entry threw at the run before, so a frame it returns from ends the run. The
  // runs are numbered, and the run an entry last threw in is kept here, written only in the catch: the
  // clean path does nothing. A flag on the entry cleared there cost Node 12% on a bare effect, and a number
  // on the entry written in the catch 3% (group I's microbench); this one nothing.
  let runs = 0
  const threwAt = new Map<Entry, number>()

  /** The entries no longer live taken out, in place, keeping the rest's order. */
  const compact = (): void => {
    let kept = 0
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (entry.live) entries[kept++] = entry
    }
    entries.length = kept
  }

  const add: FrameEffects["add"] = (effect) => {
    const entry: Entry = { effect, live: true }
    entries.push(entry)
    return () => {
      if (!entry.live) return
      entry.live = false
      threwAt.delete(entry)
      if (running) {
        removedInRun++
        return
      }
      compact()
    }
  }

  const request: FrameEffects["request"] = () => {
    if (asked) return
    asked = true
    requestFrame()
  }

  const run: FrameEffects["run"] = (time) => {
    asked = false
    running = true
    runs++
    // Those added before the run: one added in it waits for the next frame.
    const count = entries.length
    try {
      for (let i = 0; i < count; i++) {
        const entry = entries[i]
        if (!entry.live) continue
        try {
          entry.effect(time)
        } catch (defect) {
          if (threwAt.get(entry) !== runs - 1) report(defect)
          threwAt.set(entry, runs)
        }
      }
    } finally {
      running = false
      if (removedInRun > 0) {
        removedInRun = 0
        compact()
      }
    }
  }

  return { add, request, requested: () => asked, run }
}

/**
 * Frame effects for an Environment on core's Frame loop and Refresh frames, the DOM's: run at the end
 * of each tick, after the tick's hooks added before them (the Flush gate's flush, so after Wardic's
 * writes for the frame), and, on a frame with no tick, on a Refresh frame of their own that `request()`
 * asks for, which a tick withdraws. For as long as the Scope is open.
 *
 * @example
 * const effects = yield* FrameEffects.onFrameLoop((defect) => console.error(defect))
 * effects.add(() => camera.lookAt(target))
 */
// #884's PR 1 (ADR-0073 decision 19, *Amendment (#882)*'s Q3): the DOM's slot, as `@wardic/object`'s
// `frame(t)` runs its own. The tick's hook as the gate's `flushTicked` is: its own frame withdrawn, run now.
export const onFrameLoop = (report: (defect: unknown) => void): Effect.Effect<FrameEffects, never, FrameLoop.FrameLoop | RefreshFrameSource.RefreshFrameSource | Clock.Clock | Scope.Scope> =>
  Effect.gen(function* () {
    const loop = yield* FrameLoop.FrameLoop
    const { requestFrame, cancelFrame } = yield* RefreshFrameSource.RefreshFrameSource
    const clock = yield* Clock.Clock
    // The Refresh frame a request asked for, while it's pending.
    let pending = false
    let frame: unknown = undefined
    const effects: FrameEffects = make({
      requestFrame: () => {
        pending = true
        frame = requestFrame((time) => {
          pending = false
          effects.run(time)
        })
      },
      report,
    })
    const ticked = (): undefined => {
      if (pending) {
        cancelFrame(frame)
        pending = false
      }
      effects.run(clock.frameAt())
      return undefined
    }
    yield* loop.afterTick(ticked)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (pending) cancelFrame(frame)
        pending = false
      })
    )
    return effects
  })

