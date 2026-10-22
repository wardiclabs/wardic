/**
 * What a Wardic element and its `<AnimatePresence>` share (ADR-0007): the record a child registers,
 * and the presence's context value. Solid-free, so both bindings' spines write the same record (#209).
 *
 * @module
 */
import type * as Values from "@wardic/core/Values"
import type { WardicTransition } from "./config.ts"
import { constFalse } from "effect/Function"
import * as UndefinedOr from "effect/UndefinedOr"

/**
 * A child's live presence registration. `snapshot` / `exit` are MUTABLE ref
 * cells (`{ current }`) the child's spine writes to while alive; they outlive
 * the child's owner so the parent-driven exit reads them after the child leaves.
 */
export interface PresenceRecord {
  /** The child's root DOM element (the same `el` the spine wires). */
  readonly element: HTMLElement
  /** The latest emitted value-map, updated by the spine each frame. */
  readonly snapshot: { current: Values.Values }
  /**
   * The exit, resolved as the child leaves (#277): its target, a variant name or a dynamic variant
   * resolved with `custom` (the presence's, when it has one, else the child's last), and the
   * transition it runs on. The child keeps what it's resolved from current while alive.
   */
  readonly exitOf: (custom: unknown, inherited: string | undefined) => PresenceExit
  /**
   * Where it sits in the variant tree (#290), decided at setup as the tree is: whether it joins the
   * nearest element that provides a context (a **Variant child**, which then exits on that one's
   * exit name, in its stagger), whether its own Variant children join it, and whether it's a twin
   * (a `layoutId`, whose crossfade replaces its exit). Left out: none of them.
   */
  readonly tree?: PresenceTree
  /**
   * Where an exit key with no value in `snapshot` starts (ADR-0022): its `style` value, else
   * the element's Own value, read from the retained node at the exit, in the shape of `like`
   * (the key's exit target). `undefined` starts it at its target. Optional: a record without
   * it starts such a key at its target.
   */
  readonly startOf?: ((key: string, like: number | string) => number | string | undefined) | undefined
}

/** A child's exit, resolved as it leaves (#277): its values, and the transition it runs on. */
export interface PresenceExit {
  readonly values: Values.Values
  readonly transition: WardicTransition | undefined
  /** The exit name it hands its Variant children (#290): its own `exit`, if a name, else the one it took. */
  readonly name: string | undefined
}

/** A record's place in the variant tree (#290, {@link PresenceRecord.tree}). */
export interface PresenceTree {
  readonly joins: boolean
  readonly provides: boolean
  readonly twin: boolean
}

/** The value `<AnimatePresence>` publishes to descendant `createWard` spines. */
export interface PresenceContextValue {
  /**
   * Register a child's live record. Returns a disposer the registrant MAY call,
   * but the child does NOT call it on its own `onCleanup` — `<AnimatePresence>`
   * removes the registration after the exit completes.
   */
  readonly register: (rec: PresenceRecord) => () => void
  /**
   * Whether an element setting up now starts at its `animate`, with nothing animating at mount:
   * `<AnimatePresence initial={false}>`, during its first render (#134, Motion's
   * `presenceContext.initial`). A child that enters later animates in. Optional: left out, never.
   */
  readonly blocksInitial?: () => boolean
  /**
   * Whether an element setting up now is inside a child `mode="wait"` holds off the page (#277,
   * ADR-0048): `undefined` when it isn't, and it starts now. Else `start` is called once the child is
   * on the page, and the call returned cancels that (the element gone first). Optional: left out, never.
   */
  readonly hold?: (el: HTMLElement, start: () => void) => (() => void) | undefined
  /**
   * A presence hook's registration (#277's PR 5b, ADR-0048): `usePresence`'s and `useIsPresent`'s.
   * Optional: left out, nothing is watched.
   */
  readonly watch?: (watch: PresenceWatch) => void
  /** The presence's `custom` (#277's PR 5b), reactive: `usePresenceData`'s. Left out, `undefined`. */
  readonly data?: () => unknown
}

/**
 * What a presence hook registers (#277's PR 5b, ADR-0048): its element, whose leaving child it
 * belongs to, and what it's told. Kept until that child goes, the presence goes, or its element
 * leaves the page some other way.
 */
export interface PresenceWatch {
  /** Its element, once it has one: the child that holds it is the one it belongs to. */
  readonly element: () => Element | undefined
  /** Whether it holds its child as it leaves, until `release` is called (`usePresence`). */
  readonly holds: boolean
  /**
   * Its child left: called once, with the node back in place (or popped, `mode="popLayout"`), with
   * the presence's `custom`, and `release`, which lets the child go once it holds it.
   */
  readonly leave: (custom: unknown, release: () => void) => void
  /** Its child went some other way, or the presence did: it's dropped, with no leave. */
  readonly gone: () => void
}

/** Whether `presence` holds an element setting up now at its `animate` ({@link PresenceContextValue.blocksInitial}). */
export const presenceBlocksInitial = (presence: PresenceContextValue | undefined): boolean =>
  UndefinedOr.match(presence, {
    onUndefined: constFalse,
    onDefined: (p) => UndefinedOr.match(p.blocksInitial, { onUndefined: constFalse, onDefined: (blocks) => blocks() }),
  })

/**
 * Whether `el` waits for its child to go on the page ({@link PresenceContextValue.hold}): the call
 * that cancels `start`, or `undefined` when it starts now.
 */
export const presenceHold = (presence: PresenceContextValue | undefined, el: HTMLElement, start: () => void): (() => void) | undefined =>
  UndefinedOr.map(presence, (p) => UndefinedOr.map(p.hold, (hold) => hold(el, start)))
