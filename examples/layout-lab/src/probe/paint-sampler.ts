/**
 * The lab's paint probe: a post-paint frame ticker, a sampler that follows one
 * element's painted box through a run, and the classifier that turns those samples
 * into a verdict.
 *
 * The research question (issue #2) is whether a layout trigger lets the browser
 * paint the element's destination box before Wardic's measure pass seeds the FLIP.
 * If it does, the user sees one frame at the destination, then the element jumps
 * back to its origin and animates: a teleport-and-return, or "flash".
 *
 * ## What "post-paint" means here
 *
 * A read inside a `requestAnimationFrame` callback sees the DOM before the frame's
 * later rAF callbacks run. Wardic's own measure pass is one of those later
 * callbacks, so an rAF-time read cannot say what the frame showed. Instead the
 * ticker posts a `MessageChannel` message from each rAF callback. A posted message
 * is a task, and the event loop runs no task until the current rendering update
 * (rAF callbacks, style, layout, ResizeObserver callbacks, paint) has finished. The
 * handler therefore runs after the frame painted, and a `getBoundingClientRect`
 * there reads the box that frame put on screen, transform included.
 *
 * ## Which deliveries belong to a run
 *
 * A run starts in `begin()`, called immediately before the layout-mutating write.
 * Every delivery carries the number of the frame whose rAF posted it:
 *
 * - A frame numbered after `begin()`'s frame had its rAF, and so its paint, after
 *   `begin()`. It is always a sample.
 * - A frame numbered before it painted before `begin()`. It is never a sample.
 * - `begin()`'s own frame is ambiguous when its delivery is still pending. Either
 *   `begin()` runs inside that frame's rendering update (a later rAF callback, a
 *   ResizeObserver callback), so the paint comes after it and must be sampled: this
 *   is the flash frame of the rAF and ResizeObserver scenarios. Or `begin()` runs in
 *   a task that the event loop picked between that paint and the ticker's message
 *   (a click, an IntersectionObserver or timer task). Then the paint showed the
 *   origin, but a read in the late handler would see the already-mutated DOM and
 *   report a destination frame that was never painted: a false flash.
 *
 * No synchronous API tells these apart, so an ambiguous `begin()` observes
 * `document.documentElement` with a one-shot `IntersectionObserver`. Intersections
 * are computed near the end of the next rendering update, after its rAF callbacks.
 * If the callback runs while the ticker is still on `begin()`'s frame, that frame's
 * rendering update was still ahead of `begin()`, so its paint is kept. Otherwise it
 * is dropped. Chromium and Firefox both behave this way for a later rAF callback, a
 * ResizeObserver callback, and a task between the paint and the ticker's message.
 *
 * ## Cost
 *
 * The ticker runs one rAF per frame for the page's lifetime. With no active run the
 * sampler's post-paint listener records the frame number and returns: no layout
 * read, no allocation. The module touches no DOM at evaluation time, so the node
 * test tier can import it to test `classify` (`test/classify.test.ts`).
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Post-paint ticker
// ---------------------------------------------------------------------------

/**
 * A post-paint listener.
 *
 * @param t `performance.now()` when the post-paint message was handled.
 * @param frame the ticker frame whose paint just happened: the count of ticker rAF
 * callbacks up to and including the one that posted this message.
 */
export type PostPaintListener = (t: number, frame: number) => void

/** A running post-paint ticker (see {@link startPostPaintTicker}). */
export interface PostPaintTicker {
  /**
   * Subscribes `cb` to every post-paint delivery. Listeners run in subscription
   * order. A listener that throws is reported with `reportError` and the others
   * still run.
   *
   * @returns an unsubscribe function (idempotent).
   */
  readonly onPostPaint: (cb: PostPaintListener) => () => void
  /**
   * The number of ticker rAF callbacks run so far (0 before the first). A delivery
   * for frame `n` means frame `n` has painted. When `frame()` is ahead of the last
   * delivered frame, that frame's paint message is still pending.
   */
  readonly frame: () => number
  /**
   * Stops the ticker for good. It cancels the pending rAF, closes both ports (so an
   * in-flight message is never delivered) and drops every listener. Idempotent.
   */
  readonly stop: () => void
}

