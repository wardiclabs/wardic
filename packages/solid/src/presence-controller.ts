/**
 * `<AnimatePresence>`'s work (ADR-0007), Solid-free (#209): each leaving child's retained node, its
 * parent-driven exit, and the twins it hands back (ADR-0010 *Amendment (#181)*). Each binding's
 * `AnimatePresence` resolves its children with its own Solid and tells
 * {@link PresenceController.present} which are present after each change; see the Solid 1 binding's
 * `presence.tsx` for the doctrine.
 *
 * Many children (#277, ADR-0048): a child is its DOM node, so one that leaves is the node that left
 * the resolved children, each exiting on its own, in its place. A child that comes back mid-exit is
 * a new node, which enters beside the leaver while the leaver finishes (#286 would key them).
 *
 * `mode="wait"` (#277, ADR-0048): while a child exits, one entering is held off the page, its wards
 * not started, and goes on it once the last leaver is gone. Its framework has built it already, so
 * its own code has run; what waits is its place on the page and everything Wardic does with it.
 *
 * `mode="popLayout"` (#277, ADR-0048): a leaver is measured before the change and popped out of the
 * flow where it was (`position: absolute`, its size kept), so the children after it take their
 * places at once. Whatever the mode, the projection is told when a leaver is popped or removed, so
 * a `layout` sibling animates into the space, as Motion's presence re-renders its children then.
 *
 * @module
 */
import type * as Frame from "@wardic/core/Frame"
import type * as FrameLoop from "@wardic/core/FrameLoop"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as Renderer from "@wardic/core/Renderer"
import * as Values from "@wardic/core/Values"
import * as Machine from "@wardic/core/Machine"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Report from "@wardic/dom/Report"
import * as Variables from "@wardic/dom/Variables"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { constUndefined, constVoid, identity } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import type { PresenceContextValue, PresenceExit, PresenceRecord } from "./presence-record.ts"
import { type Leg, legsOf } from "./retarget-legs.ts"
import type { WardicRuntime, WardicServices } from "./runtime.ts"

/** Whether a value-map has any keys (an empty exit means "remove immediately"). */
const isEmpty = (values: Values.Values): boolean => Rec.isEmptyRecord(values)

/** An exit's spring: the defaults, one object, so core decodes it once (#66). */

/** No velocities: an exit starts each key at rest, as it did on its own spring. */
const NO_VELOCITIES: Readonly<Record<string, number>> = {}

/** One leg of an exit (#277), as the spine runs a Retarget's, committing onto the retained `el`. */
const exitRunOf = (leg: Leg, el: HTMLElement, commitFrame: FrameLoop.Sink<Frame.Frame<Values.Values>>): Effect.Effect<unknown, never, WardicServices> => {
  if (leg._tag === "Blend") {
    return Effect.suspend(leg.machine).pipe(InterpolatorRegistry.withKeyRules([Variables.values(el)]), Effect.flatMap(Machine.run(commitFrame)))
  }
  if (leg._tag === "Follow") {
    const key = leg.key
    return Effect.suspend(() => leg.machine().pipe(Machine.run((frame) => commitFrame({ ...frame, value: { [key]: frame.value } }))))
  }
  return Effect.suspend(() => (leg.machine() as Machine.Machine<Frame.Frame<Values.Values>>).pipe(Machine.run(commitFrame)))
}

/** Whether a resolved child is an element. Only called on the client, where `HTMLElement` exists. */
const isHTMLElement = (node: unknown): node is HTMLElement => node instanceof HTMLElement

/** The elements of what a binding's `children()` resolved: one node, a flat array, or none. */
const elementsOf = (resolved: unknown): ReadonlyArray<HTMLElement> => Arr.filter(Arr.ensure(resolved), isHTMLElement)

/** A child present at the last change: its element, and where it was then, to put it back as it leaves. */
interface Placed {
  readonly el: HTMLElement
  readonly parent: ParentNode | undefined
  readonly next: ChildNode | undefined
}

