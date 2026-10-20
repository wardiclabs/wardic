/**
 * `<AnimatePresence>`'s work (ADR-0007), Solid-free (#209): the leaving child's retained node, its
 * parent-driven exit, the twins it hands back (ADR-0010 *Amendment (#181)*), and a re-entry's
 * interrupt. Each binding's `AnimatePresence` resolves its child with its own Solid and tells
 * {@link PresenceController.present} which element is present after each change; see the Solid 1
 * binding's `presence.tsx` for the doctrine.
 *
 * @module
 */
import type * as Frame from "@wardic/core/Frame"
import type * as FrameLoop from "@wardic/core/FrameLoop"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as Renderer from "@wardic/core/Renderer"
import * as Values from "@wardic/core/Values"
import * as Machine from "@wardic/core/Machine"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Report from "@wardic/dom/Report"
import * as Variables from "@wardic/dom/Variables"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { constUndefined, identity } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import type { PresenceContextValue, PresenceRecord } from "./presence-record.ts"
import type { WardicRuntime, WardicServices } from "./runtime.ts"

/** Whether a value-map has any keys (an empty exit means "remove immediately"). */
const isEmpty = (values: Values.Values): boolean => Rec.isEmptyRecord(values)

/** An exit's spring: the defaults, one object, so core decodes it once (#66). */
const EXIT_SPRING: Machine.SpringOptions = {}

/** Whether a resolved child is an element. Only called on the client, where `HTMLElement` exists. */
const isHTMLElement = (node: unknown): node is HTMLElement => node instanceof HTMLElement

/** Put a retained node back into the parent it left: before its old next sibling while that's still there, else at the end. */
const reinsert = (el: Node, parent: ParentNode, next: ChildNode | undefined): void => {
  if (Predicate.isNotUndefined(next) && next.parentNode === parent) {
    parent.insertBefore(el, next)
    return
  }
  parent.appendChild(el)
}

/** What a presence reads from its provider and its props. */
export interface PresenceOptions {
  readonly runtime: WardicRuntime
  readonly projection: ProjectionSystem.Shape
  /** Whether reduced motion applies now (ADR-0029), read at each exit. */
  readonly reducedMotion: () => boolean
  readonly positionalKeys: ReducedMotion.PositionalKeys["Service"]
  /** The presence's `initial` prop: `false` starts the child present at its first render at its `animate` (#134). */
  readonly initial: () => boolean | undefined
}

