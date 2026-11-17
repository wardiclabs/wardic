/**
 * Presence on Foldkit (ADR-0071 decision 29; *Amendment (#791)* at slice 2): `w.Presence(options)` on
 * the leavers' parent. Its element's Mount runs dom's presence controller over one `MutationObserver`
 * on the element's child list. Each delivery, a microtask after Foldkit's patch (P8), puts back each
 * known child the patch took out, where it was; asks the controller what goes on the page (`shown`:
 * under `mode="wait"` an entering child is held, hidden with `display: none`, until the last leaver is
 * gone, P23); starts the children mounted since the last delivery; and tells the controller what's
 * present, which retains each leaver at Motion's place and plays its exit (#675's placement is P19's).
 * A child under a presence starts in that delivery, not in its own Mount: take-overs (#286) and holds
 * are decided in `shown`, after Foldkit has mounted the child and before anything of it animates.
 *
 * @module
 */
import * as PresenceRecord from "@wardic/core/unstable/PresenceRecord"
import type * as PresenceController from "@wardic/dom/unstable/PresenceController"
import * as Keys from "@wardic/dom/unstable/features/Keys"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { constTrue, constVoid, identity } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Ward from "../Ward.ts"
import { deliveredTo, hintFrame } from "./delivery.ts"
import { configOf, dispatcherOf } from "./element.ts"
import { PresenceMaker, type PresenceMakerShape } from "./keys.ts"
import { featureIn, type Provider, type State } from "./services.ts"
import { nearestPresenceElement } from "./tree.ts"

/** A child's start, deferred to its presence's next delivery: begun there, or once shown under `wait`; released by its Mount's destroy. */
interface Pending {
  readonly element: HTMLElement
  /** Starts the child; returns its release. */
  readonly begin: () => () => void
  release: (() => void) | undefined
  /** Cancels its hold, while `wait` holds it. */
  cancel: (() => void) | undefined
  /** Its Mount destroyed before it began. */
  gone: boolean
}

/** A `w.Presence` element's presence: what its children register with, and what its own Mount runs. */
export interface Presence {
  /** The controller's context: what a child's spine registers its record with. */
  readonly context: PresenceController.PresenceContextValue
  /** A child's start, enrolled for the next delivery; returns the child's release. */
  readonly enroll: (element: HTMLElement, begin: () => () => void) => () => void
  /** The presence element's own Mount runs it: the observer, the first delivery, the Messages; returns the release. */
  readonly mount: (paused: () => boolean, offer: (message: unknown) => void) => () => void
}

// Module state (#460, Q7): each presence element's presence, held weakly by the element.
const presences = new WeakMap<Element, Presence>()

/** Development's word on `w.Presence` without its Feature (#792, Q9). */
const MISSING = 'wardic: w.Presence needs the `presence` Feature, which this Handle doesn\'t have. Add it: `import { Features } from "@wardic/foldkit"`, then `Wardic.make({ env, features: [Features.presence] })`.'

/** No options: `w.Presence()`. */
const NO_OPTIONS: Ward.PresenceOptions<unknown> = {}

/** The elements of what the controller's `shown` returns: a node, a flat list, or none. */
const elementsOf = (shown: unknown): ReadonlyArray<HTMLElement> => Arr.filter(Arr.ensure(shown), (node): node is HTMLElement => node instanceof HTMLElement)

/**
 * The presence of the nearest `w.Presence` above `element`, made at the first ask (a child's Mount, or
 * the presence element's own); none with no presence above, or when the Handle lacks the Feature.
 */
export const nearestPresence = (provider: Provider, state: State, element: Element): Presence | undefined =>
  UndefinedOr.match(nearestPresenceElement(element), { onUndefined: () => undefined, onDefined: (owner) => presenceOf(provider, state, owner) })

