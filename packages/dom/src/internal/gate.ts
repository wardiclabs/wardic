/**
 * `makeFlushGate` — the deferred **Flush gate** (ADR-0006), framework-free here in `@wardic/dom`
 * so every binding shares one (ADR-0031, decision 3). The binding hands in its `batch` and its
 * sinks; the gate imports nothing from a framework.
 *
 * Per ADR-0006, per-frame writes never reach their element directly. Each source
 * `write(id, partialValues)`s into a provider-owned gate that:
 *
 *   1. Accumulates *value-maps* (NOT already-projected Patches) per element,
 *      merging partials by key — so multiple sources can feed one element
 *      (e.g. a drag setting `x`/`y` while a spring drives `scale`, all
 *      collapsing into one grouped `transform`). Projecting per source would
 *      clobber the grouped transform.
 *   2. Resolves the Renderer's PURE `project` ONCE at creation and uses it to
 *      turn each dirty element's merged value-map into a `Patch` exactly once
 *      per element per frame.
 *   3. Commits each resulting Patch onto its element with the Renderer's `commit`, a plain
 *      call (ADR-0034) — one DOM pass per frame, shared by every element: at the end of the
 *      Frame loop's tick, in the Refresh frame that computed the values (ADR-0033). No
 *      framework runs per frame: a binding's JSX carries an element's style only until its
 *      first commit (ADR-0021, decision 6), and after it only the keys the gate doesn't hold.
 *
 * Three locked design decisions (this session's grills):
 *   - FLUSHED at the end of the Frame loop's tick (ADR-0033): the gate registers a hook on
 *     the Environment's loop (`afterTick`), so everything a tick writes is applied at the end
 *     of that tick, inside the Clock's callback, and paints in that Refresh frame. A write
 *     made outside a tick (a drag's move, a `release` from a task, an effect a sink's hook ran,
 *     a Tier 2 `Stream` on `Clock.ticks` subscribed after the loop) still requests a
 *     Refresh frame, only if one is not already pending, and the hook withdraws that request
 *     when it flushes first. `flush` does NOT auto-reschedule, so an idle accumulator
 *     requests no frames — the next `write` does. The frames come from the Environment's
 *     `RefreshFrameSource` (ADR-0031): on the web, `requestAnimationFrame` itself. No binding
 *     calls the browser's frame functions itself. A Tier 2 `Stream` that writes here paints in
 *     the loop's frame or the next one, by its subscription order (ADR-0033): run it on the
 *     loop (`Machine.run`) to paint with it.
 *   - ONE flush per frame: all dirty elements flush together. The one exception
 *     is `flushPass` (ADR-0018): a projection Measure pass's own writes are applied
 *     at the end of its task, so a new layout never paints without its projection.
 *   - ONE sink shape (ADR-0034): a sink is the element its patch is committed onto. The gate
 *     also removes a key its last patch had and this one doesn't (a dragged node's `z-index`
 *     once its raise is dropped, ADR-0016 *Amendment (Reorder)*), restoring the element's own
 *     inline value, saved before the gate first wrote the key. Two hooks reach the binding,
 *     outside the commits, each in the binding's `batch` (ADR-0034, *Amendment (#209)*): the
 *     Starting-style switch before an element's first commit (`beforeFirstCommit`), and the keys
 *     the gate holds on the element whenever they change (`onHeld`), so the binding's `style`
 *     leaves them to Wardic.
 *
 * Observability (CONTEXT.md convention): the hot path (`write`/`flush`) is the
 * per-frame work, so — exactly like core's per-frame writes and the Clock's
 * `tick` — it stays quiet (no span, no per-call log, no metric). A flush that throws (a
 * binding's hook, a commit) is reported (`reportFailure`) and the gate
 * goes on, so it can't fail the Frame loop's tick it runs in (ADR-0033).
 */
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as RefreshFrameSource from "@wardic/core/RefreshFrameSource"
import * as Renderer from "@wardic/core/Renderer"
import * as Cause from "effect/Cause"
import { Atom, AtomRegistry } from "effect/reactivity"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as Fiber from "effect/Fiber"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Scope from "effect/Scope"
import { reportFailure } from "./report.ts"
import { TEMPLATE_KEY } from "./renderer.ts"
import { dashCase } from "./svg.ts"

