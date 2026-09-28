/**
 * The lab's frame trace (issues #2 and #18): an always-on record of what ran in
 * each Refresh frame, so a saved run shows the order of the flush gate's callback
 * against the Clock's, when ResizeObserver callbacks ran, and when the input that
 * started the run was handled relative to the next Refresh frame.
 *
 * It records three things, each in its own bounded ring buffer:
 *
 * - **rAF callbacks** ({@link RafRecord}): every `requestAnimationFrame` callback,
 *   with the timestamp the browser passed it, when it was requested, and when it
 *   started and ended. `lab/frame-order.ts` groups them into Refresh frames.
 * - **ResizeObserver deliveries** ({@link ObserverRecord}): every callback of every
 *   ResizeObserver created after this module loaded.
 * - **Inputs** ({@link InputRecord}): every `pointerdown` and `click`, seen by a
 *   capture-phase listener on `window` before any scenario handler runs.
 *
 * Every record carries a `seq`, its place in one page-wide sequence, because
 * Firefox coarsens `performance.now()` to whole milliseconds: times can tie, the
 * sequence can't.
 *
 * ## How callbacks are tagged
 *
 * A rAF callback is tagged by who requested it, read from the request's stack: the
 * first stack frame outside this module names the calling file. `gate` is
 * `@wardic/solid`'s flush gate, `clock` is core's Refresh frame Clock, `ticker` is
 * the lab's post-paint ticker, `scenario` is a scenario's own request (scenario 4
 * and free play), and anything else is `other`. A ResizeObserver is tagged when it
 * is constructed: `engine-ro` when the projection engine creates it
 * (`@wardic/dom`'s `projection.ts`), `app-ro` otherwise. The file names only appear
 * under the Vite dev server (`bun run dev`); a `vite build` bundles every module
 * into one chunk, and then every callback tags `other` and every observer `app-ro`.
 *
 * ## Installing
 *
 * The wrappers are installed when this module first evaluates, so `main.tsx`
 * imports it before anything else: the Clock reads `requestAnimationFrame` when its
 * Layer builds and the gate reads it on every call, so both see the wrapper. A
 * second evaluation (an HMR update) reuses the installed trace instead of wrapping
 * the wrappers. Outside a browser (the node test tier) nothing is installed and
 * {@link frameTrace} records nothing. The wrappers keep the native behavior: the
 * window as receiver, the arguments, the returned handle, the observer as the
 * callback's `this`, and the native error for an argument that isn't a function.
 *
 * ## Cost
 *
 * Per rAF request: one wrapper closure and, when the callback runs, one record. The
 * stack is only taken the first time a callback function is seen (cached in a
 * `WeakMap`): the gate's `flush` and the ticker's `tick` are stable functions, but
 * the Clock requests a fresh closure every Refresh frame, so one `new Error().stack`
 * (tens of µs) is taken per frame while the Clock ticks. The Clock makes that
 * request inside its own callback, so the cost shows in the `clock` record's
 * `end - start`. A scenario's own requests are fresh closures too, one per Run. No
 * DOM read, no console output and no Solid signal write on the per-frame path.
 *
 * @module
 */

/** Who requested a rAF callback (see the module doc). */
export type RafTag = "gate" | "clock" | "ticker" | "scenario" | "other"

/** Who created a ResizeObserver: `@wardic/dom`'s projection engine, or anyone else. */
export type RoTag = "engine-ro" | "app-ro"

/** One rAF callback that ran. Every time is `performance.now()`, in ms. */
export interface RafRecord {
  readonly tag: RafTag
  /** Its place in the page's sequence of traced events, taken when it started. */
  readonly seq: number
  /**
   * Its place in the same sequence, taken when it was requested. A callback
   * requested after a frame's first callback started runs in a later frame (the
   * HTML Standard snapshots a frame's callbacks when the frame begins), which is
   * how `lab/frame-order.ts` tells apart two frames that share a timestamp.
   */
  readonly requestSeq: number
  /**
   * The timestamp the browser passed the callback: equal for every callback of one
   * Refresh frame, but not unique to it. Firefox can run a second Refresh frame
   * right after an input with the previous frame's timestamp.
   */
  readonly frameTs: number
  /** When the callback was requested. */
  readonly requestedAt: number
  /** When the callback started. */
  readonly start: number
  /** When it returned (or threw). */
  readonly end: number
}

