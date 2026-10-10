/**
 * `<AnimatePresence>` — exit-before-unmount for a single child (ADR-0007).
 *
 * Doctrine: the LEAVING child cannot animate its own exit — Solid disposes its
 * reactive owner (and would remove its DOM node) the instant the `<Show>` (or
 * other control flow) that renders it flips false. So exit is PARENT-DRIVEN:
 *
 *   1. While a child is alive, its `useWardic` spine REGISTERS a record with the
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
 * full mid-exit reuse is deferred.
 */
import type * as Frame from "@wardic/core/Frame"
import type * as FrameLoop from "@wardic/core/FrameLoop"
import * as Renderer from "@wardic/core/Renderer"
import type * as Values from "@wardic/core/Values"
import * as Machine from "@wardic/core/Machine"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { children, createContext, createEffect, type JSX, onCleanup, useContext } from "solid-js"
import { useWardicProjection, useWardicRuntime, type WardicServices } from "./provider.tsx"
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

/** The value `<AnimatePresence>` publishes to descendant `useWardic` spines. */
export interface PresenceContextValue {
  /**
   * Register a child's live record. Returns a disposer the registrant MAY call,
   * but the child does NOT call it on its own `onCleanup` — `<AnimatePresence>`
   * removes the registration after the exit completes.
   */
  readonly register: (rec: PresenceRecord) => () => void
}

/**
 * Context carrying the nearest `<AnimatePresence>`'s registrar. `undefined` when
 * there is no presence in scope — `useWardic` then skips exit registration.
 */
export const PresenceContext = createContext<PresenceContextValue | undefined>(undefined)

/** Read the nearest {@link PresenceContext}, or `undefined` outside one. */
export const usePresenceContext = (): PresenceContextValue | undefined => useContext(PresenceContext)

/** Pull the numeric subset of a value-map (the spring-able keys). */
const numericOf = (values: Values.Values): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const key in values) {
    const v = values[key]
    if (typeof v === "number") out[key] = v
  }
  return out
}

/** Whether a value-map has any keys (an empty exit means "remove immediately"). */
const isEmpty = (values: Values.Values): boolean => {
  for (const _ in values) return false
  return true
}

/**
 * `<AnimatePresence>` — wraps a single (optionally conditional) child and
 * animates its exit before unmount. Must be used inside a `<WardicProvider>`
 * (it drives the exit on the provider runtime) and may wrap any control flow
 * (e.g. `<Show>`); the leaving child must be a `wardic.*` element / `useWardic`
 * spine under this presence so it registers an exit record.
 */
