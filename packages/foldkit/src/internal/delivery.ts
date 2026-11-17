/**
 * The **Delivery** (ADR-0071, decision 20): how each render's config reaches a mounted element. A `w.*`
 * element renders its folded config as one `wardic` property, minted by a `CustomElement.define`
 * spec's property factory, the public way to a `Prop` attribute (P6). Foldkit's props module writes
 * the property at `create` and again on each render whose value is a fresh reference, parent first.
 * At mount, the element's Mount puts an accessor on the property, so each later write is a setter call
 * inside the patch, where the element Retargets (#791, Q14).
 *
 * The patch's microtask (#791, Q25): the first setter call of a patch, or its first Mount insert,
 * queues one microtask, which runs after the whole patch and before paint: the `Reactivity` port's
 * watches re-read there (decision 17), then slice 1's PR 3 adds the held-frame hint.
 *
 * @module
 */
import type * as FrameLoop from "@wardic/core/FrameLoop"
import * as CustomElement from "foldkit/customElement"
import type { Attribute, HtmlBuilder } from "foldkit/html"
import * as Schema from "effect/Schema"
import * as Predicate from "effect/Predicate"
import { recheck } from "./reactivity.ts"

/** The property an element's config is delivered through. */
const KEY = "wardic"

// Schema, where Foldkit's API asks for it (ADR-0071, decision 14): a `CustomElement.define` spec types
// each property with one. Its value is never decoded: the config is Wardic's own, checked by hand.
/** The spec whose `Wardic` factory builds the `wardic` property attribute, for any element. */
const spec = /*#__PURE__*/ CustomElement.define({ tag: "wardic-element", properties: { [KEY]: Schema.Unknown }, events: {} })

/** The factory for `h`'s Message: `withMessage` is a type witness, minted once per builder. */
// Module state (#460, Q7): a cache keyed by the builder it's minted for.
const factories = new WeakMap<object, (value: unknown) => Attribute<never>>()

/** The `wardic` property attribute carrying `config`, for a view built with `h`. */
export const propertyOf = <Message>(h: HtmlBuilder<Message>, config: object): Attribute<Message> => {
  let factory = factories.get(h)
  if (Predicate.isUndefined(factory)) {
    factory = spec.withMessage(h).Wardic as (value: unknown) => Attribute<never>
    factories.set(h, factory)
  }
  return factory(config) as Attribute<Message>
}

/** An element with its `wardic` property, as the props module writes it. */
interface Delivered {
  [KEY]?: unknown
}

/** The config last delivered to `element`: what the props module wrote at `create`, or a setter took since. */
export const deliveredTo = (element: Element): unknown => (element as Delivered)[KEY]

/**
 * An accessor for the `wardic` property on `element`, over the value the props module wrote at
 * `create`: every later write calls `onSet`, inside the patch. Returns the release, which puts the
 * plain property back with its last value.
 */
export const installSetter = (element: Element, onSet: (value: unknown) => void): (() => void) => {
  const target = element as Delivered
  let value = target[KEY]
  Object.defineProperty(target, KEY, {
    configurable: true,
    enumerable: true,
    get: () => value,
    set: (next: unknown) => {
      value = next
      onSet(next)
    },
  })
  return () => {
    delete target[KEY]
    target[KEY] = value
  }
}

// Module state (#460, Q7): whether this patch's microtask is queued, cleared when it runs.
let queued = false

/** What the patch's microtask does: the watches, then (PR 3) the held-frame hint. */
const afterPatch = (): void => {
  queued = false
  recheck()
}

/**
 * A patch touched the page: a setter call, or a Mount's insert. Queues the patch's microtask, once per
 * patch, however many elements say so. A plain `queueMicrotask`: core's end-of-task checkpoint.
 */
export const patchTouched = (): void => {
  if (queued) return
  queued = true
  queueMicrotask(afterPatch)
}

/** The frame's time, as every rAF callback of a frame sees it: what the hint compares the last tick's with. */
const frameTime = (): number => Number(document.timeline.currentTime)

/**
 * The binding's hint (ADR-0071, decision 32; #673's deferred rule): a setter runs inside Foldkit's
 * patch, a Refresh frame callback after Wardic's tick, so the Frame loop opens its Late window for the
 * Retargets the patch makes, and they paint in this frame rather than the next. Called before the
 * Retarget, after {@link patchTouched}, so the window's microtask runs after the patch's. Not for a
 * replay's patch, which runs in a task (P6): the time read there is a past frame's.
 */
export const hintFrame = (loop: FrameLoop.FrameLoop["Service"]): void => {
  loop.hint(frameTime())
}

/** The hint (above), unless DevTools replay has the view (decision 34), whose patch runs in a task and lands everything at once. */
export const hintFrameUnless = (loop: FrameLoop.FrameLoop["Service"], paused: () => boolean): void => {
  if (paused()) return
  hintFrame(loop)
}
