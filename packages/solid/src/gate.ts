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
 *   - ONE `batch()` per frame: all dirty elements flush together.
 *   - TWO sink modes: a *signal sink* (`{ kind: "signal", set }`) sets the
 *     per-element Solid signal (the default for `wardic.create("div")`); a
 *     *commit sink* (`{ kind: "commit", target }`) runs `Renderer.commit(target,
 *     patch)` via a forwarded ref (used for `wardic.create(Component)` wraps).
 *     Both share the same merge + one-`project`-per-frame + single-`batch()`.
 *
 * Observability (CONTEXT.md convention): the hot path (`write`/`flush`) is the
 * per-frame work, so — exactly like core's per-frame writes and the Clock's
 * `tick` — it stays quiet (no span, no per-call log).
 */
import { type Patch, Renderer } from "@wardic/core"
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
}

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
   * Enqueue a pre-flush MEASURE pass (ADR-0009 / D4 — the projection read phase).
   * The pass runs inside the next rAF BEFORE the write flush (reads-before-writes,
   * one rAF), so it may read layout (`getBoundingClientRect`) and `write()` seed
   * values that flush in the SAME frame. Passes are deduped by function identity
   * and coalesced — many triggers in a frame run one root pass once. A `write()`
   * issued from within a pass does NOT schedule an extra frame (it is serviced by
   * the in-progress flush). A pass must not enqueue another pass.
   */
  readonly scheduleMeasure: (pass: () => void) => void
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
  // Pre-flush MEASURE passes (the projection read phase), deduped by identity.
  const measurePasses = new Set<() => void>()
  let scheduled = false
  // True only while `flush` is running — gates re-entrant write()/scheduleMeasure()
  // (from inside a measure pass) so they don't request a second frame.
  let flushing = false
  let rafId = 0

  const flush = (): void => {
    scheduled = false
    flushing = true
    // READS first (ADR-0009 / D4): run queued measure passes — each may
    // getBoundingClientRect and write() seed values — BEFORE any write is applied,
    // so a read never follows a write within a frame. A write() made from a pass
    // lands in the accumulator and flushes in THIS frame's batch (the `flushing`
    // guard stops it scheduling another rAF).
    if (measurePasses.size > 0) {
      const passes = [...measurePasses]
      measurePasses.clear()
      for (const pass of passes) pass()
    }
    // WRITES: one batch() per frame for every dirty element. No auto-reschedule —
    // the next write()/scheduleMeasure() does.
    batch(() => {
      for (const entry of accumulator.values()) {
        if (!entry.dirty) continue
        // project once per element per frame.
        const patch = project(entry.values)
        if (entry.sink.kind === "signal") {
          entry.sink.set(patch)
        } else {
          runtime.runSync(commit(entry.sink.target, patch))
        }
        entry.dirty = false
      }
    })
    flushing = false
  }

  const scheduleFlush = (): void => {
    // `flushing`: a write()/scheduleMeasure() from inside a measure pass is already
    // serviced by the in-progress flush, so it must not request another frame.
    if (scheduled || flushing) return
    scheduled = true
    rafId = requestAnimationFrame(flush)
  }

  const register: FlushGate["register"] = (id, sink) => {
    accumulator.set(id, { values: {}, sink, dirty: false })
    return () => {
      accumulator.delete(id)
    }
  }

  const write: FlushGate["write"] = (id, partial) => {
    const entry = accumulator.get(id)
    if (entry === undefined) return
    Object.assign(entry.values, partial)
    entry.dirty = true
    scheduleFlush()
  }

  const scheduleMeasure: FlushGate["scheduleMeasure"] = (pass) => {
    measurePasses.add(pass)
    scheduleFlush()
  }

  const dispose: FlushGate["dispose"] = () => {
    if (scheduled) {
      cancelAnimationFrame(rafId)
      scheduled = false
    }
    measurePasses.clear()
    accumulator.clear()
  }

  return { register, write, scheduleMeasure, dispose }
}