export function AnimatePresence(props: { readonly children: JSX.Element }): JSX.Element {
  const runtime = useWardicRuntime()
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
    runtime.runFork(
      annotations !== undefined
        ? Effect.logDebug(`wardic.presence: ${event}`).pipe(Effect.annotateLogs(annotations))
        : Effect.logDebug(`wardic.presence: ${event}`),
    )
  }

  // The registry of live child records, keyed by their DOM element. Filled by
  // register() (called from the child's spine on mount), drained as children
  // leave (after their exit settles).
  const registry = new Map<HTMLElement, PresenceRecord>()

  // In-flight exit fibers keyed by the leaving node, so a re-entry (or this
  // component's own teardown) can interrupt them.
  const exiting = new Map<HTMLElement, Fiber.Fiber<void, never>>()

  const ctx: PresenceContextValue = {
    register: (rec) => {
      registry.set(rec.element, rec)
      return () => {
        registry.delete(rec.element)
      }
    },
  }

  // Commit a projected value-map onto a retained node via the Renderer.
  const commitValues = (el: HTMLElement, values: Values.Values): void => {
    const patch: Renderer.Patch = project(values)
    runtime.runSync(commit(el, patch))
  }

  // Remove a retained node from the DOM + drop its registration + clear its
  // in-flight fiber bookkeeping. Idempotent.
  const finishExit = (el: HTMLElement): void => {
    exiting.delete(el)
    registry.delete(el)
    el.remove()
  }

  // Interrupt an in-flight exit for `el` (re-entry / teardown) and remove the
  // retained node. Idempotent.
  const interruptExit = (el: HTMLElement): void => {
    const fiber = exiting.get(el)
    if (fiber !== undefined) {
      debug("exit: interrupt")
      runtime.runFork(Fiber.interrupt(fiber))
    }
    finishExit(el)
  }

  // Drive the parent-owned exit for a leaving node: from its last snapshot
  // toward its exit target, committing each projected frame onto the (retained)
  // element, removing it on settle. Empty exit -> immediate removal.
  const driveExit = (rec: PresenceRecord): void => {
    const el = rec.element
    const exit = rec.exit.current
    if (isEmpty(exit)) {
      debug("exit: immediate (no target)")
      finishExit(el)
      return
    }

    // Split the exit target into numeric (spring) + string keys, which follow the same
    // spring's progress (springBlend, ADR-0024); seed from the child's last snapshot so the
    // exit departs continuously. An exit key the
    // child never animated starts from its Base value's start links (ADR-0022), else at
    // its target.
    const from: Values.Values = { ...rec.snapshot.current }
    for (const key in exit) {
      if (from[key] !== undefined) continue
      const start = rec.startOf?.(key, exit[key]!)
      from[key] = start ?? exit[key]!
    }
    const numericTo: Record<string, number> = {}
    const stringTo: Values.Values = {}
    for (const key in exit) {
      const v = exit[key]
      if (typeof v === "number") numericTo[key] = v
      else if (v !== undefined) stringTo[key] = v
    }
    const fromNumeric = numericOf(from)
    const hasNumeric = Object.keys(numericTo).length > 0
    const hasStrings = Object.keys(stringTo).length > 0

    // Accumulate the merged latest value-map so each committed frame carries the
    // full set of keys (numeric + string collapse into one projected Patch).
    const latest: Values.Values = { ...from, ...exit }
    const commitFrame: FrameLoop.Sink<Frame.Frame<Values.Values>> = (frame) => {
      Object.assign(latest, frame.value)
      commitValues(el, latest)
      return undefined
    }

    // The numeric keys and the string keys as two runs on the Frame loop (ADR-0027), side by
    // side: the exit ends once both settle.
    const runs: Array<Effect.Effect<unknown, never, WardicServices>> = []
    if (hasNumeric) runs.push(Machine.springValues(numericTo, {}, fromNumeric, {}).pipe(Machine.run(commitFrame)))
    if (hasStrings) runs.push(Machine.springBlend(pick(from, stringTo), stringTo).pipe(Effect.flatMap(Machine.run(commitFrame))))

    // One `wardic.presence.exit` span spans the whole exit animation (from the last
    // snapshot to the exit target), so a devtool/timeline shows each parent-driven
    // exit as a bar with its key counts. Removal-on-settle is the span's end.
    const fiber = runtime.runFork(
      Effect.all(runs, { concurrency: "unbounded", discard: true }).pipe(
        Effect.ensuring(Effect.sync(() => finishExit(el))),
        Effect.withSpan("wardic.presence.exit", {
          attributes: { numeric: Object.keys(numericTo).length, strings: Object.keys(stringTo).length },
        }),
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
  // within the context and their `useWardic` spines see `usePresenceContext()`.
  // (Resolving children() in the outer body would put their owners ABOVE the
  // provider and they'd never register an exit record.)
  const Tracker = (): JSX.Element => {
    // children() memoizes the resolved value; a <Show> flip changes what it
    // returns (the node -> undefined and back).
    const resolved = children(() => props.children)

    createEffect(() => {
      const current = resolved()
      const currentEl = current instanceof HTMLElement ? current : undefined

      // present -> absent: the child left. If we hold a registration for the node
      // that JUST left, retain it (re-attach if Solid already detached it) and
      // drive its exit.
      if (prevEl !== undefined && currentEl !== prevEl) {
        const rec = registry.get(prevEl)
        if (rec !== undefined && !exiting.has(prevEl)) {
          // RE-INSERT: Solid's <Show> branch disposal may have already removed
          // the node. Re-append it (at its prior sibling position when available)
          // into the parent it lived in, so the parent-driven exit has a mounted
          // node to animate. Without this the node would simply vanish.
          if (prevEl.parentNode === null && prevParent !== undefined) {
            if (prevNext !== undefined && prevNext.parentNode === prevParent) {
              prevParent.insertBefore(prevEl, prevNext)
            } else {
              prevParent.appendChild(prevEl)
            }
          }
          // Shared-element crossfade (ADR-0010): if the projection has a live twin
          // (Lead) to crossfade toward, defer to it — it drives the retained node as
          // a leaving Follower and calls onDone (-> finishExit) on the lead's settle.
          // Otherwise (no twin / no layoutId) run the normal exit animation.
          const leavingEl = prevEl // narrowed const (prevEl is a reassigned `let`)
          const crossfaded = projection.handleLeave(leavingEl, () => finishExit(leavingEl))
          if (crossfaded) debug("leave: crossfade (deferred to projection)")
          else driveExit(rec)
        }
      }

      // A fresh child re-entered while an OLD node (different element) is still
      // exiting -> interrupt every stale exit (v0.1: clean interrupt, no reuse).
      if (currentEl !== undefined) {
        for (const el of [...exiting.keys()]) {
          if (el !== currentEl) interruptExit(el)
        }
      }

      // Record the present node + its DOM position for the next diff/retention.
      prevEl = currentEl
      if (currentEl !== undefined) {
        prevParent = currentEl.parentNode ?? undefined
        prevNext = currentEl.nextSibling ?? undefined
      }
    })

    return resolved as unknown as JSX.Element
  }

  // Teardown: interrupt every in-flight exit + remove retained nodes (no leaks).
  onCleanup(() => {
    debug("teardown", { inflight: exiting.size })
    for (const el of [...exiting.keys()]) interruptExit(el)
  })

  return (
    <PresenceContext.Provider value={ctx}>
      <Tracker />
    </PresenceContext.Provider>
  )
}

/** Pick the keys of `keysFrom` out of `source` (the from-values for strings). */
const pick = (source: Values.Values, keysFrom: Values.Values): Values.Values => {
  const out: Values.Values = {}
  for (const key in keysFrom) {
    const v = source[key]
    if (v !== undefined) out[key] = v
  }
  return out
}

/** {@link AnimatePresence} during a server render: the client's boundaries, nothing to track. */
const serverPresence = (props: { readonly children: JSX.Element }): JSX.Element => {
  const ctx: PresenceContextValue = { register: () => () => {} }
  const Tracker = (): JSX.Element => children(() => props.children) as unknown as JSX.Element
  return (
    <PresenceContext.Provider value={ctx}>
      <Tracker />
    </PresenceContext.Provider>
  )
}
