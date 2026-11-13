/**
 * **Timeline values** (#240, ADR-0043 *Amendment (#240)*): what an element's spine tells of its keys,
 * and the service that runs their Timeline values, which the `scroll` Feature gives. Only the type and
 * the key are here, on every element's path: the code is the Feature's (`features/timeline-keys.ts`), so
 * an app that reads no scroll ships none of it.
 *
 * @module
 */
import type * as FlushGate from "@wardic/dom/FlushGate"
import * as Context from "effect/Context"
import type { LiveStyle } from "./live-style.ts"
import type { WardicRuntime } from "./runtime.ts"

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
  readonly runtime: WardicRuntime
  readonly gate: FlushGate.Shape
  readonly id: string
  readonly element: HTMLElement
  /** Its routed `style` keys: each key's Atom, which describes its derivation. */
  readonly live: LiveStyle
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
>()("@wardic/solid/Timelines") {}
