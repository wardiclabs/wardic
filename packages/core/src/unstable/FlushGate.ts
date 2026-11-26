/**
 * `makeFlushGate` — the deferred **Flush gate** (ADR-0006), framework-free and Environment-free in
 * core, so every binding shares one (ADR-0031, decision 3). The binding hands in its `batch` and its
 * sinks, and its Environment the edges it reads (`GateEnvironment`); the gate imports nothing from a
 * framework.
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
 *      call (ADR-0034) — one pass over the elements per frame, shared by every element: at the end of the
 *      Frame loop's tick, in the Refresh frame that computed the values (ADR-0033). No
 *      framework runs per frame: a binding's render carries an element's style only until its
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
 *     `RefreshFrameSource` (ADR-0031): `@wardic/dom`'s is its runtime's frame callback. No binding
 *     asks its runtime for frames itself. A Tier 2 `Stream` that writes here paints in
 *     the loop's frame or the next one, by its subscription order (ADR-0033): run it on the
 *     loop (`Machine.run`) to paint with it.
 *   - ONE flush per frame: all dirty elements flush together. The one exception
 *     is `flushPass` (ADR-0018): a projection Measure pass's own writes are applied
 *     at the end of its task, so a new layout never paints without its projection.
 *   - ONE sink shape (ADR-0034): a sink is the element its patch is committed onto. The gate
 *     also removes a key its last patch had and this one doesn't (a dragged element's raise
 *     once it's dropped, ADR-0016 *Amendment (Reorder)*), restoring the element's own
 *     value, saved before the gate first wrote the key. Two hooks reach the binding,
 *     outside the commits, each in the binding's `batch` (ADR-0034, *Amendment (#209)*): the
 *     Starting-style switch before an element's first commit (`beforeFirstCommit`), and the keys
 *     the gate holds on the element whenever they change (`onHeld`), so the binding's `style`
 *     leaves them to Wardic.
 *
 * Observability (CONTEXT.md convention): the hot path (`write`/`flush`) is the
 * per-frame work, so — exactly like core's per-frame writes and the Clock's
 * `tick` — it stays quiet (no span, no per-call log, no metric). A throw in one element's step (its
 * binding's hook, the read of its own value, its Timeline values, its commit) is that element's: it
 * commits nothing that frame, a run of them is reported once (`Report.failure`) until it commits again,
 * and every other element still commits. Anything else a flush throws is reported and the gate
 * goes on, so it can't fail the Frame loop's tick it runs in (ADR-0033).
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672: dom's `internal/gate.ts`, moved for the spine to write through
// it in core; dom's `FlushGate` builds it with the DOM's edges (`DOM_GATE`) and gives it as a Layer.
// #969 (ADR-0033, *Amendment (#969)*): one element's failure in a flush is its own.
import * as FrameLoop from "../FrameLoop.ts"
import * as RefreshFrameSource from "../RefreshFrameSource.ts"
import * as Renderer from "../Renderer.ts"
import * as Cause from "effect/Cause"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as Fiber from "effect/Fiber"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Scope from "effect/Scope"
import * as Report from "./Report.ts"

/**
 * Where a flushed `Patch` is delivered: committed onto `target` with the Renderer's `commit`,
 * at flush time.
 */
export interface FlushSink {
  /** The element the patch is committed onto. */
  readonly target: unknown
  /**
   * Called once, just before the element's first commit in a frame flush (not a Measure
   * pass's `flushPass`), inside the binding's `batch` with every other element's switch that
   * flush: a binding drops its Starting style from its `style` here,
   * so its framework removes those keys and the commit writes the first frame in the same
   * Refresh frame, with no paint in between.
   */
  readonly beforeFirstCommit?: (() => void) | undefined
  /**
   * Called with every key the gate now holds on the element, each time that set changes: after the
   * gate restores a key it dropped, and before the commit that first
   * writes a key. A binding whose `style` reaches the element leaves these keys out of it,
   * so its framework never writes over Wardic's value (`style` is a key's fallback). Called in
   * the binding's `batch`, with every other element's whose keys changed that flush, so what the
   * binding changes reaches the element before the commit, a framework that applies an update later
   * (Solid 2) included.
   */
  // ADR-0034, *Amendment (#209)*.
  readonly onHeld?: ((keys: ReadonlyArray<string>) => void) | undefined
  /**
   * Called once per frame in which the element's values were committed, after every commit of that
   * frame (Motion's `onUpdate`), with its values before
   * projection (`x` as a number). The object is the element's own, reused each call: valid during
   * the call, copied to keep. A Measure pass's commits are told at the frame flush after them, so
   * a frame tells each element once. A write it makes is the next frame's. A throw is reported,
   * and the others are still told.
   */
  readonly onCommit?: ((values: Readonly<Record<string, unknown>>) => void) | undefined
}