/**
 * Where a flushed `Patch` is delivered: committed onto `target` with the Renderer's `commit`,
 * at flush time (ADR-0034).
 */
export interface FlushSink {
  /** The element the patch is committed onto. */
  readonly target: unknown
  /**
   * Called once, just before the element's first commit in a frame flush (not a Measure
   * pass's `flushPass`), inside the binding's `batch` with every other element's switch that
   * flush (ADR-0021, decision 6): a binding drops its Starting style from its `style` prop here,
   * so its framework removes those keys and the commit writes the first frame in the same
   * Refresh frame, with no paint in between.
   */
  readonly beforeFirstCommit?: (() => void) | undefined
  /**
   * Called with every key the gate now holds on the element, each time that set changes
   * (ADR-0034): after the gate restores a key it dropped, and before the commit that first
   * writes a key. A binding whose `style` prop reaches the element leaves these keys out of it,
   * so its framework never writes over Wardic's value (`style` is a key's fallback). Called in
   * the binding's `batch`, with every other element's whose keys changed that flush (ADR-0034,
   * *Amendment (#209)*), so what the binding changes reaches the element before the commit, a
   * framework that applies an update later (Solid 2) included.
   */
  readonly onHeld?: ((keys: ReadonlyArray<string>) => void) | undefined
  /**
   * Called once per frame in which the element's values were committed, after every commit of that
   * frame (#233, ADR-0043 *Amendment (#233, #234)*: Motion's `onUpdate`), with its values before
   * projection (`x` as a number). The object is the element's own, reused each call: valid during
   * the call, copied to keep. A Measure pass's commits are told at the frame flush after them, so
   * a frame tells each element once. A write it makes is the next frame's. A throw is reported,
   * and the others are still told.
   */
  readonly onCommit?: ((values: Readonly<Record<string, unknown>>) => void) | undefined
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
   * The keys the gate holds on the element: its last patch's, each with the element's own
   * inline value from before the gate first wrote it (`""` for none), to restore when the
   * key drops out.
   */
  readonly committed: Map<string, string>
  /** Its keys' live outputs (`valueOf`), or `undefined` while nothing asked for one. */
  outputs: Map<string, Output> | undefined
  /** The values its sink's `onCommit` is told, one object reused, made on the first call. */
  latest: Record<string, unknown> | undefined
  /**
   * Whether its `onCommit` threw at its last call (#257 item 4): a run of throws is logged and
   * reported at its first, so one that throws every frame logs once; a call that returns ends it.
   */
  failing: boolean
  /** Its patch, projected this flush and committed once the binding has heard the keys held. */
  patch: Renderer.Patch | undefined
}

/** One key's live output: its Atom, the value last set on it, and its mount in the registry. */
interface Output {
  readonly atom: Atom.Writable<unknown>
  last: unknown
  readonly unmount: () => void
}

/** The element's own inline value for a patch key (`""` for none, or a target with no style). */
const inlineValueOf = (target: unknown, key: string): string => {
  if (Predicate.isNullish(target)) return ""
  const style = (target as { readonly style?: CSSStyleDeclaration }).style
  if (Predicate.isUndefined(style)) return ""
  return style.getPropertyValue(dashCase(key))
}

