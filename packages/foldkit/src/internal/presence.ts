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
import { constFalse, constTrue, constVoid, identity } from "effect/Function"
import * as Iter from "effect/Iterable"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Ward from "../Ward.ts"
import { deliveredTo, hintFrameUnless } from "./delivery.ts"
import { configOf, dispatcherOf } from "./element.ts"
import { PresenceMaker, type PresenceMakerShape } from "./keys.ts"
import { quietLayoutIn } from "./layout.ts"
import { featureIn, type LivePresence, type Provider, type State } from "./services.ts"
import { isMounted, nearestPresenceElement } from "./tree.ts"
import { DEV } from "@wardic/foldkit/internal/dev"

/** A child's start, deferred to its presence's next delivery: begun there, or once shown under `wait`; released by its Mount's destroy. */
interface Pending {
  readonly element: Element
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
  readonly enroll: (element: Element, begin: () => () => void) => () => void
  /** The presence element's own Mount runs it: the observer, the first delivery, the Messages; returns the release. */
  readonly mount: (paused: () => boolean, offer: (message: unknown) => void) => () => void
  /** Whether it is a `w.Presence({ initial: false })` ({@link holdsInitial}), as its options stand now. */
  readonly holds: () => boolean
}

// Module state (#460, Q7): each presence element's presence, held weakly by the element.
const presences = new WeakMap<Element, Presence>()

/** Development's word on `w.Presence` without its Feature (#792, Q9). */
const MISSING = 'wardic: w.Presence needs the `presence` Feature, which this Handle doesn\'t have. Add it: `import { Features } from "@wardic/foldkit"`, then `Wardic.make({ env, features: [Features.presence] })`.'

/** Development's word on `w.Presence` given to an element after its first render: its Mount is made once, so the presence never runs. */
const LATE = "wardic: w.Presence was added to an element already mounted, whose Mount runs without it: its children animate with no presence. Give w.Presence on the element's first render, or key the element so it's made again."

/** No options: `w.Presence()`. */
const NO_OPTIONS: Ward.PresenceOptions<unknown> = {}

/**
 * Whether a `w.Presence` with `options` holds the children of its first render at their `Animate`
 * (`initial: false`, #134): what the walk at a provider element's build writes for them (#794), and what
 * their Mounts start them at while that render is the presence's first (dom's `blocksInitial`).
 */
export const holdsInitial = (options: Ward.PresenceOptions<unknown> | undefined): boolean => UndefinedOr.match(options, { onUndefined: constFalse, onDefined: (given) => given.initial === false })

/** Whether a node is an element: what a presence's children and leavers are (text is never one). */
const isElement = (node: unknown): node is Element => node instanceof Element

/** An element with an inline style: HTML, SVG and MathML elements, which `wait` hides through it. */
type Styled = Element & ElementCSSInlineStyle

/** Whether an element has an inline style to hide it through. */
const isStyled = (node: unknown): node is Styled => Bool.and(isElement(node), Predicate.hasProperty(node, "style"))

/** The elements of what the controller's `shown` returns: a node, a flat list, or none. */
const elementsOf = (shown: unknown): ReadonlyArray<Element> => Arr.filter(Arr.ensure(shown), isElement)

/**
 * The presence of the nearest `w.Presence` above `element`, made at the first ask (a child's Mount, or
 * the presence element's own); none with no presence above, or when the Handle lacks the Feature.
 */
export const nearestPresence = (provider: Provider, state: State, element: Element): Presence | undefined =>
  UndefinedOr.match(nearestPresenceElement(element), { onUndefined: () => undefined, onDefined: (owner) => presenceOf(provider, state, owner, false) })

/**
 * `element`'s presence, it carrying `w.Presence`: the known one, else made now, by its own Mount (`own`)
 * or by a child's first. None without the Feature, warned once; and none when a child asks for one on an
 * element whose Mount has already run without it (a later render's `w.Presence`), warned once in
 * development: the child then starts as it would with no presence above.
 */
const presenceOf = (provider: Provider, state: State, element: Element, own: boolean): Presence | undefined => {
  const known = presences.get(element)
  if (Predicate.isNotUndefined(known)) return known
  // Its Feature may be on its way (#793, Q15): nothing said, and the element's own Mount makes it as it arrives.
  const pending = provider.features.pending()
  if (Bool.and(Bool.not(own), isMounted(element))) {
    if (DEV && Bool.not(pending)) provider.registry.warnOnce("presence-late", LATE)
    return undefined
  }
  const maker = featureIn(provider, PresenceMaker)
  if (Predicate.isUndefined(maker)) {
    if (Bool.not(pending)) provider.registry.warnOnce("presence", MISSING)
    return undefined
  }
  const made = makePresence(provider, state, maker, element)
  presences.set(element, made)
  return made
}