/** `element`'s presence, it carrying `w.Presence`: the known one, else made now; none without the Feature, warned once. */
const presenceOf = (provider: Provider, state: State, element: HTMLElement): Presence | undefined => {
  const known = presences.get(element)
  if (Predicate.isNotUndefined(known)) return known
  const maker = featureIn(provider, state, PresenceMaker)
  if (Predicate.isUndefined(maker)) {
    provider.registry.warnOnce("presence", MISSING)
    return undefined
  }
  const made = makePresence(provider, state, maker, element)
  presences.set(element, made)
  return made
}

/**
 * Run the presence of `element` when it carries `w.Presence` (its own Mount, after `mountElement`):
 * nothing for an element without one. Returns the release.
 */
export const mountPresence = (provider: Provider, state: State, element: HTMLElement, paused: () => boolean, offer: (message: unknown) => void): (() => void) => {
  if (Predicate.isUndefined(configOf(deliveredTo(element)).presence)) return constVoid
  return UndefinedOr.match(presenceOf(provider, state, element), { onUndefined: () => constVoid, onDefined: (presence) => presence.mount(paused, offer) })
}

/** Put `node` back where Foldkit took it from (P8): before the node after it, if still a child of `parent`; else after the one before; else at the end. */
const placeBack = (parent: HTMLElement, node: Element, record: MutationRecord): void => {
  const next = record.nextSibling
  if (Predicate.isNotNull(next) && next.parentNode === parent) {
    parent.insertBefore(node, next)
    return
  }
  const previous = record.previousSibling
  if (Predicate.isNotNull(previous) && previous.parentNode === parent) {
    parent.insertBefore(node, previous.nextSibling)
    return
  }
  parent.appendChild(node)
}