/** One ResizeObserver delivery. */
export interface ObserverRecord {
  readonly tag: RoTag
  /** Its place in the page's sequence of traced events, taken when it started. */
  readonly seq: number
  /** The `frameTs` of the last rAF callback that started before it; `null` before the first. */
  readonly frameTs: number | null
  readonly start: number
  readonly end: number
  /** How many entries the delivery carried. */
  readonly entries: number
}

/** One `pointerdown` or `click`. */
export interface InputRecord {
  readonly type: "pointerdown" | "click"
  /** Its place in the page's sequence of traced events. */
  readonly seq: number
  /** `performance.now()` in the capture-phase listener, just before the scenario's handler. */
  readonly t: number
  /** The event's `timeStamp`: when the browser created it, on the same timebase. */
  readonly timeStamp: number
  /** The closest `[data-scenario]` value, `/`, the closest `[data-action]` value (either may be empty). */
  readonly target: string
}

/** The records with times in a window, oldest first, in fresh arrays. */
export interface FrameTraceWindow {
  /** rAF callbacks whose `start` is in the window. */
  readonly callbacks: ReadonlyArray<RafRecord>
  /** ResizeObserver deliveries whose `start` is in the window. */
  readonly observers: ReadonlyArray<ObserverRecord>
  /** Inputs whose `t` is in the window. */
  readonly inputs: ReadonlyArray<InputRecord>
}

/** The installed trace (see the module doc). */
export interface FrameTrace {
  /** Returns the records with times in `[from, to]`. */
  readonly window: (from: number, to: number) => FrameTraceWindow
}

/** The ring capacities: a run's window (up to 4.5 s) at up to 144 Hz with ~4 callbacks a frame fits the rAF ring. */
const RAF_CAPACITY = 8192
const OBSERVER_CAPACITY = 2048
const INPUT_CAPACITY = 256

/** This module's own file name: stack frames inside it are the wrapper, not the caller. */
const SELF = "frame-trace.ts"

/** The file each rAF tag is recognized by, matched against the caller's stack frame. */
const RAF_SITES: ReadonlyArray<readonly [string, RafTag]> = [
  ["/packages/solid/src/gate.ts", "gate"],
  ["/packages/core/src/services/refresh-frame-clock.ts", "clock"],
  ["/src/probe/paint-sampler.ts", "ticker"],
  ["/src/scenarios/", "scenario"],
]

/** The file the projection engine's shared ResizeObserver is created in. */
const ENGINE_FILE = "/packages/dom/src/projection.ts"

/**
 * The first stack frame outside this module: the caller. It skips Chromium's
 * `Error` header line. Firefox appends async-caller chains further down
 * (`FrameRequestCallback*…`); only the first frame is read, so they never count.
 */
const callerOf = (stack: string): string => {
  for (const line of stack.split("\n")) {
    const frame = line.trim()
    if (frame === "" || frame === "Error" || frame.includes(SELF)) continue
    return frame
  }
  return ""
}

/** Tags a rAF request from its stack (`new Error().stack` at the request). Pure. */
export const rafTagOfStack = (stack: string): RafTag => {
  const caller = callerOf(stack)
  for (const [file, tag] of RAF_SITES) if (caller.includes(file)) return tag
  return "other"
}

/** Tags a ResizeObserver from its construction stack. Pure. */
export const roTagOfStack = (stack: string): RoTag => (callerOf(stack).includes(ENGINE_FILE) ? "engine-ro" : "app-ro")

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

  /** Every entry whose time (`at`) is in `[from, to]`, oldest first, in a fresh array. */
  between(at: (value: T) => number, from: number, to: number): Array<T> {
    const out: Array<T> = []
    const first = this.head - this.size + this.capacity
    for (let i = 0; i < this.size; i++) {
      const value = this.slots[(first + i) % this.capacity] as T
      const t = at(value)
      if (t >= from && t <= to) out.push(value)
    }
    return out
  }
}