/**
 * One `onPostPaint` subscription. It is an object, so a callback subscribed twice
 * is removed once per unsubscribe call.
 */
interface TickerEntry {
  readonly cb: PostPaintListener
}

/**
 * Starts the post-paint ticker: one `requestAnimationFrame` per frame. Each rAF
 * callback bumps the frame count, posts exactly one `MessageChannel` message
 * carrying it, and requests the next rAF. Listeners run in the message handler,
 * after that frame painted, with `t = performance.now()`.
 *
 * The rAF callback does no other work, so the ticker never reads or writes layout
 * inside the frame it is observing. Create one ticker per page and share it (the
 * sampler, the timeline's paint log and the frame-stretch control all listen to
 * the same one).
 */
export const startPostPaintTicker = (): PostPaintTicker => {
  const channel = new MessageChannel()
  // Copy-on-write: subscribe/unsubscribe replace the array, dispatch iterates the
  // array it started with. That keeps per-frame dispatch allocation-free and makes
  // mid-dispatch (un)subscription well-defined.
  let entries: ReadonlyArray<TickerEntry> = []
  let frame = 0
  let rafId = 0
  let stopped = false

  channel.port1.onmessage = (event: MessageEvent<number>) => {
    const t = performance.now()
    const painted = event.data
    const current = entries
    for (const entry of current) {
      try {
        entry.cb(t, painted)
      } catch (error) {
        reportError(error)
      }
    }
  }

  const tick = (): void => {
    frame += 1
    channel.port2.postMessage(frame)
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)

  const onPostPaint: PostPaintTicker["onPostPaint"] = (cb) => {
    const entry: TickerEntry = { cb }
    entries = [...entries, entry]
    return () => {
      entries = entries.filter((e) => e !== entry)
    }
  }

  const stop: PostPaintTicker["stop"] = () => {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(rafId)
    channel.port1.onmessage = null
    channel.port1.close()
    channel.port2.close()
    entries = []
  }

  return { onPostPaint, frame: () => frame, stop }
}

// ---------------------------------------------------------------------------
// Visual boxes
// ---------------------------------------------------------------------------

/**
 * An element's painted box in viewport CSS pixels, as `getBoundingClientRect`
 * reports it. It includes transforms, so mid-FLIP it is where the element appears,
 * not its layout slot. Plain numbers, so it is JSON-safe.
 */