/** Accumulated pre-`project` state for one registered element. */
interface Entry {
  /** Its gate id: what a failure of its own is reported with (#969). */
  readonly id: string
  /** Merged value-map (partials `Object.assign`ed in by key). */
  readonly values: Record<string, unknown>
  /** Where this element's projected Patch goes. */
  readonly sink: FlushSink
  /** Whether a `write` has landed since the last flush. */
  dirty: boolean
  /**
   * The keys the gate holds on the element: its last patch's, each with the element's own
   * value from before the gate first wrote it (`""` for none), to restore when the
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
  onCommitFailing: boolean
  /**
   * Whether one of its own steps threw at a flush since its last commit (#969): a run of them is reported
   * at its first, so one that throws every frame logs once; a commit that lands ends it.
   */
  stepFailing: boolean
  /** Whether its sink's `onHeld` threw before it heard the keys held (#969): its next flush tells it again. */
  heldUntold: boolean
  /** Its patch, projected this flush and committed once the binding has heard the keys held. */
  patch: Renderer.Patch | undefined
}

/** One key's live output: its Atom, the value last set on it, and its mount in the registry. */
interface Output {
  readonly atom: Atom.Writable<unknown>
  last: unknown
  readonly unmount: () => void
  /** Whether its sets are throwing back a dependent's failure: reported at the first, again after a clean set. */
  failing: boolean
}

/** What the gate calls of a key's Timeline value (#240): its sync with the values drawn, and its cancel. */
// #672 (Q15): the gate names what it calls, so it reads no Timeline code; dom's TimelineValue meets it.
export interface GateTimeline {
  readonly sync: (values: Readonly<Record<string, unknown>>) => void
  readonly cancel: () => void
}

/**
 * What the gate reads of its Environment's targets, and what it keeps from a sink: a target's value
 * for a key before the gate first writes it there (`""` for none), which it gives back at the key's
 * release, and the key its Renderer reserves for an element's Transform template, which `onCommit`
 * never sees.
 */
// #672 (PR2-Q1): the gate's two edges of its Environment, given by `FlushGate.make`, its only builder,
// so the gate reads none itself and moves to core as it is.
export interface GateEnvironment {
  readonly valueBeforeOf: (target: unknown, key: string) => string
  readonly templateKey: string
}

/** A step of one element's flush, as its failure is reported (#969): `prepare`'s report as its commit. */
type Step = "a commit" | "a beforeFirstCommit" | "an onHeld" | "a Timeline sync"

/** Each of `values` cancelled (#240). Per flush: a plain loop. */
const cancelEach = (values: Iterable<GateTimeline>): void => {
  for (const value of values) value.cancel()
}