/** Where `el` is now. */
const placedOf = (el: HTMLElement): Placed => ({
  el,
  parent: Option.getOrUndefined(Option.fromNullOr(el.parentNode)),
  next: Option.getOrUndefined(Option.fromNullOr(el.nextSibling)),
})

/**
 * Where `popLayout` pins a leaver (#277, ADR-0048), measured before the change as Motion's `PopChild`
 * measures it: its size (`getComputedStyle`, so its own `box-sizing` reads it back), and its margin
 * box's offset from its containing block's padding edge, from the top and from its inline start (the
 * left, or the right in a right-to-left one). The offsets are whole pixels, the DOM's `offsetTop`.
 */
interface PopBox {
  readonly width: number
  readonly height: number
  readonly top: number
  readonly side: "left" | "right"
  readonly start: number
}

/** The width of the padding box `el`'s offsets are from: its offset parent's, or the viewport's. */
const containerWidthOf = (el: HTMLElement): number => {
  const parent = el.offsetParent
  if (isHTMLElement(parent) && parent !== document.body) return parent.clientWidth
  return document.documentElement.clientWidth
}

/** A px length of a computed style, `0` for none. */
const pxOf = (value: string): number => {
  const px = Number.parseFloat(value)
  if (Number.isNaN(px)) return 0
  return px
}

/**
 * Where `el` is now, to pop it (#277): `undefined` for one with no size of its own (an inline element,
 * or an empty one) or not on the page, which isn't popped, as Motion's.
 */
const popBoxOf = (el: HTMLElement): PopBox | undefined => {
  const style = getComputedStyle(el)
  const width = Number.parseFloat(style.width)
  const height = Number.parseFloat(style.height)
  if (Bool.not(Bool.and(width > 0, height > 0))) return undefined
  // Positioned by its margin box, as its offsets are its border box's.
  const top = el.offsetTop - pxOf(style.marginTop)
  if (style.direction === "rtl") {
    const start = containerWidthOf(el) - el.offsetLeft - el.offsetWidth - pxOf(style.marginRight)
    return { width, height, top, side: "right", start }
  }
  return { width, height, top, side: "left", start: el.offsetLeft - pxOf(style.marginLeft) }
}

/** Pin a leaver where `box` measured it, out of the flow, over any style of its own. */
const pin = (el: HTMLElement, box: PopBox): void => {
  const style = el.style
  style.setProperty("position", "absolute", "important")
  style.setProperty("width", `${box.width}px`, "important")
  style.setProperty("height", `${box.height}px`, "important")
  style.setProperty("top", `${box.top}px`, "important")
  style.setProperty(box.side, `${box.start}px`, "important")
}

/** Put a retained node back into the parent it left: before its old next sibling while that's still there, else at the end. */
const reinsert = (el: Node, parent: ParentNode, next: ChildNode | undefined): void => {
  if (Predicate.isNotUndefined(next) && next.parentNode === parent) {
    parent.insertBefore(el, next)
    return
  }
  parent.appendChild(el)
}

/**
 * How a presence's children enter while others exit (#277, ADR-0048), Motion's `mode`: `"sync"`, at
 * once, beside the leavers; `"wait"`, once every leaver is gone; `"popLayout"`, at once, each leaver
 * popped out of the flow where it was.
 */
export type PresenceMode = "sync" | "wait" | "popLayout"

