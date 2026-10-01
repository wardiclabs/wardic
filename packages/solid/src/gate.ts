/**
 * `makeFlushGate` — the reactive bridge's deferred flush gate (ADR-0006).
 *
 * Per ADR-0006 ("Reactive bridge: per-element Stream→signal with a deferred
 * flush gate"), per-frame writes do not set their Solid signal directly.
 * Instead each source `write(id, partialValues)`s into a provider-owned gate
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
 *   3. Applies every resulting Patch inside a SINGLE Solid `batch()` per frame,
 *      regardless of element count — one reactive flush + one DOM pass per
 *      frame at a *constant* one-frame latency shared by every element.
 *
 * Three locked design decisions (this session's grills):
 *   - GATED rAF: a `write` schedules the rAF only if one is not already
 *     pending; `flush` does NOT auto-reschedule. An idle accumulator therefore
 *     schedules no frames — the next `write` reschedules. (Contrast the Clock's
 *     self-perpetuating ref-counted loop.)
 *   - ONE `batch()` per frame: all dirty elements flush together. The one exception
 *     is `flushPass` (ADR-0018): a projection Measure pass's own writes are applied
 *     at the end of its task, so a new layout never paints without its projection.
 *   - TWO sink modes: a *signal sink* (`{ kind: "signal", set }`) sets the
 *     per-element Solid signal (the default for `wardic.create("div")`); a
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
 * `tick` — it stays quiet (no span, no per-call log).
 */
import { type Patch, Renderer } from "@wardic/core"
import { dashCase } from "@wardic/dom"
import * as Effect from "effect/Effect"
import type * as ManagedRuntime from "effect/ManagedRuntime"
import { batch } from "solid-js"
import type { WardicServices } from "./provider.tsx"

/**
 * Where a flushed `Patch` is delivered:
 *   - `signal`: set the element's per-element Solid signal with the patch.
 *   - `commit`: write the patch onto `target` via `Renderer.commit` (run on the
 *     provider runtime at flush time).
 */
export type FlushSink =
  | { readonly kind: "signal"; readonly set: (patch: Patch) => void }
  | { readonly kind: "commit"; readonly target: unknown }

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
   * schedule a flush. A `write` for an unregistered (or unregistered-since) id
   * is a no-op.
   */
  readonly write: (id: string, partial: Record<string, unknown>) => void
  /**
   * Run a projection **Measure pass** now and apply exactly what it wrote before
   * returning (ADR-0018; the one exception ADR-0006's *Amendment (#2)* makes to the
   * one-frame latency). Only `write()`s made while `pass()` runs are recorded; each
   * recorded entry is `project`ed once and applied inside ONE Solid `batch()`, and
   * marked clean. Everything else stays dirty for the next Refresh frame. A write
   * made by a Solid effect that runs inside that `batch()` takes the ordinary
   * next-frame path. The projection engine calls it at the end of a task, so a new
   * layout never paints without its projection.
   */
  readonly flushPass: (pass: () => void) => void
  /**
   * Cancel any pending frame and clear the accumulator. Wired into the
   * provider's `onCleanup`.
   */
  readonly dispose: () => void
}

/**
 * Build a flush gate against the provider's `runtime`.
 *
 * Resolves the `Renderer` ONCE here: `project` is pure (called directly at
 * flush), `commit` returns an `Effect` (run via `runtime.runSync` at flush for
 * commit sinks). Both come from whichever env the provider was given
 * (`DomLive` / `TestLive`), so the gate inherits that environment's
 * grouping/unit logic with zero duplication.
 */
export const makeFlushGate = (
  runtime: ManagedRuntime.ManagedRuntime<WardicServices, never>,
): FlushGate => {
  // Resolve the Renderer's two halves exactly once at creation.
  const { commit, project } = runtime.runSync(
    Effect.gen(function* () {
      return yield* Renderer
    }),
  )

  const accumulator = new Map<string, Entry>()
  let scheduled = false
  let rafId = 0
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
    let restore: Patch | undefined
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

  const flush = (): void => {
    scheduled = false
    // One batch() per frame for every dirty element. No auto-reschedule — the next
    // write() does. A write() from an effect running inside the batch requests the
    // next frame (it isn't stranded).
    batch(() => {
      for (const entry of accumulator.values()) if (entry.dirty) apply(entry)
    })
  }

  const scheduleFlush = (): void => {
    if (scheduled) return
    scheduled = true
    rafId = requestAnimationFrame(flush)
  }

  const register: FlushGate["register"] = (id, sink) => {
    accumulator.set(id, { values: {}, sink, dirty: false, committed: new Map() })
    return () => {
      accumulator.delete(id)
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
    batch(() => {
      for (const id of written) {
        const entry = accumulator.get(id)
        if (entry !== undefined && entry.dirty) apply(entry)
      }
    })
  }

  const dispose: FlushGate["dispose"] = () => {
    if (scheduled) {
      cancelAnimationFrame(rafId)
      scheduled = false
    }
    accumulator.clear()
  }

  return { register, write, flushPass, dispose }
}

const noop = (): void => {}

/**
 * The gate a server render gets (ADR-0021, decision 9): a server builds no runtime and
 * flushes nothing, so `register` returns a no-op unregister and `write` / `flushPass` /
 * `dispose` do nothing. Code that grabs the gate at setup and uses it after mount keeps
 * working on the server. Internal (not a package export).
 */
export const INERT_GATE: FlushGate = Object.freeze({
  register: () => noop,
  write: noop,
  flushPass: noop,
  dispose: noop,
})