/** A Flush gate: what a binding registers its elements with and writes their values into, one per provider. */
export interface FlushGate {
  /**
   * Register an element under `id` with its `sink`. Returns an unregister fn
   * that removes the element from the accumulator (a subsequent `write` is a
   * no-op). `values` start its value-map, unflushed: drawn with its first `write`, so they never
   * commit alone.
   */
  // #443: its Transform template, which mustn't take its Starting style off early.
  readonly register: (id: string, sink: FlushSink, values?: Readonly<Record<string, unknown>>) => () => void
  /**
   * Merge `partial` into the element's value-map by key, mark it dirty, and
   * schedule a flush: the end of the Frame loop's tick, for a write made in one, or else the
   * next Refresh frame. A `write` for an unregistered (or unregistered-since) id
   * is a no-op.
   */
  readonly write: (id: string, partial: Record<string, unknown>) => void
  /**
   * Run a projection **Measure pass** now and apply exactly what it wrote before
   * returning. Only `write()`s made while
   * `pass()` runs are recorded; each recorded entry is `project`ed and committed once, and
   * marked clean. Everything else stays dirty for its flush. A write made by an effect a sink's
   * hook runs (a Solid effect) takes the ordinary path. The Projection system calls it at the
   * end of a task, so a new layout never paints without its projection.
   */
  readonly flushPass: (pass: () => void) => void
  /**
   * Hand `keys` back to the element's own style: drop each from the element's
   * value-map and schedule a flush, which writes `restore[key]` (its Environment's text form) for a key it had
   * written, or else the element's own value it overwrote, and tells the sink (`onHeld`). A key the
   * entry doesn't hold, or an unknown id, is a no-op. A binding releases a key back at its `style`
   * value, so a later `style` change shows at rest. A later `write` brings the key back. A property in
   * `keep` (`transform` for its keys) is left as it's drawn when it drops out: another writer draws it next.
   */
  // `keep`: #665's PR 4, a Batch member's group handed back to its Batch, whose writer draws it from then on.
  readonly release: (id: string, keys: ReadonlyArray<string>, restore?: Readonly<Record<string, string>>, keep?: ReadonlyArray<string>) => void
  /**
   * The element's value for `id`'s `key`, live: an `Atom` set as each write that
   * changes it lands, so it's the value the next commit draws, before the Renderer projects it
   * (`x` as a number, not a `transform`). Set at the write, not the commit, so a value derived
   * from it (another key following it through a binding) is written in the same frame and
   * commits with it. `undefined` before the key's first write, and once it's released or the
   * element unregisters. One Atom for an id and a key, made on first ask, so per frame only the
   * keys asked for cost anything.
   */
  readonly valueOf: (id: string, key: string) => Atom.Atom<unknown>
  /**
   * Run `key`'s Timeline value on `id`'s element (#240), or stop it (`undefined`): a binding sets one
   * while the key shows its Live value, and clears it when an entry of the Override stack takes the
   * key. The gate goes on writing the key: at each flush that commits the element, before the commit,
   * it starts the value's animation over it, or cancels it while something else adds to its property
   * (a projection, a Transform template, another transform key off its identity), so a frame shows one
   * or the other. A cleared or replaced one is cancelled at the next flush; a released key's, an
   * unregistered element's and a disposed gate's, at once. Setting one schedules a flush.
   */
  readonly timeline: (id: string, key: string, timeline: GateTimeline | undefined) => void
  /**
   * Call `fn` once, after the gate's next flush: the end of the Frame loop's tick, for a call
   * made in one, else the next Refresh frame's, so what was written before it is on the elements.
   * It schedules that flush if none is pending. A binding tells an animation's end here, as Motion's
   * `onAnimationComplete` comes with the final value set. One that throws is reported, and the rest
   * still run.
   */
  readonly afterFlush: (fn: () => void) => void
  /** Takes the gate off the Frame loop, cancels a pending frame and clears what it held. The Layer's Scope calls it. */
  // Wired into the provider's `onCleanup`.
  readonly dispose: () => void
}

/** The gate as its spine and its binding use it: all but its `dispose`, which its Scope runs. */
// #672: named here, as dom's `FlushGate` names it, so the spine reads the gate's own types in core.
export type Shape = Omit<FlushGate, "dispose">

/** An element's commit target and hooks, given to `register`. */
export type Sink = FlushSink

/** What a flush gate needs from its Environment: the `Renderer`, the Frame loop it flushes at the end of each tick of, and the `RefreshFrameSource`. */
// ADR-0033; ADR-0031.
export type FlushGateServices = Renderer.Renderer | RefreshFrameSource.RefreshFrameSource | FrameLoop.FrameLoop | AtomRegistry.AtomRegistry

/**
 * How the gate runs its Effects: synchronously, and forked. `FlushGate.make` builds one from its
 * Layer's context, forking into its Scope (#132, ADR-0041); a test's `ManagedRuntime` is one too.
 */
export interface FlushGateRuntime {
  readonly runSync: <A, E>(effect: Effect.Effect<A, E, FlushGateServices>) => A
  readonly runFork: <A, E>(effect: Effect.Effect<A, E, FlushGateServices>) => Fiber.Fiber<A, E>
  /** The Scope it was built in: its own fibers live there, ended as it closes (#618). */
  readonly scope: Scope.Scope
}