/** What a presence reads from its provider and its props. */
export interface PresenceOptions {
  readonly runtime: WardicRuntime
  readonly projection: ProjectionSystem.Shape
  /** Whether reduced motion applies now (ADR-0029), read at each exit. */
  readonly reducedMotion: () => boolean
  readonly positionalKeys: ReducedMotion.PositionalKeys["Service"]
  /** The presence's `initial` prop: `false` starts the child present at its first render at its `animate` (#134). */
  readonly initial: () => boolean | undefined
  /** What its binding hears of its exits (#257); left out, nothing is told. */
  readonly events?: PresenceEvents | undefined
  /**
   * Its `custom` prop (#277, Motion's), read as a child leaves: what the child's dynamic exit resolves
   * with, over the child's own. Left out, the child's own.
   */
  readonly custom?: (() => unknown) | undefined
  /** Its `mode` prop (#277), read at each change: left out, or `undefined`, `"sync"`. */
  readonly mode?: (() => PresenceMode | undefined) | undefined
  /**
   * The children `mode="wait"` held may go on the page now: the binding renders its children again,
   * through {@link PresenceController.shown}. Left out, a held child stays held.
   */
  readonly release?: (() => void) | undefined
}

/**
 * A presence's exits, told to its binding (#257, ADR-0046): Solid 1's `onExitComplete`, Solid 2's
 * presence handle. A child that leaves exits; a child with no record (not a Wardic element) leaves at
 * once, its exit starting and ending together, as Motion's does.
 */
export interface PresenceEvents {
  /** A child left, and its exit starts. */
  readonly exitStart: () => void
  /** Whether any child is exiting, at each change: on at an exit's start, off once none is left. */
  readonly exiting: (exiting: boolean) => void
  /**
   * Every exiting child has animated out and been removed, the last by completing (Motion's
   * `onExitComplete`). Not when the last ended by an interrupt: a re-entry, or the teardown.
   */
  readonly exitComplete: () => void
}

/** A presence's work, driven by its binding. */
export interface PresenceController {
  /** What its children's wards register with. */
  readonly context: PresenceContextValue
  /** The presence has mounted: a child that enters from now on animates in (#134). */
  readonly mounted: () => void
  /**
   * The children present now, after a change (a node, a flat array of them, or none): each that left
   * is retained in its place and exits. Called after the binding's framework has applied the change.
   */
  readonly present: (current: unknown) => void
  /**
   * What goes on the page of what the children resolved to (#277): all of it, but under `mode="wait"`,
   * while a child exits or is leaving in this change, each child entering is held off it until the
   * last leaver is gone ({@link PresenceOptions.release}). Called where the binding renders, before
   * the change is applied; {@link present} is then told what it showed.
   */
  readonly shown: (resolved: unknown) => unknown
  /** The presence's teardown: every exit in flight interrupted, every retained node removed. */
  readonly teardown: () => void
}

/**
 * Solid 1's {@link PresenceEvents} (#257): only Motion's `onExitComplete`, read when it's called. One
 * that throws is reported (`wardic.presence: onExitComplete failed`), and the presence goes on.
 */
export const exitCompleteEvents = (runtime: WardicRuntime, onExitComplete: () => (() => void) | undefined): PresenceEvents => ({
  exitStart: constVoid,
  exiting: constVoid,
  exitComplete: () => {
    const callback = onExitComplete()
    if (Predicate.isUndefined(callback)) return
    try {
      callback()
    } catch (defect) {
      runtime.runFork(Report.failure("wardic.presence: onExitComplete failed", Cause.die(defect)))
    }
  },
})

