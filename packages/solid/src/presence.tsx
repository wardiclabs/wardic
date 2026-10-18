/**
 * `<AnimatePresence>` — exit-before-unmount for a single child (ADR-0007).
 *
 * Doctrine: the LEAVING child cannot animate its own exit — Solid disposes its
 * reactive owner (and would remove its DOM node) the instant the `<Show>` (or
 * other control flow) that renders it flips false. So exit is PARENT-DRIVEN:
 *
 *   1. While a child is alive, its `createWard` spine REGISTERS a record with the
 *      nearest `<AnimatePresence>` via {@link PresenceContext}. The record holds
 *      two LIVE mutable refs: `snapshot.current` (the latest emitted value-map,
 *      updated each frame by the spine) and `exit.current` (the exit target,
 *      kept current by a `createEffect` reading `cfg().exit`). The child does NOT
 *      unregister on its own `onCleanup` — `<AnimatePresence>` owns removal.
 *   2. `<AnimatePresence>` resolves its child via Solid `children()` and tracks
 *      the currently-present element. When the resolved child goes present ->
 *      absent AND a registration exists for that element, it RE-INSERTS / KEEPS
 *      that DOM node in its own container instead of letting it vanish, then runs
 *      the exit animation itself (from `snapshot.current` toward `exit.current`
 *      via the provider runtime + the Renderer's `project`/`commit`), and on the
 *      exit's settle removes the node from the DOM and the registration.
 *   3. If `exit.current` is empty/undefined the node is removed immediately.
 *
 * Node retention (the hard part): mirrors solid-transition-group's single-child
 * approach. We resolve `children()` (which returns the live DOM node) and, when
 * the reactive branch drops it, RE-APPEND the captured node to our container so
 * the disposed owner's removal is undone — the node survives long enough for the
 * parent-driven exit, then we remove it on settle. The registration's snapshot /
 * exit refs are plain objects that outlive the child's owner, so the exit has
 * everything it needs after the child is gone.
 *
 * v0.1 scope: a SINGLE child. A re-entry while the previous node is still
 * exiting INTERRUPTS the exiting node (its fiber is interrupted + node removed);
 * full mid-exit reuse is deferred. One hosting the handovers of twins it handed
 * back is left to finish beside the new one (ADR-0010 *Amendment (#181)*).
 *
 * A leaving child that isn't a twin hands back the twins inside it (#181): each
 * crossfades onto its other twin while the child runs its own exit, and the child
 * goes once both have ended. Its exit's values reach the projection, so a twin
 * inside stays on its other twin while the exit moves or scales the child.
 */
import type * as Frame from "@wardic/core/Frame"
import type * as FrameLoop from "@wardic/core/FrameLoop"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as Renderer from "@wardic/core/Renderer"
import * as Values from "@wardic/core/Values"
import * as Machine from "@wardic/core/Machine"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Report from "@wardic/dom/Report"
import * as Variables from "@wardic/dom/Variables"
import { constFalse, constUndefined, identity } from "effect/Function"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import { children, createContext, createEffect, type JSX, onCleanup, onMount, useContext } from "solid-js"
import { useWardicProjection, useWardicPositionalKeys, useWardicReducedMotion, useWardicRuntime, type WardicServices } from "./provider.tsx"
import { isServer } from "./server.ts"

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
  /** The exit target, kept current by the child while alive. */
  readonly exit: { current: Values.Values }
  /**
   * Where an exit key with no value in `snapshot` starts (ADR-0022): its `style` value, else
   * the element's Own value, read from the retained node at the exit, in the shape of `like`
   * (the key's exit target). `undefined` starts it at its target. Optional: a record without
   * it starts such a key at its target.
   */
  readonly startOf?: ((key: string, like: number | string) => number | string | undefined) | undefined
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
}

