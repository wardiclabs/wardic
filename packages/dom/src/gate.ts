/**
 * `makeFlushGate` — the reactive bridge's deferred **Flush gate** (ADR-0006), framework-free
 * here in `@wardic/dom` so every binding shares one (ADR-0031, decision 3). The binding hands in
 * its `batch` and its sinks; the gate imports nothing from a framework.
 *
 * Per ADR-0006 ("Reactive bridge: per-element Stream→signal with a deferred
 * flush gate"), per-frame writes do not set their binding's cell (a Solid signal)
 * directly. Instead each source `write(id, partialValues)`s into a provider-owned gate
 * that:
 *
 *   1. Accumulates *value-maps* (NOT already-projected Patches) per element,
 *      merging partials by key — so multiple sources can feed one element
 *      (e.g. a drag setting `x`/`y` while a spring drives `scale`, all
 *      collapsing into one grouped `transform`). Projecting per source would
 *      clobber the grouped transform.
 *   2. Resolves the Renderer's PURE `project` ONCE at creation and uses it to
 *      turn each dirty element's merged value-map into a `Patch` exactly once
 *      per element per frame.
  *   3. Applies every resulting Patch inside a SINGLE `batch` per frame (the
 *      binding's: Solid's `batch()`), regardless of element count — one reactive
 *      flush + one DOM pass per frame, shared by every element: at the end of the
 *      Frame loop's tick, in the Refresh frame that computed the values (ADR-0033).
 *
 * Three locked design decisions (this session's grills):
 *   - FLUSHED at the end of the Frame loop's tick (ADR-0033): the gate registers a hook on
 *     the Environment's loop (`afterTick`), so everything a tick writes is applied at the end
 *     of that tick, inside the Clock's callback, and paints in that Refresh frame. A write
 *     made outside a tick (a drag's move, a `release` from a task, an effect inside a flush's
 *     `batch`, a Tier 2 `Stream` on `Clock.ticks` subscribed after the loop) still requests a
 *     Refresh frame, only if one is not already pending, and the hook withdraws that request
 *     when it flushes first. `flush` does NOT auto-reschedule, so an idle accumulator
 *     requests no frames — the next `write` does. The frames come from the Environment's
 *     `RefreshFrameSource` (ADR-0031): on the web, `requestAnimationFrame` itself. No binding
 *     calls the browser's frame functions itself. A Tier 2 `Stream` that writes here paints in
 *     the loop's frame or the next one, by its subscription order (ADR-0033): run it on the
 *     loop (`Machine.run`) to paint with it.
 *   - ONE `batch()` per frame: all dirty elements flush together. The one exception
 *     is `flushPass` (ADR-0018): a projection Measure pass's own writes are applied
 *     at the end of its task, so a new layout never paints without its projection.
 *   - TWO sink modes: a *signal sink* (`{ kind: "signal", set }`) sets the
 *     element's cell (in Solid, the default for `wardic.create("div")`, a signal); a
 *     *commit sink* (`{ kind: "commit", target }`) runs `Renderer.commit(target,
 *     patch)` via a forwarded ref (used for `wardic.create(Component)` wraps).
 *     Both share the same merge + one-`project`-per-frame + single-`batch()`.
 *     A commit sink also removes a key its last patch had and this one doesn't (a
 *     dragged node's `z-index` once its raise is dropped, ADR-0016 *Amendment
 *     (Reorder)*), restoring the element's own inline value, saved before the gate
 *     first wrote the key. A signal sink needs nothing: its next patch lacks the key.
 *
 * Observability (CONTEXT.md convention): the hot path (`write`/`flush`) is the
 * per-frame work, so — exactly like core's per-frame writes and the Clock's
 * `tick` — it stays quiet (no span, no per-call log, no metric). A flush that throws (an
 * effect inside the binding's `batch`, a commit) is reported (`reportFailure`) and the gate
 * goes on, so it can't fail the Frame loop's tick it runs in (ADR-0033).
 */
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import * as Renderer from "@wardic/core/Renderer"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as ManagedRuntime from "effect/ManagedRuntime"
import * as Scope from "effect/Scope"
import { reportFailure } from "./report.ts"
import { dashCase } from "./svg.ts"

