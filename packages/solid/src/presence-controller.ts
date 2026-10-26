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
import type * as Box from "@wardic/core/Box"
import type * as DefaultTransition from "@wardic/core/DefaultTransition"
import type * as Frame from "@wardic/core/Frame"
import type * as FrameLoop from "@wardic/core/FrameLoop"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as Renderer from "@wardic/core/Renderer"
import * as Values from "@wardic/core/Values"
import * as Machine from "@wardic/core/Machine"
import * as Stagger from "@wardic/core/Stagger"
import * as Velocity from "@wardic/core/Velocity"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Report from "@wardic/dom/Report"
import * as Variables from "@wardic/dom/Variables"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { constFalse, constUndefined, constVoid, identity } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import type { WardicTransition, WardicVariantLabels } from "./config.ts"
import type { ExitGroup, PresenceContextValue, PresenceExit, PresenceRecord, PresenceSeed, PresenceTree, PresenceWatch } from "./presence-record.ts"
import { delayedBy, type Leg, legsOf } from "./retarget-legs.ts"
import type { WardicRuntime, WardicServices } from "./runtime.ts"
import { staggerOf } from "./variant-tree.ts"

/** Whether a value-map has any keys (an empty exit means "remove immediately"). */
const isEmpty = (values: Values.Values): boolean => Rec.isEmptyRecord(values)

/** An exit's spring: the defaults, one object, so core decodes it once (#66). */

/** A record's place in the variant tree (#290): left out, a lone element's. */
const LONE: PresenceTree = { joins: false, provides: false, twin: false }

/** A record's place in the variant tree, {@link LONE} without one. */
const treeOf = (rec: PresenceRecord): PresenceTree => UndefinedOr.match(rec.tree, { onUndefined: () => LONE, onDefined: identity })

/** No elements: a leaving child with none inside it exiting. */
const NO_PARTS: ReadonlyArray<HTMLElement> = []

/** No records: nothing registered inside a leaving child. */
const NO_RECORDS: ReadonlyArray<PresenceRecord | undefined> = []

/** No record of its own: a plain leaving child (#392). */
const NO_OWN: ReadonlyArray<PresenceRecord> = []

/** A leaving element's exit, and its Variant children's, resolved at the leave (#290). */
interface ExitNode {
  readonly rec: PresenceRecord
  readonly exit: PresenceExit
  readonly kids: ReadonlyArray<ExitNode>
}

/** Whether an exit node, or one under it, has anything to animate. */
const busy = (node: ExitNode): boolean => Bool.or(Bool.not(isEmpty(node.exit.values)), Arr.some(node.kids, busy))

/** A stagger slot's index: reversed with `staggerDirection: -1`, as the variant node's (ADR-0007). */
const slotIndex = (i: number, n: number, direction: 1 | -1): number => {
  if (direction === -1) return n - 1 - i
  return i
}

/** No velocities: an exit starts each key at rest, as it did on its own spring. */
const NO_VELOCITIES: Readonly<Record<string, number>> = {}

/** Where an element is drawn (#286): its values, and each numeric key's velocity. */
type Drawn = PresenceSeed

/** No boxes: a leaver none of whose elements was on the page. */
const NO_BOXES: ReadonlyMap<Element, Box.Box> = new Map()

/** A Wardic element made under a presence (#286): its `key`, if it has one, and whether it's a twin. */
interface Made {
  readonly key: string | number | undefined
  readonly twin: boolean
}

/** Whether two lists of elements have the same shape (#286): as many, each pair the same tag. */
const sameShape = (a: ReadonlyArray<Element>, b: ReadonlyArray<Element>): boolean =>
  Bool.and(a.length === b.length, Arr.every(Arr.zip(a, b), ([x, y]) => x.tagName === y.tagName))

/**
 * Each numeric key's velocity from a step's frame (#286): its change since the step before, over
 * the step's `dt` (seconds), and 0 once the frame settles. A key's first step sets nothing.
 */
const measure = (velocities: Record<string, number>, last: Record<string, number>, frame: Frame.Frame<Values.Values>, dt: number): void => {
  Arr.forEach(Rec.keys(frame.value), (key) => {
    const now = frame.value[key]
    if (Predicate.isString(now)) return
    const before = last[key]
    last[key] = now
    if (frame.done) {
      velocities[key] = 0
      return
    }
    if (Predicate.isUndefined(before)) return
    if (dt <= 0) return
    velocities[key] = Velocity.between(before, now, dt)
  })
}

/** A blend's machine, its numeric keys' velocities measured each step (#286): a tween's frames carry none. */
const measuredInto =
  (velocities: Record<string, number>) =>
  (machine: Machine.Machine<Frame.Frame<Values.Values>>): Machine.Machine<Frame.Frame<Values.Values>> =>
    Machine.make({
      settles: machine.settles,
      span: machine.span,
      start: () => {
        const step = machine.start()
        const last: Record<string, number> = {}
        return (dt) => {
          const frame = step(dt)
          measure(velocities, last, frame, Math.min(dt, Machine.MAX_DT))
          return frame
        }
      },
    })

/**
 * One leg of an exit (#277), as the spine runs a Retarget's, committing onto the retained `el`. Each
 * key's velocity goes into `velocities` (#286): a spring's from its frames, a blend's measured, a
 * snap's 0, so a child back under its key starts with it.
 */
