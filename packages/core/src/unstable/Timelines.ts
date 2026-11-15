/**
 * **Timeline values** (#240, ADR-0043 *Amendment (#240)*): what an element's spine tells of its keys,
 * and the service that runs their Timeline values, which a binding's `scroll` Feature gives. Only the
 * type and the key are here, on every element's path: the code is the Feature's, so an app that reads
 * no scroll ships none of it.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672 (Q15): solid's `timelines.ts`, moved for the spine to tell its keys'
// Timeline values in core; its options' element a Subject, its runtime a Runner.
import type * as FlushGate from "./FlushGate.ts"
import * as Context from "effect/Context"
import type * as Atom from "effect/reactivity/Atom"
import type * as Subject from "./Subject.ts"
import type * as WardicServices from "./WardicServices.ts"

/** An element's keys' Timeline values, as its spine tells of them. */
export interface TimelineKeys {
  /** The element shows `key`'s Live value: its Timeline value runs, when it has one. */
  readonly shown: (key: string) => void
  /** Something else draws `key` now (an entry, a drag, an Imperative animation), or it left the `style`: its Timeline value stops. */
  readonly taken: (key: string) => void
  /** The element's unmounted: it's no longer told of a value described. */
  readonly dispose: () => void
}

/** What an element's {@link TimelineKeys} are made with. */
export interface TimelineKeysOptions {
  readonly runtime: WardicServices.Runner<WardicServices.WardicServices>
  readonly gate: FlushGate.Shape
  readonly id: string
  readonly element: Subject.Subject
  /** Its routed `style` keys: each key's Atom, which describes its derivation. */
  readonly live: LiveAtoms
}

/** What an element's Timeline values read of its Live values: a routed key's Atom, `undefined` for one not routed. */
// #672: the one member the Timelines' keys call of the spine's LiveRoutes, which meets it; named here, so
// this module, which the spine imports, imports nothing of the spine's.
export interface LiveAtoms {
  readonly atomOf: (key: string) => Atom.Atom<unknown> | undefined
}

/**
 * The `scroll` Feature's Timeline values (#240), one per provider: an element's {@link TimelineKeys},
 * made at its first write of a Live value; and `described`, told by a `createScroll` that has described
 * its values (`LiveValue.derivesAs`), after the elements following them may have shown them, so each
 * key an element shows finds its Timeline value then, its value unchanged.
 */
export class Timelines extends /*#__PURE__*/ Context.Service<
  Timelines,
  {
    readonly keysOf: (options: TimelineKeysOptions) => TimelineKeys
    readonly described: () => void
  }
>()("@wardic/core/unstable/Timelines") {}