/**
 * Where a flushed `Patch` is delivered:
 *   - `signal`: set the element's cell with the patch (in Solid, its signal).
 *   - `commit`: write the patch onto `target` via `Renderer.commit` (run on the
 *     provider runtime at flush time).
 */
export type FlushSink =
  | { readonly kind: "signal"; readonly set: (patch: Renderer.Patch) => void }
  | {
    readonly kind: "commit"
    readonly target: unknown
    /**
     * Called once, just before the element's first commit in a frame flush (not a Measure
     * pass's `flushPass`), outside the frame's `batch` (ADR-0021, decision 6): a component
     * wrap drops its Starting style from its `style` prop here, so the binding removes those keys
     * and the commit writes the first frame in the same Refresh frame, with no paint in
     * between.
     */
    readonly beforeFirstCommit?: (() => void) | undefined
  }

/** Accumulated pre-`project` state for one registered element. */
interface Entry {
  /** Merged value-map (partials `Object.assign`ed in by key). */
  readonly values: Record<string, unknown>
  /** Where this element's projected Patch goes. */
  readonly sink: FlushSink
  /** Whether a `write` has landed since the last flush. */
  dirty: boolean
  /**
   * A commit sink's keys its last patch wrote, each with the element's own inline value
   * from before the gate first wrote it (`""` for none), to restore when the key drops
   * out. Unused by a signal sink.
   */
  readonly committed: Map<string, string>
}

/** The element's own inline value for a patch key (`""` for none, or a target with no style). */
const inlineValueOf = (target: unknown, key: string): string =>
  (target as { readonly style?: CSSStyleDeclaration } | undefined)?.style?.getPropertyValue(dashCase(key)) ?? ""

/** The provider-owned flush gate (one per `WardicProvider`). */
export interface FlushGate {
  /**
   * Register an element under `id` with its `sink`. Returns an unregister fn
   * that removes the element from the accumulator (a subsequent `write` is a
   * no-op).
   */
  readonly register: (id: string, sink: FlushSink) => () => void
  /**
   * Merge `partial` into the element's value-map by key, mark it dirty, and
   * schedule a flush: the end of the Frame loop's tick, for a write made in one, or else the
   * next Refresh frame (ADR-0033). A `write` for an unregistered (or unregistered-since) id
   * is a no-op.
   */
  readonly write: (id: string, partial: Record<string, unknown>) => void
  /**
   * Run a projection **Measure pass** now and apply exactly what it wrote before
   * returning (ADR-0018, and ADR-0006's *Amendment (#2)*). Only `write()`s made while
   * `pass()` runs are recorded; each recorded entry is `project`ed once and applied inside
   * ONE `batch`, and marked clean. Everything else stays dirty for its flush. A write made by
   * an effect that runs inside that `batch` (a Solid effect) takes the ordinary path. The projection engine calls it at the end of a task, so a new
   * layout never paints without its projection.
   */
  readonly flushPass: (pass: () => void) => void
  /**
   * Hand `keys` back to the element's own style (ADR-0022): drop each from the element's
   * value-map and schedule a flush. A signal sink's next patch lacks them, so the user's
   * style shows; a commit sink writes `restore[key]` (CSS text) for a key it had written, or
   * else the inline value it overwrote. A key the entry doesn't hold, or an unknown id, is
   * a no-op. The spine releases a key back at its `style` value, so a later `style` change
   * shows at rest. A later `write` brings the key back.
   */
  readonly release: (id: string, keys: ReadonlyArray<string>, restore?: Readonly<Record<string, string>>) => void
  /**
   * Take the gate's hook off the Frame loop, cancel any pending frame and clear the
   * accumulator. Wired into the provider's `onCleanup`.
   */
  readonly dispose: () => void
}

/**
 * The runtime a flush gate needs: one that provides the `Renderer`, the Frame loop it flushes at
 * the end of each tick of (ADR-0033), and the Environment's
 * `RefreshFrameSource` (ADR-0031). A binding's wider runtime (one providing the full
 * Environment) is assignable here.
 */
