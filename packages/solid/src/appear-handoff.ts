/**
 * An element's mount animation as both sides describe it, and its **Handoff** as the spine reads it
 * (#48, ADR-0044): how far in its first legs start, from where its Appear animation has got.
 * `appear.ts` samples a server's and finds a client's.
 *
 * @module
 */
// #672 (PR4-Q3): what of `appear.ts` the spine reads, apart, for core; the rest stays for dom.
import type * as Machine from "@wardic/core/Machine"
import type * as Values from "@wardic/core/Values"
import * as Bool from "effect/Boolean"
import * as UndefinedOr from "effect/UndefinedOr"
import type { SpineConfig, WardicTransition } from "./config.ts"
import { runOf, type StopsByKey } from "./retarget-legs.ts"

/** An element's mount animation, described the same on the server and the client. */
export interface MountAnimation {
  /** The element's tag, for SVG's routing; `undefined` for an element whose tag isn't known. */
  readonly tag: string | undefined
  /** Each animated key's start. */
  readonly from: Values.Values
  /** Each animated key's target. */
  readonly to: Values.Values
  /** The element's own transition: its stagger isn't in it (ADR-0007). */
  readonly transition: WardicTransition | undefined
  /** Whether reduced motion is on for it (ADR-0029). */
  readonly reduced: boolean
  /**
   * Whether it's a layout node (#245): drawn through its projection at rest, as the client draws
   * it, its own translate on top (#363). Part of its rule's name (`Appear.Spec.projected`).
   */
  readonly layout: boolean
  /** Each key's Keyframes of more than two stops (#429), `from` at their first: part of its key. Left out with none. */
  readonly stops?: StopsByKey | undefined
  /**
   * Whether it's a **Skipped animation** (#468): every key lands on its first frame, so its rule is
   * 0 s, holding its end from first paint. Part of its key; left out when it isn't.
   */
  readonly skipped?: boolean | undefined
  /** Its **Transform template** (#443): its stops drawn through it, as the client draws them. Left out with none. */
  readonly template?: SpineConfig["transformTemplate"]
}

/** Whether a transition repeats for ever: a tween's `repeat: Infinity`, a tween as it runs (ADR-0051). */
export const repeatsForever = (transition: WardicTransition | undefined): boolean =>
  UndefinedOr.match(runOf(transition), { onUndefined: () => false, onDefined: (run) => Bool.and(run.type === "tween", (run as Machine.AnimateOptions).repeat === Number.POSITIVE_INFINITY) })

/** A transition's own delay, 0 without one. */
export const ownDelayOf = (transition: WardicTransition | undefined): number =>
  UndefinedOr.match(transition, { onUndefined: () => 0, onDefined: ({ delay = 0 }) => delay })

/**
 * The seconds a rule holds before it moves, of the delay the client counts: a transition's own
 * delay is in its rule, except a forever-repeating one's, whose rule is a cycle and whose own delay
 * goes in `animation-delay` with the stagger.
 */
const heldInRule = (transition: WardicTransition | undefined): number =>
  Bool.match(repeatsForever(transition), { onTrue: () => 0, onFalse: () => ownDelayOf(transition) })

/** A mount animation's `skipped` (#468): left out when it isn't, so its key is as before. */
export const skippedField = (skipped: boolean): { readonly skipped?: true } => Bool.match(skipped, { onTrue: () => ({ skipped: true }) as const, onFalse: () => ({}) })

/** An element's Appear animation, found at mount: the spine starts its first legs as far in as it has got. */
export interface Handoff {
  /** How far its animation has run, in seconds (its delay included). */
  readonly elapsed: () => number
  /** The delay its animation was given, in seconds. */
  readonly delay: () => number
}

/**
 * How far into its own run the client's first legs start, in seconds, read at their first tick:
 * where the CSS has got, less what the CSS waited that the client waits for itself. The CSS waited
 * its `animation-delay` and its rule's hold; the client's legs hold their transition's delay
 * (`clientDelay`, the stagger in it). The difference is a `when` wait, which the client has already
 * waited.
 */
export const startAtOf = (handoff: Handoff, ownTransition: WardicTransition | undefined, clientDelay: number) => (): number =>
  handoff.elapsed() - handoff.delay() - heldInRule(ownTransition) + clientDelay
