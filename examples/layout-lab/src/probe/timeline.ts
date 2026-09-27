/**
 * The lab timeline: one place that records, on the `performance.now()` millisecond
 * timebase, everything the lab needs to line up a layout trigger against Wardic's
 * measure pass.
 *
 * It records three things, each in its own bounded ring buffer:
 *
 * - **Marks**: `trigger` marks (a scenario is about to make its layout-mutating
 *   write) and `note` marks (auxiliary steps), dropped by the lab.
 * - **Spans**: every `wardic.*` Effect span, captured by a custom `Tracer`
 *   (`wardic.projection.measure` is the measure pass; `wardic.projection.coordinator`
 *   is one animation burst).
 * - **Paints**: one timestamp per painted frame, fed by the ticker's post-paint hook.
 *
 * From those it answers the lab's core question with `framesToMeasure`: how many
 * frames were painted between a trigger and the measure pass that picked it up.
 *
 * The module is framework-free and touches no DOM at evaluation time. Every record
 * it hands out is a JSON-safe plain object (no bigint, no `Exit`, no DOM node), and
 * carries the `scheduler` the page was loaded under, so a copied log says which
 * timing it was captured with.
 *
 * @module
 */
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Tracer from "effect/Tracer"

declare global {
  /**
   * The Effect task-scheduler mode the page was loaded under. The inline classic
   * script in `index.html` sets it before any module evaluates: `"microtask"` when
   * `?scheduler=microtask` installed the queueMicrotask-backed `setImmediate`,
   * `"default"` otherwise. It is `undefined` outside the lab page (e.g. under bun).
   */
  var __labScheduler: "microtask" | "default" | undefined
}

/**
 * The Effect task-scheduler mode a record was captured under (see `index.html`):
 * `"microtask"` for the test-harness `setImmediate` polyfill, `"default"` for
 * Effect's real-app `setTimeout(0)` fallback.
 */
export type LabScheduler = "microtask" | "default"

/**
 * Reads `globalThis.__labScheduler` at call time, defaulting to `"default"` when it
 * is unset (or holds anything unexpected).
 */
export const currentLabScheduler = (): LabScheduler =>
  globalThis.__labScheduler === "microtask" ? "microtask" : "default"

/**
 * The kind of a timeline mark: `trigger` starts a run (dropped immediately before
 * the layout-mutating write); `note` is an auxiliary step that starts nothing.
 */
export type MarkKind = "trigger" | "note"

/** A point on the timeline dropped by the lab. */
export interface Mark {
  /** Whether this mark starts a run (`trigger`) or only annotates one (`note`). */
  readonly kind: MarkKind
  /** A short label, e.g. the trigger path (`"click"`) or the step being noted. */
  readonly label: string
  /** The scenario the mark belongs to. The key is absent when no id was given. */
  readonly scenarioId?: string
  /** When the mark was dropped (`performance.now()`, ms). */
  readonly t: number
  /** The scheduler mode the mark was captured under. */
  readonly scheduler: LabScheduler
}

/**
 * One recorded `wardic.*` span. The record is created (and buffered) when the span
 * starts, then completed in place when it ends: `end` and `exitTag` are absent while
 * the span is in flight, and `attributes` is `{}` until the end-time copy.
 *
 * It is a plain, JSON-serializable object: absent optional fields are omitted
 * rather than set to `undefined`, so a `JSON.parse(JSON.stringify(...))` round trip
 * deep-equals the original.
 */
export interface SpanRecord {
  /** The span's id (the Effect `spanId`). */
  readonly id: string
  /** The span name, e.g. `"wardic.projection.measure"`. */
  readonly name: string
  /** The parent span's name. Absent for a root span or an external parent. */
  readonly parentName?: string
  /** When the span started (`performance.now()` at construction, ms). */
  readonly start: number
  /** When the span ended (`performance.now()` in `end()`, ms). Absent while in flight. */
  readonly end?: number
  /**
   * The span's attributes, copied into a JSON-safe plain object when the span ends
   * (so annotations made during the span, such as `nodes`/`active` on
   * `wardic.projection.measure`, are included). A bigint becomes its decimal string,
   * a non-finite number its string form, and any non-plain object (an `Error`, an
   * `Exit`, a DOM node) its `String()` form.
   */
  readonly attributes: Readonly<Record<string, unknown>>
  /**
   * How the span ended: `"Success"`, `"Failure"`, or `"Interrupted"` for a failure
   * whose cause is interruption only. Interruption is how the projection coordinator
   * stops once every node settles, so it is the expected end, not an error. Absent
   * while in flight.
   */
  readonly exitTag?: "Success" | "Failure" | "Interrupted"
  /** The scheduler mode the span was captured under. */
  readonly scheduler: LabScheduler
}