const exitRunOf = (
  leg: Leg,
  el: HTMLElement,
  commitFrame: FrameLoop.Sink<Frame.Frame<Values.Values>>,
  velocities: Record<string, number>,
): Effect.Effect<unknown, never, WardicServices> => {
  if (leg._tag === "Blend") {
    return Effect.suspend(leg.machine).pipe(
      InterpolatorRegistry.withKeyRules([Variables.values(el)]),
      Effect.map(measuredInto(velocities)),
      Effect.flatMap(Machine.run(commitFrame)),
    )
  }
  if (leg._tag === "Follow") {
    const key = leg.key
    return Effect.suspend(() =>
      leg.machine().pipe(
        Machine.run((frame) => {
          velocities[key] = UndefinedOr.match(frame.velocity, { onUndefined: () => 0, onDefined: identity })
          return commitFrame({ ...frame, value: { [key]: frame.value } })
        }),
      ))
  }
  if (leg._tag === "Numbers") {
    return Effect.suspend(() =>
      leg.machine().pipe(
        Machine.run((frame) => {
          Object.assign(velocities, frame.velocity)
          return commitFrame(frame)
        }),
      ))
  }
  Arr.forEach(leg.keys, (key) => {
    velocities[key] = 0
  })
  return Effect.suspend(() => leg.machine().pipe(Machine.run(commitFrame)))
}

/** How far in each name's keys of an exit start (#297): seconds, by name; `undefined` for an exit that isn't a list's. */
type DelayOf = (name: string | undefined) => number

/** At once, every name. */
const NO_DELAY: DelayOf = () => 0

/** An element's exit made ready to run (#297's PR 2): its node, where it starts, what each frame commits, and its velocities. */
interface PreparedExit {
  readonly el: HTMLElement
  readonly from: Values.Values
  readonly commitFrame: FrameLoop.Sink<Frame.Frame<Values.Values>>
  readonly velocities: Record<string, number>
}

/** An exit's name when it's one name, for its delay; `undefined` for a list or a values map. */
const singleNameOf = (name: WardicVariantLabels | undefined): string | undefined => {
  if (Predicate.isString(name)) return name
  return undefined
}