/** Whether `presence` holds an element setting up now at its `animate` ({@link PresenceContextValue.blocksInitial}). */
export const presenceBlocksInitial = (presence: PresenceContextValue | undefined): boolean =>
  UndefinedOr.match(presence, {
    onUndefined: constFalse,
    onDefined: (p) => UndefinedOr.match(p.blocksInitial, { onUndefined: constFalse, onDefined: (blocks) => blocks() }),
  })

/**
 * Context carrying the nearest `<AnimatePresence>`'s registrar. `undefined` when
 * there is no presence in scope — `createWard` then skips exit registration.
 */
export const PresenceContext = createContext<PresenceContextValue | undefined>(undefined)

/** Read the nearest {@link PresenceContext}, or `undefined` outside one. */
export const usePresenceContext = (): PresenceContextValue | undefined => useContext(PresenceContext)

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

/** {@link AnimatePresence}'s props. */
export interface AnimatePresenceProps {
  readonly children: JSX.Element
  /**
   * `false`: the child present at this presence's first render starts at its `animate`, with no
   * enter animation (it and every Wardic element under it, as Motion's); a child that enters later
   * animates in from its `initial`. Exits are unchanged (#134). On a server, the rendered child.
   */
  readonly initial?: boolean
}

/**
 * `<AnimatePresence>` — wraps a single (optionally conditional) child and
 * animates its exit before unmount. Must be used inside a `<WardicProvider>`
 * (it drives the exit on the provider runtime) and may wrap any control flow
 * (e.g. `<Show>`); the leaving child must be a `wardic.*` element / `createWard`
 * spine under this presence so it registers an exit record.
 */
export function AnimatePresence(props: AnimatePresenceProps): JSX.Element {
  const runtime = useWardicRuntime()
  const reducedMotion = useWardicReducedMotion()
  const positionalKeys = useWardicPositionalKeys()
  // A server render has no exit to drive and no runtime to log on: the same component
  // boundaries, with a context that registers nothing (ADR-0021).
  if (isServer) return serverPresence(props)
  const projection = useWardicProjection()
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
  onMount(() => {
    firstRender = false
  })

  const ctx: PresenceContextValue = {
    register: (rec) => {
      registry.set(rec.element, rec)
      return () => {
        registry.delete(rec.element)
      }
    },
    blocksInitial: () => props.initial === false && firstRender,
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

  // Inner tracker: resolved + the tracking effect MUST run UNDER the
  // PresenceContext.Provider, so the children's reactive owners are created
  // within the context and their `createWard` spines see `usePresenceContext()`.
  // (Resolving children() in the outer body would put their owners ABOVE the
  // provider and they'd never register an exit record.)
  const Tracker = (): JSX.Element => {
    // children() memoizes the resolved value; a <Show> flip changes what it
    // returns (the node -> undefined and back).
    const resolved = children(() => props.children)

    createEffect(() => {
      const current = resolved()
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
    })

    return resolved as unknown as JSX.Element
  }

  // Teardown: interrupt every in-flight exit + remove retained nodes, the twins they handed back
  // dropped with them (no leaks). Every child running its own exit is in `pending`.
  onCleanup(() => {
    debug("teardown", { inflight: exiting.size, retained: pending.size })
    Arr.forEach(Arr.fromIterable(pending.keys()), (el) => interruptExit(el))
  })

  return (
    <PresenceContext.Provider value={ctx}>
      <Tracker />
    </PresenceContext.Provider>
  )
}

/** {@link AnimatePresence} during a server render: the client's boundaries, nothing to track. */
const serverPresence = (props: AnimatePresenceProps): JSX.Element => {
  // A server renders once: every child is set up with the first render (#134).
  const ctx: PresenceContextValue = { register: () => () => {}, blocksInitial: () => props.initial === false }
  const Tracker = (): JSX.Element => children(() => props.children) as unknown as JSX.Element
  return (
    <PresenceContext.Provider value={ctx}>
      <Tracker />
    </PresenceContext.Provider>
  )
}