export interface VisualBox {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** Reads `el`'s painted box. Only the sampler calls it: in `begin()` and post-paint. */
const readVisualBox = (el: Element): VisualBox => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/**
 * The distance between two boxes: the largest absolute difference over `left`,
 * `top`, `width` and `height`. One number covers moves and resizes alike: two boxes
 * within `d` of each other have every edge and every dimension within `d`.
 */
export const boxDistance = (a: VisualBox, b: VisualBox): number =>
  Math.max(
    Math.abs(a.left - b.left),
    Math.abs(a.top - b.top),
    Math.abs(a.width - b.width),
    Math.abs(a.height - b.height),
  )

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * How a run ended.
 *
 * - `clean`: the painted frames went from the origin toward the destination with no
 *   destination frame before the animation.
 * - `flash`: a painted frame showed the destination, then within the next 3 samples
 *   the element was closer to the origin again (teleport-and-return).
 * - `snap`: the first painted frame after the trigger already showed the
 *   destination and nothing returned: no FLIP was visible.
 * - `wrong-origin`: the first painted frame was off the origin-to-destination path
 *   by more than `wrongOriginPx`: the FLIP started somewhere the element never was
 *   (issue #13's scroll-offset seed painted it ~1300px away).
 * - `no-move`: origin and destination are closer than `minMovePx`.
 * - `timeout`: the box had not settled `timeoutMs` after the trigger.
 * - `interrupted`: `begin()` or `cancel()` ended the run before it settled.
 */
export type Verdict = "clean" | "flash" | "snap" | "wrong-origin" | "no-move" | "timeout" | "interrupted"

/** The pixel thresholds {@link classify} uses. */
export interface Thresholds {
  /** Two boxes within this {@link boxDistance} are the same box. */
  readonly nearPx: number
  /** A run whose origin and destination are closer than this did not move. */
  readonly minMovePx: number
  /** A first sample further than this {@link pathDistance} off the path is `wrong-origin`. */
  readonly wrongOriginPx: number
}

/** What {@link classify} decides from the samples alone. */
export interface Classification {
  /** `timeout` and `interrupted` come from the run's lifecycle, never from samples. */
  readonly verdict: Exclude<Verdict, "timeout" | "interrupted">
  /** For `flash` only: the index of the first sample that showed the destination. */
  readonly teleportIndex?: number
  /** For `wrong-origin` only: the first sample minus the origin, per field. */
  readonly originOffset?: VisualBox
}

/** How many samples after a destination frame {@link classify} looks for the return. */
const RETURN_WINDOW = 3

/**
 * How far `sample` lies off the straight path from `origin` to `destination`: the
 * {@link boxDistance} between `sample` and its projection onto that segment.
 *
 * The projection uses all four box fields (`left`, `top`, `width`, `height`) as one
 * vector, because a FLIP moves and resizes with a single progress value: every frame
 * of a correct animation is `origin + t * (destination - origin)` in all four at
 * once. `t` is the least-squares fit over the four fields, clamped to [0, 1], so a
 * sample before the origin or past the destination is measured against that end.
 * A zero-length path (origin equals destination) projects onto the origin.
 */
export const pathDistance = (sample: VisualBox, origin: VisualBox, destination: VisualBox): number => {
  const dLeft = destination.left - origin.left
  const dTop = destination.top - origin.top
  const dWidth = destination.width - origin.width
  const dHeight = destination.height - origin.height
  const lengthSq = dLeft * dLeft + dTop * dTop + dWidth * dWidth + dHeight * dHeight
  const along =
    lengthSq === 0
      ? 0
      : ((sample.left - origin.left) * dLeft +
          (sample.top - origin.top) * dTop +
          (sample.width - origin.width) * dWidth +
          (sample.height - origin.height) * dHeight) /
        lengthSq
  const t = Math.min(1, Math.max(0, along))
  return boxDistance(sample, {
    left: origin.left + t * dLeft,
    top: origin.top + t * dTop,
    width: origin.width + t * dWidth,
    height: origin.height + t * dHeight,
  })
}

/** `a - b`, per field. */
const boxOffset = (a: VisualBox, b: VisualBox): VisualBox => ({
  left: a.left - b.left,
  top: a.top - b.top,
  width: a.width - b.width,
  height: a.height - b.height,
})

/**
 * Classifies one run's painted samples. Pure: no DOM access, so it runs in the node
 * test tier. Checks run in this order:
 *
 * 1. `no-move` when `boxDistance(origin, destination) < minMovePx`.
 * 2. `flash` when some sample `s[i]` is within `nearPx` of the destination and some
 *    `s[j]` with `i < j <= i + 3` is closer to the origin than to the destination.
 *    `teleportIndex` is the first such `i`.
 * 3. `snap` when the first sample is already within `nearPx` of the destination.
 * 4. `wrong-origin` when the first sample's {@link pathDistance} is more than
 *    `wrongOriginPx`. `originOffset` is that sample minus the origin.
 * 5. `clean` otherwise (including an empty sample list, which the sampler never
 *    produces: a settled run holds at least `settleFrames` samples).
 *
 * The return test is "closer to the origin", not "within `nearPx` of the origin",
 * so a FLIP whose first projected frame has already advanced a little still counts.
 * A spring overshoot is not a return: after passing within `nearPx` of the
 * destination it stays on the destination's side of the midpoint. Only a spring
 * that overshoots by more than half the move could swing back far enough to read as
 * a flash.
 *
 * @param origin the box `begin()` read, before the layout-mutating write.
 * @param samples the painted boxes, oldest first.
 * @param destination the settled box (the last sample).
 */
export const classify = (
  origin: VisualBox,
  samples: ReadonlyArray<VisualBox>,
  destination: VisualBox,
  thresholds: Thresholds,
): Classification => {
  if (boxDistance(origin, destination) < thresholds.minMovePx) return { verdict: "no-move" }
  for (let i = 0; i < samples.length; i++) {
    if (boxDistance(samples[i], destination) > thresholds.nearPx) continue
    const last = Math.min(samples.length - 1, i + RETURN_WINDOW)
    for (let j = i + 1; j <= last; j++) {
      const s = samples[j]
      if (boxDistance(s, origin) < boxDistance(s, destination)) {
        return { verdict: "flash", teleportIndex: i }
      }
    }
  }
  if (samples.length > 0 && boxDistance(samples[0], destination) <= thresholds.nearPx) {
    return { verdict: "snap" }
  }
  if (samples.length > 0 && pathDistance(samples[0], origin, destination) > thresholds.wrongOriginPx) {
    return { verdict: "wrong-origin", originOffset: boxOffset(samples[0], origin) }
  }
  return { verdict: "clean" }
}

// ---------------------------------------------------------------------------
// Ghosts
// ---------------------------------------------------------------------------

/**
 * The visible ghost per scenario id. A string-keyed native `Map`, never keyed by
 * element. Module-level, so {@link clearGhosts} can clear every sampler's ghosts.
 */
const ghosts = new Map<string, HTMLElement>()

/** Removes `scenarioId`'s ghost, if it has one. */
const removeGhost = (scenarioId: string): void => {
  const ghost = ghosts.get(scenarioId)
  if (ghost === undefined) return
  ghost.remove()
  ghosts.delete(scenarioId)
}

/**
 * Outlines a frame worth seeing after the fact: the teleport frame of a `flash`, or
 * the first frame of a `wrong-origin` run. A fixed-position, dashed, click-through
 * box labelled with the scenario id. It goes on `document.body`, outside every
 * `.stage`, so it cannot reflow a scenario. Being fixed-position, it lines up with
 * that frame only while the page stays at the scroll offset the sample was taken
 * at.
 */
const drawGhost = (scenarioId: string, box: VisualBox): void => {
  removeGhost(scenarioId)
  const ghost = document.createElement("div")
  ghost.dataset.flashGhost = scenarioId
  ghost.setAttribute("aria-hidden", "true")
  ghost.textContent = scenarioId
  ghost.style.cssText = [
    "position:fixed",
    `left:${box.left}px`,
    `top:${box.top}px`,
    `width:${box.width}px`,
    `height:${box.height}px`,
    "box-sizing:border-box",
    "margin:0",
    "padding:2px 3px",
    "pointer-events:none",
    "outline:2px dashed #ff2d95",
    "outline-offset:-2px",
    "background:transparent",
    "color:#ff2d95",
    "font:600 10px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace",
    "white-space:nowrap",
    "overflow:visible",
    "z-index:2147483647",
  ].join(";")
  document.body.append(ghost)
  ghosts.set(scenarioId, ghost)
}

/**
 * Removes every ghost, for example when the lab resets its flash counts. A ghost is
 * also removed by the next `begin()` for its scenario.
 */
export const clearGhosts = (): void => {
  for (const ghost of ghosts.values()) ghost.remove()
  ghosts.clear()
}

// ---------------------------------------------------------------------------
// Paint sampler
// ---------------------------------------------------------------------------

/** One post-paint read of the watched element. */
export interface PaintSample {
  /** `performance.now()` at the post-paint delivery. */
  readonly t: number
  /** The ticker frame whose paint this reads. */
  readonly frame: number
  /** The painted box. */
  readonly box: VisualBox
}

/**
 * The outcome of one run, delivered once through {@link PaintSampler.onRunEnd}.
 * Every field is a number, a string or an array of plain objects, so
 * `JSON.parse(JSON.stringify(result))` deep-equals it.
 */
export interface RunResult {
  /** The scenario the run belongs to. */
  readonly scenarioId: string
  /** The trigger time handed to `begin()` (the trigger mark's `t`). */
  readonly triggerAt: number
  /**
   * When the run ended: the post-paint `t` of the frame that settled it or timed it
   * out, or `performance.now()` when it was interrupted.
   */
  readonly endedAt: number
  /** How the run ended. */
  readonly verdict: Verdict
  /** The box `begin()` read, before the layout-mutating write. */
  readonly origin: VisualBox
  /** `window.scrollX` when `begin()` ran. */
  readonly scrollX: number
  /** `window.scrollY` when `begin()` ran. */
  readonly scrollY: number
  /**
   * The last sample's box: the settled box, or the latest one for a timeout or an
   * interruption. It is `origin` when there are no samples.
   */
  readonly destination: VisualBox
  /** Every painted frame of the run, oldest first. */
  readonly samples: ReadonlyArray<PaintSample>
  /** For `flash` only: the index into `samples` of the first destination frame. */
  readonly teleportIndex?: number
  /** For `wrong-origin` only: the first sample minus `origin`, per field. */
  readonly originOffset?: VisualBox
}

/** Tuning for {@link makePaintSampler}. Any field left out takes its default. */
export interface PaintSamplerOptions {
  /** A run settles when this many latest samples lie within `nearPx` of each other. Default 10. */
  readonly settleFrames?: number
  /** A run that has not settled this long after `triggerAt` ends as `timeout`. Default 4000. */
  readonly timeoutMs?: number
  /** Two boxes within this {@link boxDistance} are the same box. Default 1. */
  readonly nearPx?: number
  /** A move smaller than this is `no-move`. Default 8. */
  readonly minMovePx?: number
  /** A first sample further than this off the origin-to-destination path is `wrong-origin`. Default 8. */
  readonly wrongOriginPx?: number
}

/** The defaults {@link makePaintSampler} fills in. */
export const DEFAULT_PAINT_SAMPLER_OPTIONS: Required<PaintSamplerOptions> = {
  settleFrames: 10,
  timeoutMs: 4000,
  nearPx: 1,
  minMovePx: 8,
  wrongOriginPx: 8,
}

/** What {@link PaintSampler.begin} needs to start a run. */
export interface RunStart {
  /** The watched element. Its box is read synchronously as the origin. */
  readonly el: Element
  /** The scenario the run is attributed to. */
  readonly scenarioId: string
  /** The trigger mark's `performance.now()` time. The timeout counts from it. */
  readonly triggerAt: number
}

/** Follows one element's painted box through a run (see {@link makePaintSampler}). */
export interface PaintSampler {
  /**
   * Starts a run. Call it immediately before the layout-mutating write. It reads
   * the origin box synchronously; this is the only read outside the post-paint
   * listener. An active run ends first as `interrupted`, and this scenario's ghost
   * is removed.
   */
  readonly begin: (start: RunStart) => void
  /**
   * Follows `el` instead from the next post-paint sample on, for example the newly
   * mounted twin in a `layoutId` switch. `el` may still be disconnected (a Solid
   * `ref` runs before insertion): reads only happen post-paint, and a post-paint
   * read skips an element that is not connected. A no-op with no active run.
   */
  readonly retarget: (el: Element) => void
  /** Ends the active run as `interrupted`. A no-op with no active run. */
  readonly cancel: () => void
  /**
   * Subscribes `cb` to run ends. Each run is delivered exactly once, whether it
   * settled, timed out or was interrupted. A listener that throws is reported with
   * `reportError` and the others still run.
   *
   * @returns an unsubscribe function (idempotent).
   */
  readonly onRunEnd: (cb: (result: RunResult) => void) => () => void
  /** The active run's scenario id, or `undefined` when no run is active. */
  readonly activeScenarioId: () => string | undefined
}

/**
 * Whether `begin()`'s own frame painted after `begin()`:
 *
 * - `before`: it painted before, so it is not a sample. This is also the value
 *   when its delivery had already run when `begin()` was called.
 * - `after`: `begin()` ran inside its rendering update, so it is the first sample.
 * - `undecided`: the probe has not reported yet. That frame's read, if it arrives,
 *   is held back until the probe reports.
 */
type StartFramePaint = "before" | "after" | "undecided"

/** The mutable state of the active run. */
interface ActiveRun {
  readonly scenarioId: string
  readonly triggerAt: number
  readonly origin: VisualBox
  readonly scrollX: number
  readonly scrollY: number
  /** `ticker.frame()` when `begin()` ran. */
  readonly startFrame: number
  readonly samples: Array<PaintSample>
  el: Element
  startFramePaint: StartFramePaint
  /** The read of `startFrame`'s paint while `startFramePaint` is `undecided`. */
  held: PaintSample | undefined
  probe: IntersectionObserver | undefined
}

/**
 * One `onRunEnd` subscription. It is an object, so a callback subscribed twice is
 * removed once per unsubscribe call.
 */
interface RunEndEntry {
  readonly cb: (result: RunResult) => void
}

/**
 * Makes a paint sampler on `ticker`. It subscribes once, for its lifetime, and does
 * nothing per frame until `begin()` starts a run.
 *
 * During a run, each post-paint delivery that painted after `begin()` reads the
 * watched element's box (see the module doc for how the first frame is decided).
 * The run settles once the last `settleFrames` samples lie within `nearPx` of each
 * other; the destination is the last sample, and {@link classify} gives the
 * verdict. A `flash` also draws a ghost at the teleport frame's box, and a
 * `wrong-origin` at the first sample's box. A run that has
 * not settled `timeoutMs` after `triggerAt` ends as `timeout`. It does not settle
 * while its first frame is still undecided (in practice the probe reports within a
 * frame; the timeout still bounds it).
 */
export const makePaintSampler = (
  ticker: PostPaintTicker,
  options: PaintSamplerOptions = {},
): PaintSampler => {
  const settleFrames = Math.max(
    1,
    Math.floor(options.settleFrames ?? DEFAULT_PAINT_SAMPLER_OPTIONS.settleFrames),
  )
  const timeoutMs = options.timeoutMs ?? DEFAULT_PAINT_SAMPLER_OPTIONS.timeoutMs
  const nearPx = options.nearPx ?? DEFAULT_PAINT_SAMPLER_OPTIONS.nearPx
  const minMovePx = options.minMovePx ?? DEFAULT_PAINT_SAMPLER_OPTIONS.minMovePx
  const wrongOriginPx = options.wrongOriginPx ?? DEFAULT_PAINT_SAMPLER_OPTIONS.wrongOriginPx
  const thresholds: Thresholds = { nearPx, minMovePx, wrongOriginPx }

  let runEndEntries: ReadonlyArray<RunEndEntry> = []
  let active: ActiveRun | undefined
  // The last frame whose post-paint delivery reached this sampler. 0 until the
  // first one: a begin() before then counts as ambiguous, and the probe decides.
  let paintedFrame = 0

  /**
   * Ends `run` exactly once and delivers its result. Stale calls are no-ops.
   * `detail` carries the classifier's per-verdict fields.
   */
  const end = (
    run: ActiveRun,
    verdict: Verdict,
    endedAt: number,
    detail: Omit<Classification, "verdict"> = {},
  ): void => {
    if (active !== run) return
    active = undefined
    run.probe?.disconnect()
    run.probe = undefined
    // An undecided first frame is dropped: without the probe's answer it cannot be
    // shown to have painted after begin().
    run.held = undefined
    const { samples } = run
    const destination = samples.length > 0 ? samples[samples.length - 1].box : run.origin
    const { teleportIndex, originOffset } = detail
    const result: RunResult = {
      scenarioId: run.scenarioId,
      triggerAt: run.triggerAt,
      endedAt,
      verdict,
      origin: run.origin,
      scrollX: run.scrollX,
      scrollY: run.scrollY,
      destination,
      samples,
      // Omitted rather than `undefined`, so the result round-trips through JSON.
      ...(teleportIndex === undefined ? {} : { teleportIndex }),
      ...(originOffset === undefined ? {} : { originOffset }),
    }
    if (verdict === "flash" && teleportIndex !== undefined) {
      drawGhost(run.scenarioId, samples[teleportIndex].box)
    }
    if (verdict === "wrong-origin" && samples.length > 0) {
      drawGhost(run.scenarioId, samples[0].box)
    }
    for (const entry of runEndEntries) {
      try {
        entry.cb(result)
      } catch (error) {
        reportError(error)
      }
    }
  }

  /** Whether the last `settleFrames` samples lie within `nearPx` of each other. */
  const isSettled = (samples: ReadonlyArray<PaintSample>): boolean => {
    if (samples.length < settleFrames) return false
    // Pairwise boxDistance <= nearPx is the same as every field's spread over the
    // window being <= nearPx, which takes one pass instead of all pairs.
    let minLeft = Infinity
    let maxLeft = -Infinity
    let minTop = Infinity
    let maxTop = -Infinity
    let minWidth = Infinity
    let maxWidth = -Infinity
    let minHeight = Infinity
    let maxHeight = -Infinity
    for (let i = samples.length - settleFrames; i < samples.length; i++) {
      const { left, top, width, height } = samples[i].box
      minLeft = Math.min(minLeft, left)
      maxLeft = Math.max(maxLeft, left)
      minTop = Math.min(minTop, top)
      maxTop = Math.max(maxTop, top)
      minWidth = Math.min(minWidth, width)
      maxWidth = Math.max(maxWidth, width)
      minHeight = Math.min(minHeight, height)
      maxHeight = Math.max(maxHeight, height)
    }
    return (
      Math.max(maxLeft - minLeft, maxTop - minTop, maxWidth - minWidth, maxHeight - minHeight) <=
      nearPx
    )
  }

  /**
   * Starts the one-shot probe that decides whether `run.startFrame` painted after
   * `begin()` (see the module doc). It observes `document.documentElement`, which is
   * always connected, so the initial notification always arrives.
   */
  const probeStartFrame = (run: ActiveRun): IntersectionObserver => {
    const probe = new IntersectionObserver((_entries, observer) => {
      observer.disconnect()
      if (active !== run || run.startFramePaint !== "undecided") return
      run.probe = undefined
      // Computed inside startFrame's own rendering update exactly when the ticker
      // has not reached the next frame yet.
      const paintedAfter = ticker.frame() === run.startFrame
      run.startFramePaint = paintedAfter ? "after" : "before"
      const held = run.held
      run.held = undefined
      if (paintedAfter && held !== undefined) run.samples.unshift(held)
    })
    probe.observe(document.documentElement)
    return probe
  }

  ticker.onPostPaint((t, frame) => {
    paintedFrame = frame
    const run = active
    if (run === undefined) return
    // Painted before begin().
    if (frame < run.startFrame) return
    if (frame === run.startFrame && run.startFramePaint !== "after") {
      if (run.startFramePaint === "undecided" && run.el.isConnected) {
        run.held = { t, frame, box: readVisualBox(run.el) }
      }
      return
    }
    if (run.el.isConnected) run.samples.push({ t, frame, box: readVisualBox(run.el) })
    if (run.startFramePaint !== "undecided" && isSettled(run.samples)) {
      const { samples } = run
      const destination = samples[samples.length - 1].box
      const boxes = samples.map((s) => s.box)
      const { verdict, ...detail } = classify(run.origin, boxes, destination, thresholds)
      end(run, verdict, t, detail)
      return
    }
    if (t - run.triggerAt >= timeoutMs) end(run, "timeout", t)
  })

  const begin: PaintSampler["begin"] = ({ el, scenarioId, triggerAt }) => {
    // Read first, before any listener of an interrupted run can touch the DOM.
    const origin = readVisualBox(el)
    const { scrollX, scrollY } = window
    const startFrame = ticker.frame()
    const startFramePending = paintedFrame < startFrame
    // A run-end listener may itself call begin(); whatever it started is superseded
    // by this call as well.
    while (active !== undefined) end(active, "interrupted", performance.now())
    removeGhost(scenarioId)
    const run: ActiveRun = {
      scenarioId,
      triggerAt,
      origin,
      scrollX,
      scrollY,
      startFrame,
      samples: [],
      el,
      startFramePaint: startFramePending ? "undecided" : "before",
      held: undefined,
      probe: undefined,
    }
    active = run
    if (startFramePending) run.probe = probeStartFrame(run)
  }

  const retarget: PaintSampler["retarget"] = (el) => {
    if (active !== undefined) active.el = el
  }

  const cancel: PaintSampler["cancel"] = () => {
    if (active !== undefined) end(active, "interrupted", performance.now())
  }

  const onRunEnd: PaintSampler["onRunEnd"] = (cb) => {
    const entry: RunEndEntry = { cb }
    runEndEntries = [...runEndEntries, entry]
    return () => {
      runEndEntries = runEndEntries.filter((e) => e !== entry)
    }
  }

  const activeScenarioId: PaintSampler["activeScenarioId"] = () => active?.scenarioId

  return { begin, retarget, cancel, onRunEnd, activeScenarioId }
}