/** The trace outside a browser: records nothing. */
const EMPTY_TRACE: FrameTrace = { window: () => ({ callbacks: [], observers: [], inputs: [] }) }

/** The closest `[data-scenario]` / `[data-action]` of an input's target, as `scenario/action`. */
const targetOf = (target: EventTarget | null): string => {
  if (!(target instanceof Element)) return ""
  const scenario = target.closest("[data-scenario]")?.getAttribute("data-scenario") ?? ""
  const action = target.closest("[data-action]")?.getAttribute("data-action") ?? ""
  return `${scenario}/${action}`
}

/** Wraps rAF and ResizeObserver and adds the input listeners. Called once per page. */
const install = (): FrameTrace => {
  const rafs = new Ring<RafRecord>(RAF_CAPACITY)
  const observers = new Ring<ObserverRecord>(OBSERVER_CAPACITY)
  const inputs = new Ring<InputRecord>(INPUT_CAPACITY)

  // The Refresh frame of the rAF callback that started last (see ObserverRecord.frameTs).
  let lastFrameTs: number | null = null
  // The page's traced-event counter (see RafRecord.seq).
  let seq = 0

  const nativeRequest = window.requestAnimationFrame
  const tags = new WeakMap<FrameRequestCallback, RafTag>()

  // An arrow function calling the native one with the window as receiver: the Clock
  // calls `requestAnimationFrame` detached (refresh-frame-clock.ts), which must work.
  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    // Not a function: let the native call throw exactly as it would untraced.
    if (typeof callback !== "function") return nativeRequest.call(window, callback)
    let tag = tags.get(callback)
    if (tag === undefined) {
      tag = rafTagOfStack(new Error().stack ?? "")
      tags.set(callback, tag)
    }
    const requestTag = tag
    const requestSeq = ++seq
    const requestedAt = performance.now()
    return nativeRequest.call(window, (frameTs) => {
      lastFrameTs = frameTs
      const at = ++seq
      const start = performance.now()
      try {
        callback(frameTs)
      } finally {
        rafs.push({ tag: requestTag, seq: at, requestSeq, frameTs, requestedAt, start, end: performance.now() })
      }
    })
  }

  if (typeof window.ResizeObserver === "function") {
    const NativeResizeObserver = window.ResizeObserver
    class TracedResizeObserver extends NativeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        // Not a function: hand it to the native constructor, which throws as untraced.
        if (typeof callback !== "function") {
          super(callback)
          return
        }
        const tag = roTagOfStack(new Error().stack ?? "")
        super((entries, observer) => {
          const frameTs = lastFrameTs
          const at = ++seq
          const start = performance.now()
          try {
            // The observer is the callback's `this` natively.
            callback.call(observer, entries, observer)
          } finally {
            observers.push({ tag, seq: at, frameTs, start, end: performance.now(), entries: entries.length })
          }
        })
      }
    }
    window.ResizeObserver = TracedResizeObserver
  }

  const onInput = (event: Event): void => {
    inputs.push({
      type: event.type === "click" ? "click" : "pointerdown",
      seq: ++seq,
      t: performance.now(),
      timeStamp: event.timeStamp,
      target: targetOf(event.target),
    })
  }
  const listen: AddEventListenerOptions = { capture: true, passive: true }
  window.addEventListener("pointerdown", onInput, listen)
  window.addEventListener("click", onInput, listen)

  return {
    window: (from, to) => ({
      callbacks: rafs.between((r) => r.start, from, to),
      observers: observers.between((r) => r.start, from, to),
      inputs: inputs.between((r) => r.t, from, to),
    }),
  }
}

/** Where the installed trace lives, so a second evaluation of this module finds it. */
const INSTALLED = Symbol.for("wardic.layoutLab.frameTrace")

type Host = typeof globalThis & { [INSTALLED]?: FrameTrace }

/**
 * The page's frame trace, installed when this module first evaluates in a browser.
 * Outside one it records nothing.
 */
export const frameTrace: FrameTrace =
  typeof window === "undefined" ? EMPTY_TRACE : ((globalThis as Host)[INSTALLED] ??= install())