/** What a binding hands its flush gate. */
export interface FlushGateOptions {
  /**
   * Runs a flush's hooks together: calls `apply`, and returns once every update inside it has reached
   * the elements, before the gate commits. Solid 1 passes its `batch`, Solid 2 runs `apply` then
   * `flush()`, and React would pass `flushSync`, untried; a binding with nothing to batch passes
   * `(apply) => apply()`. Called at most twice a flush: once for the starting-style switches
   * (`beforeFirstCommit`) of the elements committing for the first time, before anything is read off the
   * elements; and once for the held keys (`onHeld`) of the elements whose held keys changed.
   */
  // ADR-0031, decision 3, ADR-0034; *Amendment (#209)*.
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
export const makeFlushGate = (runtime: FlushGateRuntime, options: FlushGateOptions, environment: GateEnvironment): FlushGate => {
  const { batch } = options
  const { valueBeforeOf, templateKey } = environment
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
  // Each element's Timeline values by key (#240), and those let go of since its last flush, cancelled at
  // its next: only the elements that have one, so the per-frame path checks their sizes alone.
  const timelines = new Map<Entry, Map<string, GateTimeline>>()
  const endings = new Map<Entry, Array<GateTimeline>>()
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
      committed.set(key, valueBeforeOf(target, key))
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
      }
    }
    // Committed before its keys are let go of, so a restore that throws is tried again at the next flush (#969).
    if (Predicate.isNotUndefined(restore)) {
      commit(target, restore)
      for (const key in restore) committed.delete(key)
    }
    // The keys held changed (the usual frame changes none), or its sink threw before it heard them: the
    // binding hears before the commit.
    if ((added || Predicate.isNotUndefined(restore) || entry.heldUntold) && Predicate.isNotUndefined(sink.onHeld)) held.push(entry)
  }

  /**
   * Before a flush's commits (#240): cancel the Timeline values each element committing now let go of,
   * and sync the rest with its values, so each starts or stops as nothing else adds to its property.
   * An entry is committing while it holds a prepared patch. Kept beside the entries, not on them, so an
   * element with none pays nothing per frame: the flush checks two sizes. Per flush: plain loops.
   */
  const syncTimelines = (): void => {
    for (const [entry, ended] of endings) {
      if (Predicate.isUndefined(entry.patch)) continue
      endings.delete(entry)
      // Each on its own: one whose cancel throws stops none of the others (#969).
      for (let i = 0; i < ended.length; i++) {
        try {
          ended[i].cancel()
        } catch (defect) {
          failedAt(entry, "a Timeline sync", defect)
        }
      }
    }
    for (const [entry, byKey] of timelines) {
      if (Predicate.isUndefined(entry.patch)) continue
      try {
        for (const value of byKey.values()) value.sync(entry.values)
      } catch (defect) {
        failedAt(entry, "a Timeline sync", defect)
      }
    }
  }

  /** Every Timeline value of `entry`, cancelled at once: its element is gone, or the gate is. */
  const cancelTimelines = (entry: Entry): void => {
    const ended = endings.get(entry)
    endings.delete(entry)
    if (Predicate.isNotUndefined(ended)) cancelEach(ended)
    const byKey = timelines.get(entry)
    timelines.delete(entry)
    if (Predicate.isNotUndefined(byKey)) cancelEach(byKey.values())
  }

  /** Commit a prepared entry's patch onto its element. */
  const commitPrepared = (entry: Entry): void => {
    const patch = entry.patch
    if (Predicate.isUndefined(patch)) return
    entry.patch = undefined
    commit(entry.sink.target, patch)
    if (entry.stepFailing) entry.stepFailing = false
    if (Predicate.isNotUndefined(entry.sink.onCommit)) committedSince.add(entry)
  }

  /**
   * One of `entry`'s steps threw this flush (#969): its later steps skipped this frame, its patch with
   * them, and the other elements' going on. A run of them is reported at its first, `step` naming it.
   */
  // A failure's path, never the frame's: one place each loop's catch calls.
  const failedAt = (entry: Entry, step: Step, defect: unknown): void => {
    entry.patch = undefined
    // Tried again at the gate's next flush, which it doesn't ask for itself: a Subject frozen for good would
    // keep the host's frames running. A later write, its own or another element's, brings that flush.
    entry.dirty = true
    // Its sink's `onCommit` hears nothing of a frame it didn't commit in.
    committedSince.delete(entry)
    if (entry.stepFailing) return
    entry.stepFailing = true
    runtime.runFork(Effect.annotateLogs(Report.failure(`wardic.gate: ${step} failed`, Cause.die(defect)), { id: entry.id }))
  }

  /**
   * The prepared entries, committed, after the binding has heard the keys held change, together, in
   * its `batch` (#209); both lists emptied for the next flush.
   */
  const commitAll = (entries: Array<Entry>, held: Array<Entry>): void => {
    if (held.length > 0) batch(() => tellHeld(held))
    // A try for each element, its call direct (#969): a shared helper taking the step measured +20% a frame.
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      try {
        commitPrepared(entry)
      } catch (defect) {
        failedAt(entry, "a commit", defect)
      }
    }
    entries.length = 0
    held.length = 0
  }

  /** Each entry's `onHeld`, with every key the gate holds on its element now. */
  const tellHeld = (held: ReadonlyArray<Entry>): void => {
    for (let i = 0; i < held.length; i++) {
      const entry = held[i]
      const onHeld = entry.sink.onHeld
      if (Predicate.isUndefined(onHeld)) continue
      try {
        onHeld(Array.from(entry.committed.keys()))
        if (entry.heldUntold) entry.heldUntold = false
      } catch (defect) {
        // Told again at its next flush, before its commit (#969).
        entry.heldUntold = true
        failedAt(entry, "an onHeld", defect)
      }
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
      delete latest[templateKey]
      try {
        onCommit(latest)
        entry.onCommitFailing = false
      } catch (defect) {
        if (entry.onCommitFailing) continue
        entry.onCommitFailing = true
        runtime.runFork(Report.failure("wardic.gate: an onCommit failed", Cause.die(defect)))
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
  // #979, group D (ADR-0074): an output's dependent that throws (an app's Atom over a ward's `read(key)`)
  // is its own. The registry has set the output and told its other listeners before the throw comes back,
  // so the write goes on, the element's other outputs with it: before, it came out of the ward's own leg.
  const setOutputs = (entry: Entry): void => {
    const outputs = entry.outputs
    if (Predicate.isUndefined(outputs)) return
    for (const [key, output] of outputs) {
      const value = entry.values[key]
      if (value === output.last) continue
      output.last = value
      setOutput(entry.id, key, output, value)
    }
  }

  /**
   * `output` set to `value`, its dependent's throw its own. The try is here, out of `setOutputs`' loop over
   * the Map: in its body, it measured +5–8% on Node's write.
   */
  const setOutput = (id: string, key: string, output: Output, value: unknown): void => {
    try {
      registry.set(output.atom, value)
      if (output.failing) output.failing = false
    } catch (defect) {
      if (!output.failing) runtime.runFork(Effect.annotateLogs(Report.failure("wardic.gate: an output failed", Cause.die(defect)), { id, key }))
      output.failing = true
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
      const hook = entry.sink.beforeFirstCommit
      try {
        if (Predicate.isNotUndefined(hook)) hook()
        // Its own: a hook that registered the id again leaves the new entry's switch to come (#969).
        if (accumulator.get(id) === entry) firstCommits.delete(id)
      } catch (defect) {
        // Kept, so the gate's next flush switches it; nothing of it commits before (#969).
        failedAt(entry, "a beforeFirstCommit", defect)
      }
    }
  }

  const flush = (): void => {
    scheduled = false
    try {
      // The switches first: an element's own values are read once its Starting style is gone.
      if (firstCommits.size > 0) batch(runFirstCommits)
      // Every dirty element, once. No auto-reschedule — the next write() does. A write()
      // from an effect a sink's hook runs requests the next frame (it isn't stranded).
      for (const entry of accumulator.values()) {
        if (!entry.dirty) continue
        // Its Starting-style switch threw this frame: it waits for the next flush's (#969).
        if (firstCommits.size > 0 && firstCommits.has(entry.id)) continue
        try {
          prepare(entry, prepared, heldChanged)
        } catch (defect) {
          failedAt(entry, "a commit", defect)
        }
      }
      if (timelines.size > 0 || endings.size > 0) syncTimelines()
      commitAll(prepared, heldChanged)
      if (committedSince.size > 0) tellCommitted()
    } catch (defect) {
      prepared.length = 0
      heldChanged.length = 0
      runtime.runFork(Report.failure("wardic.gate: a flush failed", Cause.die(defect)))
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
        runtime.runFork(Report.failure("wardic.gate: an afterFlush call failed", Cause.die(defect)))
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
    const entry: Entry = {
      values: UndefinedOr.match(values, { onUndefined: () => ({}), onDefined: (start) => ({ ...start }) }),
      sink,
      dirty: false,
      committed: new Map(),
      outputs: outputsById.get(id),
      id,
      latest: undefined,
      onCommitFailing: false,
      stepFailing: false,
      heldUntold: false,
      patch: undefined,
    }
    // An entry the id had: its Timeline values end with it (#240).
    const replaced = accumulator.get(id)
    if (Predicate.isNotUndefined(replaced)) cancelTimelines(replaced)
    accumulator.set(id, entry)
    if (Predicate.isNotUndefined(sink.beforeFirstCommit)) firstCommits.add(id)
    return () => {
      cancelTimelines(entry)
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
    const output: Output = { atom, last: undefined, unmount: registry.mount(atom), failing: false }
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
      if (Predicate.isUndefined(entry) || !entry.dirty) continue
      try {
        prepare(entry, entries, held)
      } catch (defect) {
        failedAt(entry, "a commit", defect)
      }
    }
    if (timelines.size > 0 || endings.size > 0) syncTimelines()
    commitAll(entries, held)
  }

  // Per key per Retarget, as the Override stack takes a key and lets it go: statements (the hot path).
  const timeline: FlushGate["timeline"] = (id, key, value) => {
    const entry = accumulator.get(id)
    if (Predicate.isUndefined(entry)) return
    let byKey = timelines.get(entry)
    let known: GateTimeline | undefined
    if (Predicate.isNotUndefined(byKey)) known = byKey.get(key)
    if (known === value) return
    // The one it had is cancelled at the next flush, with the commit that draws the key without it.
    if (Predicate.isNotUndefined(known)) {
      const ending = endings.get(entry)
      if (Predicate.isNotUndefined(ending)) ending.push(known)
      if (Predicate.isUndefined(ending)) endings.set(entry, [known])
      if (Predicate.isNotUndefined(byKey)) byKey.delete(key)
    }
    if (Predicate.isNotUndefined(value)) {
      if (Predicate.isUndefined(byKey)) {
        byKey = new Map()
        timelines.set(entry, byKey)
      }
      byKey.set(key, value)
    }
    // An element left with none leaves the map, so the flush skips it.
    if (Predicate.isNotUndefined(byKey) && byKey.size === 0) timelines.delete(entry)
    entry.dirty = true
    scheduleFlush()
  }

  /** `entry`'s Timeline values for `keys`, cancelled at once: those keys go back to the element's own style. */
  const releaseTimelines = (entry: Entry, keys: ReadonlyArray<string>): void => {
    const byKey = timelines.get(entry)
    if (Predicate.isUndefined(byKey)) return
    for (const key of keys) {
      const value = byKey.get(key)
      if (Predicate.isUndefined(value)) continue
      byKey.delete(key)
      value.cancel()
    }
    if (byKey.size === 0) timelines.delete(entry)
  }

  const release: FlushGate["release"] = (id, keys, restore, keep) => {
    const entry = accumulator.get(id)
    if (Predicate.isUndefined(entry)) return
    releaseTimelines(entry, keys)
    // A property another writer draws next: dropped from what's saved, so its drop-out writes nothing.
    if (Predicate.isNotUndefined(keep)) for (const property of keep) entry.committed.delete(property)
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
    // Off the loop first, so no tick flushes what follows; a failure reported, never thrown (#618).
    const unhooked = Effect.runSyncExit(Scope.close(ticks, Exit.void))
    if (Exit.isFailure(unhooked)) runtime.runFork(Report.failure("wardic.gate: its tick hook failed to close", unhooked.cause))
    if (scheduled) {
      cancelFrame(frame)
      scheduled = false
    }
    for (const entry of accumulator.values()) cancelTimelines(entry)
    timelines.clear()
    endings.clear()
    accumulator.clear()
    firstCommits.clear()
    committedSince.clear()
    // The calls waiting on a flush that won't come: their provider is gone (#257).
    afterFlushes = []
    for (const id of [...outputsById.keys()]) endOutputs(id)
  }

  // The gate's hook on the loop, for the gate's lifetime: a child of the Scope it's built in, so a gate
  // its `dispose` never reached is unhooked as that Scope closes.
  const ticks = Scope.forkUnsafe(runtime.scope, "sequential")
  runtime.runSync(afterTick(flushTicked).pipe(Scope.provide(ticks)))

  return { register, write, flushPass, release, valueOf, afterFlush, timeline, dispose }
}