/** The slice of the timeline returned by `Timeline.window`. */
export interface TimelineWindow {
  /** The scheduler mode in effect when the window was taken. */
  readonly scheduler: LabScheduler
  /** Marks with `t` in the window, oldest first. */
  readonly marks: ReadonlyArray<Mark>
  /** Recorded spans whose `start` is in the window, oldest first (in-flight ones included). */
  readonly spans: ReadonlyArray<SpanRecord>
  /** Paint timestamps in the window, oldest first. */
  readonly paints: ReadonlyArray<number>
}

/** Options for `makeTimeline`. */
export interface TimelineOptions {
  /**
   * The capacity of EACH ring buffer (marks, spans, paints). When a buffer is full
   * the oldest entry is overwritten. Must be a positive integer. Default 2048.
   */
  readonly capacity?: number
}

/** The lab timeline (see the module doc). Every method is safe to pass unbound. */
export interface Timeline {
  /**
   * The custom Effect `Tracer`. It records every span whose name starts with
   * `wardic.`; other spans are created as ordinary native spans and not recorded.
   */
  readonly tracer: Tracer.Tracer
  /** `Layer.succeed(Tracer.Tracer, tracer)`: merge it into the Wardic environment. */
  readonly layer: Layer.Layer<never>
  /** Records and returns a mark stamped with `performance.now()`. */
  readonly mark: (kind: MarkKind, label: string, scenarioId?: string) => Mark
  /**
   * Records one painted frame at `t` (`performance.now()` timebase, ms). Called once
   * per frame, so it only writes the paint ring buffer: O(1), no allocation.
   */
  readonly notePaint: (t: number) => void
  /**
   * Subscribes `cb` to the end of every recorded span, called with the completed
   * record. A listener that throws is reported with `console.error` and never
   * reaches the Effect runtime; the remaining listeners still run.
   *
   * @returns an unsubscribe function (idempotent).
   */
  readonly onSpanEnd: (cb: (s: SpanRecord) => void) => () => void
  /**
   * How many recorded spans named `name` have started and not yet ended. Kept as a
   * running count, not read from the span ring, so a long-lived span (a driver's
   * `wardic.clock`) still counts after newer spans have pushed its record out.
   * `wardic.clock` > 0 means the Clock is ticking: each subscription to
   * `Clock.ticks` runs inside one, for exactly as long as it holds the Clock.
   */
  readonly openCount: (name: string) => number
  /**
   * Counts the recorded paints `p` with `trigger.t < p < s.start`, where `s` is the
   * first `wardic.projection.measure` span with `start >= trigger.t`: the number of
   * frames painted before the measure pass that answered the trigger.
   *
   * @returns `undefined` while no such measure span has been recorded.
   */
  readonly framesToMeasure: (trigger: Mark) => number | undefined
  /** Returns the marks, spans (by `start`) and paints with timestamps in `[from, to]`. */
  readonly window: (from: number, to: number) => TimelineWindow
  /** Empties every buffer. Listeners stay subscribed; spans still open stay counted. */
  readonly clear: () => void
}

/** Spans whose name starts with this prefix are recorded. */
const RECORDED_PREFIX = "wardic."

/** The span that marks one measure pass. */
const MEASURE_SPAN = "wardic.projection.measure"

const DEFAULT_CAPACITY = 2048

/** How deep the attribute copy descends into nested arrays/objects before stringifying. */
const MAX_ATTRIBUTE_DEPTH = 4

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