/** The presence of one `w.Presence` element (above). */
const makePresence = (provider: Provider, state: State, maker: PresenceMakerShape, element: HTMLElement): Presence => {
  const optionsNow = (): Ward.PresenceOptions<unknown> => UndefinedOr.match(configOf(deliveredTo(element)).presence, { onUndefined: () => NO_OPTIONS, onDefined: identity })
  // What its Mount gives it when it runs, after its children's Mounts: until then, no Message leaves.
  let paused: () => boolean = constTrue
  let offer: (message: unknown) => void = constVoid
  const pending: Array<Pending> = []
  // The children `wait` holds, each with the `display` it had.
  const hidden = new Map<HTMLElement, string>()
  // Foldkit's children as of the last delivery: a removed one of them is a leaver to put back.
  let known = new Set<Element>()
  let observer: MutationObserver | undefined
  const dispatch = dispatcherOf((message) => offer(message))
  // `onExitComplete` as a Message (decision 23), read when the last leaver has gone; none under replay (decision 34).
  const exitCompleteOf = (): (() => void) | undefined => {
    if (paused()) return undefined
    return UndefinedOr.map(optionsNow().onExitComplete, (handler) => () => dispatch(handler)(undefined))
  }
  const controller = maker.make({
    runtime: provider.runtime,
    renderer: provider.renderer,
    projection: () => Keys.projectionIn(provider.registry.built()),
    reducedMotion: provider.reducedMotion,
    positionalKeys: provider.positionalKeys,
    defaultTransition: provider.defaultTransition,
    initial: () => optionsNow().initial,
    events: maker.events(provider.runtime, exitCompleteOf),
    mode: () => optionsNow().mode,
    custom: () => optionsNow().custom,
    anchorX: () => optionsNow().anchorX,
    anchorY: () => optionsNow().anchorY,
    presenceAffectsLayout: () => optionsNow().presenceAffectsLayout,
    // The last leaver has gone: the children `wait` held go on the page.
    release: () => deliver([], false),
  })
  // `propagate` (Motion's): under a presence above, read once, as Solid's.
  const tear = maker.propagateTo(UndefinedOr.map(nearestPresence(provider, state, element), (above) => above.context), optionsNow().propagate === true, controller)

  const hide = (child: HTMLElement): void => {
    if (hidden.has(child)) return
    hidden.set(child, child.style.display)
    child.style.display = "none"
  }
  const show = (child: HTMLElement): void => {
    UndefinedOr.map(hidden.get(child), (was) => {
      hidden.delete(child)
      child.style.display = was
    })
  }
  /** The known children `records` say Foldkit took out, each put back where it was: the change's leavers. */
  const putBack = (records: ReadonlyArray<MutationRecord>): Set<Element> => {
    const leavers = new Set<Element>()
    Arr.forEach(records, (record) => {
      Arr.forEach(Array.from(record.removedNodes), (removed) => {
        if (Bool.not(removed instanceof Element)) return
        const node = removed as Element
        if (node.isConnected) return
        if (Bool.not(known.has(node))) return
        if (leavers.has(node)) return
        leavers.add(node)
        placeBack(element, node, record)
      })
    })
    return leavers
  }
  /** The children `records` say Foldkit put in, still on the page: the change's enterers (a moved child among them). */
  const added = (records: ReadonlyArray<MutationRecord>): Set<Element> => {
    const enterers = new Set<Element>()
    Arr.forEach(records, (record) => {
      Arr.forEach(Array.from(record.addedNodes), (node) => {
        if (Bool.not(node instanceof Element)) return
        if ((node as Element).isConnected) enterers.add(node as Element)
      })
    })
    return enterers
  }
  /** A child's start, now, or once `wait` shows it. */
  const start = (child: Pending): void => {
    if (child.gone) return
    const begun = (): void => {
      child.cancel = undefined
      child.release = child.begin()
    }
    child.cancel = PresenceRecord.presenceHold(controller.context, child.element, begun)
    if (Predicate.isUndefined(child.cancel)) begun()
  }
  /** A delivery (above): after a patch, or at the mount, or as the last leaver goes. */
  const deliver = (records: ReadonlyArray<MutationRecord>, hint: boolean): void => {
    // The exits and the starts take their first step in this frame (decision 32; #792, Q7); not at the mount, nor under replay.
    if (Bool.and(hint, Bool.not(paused()))) hintFrame(provider.loop)
    const leavers = putBack(records)
    const enterers = added(records)
    // Foldkit's children now: the known ones it kept, and the ones it put in; not a leaver the controller retains.
    const current = Arr.filter(Array.from(element.children), (child): child is HTMLElement => Bool.and(child instanceof HTMLElement, Bool.or(Bool.and(known.has(child), Bool.not(leavers.has(child))), enterers.has(child))))
    const onPage = new Set(elementsOf(controller.shown(current)))
    Arr.forEach(current, (child) => Bool.match(onPage.has(child), { onTrue: () => show(child), onFalse: () => hide(child) }))
    Arr.forEach(pending.splice(0), start)
    controller.present(Arr.filter(current, (child) => onPage.has(child)))
    known = new Set(current)
    // Its own moves, and the controller's, make records too: dropped, so they deliver nothing (P19).
    UndefinedOr.map(observer, (watching) => watching.takeRecords())
  }

  return {
    context: controller.context,
    enroll: (child, begin) => {
      const entry: Pending = { element: child, begin, release: undefined, cancel: undefined, gone: false }
      pending.push(entry)
      return () => {
        entry.gone = true
        UndefinedOr.map(entry.cancel, (cancel) => cancel())
        UndefinedOr.map(entry.release, (release) => release())
      }
    },
    mount: (isPaused, offerMessage) => {
      paused = isPaused
      offer = offerMessage
      observer = new MutationObserver((records) => deliver(records, true))
      observer.observe(element, { childList: true })
      // The first delivery, inside the patch: every child is Foldkit's; those mounted with the presence start, and `initial: false` covers them.
      known = new Set(Array.from(element.children))
      deliver([], false)
      controller.mounted()
      return () => {
        UndefinedOr.map(observer, (watching) => watching.disconnect())
        observer = undefined
        tear()
        presences.delete(element)
      }
    },
  }
}