/**
 * Run the presence of `element` when it carries `w.Presence` (its own Mount, after `mountElement`):
 * nothing for an element without one. With its Feature on its way in a load (#793, Q15), made and run
 * as it arrives: the children mounted before then started with no presence, those after enroll.
 * Returns the release.
 */
export const mountPresence = (provider: Provider, state: State, element: Element, paused: () => boolean, offer: (message: unknown) => void): (() => void) => {
  if (Predicate.isUndefined(configOf(deliveredTo(element)).presence)) return constVoid
  const made = presenceOf(provider, state, element, true)
  if (Predicate.isNotUndefined(made)) return made.mount(paused, offer)
  if (Bool.not(provider.features.pending())) return constVoid
  const release = MutableRef.make<() => void>(constVoid)
  const stopRechecks = provider.onFeatures(() => {
    UndefinedOr.map(presenceOf(provider, state, element, true), (presence) => {
      MutableRef.set(release, presence.mount(paused, offer))
      stopRechecks()
    })
  })
  return () => {
    stopRechecks()
    MutableRef.get(release)()
  }
}

/** Put `node` back where Foldkit took it from (P8): before the node after it, if still a child of `parent`; else after the one before; else at the end. */
const placeBack = (parent: Element, node: Element, record: MutationRecord): void => {
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

/** What a delivery's records say Foldkit took out: the change's leavers, put back, and the held children dropped. */
interface TakenOut {
  readonly leavers: ReadonlySet<Element>
  readonly dropped: number
}

/** The presence of one `w.Presence` element (above). */
const makePresence = (provider: Provider, state: State, maker: PresenceMakerShape, element: Element): Presence => {
  const optionsNow = (): Ward.PresenceOptions<unknown> => UndefinedOr.match(configOf(deliveredTo(element)).presence, { onUndefined: () => NO_OPTIONS, onDefined: identity })
  // What its Mount gives it when it runs, after its children's Mounts: until then, no Message leaves.
  let paused: () => boolean = constTrue
  let offer: (message: unknown) => void = constVoid
  const pending: Array<Pending> = []
  // The children `wait` holds, each with the `display` it had.
  const hidden = new Map<Styled, string>()
  // Foldkit's children as of the last delivery: a removed one of them is a leaver to put back.
  let known = new Set<Element>()
  let observer: MutationObserver | undefined
  let torn = false
  const dispatch = dispatcherOf((message) => offer(message))
  /** Whether its children's going and coming moves the `layout` elements around them (Motion's `presenceAffectsLayout`), `true` unless told otherwise. */
  const affectsLayout = (): boolean => optionsNow().presenceAffectsLayout !== false
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
    // The last leaver has gone: the children `wait` held go on the page, in a delivery of their own. A
    // microtask later, not now: a take-over ends the last exit inside `shown` or `present` (dom's
    // `leaveEnds`), where a delivery can't run; Solid's release is a signal, read later, for the same reason.
    release: () => {
      queueMicrotask(() => deliver([], true))
    },
  })
  // `propagate` (Motion's): under a presence above, read once, as Solid's.
  const tearDown = maker.propagateTo(UndefinedOr.map(nearestPresence(provider, state, element), (above) => above.context), optionsNow().propagate === true, controller)

  const hide = (child: Element): void => {
    Option.map(Option.liftPredicate(child, isStyled), (styled) => {
      if (hidden.has(styled)) return
      hidden.set(styled, styled.style.display)
      styled.style.display = "none"
    })
  }
  const show = (child: Element): void => {
    Option.map(Option.liftPredicate(child, isStyled), (styled) => {
      UndefinedOr.map(hidden.get(styled), (was) => {
        hidden.delete(styled)
        styled.style.display = was
      })
    })
  }
  /**
   * The known children `records` say Foldkit took out, each put back where it was: the change's
   * leavers. A held child it took out never showed: dropped, with no exit (P23's W3), not put back.
   */
  const takenOut = (records: ReadonlyArray<MutationRecord>): TakenOut => {
    const leavers = new Set<Element>()
    let dropped = 0
    Iter.forEach(records, (record) => {
      Iter.forEach(record.removedNodes, (removed) => {
        Option.map(Option.liftPredicate(removed, isElement), (node) => {
          if (node.isConnected) return
          if (isStyled(node) && hidden.has(node)) {
            hidden.delete(node)
            known.delete(node)
            dropped++
            return
          }
          if (Bool.not(known.has(node))) return
          if (leavers.has(node)) return
          leavers.add(node)
          placeBack(element, node, record)
        })
      })
    })
    return { leavers, dropped }
  }
  /** The children `records` say Foldkit put in, still on the page: the change's enterers (a moved child among them). */
  const putIn = (records: ReadonlyArray<MutationRecord>): Set<Element> => {
    const enterers = new Set<Element>()
    Iter.forEach(records, (record) => {
      Iter.forEach(record.addedNodes, (added) => {
        Option.map(Option.liftPredicate(added, isElement), (node) => {
          if (node.isConnected) enterers.add(node)
        })
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
  /**
   * What the Handle calls on it (#840): its children measured where they are, ahead of a patch, which
   * `popLayout` pins the next change's leavers at; and its delivery run now, from the records its observer
   * holds, ahead of a Mount, since a presence inside an entering child starts that child's elements at its
   * own mount, inside the patch's task, before this presence's observer is told, and a `layoutId` twin
   * starting then measures the one it takes over from, in a leaver this presence hasn't pinned yet.
   */
  const live: LivePresence = {
    snapshot: () => {
      if (optionsNow().mode !== "popLayout") return
      controller.snapshot(Arr.filter(Arr.fromIterable(element.children), (child) => known.has(child)))
    },
    flush: () => {
      UndefinedOr.map(observer, (watching) => {
        const records = watching.takeRecords()
        if (records.length === 0) return
        deliver(records, true)
        // The patch's children whose Mounts come after the one that flushed enroll after this delivery: started a microtask on, where the observer's delivery would have.
        queueMicrotask(() => {
          if (pending.length > 0) deliver([], true)
        })
      })
    },
  }
  /** A delivery (above): after a patch, at the mount, or as the last leaver goes. */
  const deliver = (records: ReadonlyArray<MutationRecord>, hint: boolean): void => {
    if (torn) return
    state.snapshotting = false
    const { leavers, dropped } = takenOut(records)
    const enterers = putIn(records)
    // Records of the controller's own removals alone (an exit's end, after its delivery): nothing of Foldkit's changed.
    if (Bool.and(records.length > 0, Bool.and(leavers.size === 0, Bool.and(enterers.size === 0, dropped === 0)))) return
    // The exits and the starts take their first step in this frame (decision 32; #792, Q7); not at the mount, nor under replay.
    if (hint) hintFrameUnless(provider.loop, paused)
    // Foldkit's children now: the known ones it kept, and the ones it put in; not a leaver the controller retains.
    const current = Arr.filter(Arr.fromIterable(element.children), (child) => Bool.or(Bool.and(known.has(child), Bool.not(leavers.has(child))), enterers.has(child)))
    const onPage = new Set(elementsOf(controller.shown(current)))
    Arr.forEach(current, (child) => Bool.match(onPage.has(child), { onTrue: () => show(child), onFalse: () => hide(child) }))
    // Told not to affect layout (Motion's `presenceAffectsLayout: false`): its child list's changes make no pass either (#792, Q21).
    quietLayoutIn(element, Bool.not(affectsLayout()))
    controller.present(Arr.filter(current, (child) => onPage.has(child)))
    // The children start once the leavers are retained and a `popLayout` one is pinned (#840): a child
    // taking over a `layoutId` twin inside a leaver measures the twin as it starts, where the leaver is
    // then, which before the pin is where the patch pushed it. Solid's children start after its presence
    // has placed its leavers too.
    Arr.forEach(pending.splice(0), start)
    known = new Set(current)
    // Its own moves, and the controller's, make records too: dropped, so they deliver nothing (P19).
    UndefinedOr.map(observer, (watching) => watching.takeRecords())
  }

  return {
    context: controller.context,
    holds: () => holdsInitial(optionsNow()),
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
      state.presences.add(live)
      // The first delivery, inside the patch: every child is Foldkit's; those mounted with the presence start, and `initial: false` covers them.
      known = new Set(Arr.fromIterable(element.children))
      deliver([], false)
      controller.mounted()
      return () => {
        torn = true
        state.presences.delete(live)
        UndefinedOr.map(observer, (watching) => watching.disconnect())
        observer = undefined
        tearDown()
        quietLayoutIn(element, false)
        presences.delete(element)
      }
    },
  }
}