/** The provider-owned flush gate (one per `WardicProvider`). */
export interface FlushGate {
  /**
   * Register an element under `id` with its `sink`. Returns an unregister fn
   * that removes the element from the accumulator (a subsequent `write` is a
   * no-op). `values` start its value-map, unflushed: drawn with its first `write`, so they never
   * commit alone (#443: its Transform template, which mustn't take its Starting style off early).
   */
  readonly register: (id: string, sink: FlushSink, values?: Readonly<Record<string, unknown>>) => () => void
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
   * `pass()` runs are recorded; each recorded entry is `project`ed and committed once, and
   * marked clean. Everything else stays dirty for its flush. A write made by an effect a sink's
   * hook runs (a Solid effect) takes the ordinary path. The projection engine calls it at the
   * end of a task, so a new layout never paints without its projection.
   */
  readonly flushPass: (pass: () => void) => void
  /**
   * Hand `keys` back to the element's own style (ADR-0022): drop each from the element's
   * value-map and schedule a flush, which writes `restore[key]` (CSS text) for a key it had
   * written, or else the inline value it overwrote, and tells the sink (`onHeld`). A key the
   * entry doesn't hold, or an unknown id, is a no-op. The spine releases a key back at its
   * `style` value, so a later `style` change shows at rest. A later `write` brings the key
   * back.
   */
  readonly release: (id: string, keys: ReadonlyArray<string>, restore?: Readonly<Record<string, string>>) => void
  /**
   * The element's value for `id`'s `key`, live (#130, ADR-0043): an `Atom` set as each write that
   * changes it lands, so it's the value the next commit draws, before the Renderer projects it
   * (`x` as a number, not a `transform`). Set at the write, not the commit, so a value derived
   * from it (another key following it through a binding) is written in the same frame and
   * commits with it. `undefined` before the key's first write, and once it's released or the
   * element unregisters. One Atom for an id and a key, made on first ask, so per frame only the
   * keys asked for cost anything.
   */
  readonly valueOf: (id: string, key: string) => Atom.Atom<unknown>
  /**
   * Call `fn` once, after the gate's next flush (#257): the end of the Frame loop's tick, for a call
   * made in one, else the next Refresh frame's, so what was written before it is on the elements.
   * It schedules that flush if none is pending. The spine tells a Retarget's settle here, as Motion's
   * `onAnimationComplete` comes with the final value set. One that throws is reported, and the rest
   * still run.
   */
  readonly afterFlush: (fn: () => void) => void
  /**
   * Take the gate's hook off the Frame loop, cancel any pending frame and clear the
   * accumulator. Wired into the provider's `onCleanup`.
   */
  readonly dispose: () => void
}

/** What a flush gate needs from its Environment: the `Renderer`, the Frame loop it flushes at the end of each tick of (ADR-0033), and the `RefreshFrameSource` (ADR-0031). */
export type FlushGateServices = Renderer.Renderer | RefreshFrameSource.RefreshFrameSource | FrameLoop.FrameLoop | AtomRegistry.AtomRegistry

/**
 * How the gate runs its Effects: synchronously, and forked. `FlushGate.make` builds one from its
 * Layer's context, forking into its Scope (#132, ADR-0041); a test's `ManagedRuntime` is one too.
 */
export interface FlushGateRuntime {
  readonly runSync: <A, E>(effect: Effect.Effect<A, E, FlushGateServices>) => A
  readonly runFork: <A, E>(effect: Effect.Effect<A, E, FlushGateServices>) => Fiber.Fiber<A, E>
}

/** What a binding hands its flush gate. */
export interface FlushGateOptions {
  /**
   * Apply a flush's hooks together: run `apply`, and return once every update inside it has
   * reached the elements, before the gate commits (ADR-0031, decision 3; ADR-0034). Solid 1 passes
   * its `batch`; Solid 2 runs `apply` then `flush()`; React would pass `flushSync` (inferred). A
   * binding with no hook passes `(apply) => apply()`. Called at most twice a flush: once for the
   * Starting-style switches (`beforeFirstCommit`) when an element commits for the first time,
   * before anything is read off the elements, and once for the keys held (`onHeld`) when an
   * element's change (*Amendment (#209)*).
   */
  readonly batch: (apply: () => void) => void
}

