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

/** What an Environment gives its Frame effects. */
export interface FrameEffectsOptions {
  /** Asks the Environment for a frame, whose end runs the effects. Called once a request, until the run. */
  readonly requestFrame: () => void
  /** What an effect that throws reports: the rest of the frame's effects still run. */
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
    // Those added before the run: one added in it waits for the next frame.
    const count = entries.length
    try {
      for (let i = 0; i < count; i++) {
        const entry = entries[i]
        if (!entry.live) continue
        try {
          entry.effect(time)
        } catch (defect) {
          report(defect)
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