export type FlushGateRuntime = ManagedRuntime.ManagedRuntime<
  Renderer.Renderer | RefreshFrameSource.RefreshFrameSource | FrameLoop.FrameLoop,
  never
>

/** What a binding hands its flush gate. */
export interface FlushGateOptions {
  /**
   * Apply a flush's writes: run `apply`, and return once every cell write inside it will reach
   * the screen before the next paint (ADR-0031, decision 3). Solid 1 passes its `batch`. A
   * binding whose sinks all commit passes `(apply) => apply()`; React, with state sinks, would
   * pass `flushSync` (inferred). Called once per frame flush and once per `flushPass`.
   */
  readonly batch: (apply: () => void) => void
}

/**
 * Build a flush gate against the provider's `runtime`, applying each flush through the
 * binding's `batch`.
 *
 * Resolves both ONCE here: `project` is pure (called directly at flush), `commit` returns an
 * `Effect` (run via `runtime.runSync` at flush for commit sinks), `requestFrame` /
 * `cancelFrame` schedule and cancel the flush of a write made outside a tick, and the Frame
 * loop's `afterTick` takes the gate's hook for its lifetime. All come from whichever env the
 * provider was given (`DomLive` / `TestLive`), so the gate inherits that environment's
 * grouping/unit logic, its Refresh frames and its loop with zero duplication.
 */
