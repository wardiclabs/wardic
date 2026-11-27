/**
 * An element's **Timeline values** (#240, ADR-0043 *Amendment (#240)*), the `scroll` Feature's: a routed
 * `style` key whose Live value core describes as derived from a container's scroll
 * (`LiveValue.scrollDerivationOf`) gets the DOM's `TimelineValue`, handed to the gate while the key shows
 * its Live value and taken back from it while anything else draws the key. Made again when what the key
 * derives from changes: a new source in its `style`, or a `createScroll`'s new container.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672 (PR6-Q1): solid's `features/timeline-keys.ts`, moved to dom with the Features, for
// every DOM binding.
import * as LiveValue from "@wardic/core/LiveValue"
import * as Report from "@wardic/core/unstable/Report"
import * as TimelineValue from "../../TimelineValue.ts"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import type * as Atom from "effect/reactivity/Atom"
import type * as Timelines from "@wardic/core/unstable/Timelines"

/** A key's Timeline value as last made: the derivation it was made from, and the value, `undefined` where the gate draws the key. */
interface Made {
  readonly derivation: LiveValue.ScrollDerivation
  readonly timeline: TimelineValue.TimelineValue | undefined
}

/** An element's {@link Timelines.TimelineKeys}, and what its provider's `described` tells it. */
interface ElementKeys extends Timelines.TimelineKeys {
  /** Find each key it shows its Timeline value again: what it derives from may have been described since. */
  readonly recheck: () => void
}

/**
 * A provider's {@link Timelines.Timelines}: each mounted element's keys, told again when a `createScroll`
 * describes its values.
 */
export const makeTimelines = (): Timelines.Timelines["Service"] => {
  const mounted = new Set<ElementKeys>()
  return {
    keysOf: (options) => {
      const keys = elementKeysOf(options, () => mounted.delete(keys))
      mounted.add(keys)
      return keys
    },
    described: () => {
      mounted.forEach((keys) => keys.recheck())
    },
  }
}

// #979 (ADR-0074, row 7): a make calls the app's code, an `ease` or an interpolator, at each point its
// keyframes sample, some the frame path never reads. Its throw came out of the binding, a Solid 2 halt.
const TIMELINE_FAILED = "wardic.timeline: a Timeline value failed"

/**
 * An element's keys. `shown` runs at each write of a key's Live value, so per frame while it moves: a key
 * shown already from the same source is left as it is, with nothing read but its source, statements and
 * nothing made. What it derives from changes only where it's described anew, which `recheck` hears.
 */
const elementKeysOf = (options: Timelines.TimelineKeysOptions, unmounted: () => void): ElementKeys => {
  const { runtime, gate, id, live } = options
  // #672: the spine hands its Subject; a DOM binding's is its element, which a Timeline value follows.
  const element = options.element as Element
  const made = new Map<string, Made>()
  // The keys that show their Live value, whatever runs them, each with the Atom it was shown from (none
  // for a plain accessor's): the ones `recheck` looks at again.
  const showing = new Map<string, Atom.Atom<unknown> | undefined>()
  // The keys whose Timeline value the gate has, each with it.
  const running = new Map<string, TimelineValue.TimelineValue>()

  /**
   * `key`'s Timeline value now, made again when its derivation changed; `undefined` for none. A make that
   * throws is reported and makes none, so the gate draws the key, and it's kept as made: tried again only
   * for a new derivation.
   */
  const timelineOf = (key: string): TimelineValue.TimelineValue | undefined => {
    const atom = live.atomOf(key)
    if (Predicate.isUndefined(atom)) return undefined
    const derivation = Option.getOrUndefined(LiveValue.scrollDerivationOf(atom))
    if (Predicate.isUndefined(derivation)) return undefined
    const last = made.get(key)
    if (Predicate.isNotUndefined(last)) {
      if (last.derivation === derivation) return last.timeline
    }
    const timeline = Exit.match(runtime.runSyncExit(TimelineValue.make(derivation, element, key)), {
      onSuccess: Option.getOrUndefined,
      onFailure: (cause) => {
        runtime.runFork(Report.failure(TIMELINE_FAILED, cause).pipe(Effect.annotateLogs({ key })))
        return undefined
      },
    })
    made.set(key, { derivation, timeline })
    return timeline
  }

  /** The gate runs `key`'s Timeline value now, or none. */
  const run = (key: string): void => {
    const timeline = timelineOf(key)
    if (running.get(key) === timeline) return
    gate.timeline(id, key, timeline)
    if (Predicate.isUndefined(timeline)) {
      running.delete(key)
      return
    }
    running.set(key, timeline)
  }

  return {
    shown: (key) => {
      const atom = live.atomOf(key)
      if (showing.has(key)) {
        if (showing.get(key) === atom) return
      }
      showing.set(key, atom)
      run(key)
    },
    taken: (key) => {
      showing.delete(key)
      if (Bool.not(running.has(key))) return
      running.delete(key)
      gate.timeline(id, key, undefined)
    },
    recheck: () => {
      showing.forEach((_, key) => run(key))
    },
    dispose: unmounted,
  }
}