type NativeSpanOptions = ConstructorParameters<typeof Tracer.NativeSpan>[0]

/** A fixed-capacity FIFO that overwrites its oldest entry when full. */
class Ring<T> {
  private readonly slots: Array<T | undefined>
  private readonly capacity: number
  private head = 0
  private size = 0

  constructor(capacity: number) {
    this.capacity = capacity
    this.slots = new Array<T | undefined>(capacity).fill(undefined)
  }

  push(value: T): void {
    this.slots[this.head] = value
    this.head = this.head + 1 === this.capacity ? 0 : this.head + 1
    if (this.size < this.capacity) this.size++
  }

  /** The oldest entry satisfying `pred`. */
  find(pred: (value: T) => boolean): T | undefined {
    const first = this.head - this.size + this.capacity
    for (let i = 0; i < this.size; i++) {
      const value = this.slots[(first + i) % this.capacity] as T
      if (pred(value)) return value
    }
    return undefined
  }

  /** Every entry satisfying `keep`, oldest first, in a fresh array. */
  filter(keep: (value: T) => boolean): Array<T> {
    const out: Array<T> = []
    const first = this.head - this.size + this.capacity
    for (let i = 0; i < this.size; i++) {
      const value = this.slots[(first + i) % this.capacity] as T
      if (keep(value)) out.push(value)
    }
    return out
  }

  clear(): void {
    this.slots.fill(undefined)
    this.head = 0
    this.size = 0
  }
}

const describe = (value: unknown): string => {
  try {
    return String(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

/** Maps `value` to something `JSON.stringify` round-trips losslessly. */
const toJsonSafe = (value: unknown, depth: number): unknown => {
  switch (typeof value) {
    case "string":
    case "boolean":
      return value
    case "number":
      // JSON writes NaN/±Infinity as null and -0 as 0; normalise so the round trip is exact.
      return Number.isFinite(value) ? (value === 0 ? 0 : value) : String(value)
    case "bigint":
      return value.toString()
    case "undefined":
      return null
  }
  if (typeof value !== "object") return describe(value) // symbol, function
  if (value === null) return null
  if (depth >= MAX_ATTRIBUTE_DEPTH) return describe(value)
  if (Array.isArray(value)) return Array.from(value, (item: unknown) => toJsonSafe(item, depth + 1))
  const proto: unknown = Object.getPrototypeOf(value)
  if (proto === Object.prototype || proto === null) return copyEntries(Object.entries(value), depth + 1)
  return describe(value)
}

/** Copies `entries` into a fresh plain object of JSON-safe values, skipping `undefined`. */
const copyEntries = (entries: Iterable<readonly [string, unknown]>, depth: number): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const [key, raw] of entries) {
    if (raw === undefined) continue
    let value: unknown
    try {
      value = toJsonSafe(raw, depth)
    } catch {
      value = "[unserializable]"
    }
    if (key === "__proto__") {
      Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true })
    } else {
      out[key] = value
    }
  }
  return out
}

/**
 * A native span that also fills a `SpanRecord`: `start` at construction, then
 * `end`, the attribute copy and `exitTag` when it ends. Parent, attributes, links
 * and status keep their native semantics.
 */
class LabSpan extends Tracer.NativeSpan {
  readonly record: Mutable<SpanRecord>
  private readonly onEnd: (record: SpanRecord) => void

  constructor(options: NativeSpanOptions, onEnd: (record: SpanRecord) => void) {
    super(options)
    const start = performance.now()
    const parent = options.parent
    const parentName = Option.isSome(parent) && parent.value._tag === "Span" ? parent.value.name : undefined
    const scheduler = currentLabScheduler()
    this.record =
      parentName === undefined
        ? { id: this.spanId, name: this.name, start, attributes: {}, scheduler }
        : { id: this.spanId, name: this.name, parentName, start, attributes: {}, scheduler }
    this.onEnd = onEnd
  }

  override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    const end = performance.now()
    super.end(endTime, exit)
    const record = this.record
    if (record.end !== undefined) return
    record.end = end
    record.attributes = copyEntries(this.attributes, 0)
    record.exitTag = Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause) ? "Interrupted" : exit._tag
    this.onEnd(record)
  }
}