export const makeFlushGate = (runtime: FlushGateRuntime, options: FlushGateOptions): FlushGate => {
  const { batch } = options
  // Resolve the Renderer's two halves and the Refresh frame source exactly once at creation.
  // `requestFrame` and `cancelFrame` are called detached, never as `frames.requestFrame(cb)`: a
  // browser throws "Illegal invocation" when `requestAnimationFrame` runs with `this` bound to
  // anything but the window (ADR-0031, decision 7).
  const { commit, project, requestFrame, cancelFrame, afterTick } = runtime.runSync(
    Effect.gen(function* () {
      const { commit, project } = yield* Renderer.Renderer
      const { requestFrame, cancelFrame } = yield* RefreshFrameSource.RefreshFrameSource
      const { afterTick } = yield* FrameLoop.FrameLoop
      return { commit, project, requestFrame, cancelFrame, afterTick }
    }),
  )

  const accumulator = new Map<string, Entry>()
  // Commit sinks waiting for their first commit's `beforeFirstCommit` (usually empty).
  const firstCommits = new Set<string>()
  let scheduled = false
  // The pending Refresh frame's handle, while `scheduled`.
  let frame: unknown
  // The ids written while a `flushPass` pass runs; `undefined` otherwise.
  let recording: Set<string> | undefined

  /** Project and apply one dirty entry (once per element per flush), marking it clean. */
  const apply = (entry: Entry): void => {
    const patch = project(entry.values)
    entry.dirty = false
    if (entry.sink.kind === "signal") {
      entry.sink.set(patch)
      return
    }
    const target = entry.sink.target
    const committed = entry.committed
    const before = committed.size
    let kept = 0
    for (const key in patch) {
      if (committed.has(key)) kept++
      else committed.set(key, inlineValueOf(target, key))
    }
    // A key the last patch wrote and this one doesn't: the element gets its own value
    // back. Only looked for when one dropped out (the usual frame keeps every key).
    let restore: Renderer.Patch | undefined
    if (kept < before) {
      for (const [key, own] of committed) {
        if (key in patch) continue
        ;(restore ??= {})[key] = own
        committed.delete(key)
      }
    }
    if (restore !== undefined) runtime.runSync(commit(target, restore))
    runtime.runSync(commit(target, patch))
  }

  /**
   * Run `beforeFirstCommit` for each waiting entry about to commit (dirty), outside the
   * batch so the binding applies what it changes before the commit. A wrap that never commits
   * stays waiting, so this loops over the wraps still waiting, once per frame flush.
   */
  const runFirstCommits = (): void => {
    for (const id of firstCommits) {
      const entry = accumulator.get(id)
      if (entry === undefined || !entry.dirty) continue
      firstCommits.delete(id)
      if (entry.sink.kind === "commit") entry.sink.beforeFirstCommit?.()
    }
  }

  const flush = (): void => {
    scheduled = false
    try {
      if (firstCommits.size > 0) runFirstCommits()
      // One batch per frame for every dirty element. No auto-reschedule — the next
      // write() does. A write() from an effect running inside the batch requests the
      // next frame (it isn't stranded).
      batch(() => {
        for (const entry of accumulator.values()) if (entry.dirty) apply(entry)
      })
    } catch (defect) {
      runtime.runFork(reportFailure("wardic.gate: a flush failed", Cause.die(defect)))
    }
  }

  /**
   * The end of the Frame loop's tick (ADR-0033): flush now, in the Refresh frame that computed
   * the values, and withdraw the frame the first write since the last flush requested.
   */
  const flushTicked = (): undefined => {
    if (!scheduled) return undefined
    cancelFrame(frame)
    flush()
    return undefined
  }

  const scheduleFlush = (): void => {
    if (scheduled) return
    scheduled = true
    frame = requestFrame(flush)
  }

  const register: FlushGate["register"] = (id, sink) => {
    accumulator.set(id, { values: {}, sink, dirty: false, committed: new Map() })
    if (sink.kind === "commit" && sink.beforeFirstCommit !== undefined) firstCommits.add(id)
    return () => {
      accumulator.delete(id)
      firstCommits.delete(id)
    }
  }

  const write: FlushGate["write"] = (id, partial) => {
    const entry = accumulator.get(id)
    if (entry === undefined) return
    Object.assign(entry.values, partial)
    entry.dirty = true
    recording?.add(id)
    scheduleFlush()
  }

  const flushPass: FlushGate["flushPass"] = (pass) => {
    const written = new Set<string>()
    recording = written
    try {
      pass()
    } finally {
      recording = undefined
    }
    if (written.size === 0) return
    // No `beforeFirstCommit` here: a Measure pass may write only a node's projection, and
    // dropping the Starting style then would leave its animated keys unset until the frame
    // flush (a frame later for an element mounted inside a frame). The frame flush switches.
    batch(() => {
      for (const id of written) {
        const entry = accumulator.get(id)
        if (entry !== undefined && entry.dirty) apply(entry)
      }
    })
  }

  const release: FlushGate["release"] = (id, keys, restore) => {
    const entry = accumulator.get(id)
    if (entry === undefined) return
    let released = false
    for (const key of keys) {
      if (!Object.hasOwn(entry.values, key)) continue
      delete entry.values[key]
      released = true
      // The drop-out path in `apply` writes the saved value back: make it the one handed in.
      const value = restore?.[key]
      if (value !== undefined && entry.committed.has(key)) entry.committed.set(key, value)
    }
    if (!released) return
    entry.dirty = true
    scheduleFlush()
  }

  const dispose: FlushGate["dispose"] = () => {
    Effect.runSync(Scope.close(ticks, Exit.void))
    if (scheduled) {
      cancelFrame(frame)
      scheduled = false
    }
    accumulator.clear()
    firstCommits.clear()
  }

  // The gate's hook on the loop, for the gate's lifetime.
  const ticks = Scope.makeUnsafe()
  runtime.runSync(afterTick(flushTicked).pipe(Scope.provide(ticks)))

  return { register, write, flushPass, release, dispose }
}

const noop = (): void => {}

/**
 * The gate a server render gets (ADR-0021, decision 9): a server builds no runtime and
 * flushes nothing, so `register` returns a no-op unregister and `write` / `flushPass` /
 * `release` / `dispose` do nothing. Code that grabs the gate at setup and uses it after mount keeps
 * working on the server. Every binding's server path hands it down (Tier 2, for binding authors).
 */
export const INERT_GATE: FlushGate = Object.freeze({
  register: () => noop,
  write: noop,
  flushPass: noop,
  release: noop,
  dispose: noop,
})