/** The transition a name of an exit orchestrates its Variant children's keys on (#297): its group's, else the exit's. */
const transitionOfName = (exit: PresenceExit, name: string | undefined): WardicTransition | undefined => {
  const groups = exit.groups
  if (Bool.or(Predicate.isUndefined(groups), Predicate.isUndefined(name))) return exit.transition
  return Option.match(Arr.findFirst(groups as ReadonlyArray<ExitGroup>, (group) => group.name === name), {
    onNone: () => exit.transition,
    onSome: (group) => group.transition,
  })
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

/** The element its first child sits in, if it's one (#277's PR 5c). */
const parentElementOf = (placed: ReadonlyArray<Placed>): Element | undefined =>
  UndefinedOr.map(UndefinedOr.map(placed[0], (first) => first.parent), (parent) => {
    if (parent instanceof Element) return parent
    return undefined
  })

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
  /** What an exit's key with no transition of its own runs on (ADR-0051). */
  readonly defaultTransition: DefaultTransition.DefaultTransition["Service"]
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
  /**
   * `propagate` (#277's PR 5c): every child present leaves, as if the change took them all, and
   * `done` is called once none is left (at once with none).
   */
  readonly leaveAll: (done: () => void) => void
  /**
   * Where its children are: the parent node of the last it had (#277's PR 5c), what a parent
   * presence finds it inside. `undefined` before it had one.
   */
  readonly anchor: () => Element | undefined
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
  const { runtime, projection, reducedMotion, positionalKeys, defaultTransition } = options
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
  // What lets go of the twins each leaving child keeps for a late take-over (#402): called as it goes.
  const lates = new Map<HTMLElement, () => void>()
  // The unregistration of each exit's values with the projection.
  const exitValues = new Map<HTMLElement, () => void>()
  // The Wardic elements exiting inside each leaving child (#290), dropped with it.
  const exitParts = new Map<HTMLElement, ReadonlyArray<HTMLElement>>()

  // `initial={false}` (#134): the children set up with this first render start at their
  // `animate`; one that enters after it animates in.
  let firstRender = true

  // The children exiting now, each told once at its end (#257): completed, or interrupted.
  const leaving = new Set<HTMLElement>()
  // Each retained child's place when it left (#277): a framework that clears its nodes wholesale (a
  // list emptied clears its parent) takes it out mid-exit, and it goes back there.
  const places = new Map<HTMLElement, Placed>()
  const events = options.events

  // The presence hooks registered (#277's PR 5b), each told at its child's leave.
  const watches = new Set<PresenceWatch>()

  // The children `mode="wait"` holds off the page now (#277), and the start of each ward inside one,
  // by its element, called once the child is on the page.
  let held: ReadonlyArray<HTMLElement> = []
  const starts = new Map<HTMLElement, () => void>()
  // `popLayout`'s leavers (#277), each where it was measured before the change: popped as it leaves,
  // and kept until it's gone. Whether this change popped one, so the projection is told.
  const pops = new Map<HTMLElement, PopBox>()
  let popped = false

  // Keys (#286, ADR-0048): each Wardic element made under this presence, told as it's made, so a
  // child's key is known before what goes on the page is decided.
  const made = new WeakMap<Element, Made>()
  // The latest child exiting under each key: a child back under it takes over from that one.
  const keyedLeavers = new Map<string | number, HTMLElement>()
  // What each element exiting has drawn, kept by its exit's frames.
  const draws = new Map<HTMLElement, Drawn>()
  // The children entering now that take over from a leaver, each with that leaver: taken over at
  // the first of their wards' mounts, or the presence's next look, whichever comes first.
  const takeovers = new Map<HTMLElement, HTMLElement>()
  // Where each Wardic element in a child that took over starts: read once, at its mount.
  const seeds = new WeakMap<Element, Drawn>()
  // The keyed leavers crossfading as twins (ADR-0010), the projection's: one taken over ends its
  // leaving Follower at once (Q8: D).
  const crossfades = new Set<HTMLElement>()
  // Where each leaver taken over painted, it and the Wardic elements inside it, in the Root frame:
  // read as the take-over is found, before the change moves anything.
  const leaverBoxes = new Map<HTMLElement, ReadonlyMap<Element, Box.Box>>()
  // Whether any keyed element was made: until then, no change looks for a take-over.
  let keyed = false

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
    // `propagate` (#277's PR 5c): the last child that left lets the parent's child go.
    allLeft()
    if (held.length > 0) UndefinedOr.map(options.release, (release) => release())
  }

  // What `leaveAll` calls once none is left (#277's PR 5c), and where its children last were.
  let onAllLeft: (() => void) | undefined
  let anchor: Element | undefined

  /** `leaveAll`'s end, told once (#277's PR 5c). */
  const allLeft = (): void => {
    if (Predicate.isUndefined(onAllLeft)) return
    const done = onAllLeft
    onAllLeft = undefined
    done()
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
    watch: (watch) => {
      watches.add(watch)
    },
    hold: (el, start) => {
      if (Bool.not(isHeld(el))) return undefined
      starts.set(el, start)
      return () => {
        starts.delete(el)
      }
    },
    made: (el, key, twin) => {
      made.set(el, { key, twin })
      if (Predicate.isNotUndefined(key)) keyed = true
    },
    takeOverOf: (el) => {
      settleTakeovers()
      const seed = seeds.get(el)
      seeds.delete(el)
      return seed
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
    draws.delete(el)
    crossfades.delete(el)
    leaverBoxes.delete(el)
    // No longer one a child back under its key takes over from (#286).
    UndefinedOr.map(keyOf(el), (key) => {
      if (keyedLeavers.get(key) === el) keyedLeavers.delete(key)
    })
    pending.delete(el)
    handovers.delete(el)
    UndefinedOr.map(lates.get(el), (forget) => forget())
    lates.delete(el)
    places.delete(el)
    // A popped leaver is out of the flow: its going moves nothing.
    const moves = Bool.and(el.isConnected, Bool.not(pops.delete(el)))
    const unregister = exitValues.get(el)
    exitValues.delete(el)
    if (Predicate.isNotUndefined(unregister)) unregister()
    // The elements inside it that exited with it go with it (#290): their records, and their values.
    Arr.forEach(UndefinedOr.match(exitParts.get(el), { onUndefined: () => NO_PARTS, onDefined: identity }), (part) => {
      registry.delete(part)
      draws.delete(part)
      UndefinedOr.map(exitValues.get(part), (unregisterPart) => unregisterPart())
      exitValues.delete(part)
    })
    exitParts.delete(el)
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
  // it, then runs its own exit and the exits inside it, and goes once all have ended. A plain child
  // (not a Wardic element, no `rec`) runs only those inside it (#392), as Motion's presence child does.
  const leave = (el: HTMLElement, rec: PresenceRecord | undefined, custom: unknown, inside: ReadonlyArray<PresenceWatch>, holds: number): void => {
    // A keyed one is what a child back under its key takes over from (#286), the latest the one.
    UndefinedOr.map(keyOf(el), (key) => keyedLeavers.set(key, el))
    const drop = projection.handBackWithin(el, () => partDone(el))
    // Its parts: its exit, each hook holding it (#277's PR 5b), and the handovers of the twins it hands back.
    pending.set(el, 1 + holds)
    if (Option.isSome(drop)) {
      handovers.set(el, drop.value)
      pending.set(el, 2 + holds)
      debug("leave: hands back its twins")
    }
    // The twins nobody took over stay a later twin's to take over while it's on the page (#402).
    lates.set(el, projection.keepLeaving(el, (dropLate) => takenLate(el, dropLate)))
    tellLeave(el, inside, true)
    driveExit(el, rec, custom)
  }

  // A twin in a leaving child taken over late (ADR-0010 *Amendment (#402)*): one more of its parts,
  // ended with that handover, and dropped with its others by an interrupted exit. Its own exit runs on:
  // the handover draws the twin over it.
  const takenLate = (el: HTMLElement, drop: () => void): (() => void) => {
    const left = pending.get(el)
    if (Predicate.isUndefined(left)) {
      drop()
      return constVoid
    }
    pending.set(el, left + 1)
    const before = handovers.get(el)
    handovers.set(el, () => {
      UndefinedOr.map(before, (dropBefore) => dropBefore())
      drop()
    })
    debug("leave: a twin taken over late")
    return () => partDone(el)
  }

  /**
   * The Wardic elements inside a leaving child (#290), in document order, each running its own exit
   * with the child's: every registered one but a twin, whose crossfade replaces its exit (#181).
   */
  const partsOf = (el: HTMLElement): ReadonlyArray<PresenceRecord> => Arr.filter(registeredWithin(el), isPart)

  /**
   * The records of the elements inside `el`, in document order, `undefined` for one not registered:
   * found by walking its own elements (#392), as many steps as it has, not as the presence has records.
   */
  const registeredWithin = (el: HTMLElement): ReadonlyArray<PresenceRecord | undefined> => {
    if (registry.size === 0) return NO_RECORDS
    return Arr.map(Arr.fromIterable(el.getElementsByTagName("*")), (inner) => registry.get(inner as HTMLElement))
  }

  /** A registered element but a twin. */
  const isPart = (part: PresenceRecord | undefined): part is PresenceRecord => {
    if (Predicate.isUndefined(part)) return false
    return Bool.not(treeOf(part).twin)
  }

  /**
   * Whether a leaving child stays to exit (#392): a Wardic element, or a plain one with something
   * inside it to wait for, a Wardic element (an exit to run, a twin to hand back) or a hook's hold.
   */
  const retains = (el: HTMLElement): boolean => {
    if (registry.has(el)) return true
    if (holdsIn(el)) return true
    return registersWithin(el)
  }

  /** Whether a Wardic element made under this presence is inside `el`. */
  const registersWithin = (el: HTMLElement): boolean => Arr.some(registeredWithin(el), Predicate.isNotUndefined)

  /**
   * A leaving child's exit, and the exits inside it (#290), as Motion's `animateVariant` runs them:
   * each element's own exit, its Variant children's on the name it hands down, in its exit
   * orchestration (`delayChildren`, the stagger, `when`), and every other element's from the leave.
   * A plain child (no `rec`) has no exit of its own: the elements inside it are the roots (#392).
   * The child goes once all of them, and the handovers of the twins it handed back, have ended.
   */
  const driveExit = (el: HTMLElement, rec: PresenceRecord | undefined, custom: unknown): void => {
    const parts = partsOf(el)
    exitParts.set(el, Arr.map(parts, (part) => part.element))
    const own = UndefinedOr.match(rec, { onUndefined: () => NO_OWN, onDefined: Arr.of })
    const byElement = new Map<Element, PresenceRecord>(Arr.map([...own, ...parts], (r) => [r.element, r] as const))
    // The nearest element inside the child its Variant children join: one that provides a context.
    const providerOf = (node: Element | null): PresenceRecord | undefined => {
      if (node === null) return undefined
      const found = byElement.get(node)
      if (Predicate.isNotUndefined(found) && treeOf(found).provides) return found
      if (node === el) return undefined
      return providerOf(node.parentElement)
    }
    const joinsTo = new Map<PresenceRecord, PresenceRecord>()
    Arr.forEach(parts, (part) => {
      if (Bool.not(treeOf(part).joins)) return
      UndefinedOr.map(providerOf(part.element.parentElement), (provider) => joinsTo.set(part, provider))
    })
    const joinersOf = (provider: PresenceRecord): ReadonlyArray<PresenceRecord> => Arr.filter(parts, (part) => joinsTo.get(part) === provider)
    const nodeOf = (node: PresenceRecord, inherited: WardicVariantLabels | undefined): ExitNode => {
      const exit = node.exitOf(custom, inherited)
      return { rec: node, exit, kids: Arr.map(joinersOf(node), (kid) => nodeOf(kid, exit.name)) }
    }
    // The child's own tree, if it's a Wardic element, and each element inside it that joins nothing
    // inside it, from the leave.
    const roots = [
      ...Arr.map(own, (r) => nodeOf(r, undefined)),
      ...Arr.map(Arr.filter(parts, (part) => Bool.not(joinsTo.has(part))), (part) => nodeOf(part, undefined)),
    ]
    if (Bool.not(Arr.some(roots, busy))) {
      debug("exit: immediate (no target)")
      partDone(el)
      return
    }
    // One `wardic.presence.exit` span spans the whole exit, from the leave to the last part's end.
    // A failed run is logged and reported (ADR-0030, decision 4); the node is removed either way.
    const fiber = runtime.runFork(
      Effect.all(Arr.map(roots, (root) => runOf(root, NO_DELAY)), { concurrency: "unbounded", discard: true }).pipe(
        Effect.tapCause((cause) => Report.failure("wardic.presence: an exit failed", cause)),
        Effect.ensuring(Effect.sync(() => partDone(el))),
        Effect.withSpan(
          "wardic.presence.exit",
          { attributes: { parts: parts.length + own.length } },
          // No call-site stack (ADR-0040, decision 2): pipeable, it's the third argument.
          { captureStackTrace: false },
        ),
      ),
    )
    exiting.set(el, fiber)
  }

  /**
   * A node's exit and its Variant children's (#290), Motion's `animateVariant`: with `when`, one after
   * the other, the children's delays from 0; else together, the children's from `delay`.
   */
  const runOf = (node: ExitNode, delay: DelayOf): Effect.Effect<unknown, never, WardicServices> => {
    // A list's names each run on their own (#297's PR 2): each name's keys and its children's, in that
    // name's own `when`.
    const groups = node.exit.groups
    if (Predicate.isNotUndefined(groups)) {
      const first = UndefinedOr.match(groups[0], { onUndefined: constUndefined, onDefined: (group) => group.name })
      return Effect.all(Arr.map(groups, (group) => runName(node, group.name, delay, group.name === first)), { concurrency: "unbounded", discard: true })
    }
    const own = exitOf(node.rec, node.exit, delay)
    if (node.kids.length === 0) return own
    const n = node.kids.length
    // Each name orchestrates the children's keys of that name (#297, Motion's `animateVariant` a name):
    // its own transition's delay and stagger, else the exit's.
    const slot = (i: number) => (name: string | undefined): number => {
      const s = staggerOf(transitionOfName(node.exit, name))
      return s.delayChildren + Stagger.make(s.amount, { from: s.from })(slotIndex(i, n, s.direction), n)
    }
    const kidsFrom = (from: DelayOf): Effect.Effect<unknown, never, WardicServices> =>
      Effect.all(Arr.map(node.kids, (kid, i) => runOf(kid, (name) => from(name) + slot(i)(name))), { concurrency: "unbounded", discard: true })
    // `when` for a list as a whole, meanwhile (#297's PR 1): the exit's, its last name's that sets it.
    const when = UndefinedOr.map(node.exit.transition, (t) => t.when)
    if (when === "beforeChildren") return Effect.andThen(own, kidsFrom(NO_DELAY))
    if (when === "afterChildren") return Effect.andThen(kidsFrom(NO_DELAY), own)
    return Effect.all([own, kidsFrom(delay)], { concurrency: "unbounded", discard: true })
  }

  /**
   * One name of a list's exit (#297's PR 2, Motion's `animateVariant` a name): the element's keys of that
   * name, and its Variant children's, one after the other with that name's `when`, else together. A
   * child whose exit isn't the list runs it whole, under the list's first name.
   */
  const runName = (node: ExitNode, name: string, delay: DelayOf, first: boolean): Effect.Effect<unknown, never, WardicServices> => {
    const own = exitOf(node.rec, node.exit, delay, name)
    const n = node.kids.length
    if (n === 0) return own
    const slot = (i: number) => (of: string | undefined): number => {
      const s = staggerOf(transitionOfName(node.exit, of))
      return s.delayChildren + Stagger.make(s.amount, { from: s.from })(slotIndex(i, n, s.direction), n)
    }
    const kidsFrom = (from: DelayOf): Effect.Effect<unknown, never, WardicServices> =>
      Effect.all(
        Arr.map(node.kids, (kid, i) => {
          const at: DelayOf = (of) => from(of) + slot(i)(of)
          if (Predicate.isNotUndefined(kid.exit.groups)) return runName(kid, name, at, first)
          if (first) return runOf(kid, at)
          return Effect.void
        }),
        { concurrency: "unbounded", discard: true },
      )
    const when = UndefinedOr.map(transitionOfName(node.exit, name), (t) => t.when)
    if (when === "beforeChildren") return Effect.andThen(own, kidsFrom(NO_DELAY))
    if (when === "afterChildren") return Effect.andThen(kidsFrom(NO_DELAY), own)
    return Effect.all([own, kidsFrom(delay)], { concurrency: "unbounded", discard: true })
  }

  /**
   * One element's own exit on its retained node, `delay` seconds in (#290): a Retarget's legs (#277),
   * on the exit's own transition, else the element's, its positional keys snapping under reduced
   * motion (ADR-0029) unless it opts out. Nothing to run for an empty one.
   */
  const exitOf = (rec: PresenceRecord, exit: PresenceExit, delay: DelayOf, only?: string): Effect.Effect<unknown, never, WardicServices> => {
    const to = exit.values
    if (isEmpty(to)) return Effect.void
    const { from, commitFrame, velocities, el } = preparedOf(rec, exit)
    // A list's exit by name (#297): each name's keys on its own transition, at its own delay; one
    // name's alone when its `when` orders it (#297's PR 2).
    const reduce = reducedMotion()
    const legs = UndefinedOr.match(exit.groups, {
      onUndefined: () => legsOf(from, to, delayedBy(exit.transition, delay(singleNameOf(exit.name))), reduce, positionalKeys, defaultTransition, NO_VELOCITIES),
      onDefined: (groups) =>
        Arr.flatMap(
          Arr.filter(groups, (group) => Bool.or(Predicate.isUndefined(only), group.name === only)),
          (group: ExitGroup) => legsOf(from, group.values, delayedBy(group.transition, delay(group.name)), reduce, positionalKeys, defaultTransition, NO_VELOCITIES),
        ),
    })
    return Effect.all(Arr.map(legs, (leg) => exitRunOf(leg, el, commitFrame, velocities)), { concurrency: "unbounded", discard: true })
  }

  // Each exit's start, made once though a list's names run its keys apart (#297's PR 2).
  const prepared = new WeakMap<PresenceExit, PreparedExit>()

  /** An element's exit made ready to run: where it starts, and what each frame commits. */
  const preparedOf = (rec: PresenceRecord, exit: PresenceExit): PreparedExit => {
    const known = prepared.get(exit)
    if (Predicate.isNotUndefined(known)) return known
    const el = rec.element
    const to = exit.values
    // Seeded from the element's last snapshot, so its exit departs continuously. A key it never
    // animated starts from its Base value's start links (ADR-0022), else at its target.
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
    // The merged latest value-map, so each committed frame carries every key.
    const latest: Values.Values = { ...from }
    // What the exit has drawn, for the projection (ADR-0010 *Amendment (#181)*): the twins handed back
    // follow it. Its last snapshot until the first frame commits.
    const drawn: Values.Values = { ...from }
    UndefinedOr.map(exitValues.get(el), (unregister) => unregister())
    exitValues.set(el, projection.registerValues(el, () => drawn))
    // And how fast each key moves (#286): a child back under its key starts with it.
    const velocities: Record<string, number> = {}
    draws.set(el, { values: drawn, velocities })
    const commitFrame: FrameLoop.Sink<Frame.Frame<Values.Values>> = (frame) => {
      Object.assign(latest, frame.value)
      commitValues(el, latest)
      Object.assign(drawn, latest)
      return undefined
    }
    const made: PreparedExit = { el, from, commitFrame, velocities }
    prepared.set(exit, made)
    return made
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
    // The hooks still waiting go with it, told nothing left (#277's PR 5b).
    Arr.forEach(Arr.fromIterable(watches), (watch) => watch.gone())
    watches.clear()
    Arr.forEach(Arr.fromIterable(pending.keys()), (el) => interruptExit(el))
    // A crossfading leaver is the projection's, not in `pending`: its exit ends here too, uncompleted (#257).
    Arr.forEach(Arr.fromIterable(leaving), (el) => leaveEnds(el, false))
  }

  /** Whether a hook inside `el` holds it as it leaves (#277's PR 5b). */
  const holdsIn = (el: HTMLElement): boolean => Arr.some(watchesIn(el), (watch) => watch.holds)

  /** A record whose element is off the page, dropped; a leaver's is put back first, so it stays. */
  const dropDetached = (el: HTMLElement): void => {
    if (el.isConnected) return
    registry.delete(el)
  }

  /** Pop a leaver `popLayout` measured. */
  const popOut = (el: HTMLElement): void => {
    const box = pops.get(el)
    if (Predicate.isUndefined(box)) return
    pin(el, box)
    popped = true
  }

  /**
   * Measure each child leaving in this change that stays to exit, before the change is applied (#277):
   * a plain one too, with something inside it to wait for (#392).
   */
  const measureLeavers = (resolved: unknown): void => {
    const kept = new Set(elementsOf(resolved))
    Arr.forEach(previous, (placed) => {
      if (kept.has(placed.el)) return
      if (Bool.not(retains(placed.el))) return
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
    // The presence hooks inside it (#277's PR 5b): told it left; `usePresence`'s hold it until released.
    const inside = watchesIn(el)
    const holds = Arr.filter(inside, (watch) => watch.holds).length
    // A plain child (not a Wardic element) with nothing inside it to wait for, no Wardic element
    // (an exit to run, a twin to hand back) and no hook holding it, is gone at once (#257, #392).
    if (Bool.and(Predicate.isUndefined(rec), holds === 0)) {
      if (Bool.not(registersWithin(el))) {
        if (Bool.not(leaving.has(el))) {
          leaveStarts(el)
          tellLeave(el, inside, false)
          leaveEnds(el, true)
        }
        return
      }
    }
    if (Bool.or(exiting.has(el), pending.has(el))) return
    leaveStarts(el)
    // RE-INSERT: Solid's branch disposal may have already removed the node. Put it back where it was,
    // so the parent-driven exit has a mounted node to animate.
    putBack(placed)
    places.set(el, placed)
    // `popLayout` (#277): out of the flow where it was, so the children after it take their places.
    popOut(el)
    // A plain child (#392): retained, as Motion's presence child, until the exits inside it, the
    // handovers of its twins and the hooks holding it (#277's PR 5b) have all ended.
    if (Predicate.isUndefined(rec)) {
      leave(el, undefined, customNow(), inside, holds)
      return
    }
    // Shared-element crossfade (ADR-0010): if the projection has a live twin (Lead) to crossfade
    // toward, defer to it — it drives the retained node as a leaving Follower and calls onDone
    // (-> finishExit) on the lead's settle. Otherwise run the normal exit animation. A crossfading
    // child goes with its handover: the hooks inside it are told, but don't hold it.
    const crossfaded = projection.handleLeave(el, () => finishExit(el))
    if (crossfaded) {
      debug("leave: crossfade (deferred to projection)")
      tellLeave(el, inside, false)
      // A keyed one is what a child back under its key takes over from (#286), its Follower ended.
      UndefinedOr.map(keyOf(el), (key) => {
        keyedLeavers.set(key, el)
        crossfades.add(el)
      })
      return
    }
    // Its exit, resolved now (#277): with the presence's `custom` when it has one, else the child's last.
    leave(el, rec, customNow(), inside, holds)
  }

  /** The presence hooks inside `el` (#277's PR 5b): those whose element it holds. */
  const watchesIn = (el: HTMLElement): ReadonlyArray<PresenceWatch> =>
    Arr.filter(Arr.fromIterable(watches), (watch) => UndefinedOr.match(watch.element(), { onUndefined: constFalse, onDefined: (at) => el.contains(at) }))

  /**
   * Tell the hooks inside a leaving child it left (#277's PR 5b), with the presence's `custom`. With
   * `counted`, each that holds it is one of its parts, ended by its release (once). A callback that
   * throws is reported, and lets the child go.
   */
  const tellLeave = (el: HTMLElement, inside: ReadonlyArray<PresenceWatch>, counted: boolean): void => {
    const custom = customNow()
    Arr.forEach(inside, (watch) => {
      watches.delete(watch)
      let released = false
      const release = (): void => {
        if (released) return
        released = true
        if (Bool.and(counted, watch.holds)) partDone(el)
      }
      try {
        watch.leave(custom, release)
      } catch (defect) {
        runtime.runFork(Report.failure("wardic.presence: a usePresence callback failed", Cause.die(defect)))
        release()
      }
    })
  }

  /** A hook whose element left the page some other way, dropped (#277's PR 5b): not one a held child holds. */
  const dropDetachedWatch = (watch: PresenceWatch): void => {
    UndefinedOr.map(watch.element(), (at) => {
      if (Bool.or(at.isConnected, isHeld(at as HTMLElement))) return
      watches.delete(watch)
      watch.gone()
    })
  }

  // --- Keys (#286, ADR-0048) ------------------------------------------------

  /** An element's `key`, told as it was made: `undefined` for one with none, or not a Wardic element. */
  const keyOf = (el: Element): string | number | undefined => UndefinedOr.map(made.get(el), (m) => m.key)

  /**
   * Where a Wardic element is drawn: what its exit has drawn, if it's exiting, over its last values;
   * else its last values, at the velocities its own animation left them.
   */
  const drawnOf = (rec: PresenceRecord): Drawn =>
    UndefinedOr.match(draws.get(rec.element), {
      onUndefined: (): Drawn => ({
        values: { ...rec.snapshot.current },
        velocities: UndefinedOr.match(rec.velocities, { onUndefined: () => NO_VELOCITIES, onDefined: (of) => ({ ...of() }) }),
      }),
      onDefined: (drawn): Drawn => ({ values: { ...rec.snapshot.current, ...drawn.values }, velocities: { ...drawn.velocities } }),
    })

  /** The Wardic elements made under this presence inside `el`, in document order, but the twins (#181). */
  const madeWithin = (el: HTMLElement): ReadonlyArray<Element> =>
    Arr.filter(Arr.fromIterable(el.querySelectorAll("*")), (inner) =>
      UndefinedOr.match(made.get(inner), { onUndefined: constFalse, onDefined: (m) => Bool.not(m.twin) }))

  /**
   * The children entering in this change that take over from a leaver: one with the key of a child
   * exiting, or of one leaving in this change (Motion keeps an element whose key stays).
   */
  const findTakeovers = (resolved: unknown): void => {
    const onPage = new Set(Arr.map(previous, (placed) => placed.el))
    const now = elementsOf(resolved)
    const kept = new Set(now)
    // The keyed children leaving in this change, by key, over the ones exiting already.
    const byKey = new Map(keyedLeavers)
    Arr.forEach(previous, (placed) => {
      if (Bool.or(kept.has(placed.el), Bool.not(registry.has(placed.el)))) return
      UndefinedOr.map(keyOf(placed.el), (key) => byKey.set(key, placed.el))
    })
    if (byKey.size === 0) return
    Arr.forEach(now, (el) => {
      if (onPage.has(el)) return
      UndefinedOr.map(keyOf(el), (key) =>
        UndefinedOr.map(byKey.get(key), (leaver) => {
          if (leaver === el) return
          takeovers.set(el, leaver)
          if (Bool.not(leaverBoxes.has(leaver))) leaverBoxes.set(leaver, boxesOf(leaver))
        }))
    })
  }

  /** Where a leaver and the Wardic elements inside it paint now, in the Root frame: each one on the page. */
  const boxesOf = (leaver: HTMLElement): ReadonlyMap<Element, Box.Box> => {
    const boxes = new Map<Element, Box.Box>()
    Arr.forEach([leaver, ...Arr.map(partsOf(leaver), (part) => part.element)], (el) =>
      Option.map(projection.rootBoxOf(el), (box) => boxes.set(el, box)))
    return boxes
  }

  /** The take-overs found, each done once: at the first of the child's wards' mounts, or the presence's next look. */
  const settleTakeovers = (): void => {
    if (takeovers.size === 0) return
    const due = Arr.fromIterable(takeovers)
    takeovers.clear()
    Arr.forEach(due, ([el, leaver]) => takeOver(el, leaver))
  }

  // Children taken over in the change they left in: they never start an exit.
  const takenOver = new WeakSet<HTMLElement>()

  /**
   * `el` takes over from `leaver`: each Wardic element in it starts where the one it pairs with in
   * the leaver is drawn, the child itself with the leaver, and those inside in document order when
   * the two have the same shape (as many, each pair the same tag). The leaver goes at once. An exiting
   * one's exit ends, uncompleted, as an interrupted one's does (Motion tells no completion for a key
   * back); one leaving in this change never starts its exit, nor are its hooks told it left.
   */
  const takeOver = (el: HTMLElement, leaver: HTMLElement): void => {
    const from = registry.get(leaver)
    // Gone since (its exit ended): the child enters as any other.
    if (Predicate.isUndefined(from)) return
    const before = partsOf(leaver)
    const after = madeWithin(el)
    // Each as drawn, and where it painted: a layout node moves from there (#286's PR 2).
    const boxes = UndefinedOr.match(leaverBoxes.get(leaver), { onUndefined: (): ReadonlyMap<Element, Box.Box> => NO_BOXES, onDefined: identity })
    leaverBoxes.delete(leaver)
    const seedOf = (rec: PresenceRecord): Drawn => ({ ...drawnOf(rec), box: boxes.get(rec.element) })
    const paired = sameShape(Arr.map(before, (part) => part.element), after)
    if (paired) Arr.forEach(Arr.zip(before, after), ([part, into]) => seeds.set(into, seedOf(part)))
    debug("leave: taken over", { parts: before.length, paired })
    // A twin crossfading out (Q8: D): its leaving Follower goes at once, uncompleted, and the new
    // node's handover fades on from where it had faded to, as Motion's same element would.
    if (crossfades.has(leaver)) {
      leaveEnds(leaver, false)
      seeds.set(el, { ...seedOf(from), fade: Option.getOrUndefined(projection.dropLeaver(leaver)) })
      return
    }
    seeds.set(el, seedOf(from))
    if (pending.has(leaver)) {
      interruptExit(leaver)
      return
    }
    // Leaving in this change: it goes as Solid took it, its records and hooks with it.
    takenOver.add(leaver)
    pops.delete(leaver)
    Arr.forEach([from, ...before], (rec) => registry.delete(rec.element))
    Arr.forEach(watchesIn(leaver), (watch) => {
      watches.delete(watch)
      watch.gone()
    })
  }

  const present = (current: unknown): void => {
    const now = elementsOf(current)
    const kept = new Set(now)
    // The take-overs found as these children went on the page (#286), before any leaves: a child
    // taken over in the change it left in doesn't leave.
    if (takeovers.size > 0) {
      Arr.forEach(Arr.fromIterable(takeovers.keys()), (el) => {
        if (Bool.not(kept.has(el))) takeovers.delete(el)
      })
      settleTakeovers()
    }
    // The children that left, the last first: each goes back before its old next sibling, which, if
    // it left too, is back already, so neighbours leaving together keep their order.
    Arr.forEach(Arr.reverse(Arr.filter(previous, (placed) => Bool.and(Bool.not(kept.has(placed.el)), Bool.not(takenOver.has(placed.el))))), left)
    // A child still exiting that the framework took out since (a list emptied) goes back too.
    Arr.forEach(Arr.fromIterable(places.values()), putBack)
    previous = Arr.map(now, placedOf)
    // Where its children are (#277's PR 5c): a parent presence finds it inside its leaving child by it.
    if (now.length > 0) anchor = parentElementOf(previous)
    // A record whose element left the page some other way (its own control flow, inside a child that
    // stays) is dropped (#290): nothing exits it, and nothing else would.
    Arr.forEach(Arr.fromIterable(registry.keys()), dropDetached)
    Arr.forEach(Arr.fromIterable(watches), dropDetachedWatch)
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
   * the last change is leaving now and stays to exit (a Wardic element, or a plain one with something
   * inside it to wait for, #392).
   */
  const waits = (kept: ReadonlySet<HTMLElement>): boolean =>
    Bool.or(
      leaving.size > 0,
      Arr.some(previous, (placed) => {
        if (kept.has(placed.el)) return false
        return retains(placed.el)
      }),
    )

  const shown = (resolved: unknown): unknown => {
    const mode = modeNow()
    // `popLayout` (#277): each child leaving in this change is measured where it is, before the change
    // moves it, as Motion's `getSnapshotBeforeUpdate`.
    if (mode === "popLayout") measureLeavers(resolved)
    // A child back under the key of one leaving takes over from it (#286): found before the mode
    // decides what goes on the page, so `wait` doesn't hold it. Nothing is looked up with no key.
    if (keyed) findTakeovers(resolved)
    if (mode !== "wait") {
      held = []
      return resolved
    }
    const now = elementsOf(resolved)
    const kept = new Set(now)
    // Entering: not on the page at the last change.
    const onPage = new Set(Arr.map(previous, (placed) => placed.el))
    held = Bool.match(waits(kept), { onTrue: () => Arr.filter(now, (el) => Bool.and(Bool.not(onPage.has(el)), Bool.not(takeovers.has(el)))), onFalse: () => [] })
    if (held.length === 0) return resolved
    const holding = new Set<unknown>(held)
    return Arr.filter(Arr.ensure(resolved), (node) => Bool.not(holding.has(node)))
  }

  const leaveAll = (done: () => void): void => {
    onAllLeft = done
    present([])
    if (leaving.size === 0) allLeft()
  }

  return {
    context: ctx,
    shown,
    leaveAll,
    anchor: () => anchor,
    mounted: () => {
      firstRender = false
    },
    present,
    teardown,
  }
}

/**
 * `propagate` (#277's PR 5c, ADR-0048, Motion's): a presence inside another's child registers with
 * that one as a hook that holds it. When the child leaves, every child of this presence leaves, and
 * the parent's child goes once they've all gone. Its own disposal comes first (Solid disposes the
 * leaving child before its presence hears of it), so its teardown waits a microtask for that word.
 * Without `propagate`, or a presence above, its teardown runs at its disposal, as before. Returns
 * what its disposal runs.
 */
export const propagateTo = (parent: PresenceContextValue | undefined, propagate: boolean, presence: PresenceController): (() => void) => {
  let torn = false
  const tear = (): void => {
    if (torn) return
    torn = true
    presence.teardown()
  }
  const watch = UndefinedOr.map(parent, (above) => above.watch)
  if (Bool.or(Bool.not(propagate), Predicate.isUndefined(watch))) return tear
  let disposed = false
  let leaving = false
  ;(watch as (watch: PresenceWatch) => void)({
    element: presence.anchor,
    holds: true,
    leave: (_custom, release) => {
      leaving = true
      presence.leaveAll(() => {
        release()
        tear()
      })
    },
    gone: () => {
      if (disposed) tear()
    },
  })
  return () => {
    disposed = true
    queueMicrotask(() => {
      if (Bool.not(leaving)) tear()
    })
  }
}