/** A presence's work: see the module. */
export const makePresence = (options: PresenceOptions): PresenceController => {
  const { runtime, projection, reducedMotion, positionalKeys } = options
  const { commit, project } = runtime.runSync(Renderer.Renderer)

  /**
   * Debug-level lifecycle log for the parent-driven exit (observability
   * convention): forked on the runtime, filtered out unless the logger is at
   * Debug, so an exit that never removes its node — or a re-entry that interrupts
   * the wrong one — is diagnosable. The per-frame commit stays silent.
   */
  const debug = (event: string, annotations?: Record<string, unknown>): void => {
    const log = Effect.logDebug(`wardic.presence: ${event}`)
    runtime.runFork(UndefinedOr.match(annotations, { onUndefined: () => log, onDefined: (a) => log.pipe(Effect.annotateLogs(a)) }))
  }

  // The registry of live child records, keyed by their DOM element. Filled by
  // register() (called from the child's spine on mount), drained as children
  // leave (after their exit settles).
  const registry = new Map<HTMLElement, PresenceRecord>()

  // In-flight exit fibers keyed by the leaving node, so a re-entry (or this
  // component's own teardown) can interrupt them.
  const exiting = new Map<HTMLElement, Fiber.Fiber<void, never>>()

  // A leaving child's parts still running (ADR-0010 *Amendment (#181)*): its exit, and the handovers
  // of the twins it handed back. It goes when the count reaches 0. Every retained child that runs its
  // own exit is here; a twin presence left to the projection isn't.
  const pending = new Map<HTMLElement, number>()
  // The handed-back twins of a leaving child, by it: the call that drops them, for an interrupted exit.
  const handovers = new Map<HTMLElement, () => void>()
  // The unregistration of each exit's values with the projection.
  const exitValues = new Map<HTMLElement, () => void>()

  // `initial={false}` (#134): the children set up with this first render start at their
  // `animate`; one that enters after it animates in.
  let firstRender = true

  // The children exiting now, each told once at its end (#257): completed, or interrupted.
  const leaving = new Set<HTMLElement>()
  // Each retained child's place when it left (#277): a framework that clears its nodes wholesale (a
  // list emptied clears its parent) takes it out mid-exit, and it goes back there.
  const places = new Map<HTMLElement, Placed>()
  const events = options.events

  // The children `mode="wait"` holds off the page now (#277), and the start of each ward inside one,
  // by its element, called once the child is on the page.
  let held: ReadonlyArray<HTMLElement> = []
  const starts = new Map<HTMLElement, () => void>()
  // `popLayout`'s leavers (#277), each where it was measured before the change: popped as it leaves,
  // and kept until it's gone. Whether this change popped one, so the projection is told.
  const pops = new Map<HTMLElement, PopBox>()
  let popped = false

  /** A child's exit starts: told, and `exiting` turns on with the first. */
  const leaveStarts = (el: HTMLElement): void => {
    leaving.add(el)
    if (Predicate.isUndefined(events)) return
    if (leaving.size === 1) events.exiting(true)
    events.exitStart()
  }

  /**
   * A child's exit ended: with the last, `exiting` turns off, a completion is told, and the children
   * `mode="wait"` held go on the page (#277), as Motion renders them after its `onExitComplete`.
   */
  const leaveEnds = (el: HTMLElement, completed: boolean): void => {
    if (Bool.not(leaving.delete(el))) return
    if (leaving.size > 0) return
    UndefinedOr.map(events, (told) => {
      told.exiting(false)
      if (completed) told.exitComplete()
    })
    if (held.length > 0) UndefinedOr.map(options.release, (release) => release())
  }

  /** Whether `el` is inside a child held off the page (#277). */
  const isHeld = (el: HTMLElement): boolean => Arr.some(held, (child) => child.contains(el))

  const ctx: PresenceContextValue = {
    register: (rec) => {
      registry.set(rec.element, rec)
      return () => {
        registry.delete(rec.element)
      }
    },
    blocksInitial: () => options.initial() === false && firstRender,
    hold: (el, start) => {
      if (Bool.not(isHeld(el))) return undefined
      starts.set(el, start)
      return () => {
        starts.delete(el)
      }
    },
  }

  // Commit a projected value-map onto a retained node via the Renderer.
  const commitValues = (el: HTMLElement, values: Values.Values): void => {
    const patch: Renderer.Patch = project(values)
    commit(el, patch)
  }

  // Remove a retained node from the DOM + drop its registration + clear its
  // in-flight fiber bookkeeping. Idempotent. `completed`: its exit ended on its own (#257).
  const finishExit = (el: HTMLElement, completed = true): void => {
    exiting.delete(el)
    registry.delete(el)
    pending.delete(el)
    handovers.delete(el)
    places.delete(el)
    // A popped leaver is out of the flow: its going moves nothing.
    const moves = Bool.and(el.isConnected, Bool.not(pops.delete(el)))
    const unregister = exitValues.get(el)
    exitValues.delete(el)
    if (Predicate.isNotUndefined(unregister)) unregister()
    el.remove()
    // Its siblings take the space it leaves (#277): a `layout` one animates there, as Motion's do.
    if (moves) projection.notify()
    // Told once the node is gone, as Motion's `onExitComplete` finds it (#257).
    leaveEnds(el, completed)
  }

  // One of a leaving child's parts ended (#181): it goes with the last. A child already removed
  // (an interrupted exit's fiber ending after) is ignored.
  const partDone = (el: HTMLElement): void => {
    const left = pending.get(el)
    if (Predicate.isUndefined(left)) return
    if (left > 1) {
      pending.set(el, left - 1)
      return
    }
    finishExit(el)
  }

  // Interrupt an in-flight exit for `el` (re-entry / teardown) and remove the
  // retained node, the twins it handed back dropped with it. Idempotent.
  const interruptExit = (el: HTMLElement): void => {
    // Told first, as interrupted: the exit's fiber, interrupted below, ends at once through
    // `partDone`, which would tell it completed (#257).
    leaveEnds(el, false)
    const fiber = exiting.get(el)
    if (Predicate.isNotUndefined(fiber)) {
      debug("exit: interrupt")
      runtime.runFork(Fiber.interrupt(fiber))
    }
    const drop = handovers.get(el)
    if (Predicate.isNotUndefined(drop)) drop()
    finishExit(el, false)
  }

  // A leaving child that isn't a twin (ADR-0010 *Amendment (#181)*): it hands back the twins inside
  // it, then runs its own exit, and goes once both have ended.
  const leave = (rec: PresenceRecord, exit: PresenceExit): void => {
    const el = rec.element
    const drop = projection.handBackWithin(el, () => partDone(el))
    pending.set(el, 1)
    if (Option.isSome(drop)) {
      handovers.set(el, drop.value)
      pending.set(el, 2)
      debug("leave: hands back its twins")
    }
    driveExit(rec, exit)
  }

  // Drive the parent-owned exit for a leaving node: from its last snapshot
  // toward its exit target, committing each projected frame onto the (retained)
  // element, removing it on settle. Empty exit -> immediate removal.
  const driveExit = (rec: PresenceRecord, exit: PresenceExit): void => {
    const el = rec.element
    const to = exit.values
    if (isEmpty(to)) {
      debug("exit: immediate (no target)")
      partDone(el)
      return
    }

    // Seeded from the child's last snapshot, so the exit departs continuously. An exit key the
    // child never animated starts from its Base value's start links (ADR-0022), else at its target.
    const snapshot = rec.snapshot.current
    const startOf = (key: string, target: number | string): number | string =>
      UndefinedOr.match(UndefinedOr.match(rec.startOf, { onUndefined: constUndefined, onDefined: (of) => of(key, target) }), {
        onUndefined: () => target,
        onDefined: identity,
      })
    const from: Values.Values = {
      ...snapshot,
      ...Rec.map(Rec.filter(to, (_, key) => Predicate.isUndefined(snapshot[key])), (target, key) => startOf(key, target)),
    }
    // A Retarget's legs (#277): on the exit's own transition, else the element's (a tween, a spring,
    // a delay), its positional keys snapping under reduced motion (ADR-0029) unless it opts out.
    const legs = legsOf(from, to, exit.transition, reducedMotion(), positionalKeys, NO_VELOCITIES)

    // The merged latest value-map, so each committed frame carries every key.
    const latest: Values.Values = { ...from }
    // What the exit has drawn, for the projection (ADR-0010 *Amendment (#181)*): the twins this
    // child handed back follow it. Its last snapshot until the first frame commits.
    const drawn: Values.Values = { ...from }
    exitValues.set(el, projection.registerValues(el, () => drawn))
    const commitFrame: FrameLoop.Sink<Frame.Frame<Values.Values>> = (frame) => {
      Object.assign(latest, frame.value)
      commitValues(el, latest)
      Object.assign(drawn, latest)
      return undefined
    }
    // The leaving element's Variable values (#55): a `var()` end blends what it resolves to on it.
    const runs = Arr.map(legs, (leg) => exitRunOf(leg, el, commitFrame))

    // One `wardic.presence.exit` span spans the whole exit animation (from the last
    // snapshot to the exit target), so a devtool/timeline shows each parent-driven
    // exit as a bar with its key and leg counts. Removal-on-settle is the span's end. A failed run
    // is logged and reported (ADR-0030, decision 4); the node is removed either way.
    const fiber = runtime.runFork(
      Effect.all(runs, { concurrency: "unbounded", discard: true }).pipe(
        Effect.tapCause((cause) => Report.failure("wardic.presence: an exit failed", cause)),
        Effect.ensuring(Effect.sync(() => partDone(el))),
        Effect.withSpan(
          "wardic.presence.exit",
          { attributes: { keys: Object.keys(to).length, legs: legs.length } },
          // No call-site stack (ADR-0040, decision 2): pipeable, it's the third argument.
          { captureStackTrace: false },
        ),
      ),
    )
    exiting.set(el, fiber)
  }

  // The children present at the last change, and where each was, to retain one as it leaves.
  let previous: ReadonlyArray<Placed> = []

  // Teardown: interrupt every in-flight exit + remove retained nodes, the twins they handed back
  // dropped with them (no leaks). Every child running its own exit is in `pending`.
  const teardown = (): void => {
    debug("teardown", { inflight: exiting.size, retained: pending.size })
    // A held child never goes on the page, nor do its wards start (#277): with none held, the exits
    // ended below release nothing, so the binding isn't rendered again as it's disposed.
    held = []
    starts.clear()
    Arr.forEach(Arr.fromIterable(pending.keys()), (el) => interruptExit(el))
    // A crossfading leaver is the projection's, not in `pending`: its exit ends here too, uncompleted (#257).
    Arr.forEach(Arr.fromIterable(leaving), (el) => leaveEnds(el, false))
  }

  /** Pop a leaver `popLayout` measured. */
  const popOut = (el: HTMLElement): void => {
    const box = pops.get(el)
    if (Predicate.isUndefined(box)) return
    pin(el, box)
    popped = true
  }

  /** Measure each child leaving in this change with an exit to run, before the change is applied (#277). */
  const measureLeavers = (resolved: unknown): void => {
    const kept = new Set(elementsOf(resolved))
    Arr.forEach(previous, (placed) => {
      if (Bool.or(kept.has(placed.el), Bool.not(registry.has(placed.el)))) return
      UndefinedOr.map(popBoxOf(placed.el), (box) => pops.set(placed.el, box))
    })
  }

  /** Put a retained child back where it was, if a framework took it out. */
  const putBack = (placed: Placed): void => {
    if (placed.el.parentNode !== null) return
    UndefinedOr.map(placed.parent, (parent) => reinsert(placed.el, parent, placed.next))
  }

  /** A child that left: retained in its place, and exiting, unless it's leaving already. */
  const left = (placed: Placed): void => {
    const el = placed.el
    const rec = registry.get(el)
    // A child with no record (not a Wardic element) has no exit: it's gone at once (#257).
    if (Predicate.isUndefined(rec)) {
      if (Bool.not(leaving.has(el))) {
        leaveStarts(el)
        leaveEnds(el, true)
      }
      return
    }
    if (exiting.has(el)) return
    leaveStarts(el)
    // RE-INSERT: Solid's branch disposal may have already removed the node. Put it back where it was,
    // so the parent-driven exit has a mounted node to animate.
    putBack(placed)
    places.set(el, placed)
    // `popLayout` (#277): out of the flow where it was, so the children after it take their places.
    popOut(el)
    // Shared-element crossfade (ADR-0010): if the projection has a live twin (Lead) to crossfade
    // toward, defer to it — it drives the retained node as a leaving Follower and calls onDone
    // (-> finishExit) on the lead's settle. Otherwise run the normal exit animation.
    const crossfaded = projection.handleLeave(el, () => finishExit(el))
    if (crossfaded) debug("leave: crossfade (deferred to projection)")
    // Its exit, resolved now (#277): with the presence's `custom` when it has one, else the child's last.
    if (Bool.not(crossfaded)) leave(rec, rec.exitOf(customNow()))
  }

  const present = (current: unknown): void => {
    const now = elementsOf(current)
    const kept = new Set(now)
    // The children that left, the last first: each goes back before its old next sibling, which, if
    // it left too, is back already, so neighbours leaving together keep their order.
    Arr.forEach(Arr.reverse(Arr.filter(previous, (placed) => Bool.not(kept.has(placed.el)))), left)
    // A child still exiting that the framework took out since (a list emptied) goes back too.
    Arr.forEach(Arr.fromIterable(places.values()), putBack)
    previous = Arr.map(now, placedOf)
    // A popped leaver moved its siblings (#277): a `layout` one animates into the space.
    if (popped) {
      popped = false
      projection.notify()
    }
    // The wards inside the children held until now start, the children on the page (#277). Held
    // children go on together, so none is left held then. (A ward started while its child is held
    // would only wait again: the check saves its re-run.)
    if (Bool.and(starts.size > 0, held.length === 0)) startHeld()
  }

  /** The held wards' starts, each once. */
  const startHeld = (): void => {
    const ready = Arr.fromIterable(starts.values())
    starts.clear()
    Arr.forEach(ready, (start) => start())
  }

  /** The presence's `custom` now (#277): `undefined` without one. */
  const customNow = (): unknown => UndefinedOr.map(options.custom, (custom) => custom())

  /** The mode now: `"sync"` unless the prop says otherwise. */
  const modeNow = (): PresenceMode | undefined => UndefinedOr.map(options.mode, (mode) => mode())

  /**
   * Whether an entering child waits (#277): under `mode="wait"`, while a child exits, or one shown at
   * the last change is leaving now with an exit to run (a Wardic element, registered).
   */
  const waits = (kept: ReadonlySet<HTMLElement>): boolean =>
    Bool.or(
      leaving.size > 0,
      Arr.some(previous, (placed) => Bool.and(Bool.not(kept.has(placed.el)), registry.has(placed.el))),
    )

  const shown = (resolved: unknown): unknown => {
    const mode = modeNow()
    // `popLayout` (#277): each child leaving in this change is measured where it is, before the change
    // moves it, as Motion's `getSnapshotBeforeUpdate`.
    if (mode === "popLayout") measureLeavers(resolved)
    if (mode !== "wait") {
      held = []
      return resolved
    }
    const now = elementsOf(resolved)
    const kept = new Set(now)
    // Entering: not on the page at the last change.
    const onPage = new Set(Arr.map(previous, (placed) => placed.el))
    held = Bool.match(waits(kept), { onTrue: () => Arr.filter(now, (el) => Bool.not(onPage.has(el))), onFalse: () => [] })
    if (held.length === 0) return resolved
    const holding = new Set<unknown>(held)
    return Arr.filter(Arr.ensure(resolved), (node) => Bool.not(holding.has(node)))
  }

  return {
    context: ctx,
    shown,
    mounted: () => {
      firstRender = false
    },
    present,
    teardown,
  }
}