/**
 * Build a flush gate against the provider's `runtime`, running each frame flush's Starting-style
 * switches through the binding's `batch`.
 *
 * Resolves both ONCE here: `project` is pure and `commit` a plain call (both called directly at
 * flush, ADR-0034), `requestFrame` /
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
  // Every live output asked for (`valueOf`), by id: an entry registered later picks its map up.
  const outputsById = new Map<string, Map<string, Output>>()
  const registry = runtime.runSync(AtomRegistry.AtomRegistry)
  // Sinks waiting for their first commit's `beforeFirstCommit` (usually empty).
  const firstCommits = new Set<string>()
  let scheduled = false
  // What `afterFlush` queued since the last flush, called at its end (#257).
  let afterFlushes: Array<() => void> = []
  // The pending Refresh frame's handle, while `scheduled`.
  let frame: unknown
  // The ids written while a `flushPass` pass runs; `undefined` otherwise.
  let recording: Set<string> | undefined
  // The entries committed since the last frame flush whose sink has an `onCommit` (#233).
  const committedSince = new Set<Entry>()
  // A frame flush's entries, in order, prepared and waiting for their commit; and those whose
  // keys held changed, which the binding hears first. Reused each flush: the per-frame path.
  const prepared: Array<Entry> = []
  const heldChanged: Array<Entry> = []

  /**
   * Project one dirty entry's patch and restore the keys it dropped (once per element per flush),
   * marking it clean: into `into`, and into `held` when the keys it holds change and its sink
   * hears them. Its commit waits for the binding's `batch` of those (ADR-0034, *Amendment
   * (#209)*). Plain calls only: this is the per-frame path.
   */
  const prepare = (entry: Entry, into: Array<Entry>, held: Array<Entry>): void => {
    const patch = project(entry.values)
    entry.dirty = false
    entry.patch = patch
    into.push(entry)
    const sink = entry.sink
    const target = sink.target
    const committed = entry.committed
    const before = committed.size
    let kept = 0
    let added = false
    for (const key in patch) {
      if (committed.has(key)) {
        kept++
        continue
      }
      committed.set(key, inlineValueOf(target, key))
      added = true
    }
    // A key the last patch wrote and this one doesn't: the element gets its own value
    // back. Only looked for when one dropped out (the usual frame keeps every key).
    let restore: Renderer.Patch | undefined
    if (kept < before) {
      for (const [key, own] of committed) {
        if (key in patch) continue
        if (Predicate.isUndefined(restore)) restore = {}
        restore[key] = own
        committed.delete(key)
      }
    }
    if (Predicate.isNotUndefined(restore)) commit(target, restore)
    // The keys held changed (the usual frame changes none): the binding hears before the commit.
    if ((added || Predicate.isNotUndefined(restore)) && Predicate.isNotUndefined(sink.onHeld)) held.push(entry)
  }

  /** Commit a prepared entry's patch onto its element. */
  const commitPrepared = (entry: Entry): void => {
    const patch = entry.patch
    if (Predicate.isUndefined(patch)) return
    entry.patch = undefined
    commit(entry.sink.target, patch)
    if (Predicate.isNotUndefined(entry.sink.onCommit)) committedSince.add(entry)
  }

  /**
   * The prepared entries, committed, after the binding has heard the keys held change, together, in
   * its `batch` (#209); both lists emptied for the next flush.
   */
  const commitAll = (entries: Array<Entry>, held: Array<Entry>): void => {
    if (held.length > 0) batch(() => tellHeld(held))
    for (let i = 0; i < entries.length; i++) commitPrepared(entries[i])
    entries.length = 0
    held.length = 0
  }

  /** Each entry's `onHeld`, with every key the gate holds on its element now. */
  const tellHeld = (held: ReadonlyArray<Entry>): void => {
    for (let i = 0; i < held.length; i++) {
      const entry = held[i]
      const onHeld = entry.sink.onHeld
      if (Predicate.isNotUndefined(onHeld)) onHeld(Array.from(entry.committed.keys()))
    }
  }

  /**
   * Tell each entry committed since the last frame flush, once, after every commit of this one
   * (#233). Its values are copied into its own reused object, so its sink never holds the gate's.
   */
  const tellCommitted = (): void => {
    for (const entry of committedSince) {
      const onCommit = entry.sink.onCommit
      if (Predicate.isUndefined(onCommit)) continue
      let latest = entry.latest
      if (Predicate.isUndefined(latest)) {
        latest = {}
        entry.latest = latest
      }
      for (const key in latest) if (!Object.hasOwn(entry.values, key)) delete latest[key]
      Object.assign(latest, entry.values)
      // Its Transform template rides in its values (#443), and isn't one: Motion's `onUpdate` never sees it.
      delete latest[TEMPLATE_KEY]
      try {
        onCommit(latest)
        entry.failing = false
      } catch (defect) {
        if (entry.failing) continue
        entry.failing = true
        runtime.runFork(reportFailure("wardic.gate: an onCommit failed", Cause.die(defect)))
      }
    }
    committedSince.clear()
  }

  /**
   * The live outputs asked for of `entry`, each set where its value changed, as a write or a
   * release lands: a value derived from one (a Live value of another key, through a binding) is
   * written in the same frame, and commits with it. An unchanged one skips the registry. Plain
   * calls: a write is the per-frame path.
   */
  const setOutputs = (entry: Entry): void => {
    const outputs = entry.outputs
    if (Predicate.isUndefined(outputs)) return
    for (const [key, output] of outputs) {
      const value = entry.values[key]
      if (value === output.last) continue
      output.last = value
      registry.set(output.atom, value)
    }
  }

  /**
   * Run `beforeFirstCommit` for each waiting entry about to commit (dirty), in the binding's
   * `batch` before any commit, so the binding applies what it changes first. A wrap that never
   * commits stays waiting, so this loops over the wraps still waiting, once per frame flush.
   */
  const runFirstCommits = (): void => {
    for (const id of firstCommits) {
      const entry = accumulator.get(id)
      if (Predicate.isUndefined(entry) || !entry.dirty) continue
      firstCommits.delete(id)
      const hook = entry.sink.beforeFirstCommit
      if (Predicate.isNotUndefined(hook)) hook()
    }
  }

  const flush = (): void => {
    scheduled = false
    try {
      // The switches first: an element's own inline values are read once its Starting style is gone.
      if (firstCommits.size > 0) batch(runFirstCommits)
      // Every dirty element, once. No auto-reschedule — the next write() does. A write()
      // from an effect a sink's hook runs requests the next frame (it isn't stranded).
      for (const entry of accumulator.values()) if (entry.dirty) prepare(entry, prepared, heldChanged)
      commitAll(prepared, heldChanged)
      if (committedSince.size > 0) tellCommitted()
    } catch (defect) {
      prepared.length = 0
      heldChanged.length = 0
      runtime.runFork(reportFailure("wardic.gate: a flush failed", Cause.die(defect)))
    }
    if (afterFlushes.length > 0) runAfterFlushes()
  }

  /** The calls `afterFlush` queued, each once, a new queue for any they make. */
  const runAfterFlushes = (): void => {
    const due = afterFlushes
    afterFlushes = []
    for (const fn of due) {
      try {
        fn()
      } catch (defect) {
        runtime.runFork(reportFailure("wardic.gate: an afterFlush call failed", Cause.die(defect)))
      }
    }
  }

  const afterFlush: FlushGate["afterFlush"] = (fn) => {
    afterFlushes.push(fn)
    scheduleFlush()
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

  const register: FlushGate["register"] = (id, sink, values) => {
    const entry: Entry = { values: UndefinedOr.match(values, { onUndefined: () => ({}), onDefined: (start) => ({ ...start }) }), sink, dirty: false, committed: new Map(), outputs: outputsById.get(id), latest: undefined, failing: false, patch: undefined }
    accumulator.set(id, entry)
    if (Predicate.isNotUndefined(sink.beforeFirstCommit)) firstCommits.add(id)
    return () => {
      accumulator.delete(id)
      firstCommits.delete(id)
      committedSince.delete(entry)
      endOutputs(id)
    }
  }

  /** `id`'s live outputs, each set to `undefined` and forgotten: its element is gone. */
  const endOutputs = (id: string): void => {
    const outputs = outputsById.get(id)
    if (Predicate.isUndefined(outputs)) return
    outputsById.delete(id)
    for (const output of outputs.values()) {
      registry.set(output.atom, undefined)
      output.unmount()
    }
  }

  /** `id`'s current value for `key`, or `undefined` for an unregistered id or a key it hasn't written. */
  const committedValueOf = (id: string, key: string): unknown => {
    const entry = accumulator.get(id)
    if (Predicate.isUndefined(entry)) return undefined
    return entry.values[key]
  }

  const valueOf: FlushGate["valueOf"] = (id, key) => {
    let outputs = outputsById.get(id)
    if (Predicate.isUndefined(outputs)) {
      outputs = new Map()
      outputsById.set(id, outputs)
      const entry = accumulator.get(id)
      if (Predicate.isNotUndefined(entry)) entry.outputs = outputs
    }
    const known = outputs.get(key)
    if (Predicate.isNotUndefined(known)) return known.atom
    // Made `undefined` and mounted until its element unregisters, not kept alive: a kept-alive
    // Atom's node never leaves the registry, and one left behind reads `undefined` afresh.
    const atom = Atom.make<unknown>(undefined)
    const output: Output = { atom, last: undefined, unmount: registry.mount(atom) }
    outputs.set(key, output)
    const value = committedValueOf(id, key)
    if (Predicate.isNotUndefined(value)) {
      output.last = value
      registry.set(atom, value)
    }
    return atom
  }

  const write: FlushGate["write"] = (id, partial) => {
    const entry = accumulator.get(id)
    if (Predicate.isUndefined(entry)) return
    Object.assign(entry.values, partial)
    entry.dirty = true
    if (Predicate.isNotUndefined(recording)) recording.add(id)
    scheduleFlush()
    setOutputs(entry)
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
    // A commit here is told at the frame flush (#233): the write that made it scheduled that flush.
    // Its own lists: a pass may run from a hook the frame flush's `batch` runs.
    const entries: Array<Entry> = []
    const held: Array<Entry> = []
    for (const id of written) {
      const entry = accumulator.get(id)
      if (Predicate.isNotUndefined(entry) && entry.dirty) prepare(entry, entries, held)
    }
    commitAll(entries, held)
  }

  const release: FlushGate["release"] = (id, keys, restore) => {
    const entry = accumulator.get(id)
    if (Predicate.isUndefined(entry)) return
    let released = false
    for (const key of keys) {
      if (!Object.hasOwn(entry.values, key)) continue
      delete entry.values[key]
      released = true
      // The drop-out path in `apply` writes the saved value back: make it the one handed in.
      if (Predicate.isUndefined(restore)) continue
      const value: string | undefined = restore[key]
      if (Predicate.isNotUndefined(value) && entry.committed.has(key)) entry.committed.set(key, value)
    }
    if (!released) return
    entry.dirty = true
    scheduleFlush()
    setOutputs(entry)
  }

  const dispose: FlushGate["dispose"] = () => {
    Effect.runSync(Scope.close(ticks, Exit.void))
    if (scheduled) {
      cancelFrame(frame)
      scheduled = false
    }
    accumulator.clear()
    firstCommits.clear()
    committedSince.clear()
    // The calls waiting on a flush that won't come: their provider is gone (#257).
    afterFlushes = []
    for (const id of [...outputsById.keys()]) endOutputs(id)
  }

  // The gate's hook on the loop, for the gate's lifetime.
  const ticks = Scope.makeUnsafe()
  runtime.runSync(afterTick(flushTicked).pipe(Scope.provide(ticks)))

  return { register, write, flushPass, release, valueOf, afterFlush, dispose }
}


