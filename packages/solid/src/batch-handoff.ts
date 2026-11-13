/**
 * A Batch's Handoff (#706, ADR-0044 *Amendment (#706)*): its members' Appear animations read where they've
 * got to, and let go, at the first step of the first change after they arrive. Loaded with `import()` the
 * first time a hydrating Batch has a member running one (Q11), so a Batch that never takes one over ships
 * none of it. Shared by both bindings.
 *
 * @module
 */
import * as Appear from "@wardic/dom/Appear"
import * as Effect from "effect/Effect"
import * as Iter from "effect/Iterable"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import { pageAnimationsOf } from "./appear.ts"
import type { WardicRuntime } from "./runtime.ts"

/** A Batch's members running their Appear animation, as its Handoff reads them. */
export interface HandoffMembers {
  /** Their slots: each one's taken over, or let go, at the change's first step. */
  readonly appearing: ReadonlySet<number>
  /** A slot's element, where it has one. */
  readonly elementOf: (slot: number) => Element | undefined
  /** In development, a member's own transitions' key, which its animation's rule is checked against (Q9). */
  readonly keyOf: ((slot: number) => Option.Option<string>) | undefined
  /** Where a rule another set of transitions named is noted, at Debug. */
  readonly runtime: WardicRuntime
  /** Each member let go of its animation, once the step's starts are done: none waits for a step then. */
  readonly release: () => void
}

/** A member's rule sampled from other transitions than the client's (ADR-0044 decision 6): noted, and taken over all the same. */
const MISMATCH = /*#__PURE__*/ Effect.logDebug("wardic.hydration: a Batch member's Appear animation was sampled from other transitions than the client's; it goes on from the same time")

/**
 * The Handoff's `startAt`, every change's until the first one's first step: a member running its Appear
 * animation started where that has got to; any other, `NaN`, from its start. At the first member's first step, in the frame that draws it, every such
 * member's time is read with the page's animations, all before any is let go: a release between two reads
 * would have the second work the page's style out again. They're let go once the step's starts are done,
 * in its task, so no paint falls between. In development, each rule is checked once against the member's
 * own transitions (ADR-0044 decision 6): another is noted, and taken over all the same.
 */
export const startAtOf = (members: HandoffMembers): ((slot: number) => number) => {
  let times: Map<number, number> | undefined = undefined
  /** Every such member's time, read at once. */
  const timesNow = (): Map<number, number> => {
    const read = new Map<number, number>()
    const checked = new Set<string>()
    const keyOf = members.keyOf
    // Once a Handoff, over its members (#665's per-member site): reads alone.
    Iter.forEach(members.appearing, (slot) => {
      const el = members.elementOf(slot)
      if (Predicate.isUndefined(el)) return
      const animation = pageAnimationsOf(el).get(el)
      if (Predicate.isUndefined(animation)) return
      const name = (animation as Animation & { readonly animationName: string }).animationName
      if (Predicate.isNotUndefined(keyOf) && !checked.has(name)) {
        checked.add(name)
        if (!Option.exists(keyOf(slot), (key) => Appear.matchesBatch(animation, key))) members.runtime.runFork(MISMATCH)
      }
      read.set(slot, Appear.elapsedOf(animation))
    })
    // Every one let go once this step's starts are done, a member it didn't move among them.
    queueMicrotask(members.release)
    return read
  }
  // Per member at the change's first step: statements.
  return (slot) => {
    if (Predicate.isUndefined(times)) times = timesNow()
    const time = times.get(slot)
    if (Predicate.isUndefined(time)) return Number.NaN
    return time
  }
}