/** A presence's work, driven by its binding. */
export interface PresenceController {
  /** What its children's wards register with. */
  readonly context: PresenceContextValue
  /** The presence has mounted: a child that enters from now on animates in (#134). */
  readonly mounted: () => void
  /**
   * The child present now, after a change: a child that left is retained and exits, and an exit a
   * new child interrupts is ended. Called after the binding's framework has applied the change.
   */
  readonly present: (current: unknown) => void
  /** The presence's teardown: every exit in flight interrupted, every retained node removed. */
  readonly teardown: () => void
}

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

  const ctx: PresenceContextValue = {
    register: (rec) => {
      registry.set(rec.element, rec)
      return () => {
        registry.delete(rec.element)
      }
    },
    blocksInitial: () => options.initial() === false && firstRender,
  }

  // Commit a projected value-map onto a retained node via the Renderer.
  const commitValues = (el: HTMLElement, values: Values.Values): void => {
    const patch: Renderer.Patch = project(values)
    commit(el, patch)
  }

  // Remove a retained node from the DOM + drop its registration + clear its
  // in-flight fiber bookkeeping. Idempotent.
  const finishExit = (el: HTMLElement): void => {
    exiting.delete(el)
    registry.delete(el)
    pending.delete(el)
    handovers.delete(el)
    const unregister = exitValues.get(el)
    exitValues.delete(el)
    if (Predicate.isNotUndefined(unregister)) unregister()
    el.remove()
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
    const fiber = exiting.get(el)
    if (Predicate.isNotUndefined(fiber)) {
      debug("exit: interrupt")
      runtime.runFork(Fiber.interrupt(fiber))
    }
    const drop = handovers.get(el)
    if (Predicate.isNotUndefined(drop)) drop()
    finishExit(el)
  }

  // A leaving child that isn't a twin (ADR-0010 *Amendment (#181)*): it hands back the twins inside
  // it, then runs its own exit, and goes once both have ended.
  const leave = (rec: PresenceRecord): void => {
    const el = rec.element
    const drop = projection.handBackWithin(el, () => partDone(el))
    pending.set(el, 1)
    if (Option.isSome(drop)) {
      handovers.set(el, drop.value)
      pending.set(el, 2)
      debug("leave: hands back its twins")
    }
    driveExit(rec)
  }

  // Drive the parent-owned exit for a leaving node: from its last snapshot
  // toward its exit target, committing each projected frame onto the (retained)
  // element, removing it on settle. Empty exit -> immediate removal.
  const driveExit = (rec: PresenceRecord): void => {
    const el = rec.element
    const exit = rec.exit.current
    if (isEmpty(exit)) {
      debug("exit: immediate (no target)")
      partDone(el)
      return
    }

    // Split the exit target into numeric (spring) + string keys, which follow the same
    // spring's progress (springBlend, ADR-0024); seed from the child's last snapshot so the
    // exit departs continuously. An exit key the
    // child never animated starts from its Base value's start links (ADR-0022), else at
    // its target.
    const snapshot = rec.snapshot.current
    const startOf = (key: string, target: number | string): number | string =>
      UndefinedOr.match(UndefinedOr.match(rec.startOf, { onUndefined: constUndefined, onDefined: (of) => of(key, target) }), {
        onUndefined: () => target,
        onDefined: identity,
      })
    const from: Values.Values = {
      ...snapshot,
      ...Rec.map(Rec.filter(exit, (_, key) => Predicate.isUndefined(snapshot[key])), (target, key) => startOf(key, target)),
    }
    // Reduced motion (ADR-0029), read now: the exit's positional keys snap to their target on its
    // first tick, and the rest animate.
    const { positional, rest } = Bool.match(reducedMotion(), {
      onTrue: () => ReducedMotion.split(exit, positionalKeys),
      onFalse: (): ReducedMotion.Split => ({ positional: {}, rest: exit }),
    })
    const snapped = Object.keys(positional).length
    const { numbers: numericTo, strings: stringTo } = Values.split(rest)
    const fromNumeric = Values.split(from).numbers
    const hasNumeric = Object.keys(numericTo).length > 0
    const hasStrings = Object.keys(stringTo).length > 0

    // Accumulate the merged latest value-map so each committed frame carries the
    // full set of keys (numeric + string collapse into one projected Patch).
    const latest: Values.Values = { ...from, ...exit }
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

    // The numeric keys and the string keys as two runs on the Frame loop (ADR-0027), side by
    // side: the exit ends once both settle.
    const runs: Array<Effect.Effect<unknown, never, WardicServices>> = []
    if (snapped > 0) runs.push(ReducedMotion.snap(Values.pick(from, positional), positional).pipe(Machine.run(commitFrame)))
    if (hasNumeric) runs.push(Machine.springValues(numericTo, EXIT_SPRING, fromNumeric).pipe(Machine.run(commitFrame)))
    // The leaving element's Variable values (#55): a `var()` end blends what it resolves to on it.
    if (hasStrings) {
      runs.push(
        Machine.springBlend(Values.pick(from, stringTo), stringTo).pipe(
          InterpolatorRegistry.withKeyRules([Variables.values(el)]),
          Effect.flatMap(Machine.run(commitFrame)),
        ),
      )
    }

    // One `wardic.presence.exit` span spans the whole exit animation (from the last
    // snapshot to the exit target), so a devtool/timeline shows each parent-driven
    // exit as a bar with its key counts. Removal-on-settle is the span's end. A failed run
    // is logged and reported (ADR-0030, decision 4); the node is removed either way.
    const fiber = runtime.runFork(
      Effect.all(runs, { concurrency: "unbounded", discard: true }).pipe(
        Effect.tapCause((cause) => Report.failure("wardic.presence: an exit failed", cause)),
        Effect.ensuring(Effect.sync(() => partDone(el))),
        Effect.withSpan(
          "wardic.presence.exit",
          { attributes: { numeric: Object.keys(numericTo).length, strings: Object.keys(stringTo).length, snapped } },
          // No call-site stack (ADR-0040, decision 2): pipeable, it's the third argument.
          { captureStackTrace: false },
        ),
      ),
    )
    exiting.set(el, fiber)
  }

  // The element that was present on the PREVIOUS effect run + its DOM position at
  // the time it was present, so we can RE-ATTACH it after Solid's branch disposal
  // detaches it (node retention).
  let prevEl: HTMLElement | undefined
  let prevParent: ParentNode | undefined
  let prevNext: ChildNode | undefined

  // Teardown: interrupt every in-flight exit + remove retained nodes, the twins they handed back
  // dropped with them (no leaks). Every child running its own exit is in `pending`.
  const teardown = (): void => {
    debug("teardown", { inflight: exiting.size, retained: pending.size })
    Arr.forEach(Arr.fromIterable(pending.keys()), (el) => interruptExit(el))
  }

  const present = (current: unknown): void => {
    const currentEl = Option.getOrUndefined(Option.liftPredicate(current, isHTMLElement))

    // present -> absent: the child left. If we hold a registration for the node
    // that JUST left, retain it (re-attach if Solid already detached it) and
    // drive its exit.
    if (Predicate.isNotUndefined(prevEl) && currentEl !== prevEl) {
      const rec = registry.get(prevEl)
      if (Predicate.isNotUndefined(rec) && !exiting.has(prevEl)) {
        // RE-INSERT: Solid's <Show> branch disposal may have already removed
        // the node. Re-append it (at its prior sibling position when available)
        // into the parent it lived in, so the parent-driven exit has a mounted
        // node to animate. Without this the node would simply vanish.
        if (prevEl.parentNode === null && Predicate.isNotUndefined(prevParent)) reinsert(prevEl, prevParent, prevNext)
        // Shared-element crossfade (ADR-0010): if the projection has a live twin
        // (Lead) to crossfade toward, defer to it — it drives the retained node as
        // a leaving Follower and calls onDone (-> finishExit) on the lead's settle.
        // Otherwise (no twin / no layoutId) run the normal exit animation.
        const leavingEl = prevEl // narrowed const (prevEl is a reassigned `let`)
        const crossfaded = projection.handleLeave(leavingEl, () => finishExit(leavingEl))
        if (crossfaded) debug("leave: crossfade (deferred to projection)")
        if (Bool.not(crossfaded)) leave(rec)
      }
    }

    // A fresh child re-entered while an OLD node (different element) is still
    // exiting -> interrupt every stale exit (v0.1: clean interrupt, no reuse).
    // One hosting the handovers of twins it handed back finishes beside the new one (#181).
    if (Predicate.isNotUndefined(currentEl)) {
      Arr.forEach(Arr.fromIterable(exiting.keys()), (el) => {
        if (el === currentEl || handovers.has(el)) return
        interruptExit(el)
      })
    }

    // Record the present node + its DOM position for the next diff/retention.
    prevEl = currentEl
    if (Predicate.isNotUndefined(currentEl)) {
      prevParent = Option.getOrUndefined(Option.fromNullOr(currentEl.parentNode))
      prevNext = Option.getOrUndefined(Option.fromNullOr(currentEl.nextSibling))
    }
  }

  return {
    context: ctx,
    mounted: () => {
      firstRender = false
    },
    present,
    teardown,
  }
}