/**
 * Creates a lab timeline with bounded buffers (`options.capacity` entries each,
 * default 2048). See `Timeline` for the API.
 *
 * @throws RangeError when `options.capacity` is not a positive integer.
 */
export const makeTimeline = (options?: TimelineOptions): Timeline => {
  const capacity = options?.capacity ?? DEFAULT_CAPACITY
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`makeTimeline: capacity must be a positive integer, got ${capacity}`)
  }

  const marks = new Ring<Mark>(capacity)
  const spans = new Ring<SpanRecord>(capacity)
  // Paints get a typed ring of their own so the per-frame write never allocates.
  const paints = new Float64Array(capacity)
  let paintHead = 0
  let paintSize = 0

  let listeners: ReadonlyArray<{ readonly cb: (s: SpanRecord) => void }> = []
  // Recorded spans started and not yet ended, per name (see `openCount`).
  const open = new Map<string, number>()

  const notifySpanEnd = (record: SpanRecord): void => {
    open.set(record.name, (open.get(record.name) ?? 1) - 1)
    // Copy-on-write list: (un)subscribing during a notification never disturbs it.
    for (const listener of listeners) {
      try {
        listener.cb(record)
      } catch (error) {
        console.error("[layout-lab] timeline: an onSpanEnd listener threw", error)
      }
    }
  }

  const tracer = Tracer.make({
    span(spanOptions) {
      if (!spanOptions.name.startsWith(RECORDED_PREFIX)) return new Tracer.NativeSpan(spanOptions)
      const span = new LabSpan(spanOptions, notifySpanEnd)
      spans.push(span.record)
      open.set(spanOptions.name, (open.get(spanOptions.name) ?? 0) + 1)
      return span
    },
  })

  const mark = (kind: MarkKind, label: string, scenarioId?: string): Mark => {
    const t = performance.now()
    const scheduler = currentLabScheduler()
    const m: Mark =
      scenarioId === undefined ? { kind, label, t, scheduler } : { kind, label, scenarioId, t, scheduler }
    marks.push(m)
    return m
  }

  const notePaint = (t: number): void => {
    paints[paintHead] = t
    paintHead = paintHead + 1 === capacity ? 0 : paintHead + 1
    if (paintSize < capacity) paintSize++
  }

  const onSpanEnd = (cb: (s: SpanRecord) => void): (() => void) => {
    const entry = { cb }
    listeners = [...listeners, entry]
    return () => {
      listeners = listeners.filter((l) => l !== entry)
    }
  }

  const framesToMeasure = (trigger: Mark): number | undefined => {
    const after = trigger.t
    // `>=`, not `>`: Firefox coarsens `performance.now()` to whole milliseconds, so a
    // measure pass can start in the trigger's own millisecond.
    const measure = spans.find((s) => s.name === MEASURE_SPAN && s.start >= after)
    if (measure === undefined) return undefined
    const before = measure.start
    const first = paintHead - paintSize + capacity
    let frames = 0
    for (let i = 0; i < paintSize; i++) {
      const p = paints[(first + i) % capacity]
      if (p > after && p < before) frames++
    }
    return frames
  }

  const windowOf = (from: number, to: number): TimelineWindow => {
    const inWindow: Array<number> = []
    const first = paintHead - paintSize + capacity
    for (let i = 0; i < paintSize; i++) {
      const p = paints[(first + i) % capacity]
      if (p >= from && p <= to) inWindow.push(p)
    }
    return {
      scheduler: currentLabScheduler(),
      marks: marks.filter((m) => m.t >= from && m.t <= to),
      spans: spans.filter((s) => s.start >= from && s.start <= to),
      paints: inWindow,
    }
  }

  const clear = (): void => {
    marks.clear()
    spans.clear()
    paintHead = 0
    paintSize = 0
  }

  return {
    tracer,
    layer: Layer.succeed(Tracer.Tracer, tracer),
    mark,
    notePaint,
    onSpanEnd,
    openCount: (name) => open.get(name) ?? 0,
    framesToMeasure,
    window: windowOf,
    clear,
  }
}
