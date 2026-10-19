/**
 * Scenario 19: scroll-linked values (#234, #233, ADR-0043 *Amendment (#233, #234)*). Live values made
 * from a scroll, a velocity and time, driven by hand:
 *
 * - **progress bar**: `createScroll`'s `scrollYProgress` for the scroll box drives a bar's `scaleX`,
 *   and the bar reports through `onUpdate`. Each scroll burst is a run on **follows** (the bar paints
 *   the box's progress in the frame of its scroll) and **updates** (`onUpdate` told once a frame, with
 *   what painted).
 * - **reveal**: a card inside the scroll box, its progress through the box (`target`, `offset:
 *   ["start end", "end start"]`) fading it in and out. Each burst is a run on **follows**.
 * - **velocity skew**: `createVelocity(scrollY)` mapped to `skewY`: it leans while the box scrolls
 *   and stands back up once it stops (Motion's skew-on-scroll). Each burst is a run on **moves** and
 *   **settles**.
 * - **spinner**: `createTime()` turns a square 90° a second. Sample spinner records 60 frames, on
 *   **ticks**.
 * - **CSS reference** (#240): under the progress bar, a bar driven by CSS alone, a scroll-driven
 *   animation on the box's named `scroll-timeline`, which the browser can run off the main thread
 *   with the scroll itself. Busy blocks the page's main thread 50 ms out of every 100: the reference
 *   keeps up with a touch scroll, and the gap between the two bars is how far the main thread's
 *   copy of the scroll trails what's on screen. Not drawn where scroll-driven animations aren't
 *   supported. Not judged: the gap is read off screen captures (`.tmp/240/measure.ts`) or by eye.
 *
 * The recorder reads each painted value just after its frame, and the Live value as the frame
 * starts (its rAF callback), and the card judges the run (`liveChecksOf` in `lab/live-board.ts`). A
 * read that ran late, after the next frame started (a phone's, `lab/frame-counter.ts`), is marked so
 * and skipped by the lines that compare one frame's reads. The
 * stage is 320px wide with Sample spinner under it, so a phone shows every cell.
 *
 * @module
 */
import { createScroll, createTime, createTransform, createVelocity, wardic } from "@wardic/solid"
import { createSignal, For, type JSX, onCleanup } from "solid-js"
import { frameNumber } from "../lab/frame-counter.ts"
import { type LiveCheckName, type LiveFrame, SCROLL_LINKED_LINES } from "../lab/live-board.ts"
import type { ScenarioContext, ScenarioDef } from "./types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "scroll-linked"

const STAGE_STYLE: JSX.CSSProperties = { "--stage-w": "320px", "--stage-h": "259px" }
const COLUMN: JSX.CSSProperties = { display: "flex", "flex-direction": "column", gap: "6px", padding: "8px 10px" }
const LABEL: JSX.CSSProperties = { "font-size": "10px", "line-height": "12px", opacity: 0.8 }
const ACCENT = "var(--lab-accent, rgb(0, 102, 204))"
const BAR: JSX.CSSProperties = { width: "300px", height: "8px", background: ACCENT, "border-radius": "4px", "transform-origin": "0 50%" }
const SCROLLER: JSX.CSSProperties = {
  position: "relative",
  width: "300px",
  height: "110px",
  overflow: "auto",
  "border-radius": "6px",
  background: "rgba(0, 0, 0, 0.05)",
}
const COLUMN_INSIDE: JSX.CSSProperties = { position: "relative", height: "900px" }
/** One added row (#239): "Add rows" grows the box's content with its scroll still. */
const ADDED_ROW: JSX.CSSProperties = { height: "30px", margin: "0 10px 6px", background: "rgba(0, 0, 0, 0.08)", "border-radius": "4px" }
const CARD: JSX.CSSProperties = { position: "absolute", top: "400px", left: "110px", width: "80px", height: "40px", background: ACCENT, "border-radius": "6px" }
const ROW: JSX.CSSProperties = { display: "flex", "align-items": "center", gap: "40px", height: "50px", "padding-left": "20px" }
const SQUARE: JSX.CSSProperties = { width: "36px", height: "36px", background: ACCENT, "border-radius": "4px" }
/** The CSS reference's colour, unlike the accent so a capture tells the bars apart. */
const REFERENCE_COLOUR = "rgb(230, 120, 20)"
const REFERENCE_BAR: JSX.CSSProperties = { ...BAR, background: REFERENCE_COLOUR, transform: "scaleX(0)" }
/**
 * The reference (#240): the box names its scroll timeline, the column brings the name into scope
 * for its sibling, and the bar's animation runs on it. `animation-timeline` comes after the
 * `animation` shorthand, which resets it.
 */
const REFERENCE_SHEET = `
@keyframes wardic-s19-fill { from { transform: scaleX(0) } to { transform: scaleX(1) } }
@supports (animation-timeline: scroll()) {
  [data-scenario="${ID}"] [data-cell="column"] { timeline-scope: --wardic-s19-box }
  [data-scenario="${ID}"] [data-cell="scroller"] { scroll-timeline: --wardic-s19-box y }
  [data-scenario="${ID}"] [data-cell="reference"] { animation: wardic-s19-fill linear both; animation-timeline: --wardic-s19-box }
}`
/** Busy (#240): the main thread blocked this long out of every `BUSY_EVERY` ms. */
const BUSY_MS = 50
const BUSY_EVERY = 100
const CONTROLS: JSX.CSSProperties = { display: "flex", "flex-wrap": "wrap", gap: "8px", "margin-top": "6px" }

/** The computed transform's matrix `[a, b, c, d]`, the identity for none. */
const matrixOf = (el: Element): readonly [number, number, number, number] => {
  const t = getComputedStyle(el).transform
  if (t === "" || t === "none") return [1, 0, 0, 1]
  const v = /\(([^)]+)\)/.exec(t)![1]!.split(",").map(Number)
  return [v[0]!, v[1]!, v[2]!, v[3]!]
}
const scaleXOf = (el: Element): number => matrixOf(el)[0]
/** A `skewY` angle, degrees: `b` is its tangent. */
const skewYOf = (el: Element): number => (Math.atan(matrixOf(el)[1]) * 180) / Math.PI
/** A rotation, degrees, in [-180, 180]. */
const rotationOf = (el: Element): number => {
  const [a, b] = matrixOf(el)
  return (Math.atan2(b, a) * 180) / Math.PI
}
const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)

/** How a cell's runs are read and judged. */
interface CellSpec {
  readonly cell: string
  readonly lines: ReadonlyArray<LiveCheckName>
  /** The key's painted value, read just after the frame. */
  readonly shown: () => number
  /** The value it's judged against, read as the frame starts. */
  readonly live: () => number
  /** `onUpdate`'s calls since the last read, and the value its last one held (the bar's). */
  readonly told?: () => { readonly calls: number; readonly updated: number | undefined }
  readonly tolerance: number
  readonly rest?: number
  readonly rate?: number
  /** A run of a set length (the spinner's), not one that ends once its value stands still. */
  readonly frames?: number
}

/** Frames with an unchanged Live value that end a run. */
const STILL_FRAMES = 40
/** The longest a run samples, ms. */
const MAX_MS = 60000

/** Sample each cell's runs just after every painted frame, and record each as a board run of kind `live`. */
const makeRecorder = (ctx: ScenarioContext) => {
  const running = new Map<string, () => void>()
  const start = (spec: CellSpec): void => {
    if (running.has(spec.cell)) return
    const frames: Array<LiveFrame> = []
    const startedAt = performance.now()
    const channel = new MessageChannel()
    let liveAtFrame = Number.NaN
    // The frame the read was queued in: a later one at the read means it ran late.
    let rafFrame = 0
    let still = 0
    let unwrap = 0
    let previousShown = Number.NaN
    const finish = (cut: boolean): void => {
      channel.port1.close()
      running.delete(spec.cell)
      const shown = frames.map((f) => f.shown)
      ctx.recordBoardRun({
        cell: spec.cell,
        kind: "live",
        base: frames[0]?.live ?? Number.NaN,
        target: frames[frames.length - 1]?.live ?? Number.NaN,
        before: Number.NaN,
        during: shown,
        after: [],
        startedAt,
        endedAt: performance.now(),
        live: {
          frames,
          lines: spec.lines,
          maxStep: Number.POSITIVE_INFINITY,
          tolerance: spec.tolerance,
          ...(spec.rest === undefined ? {} : { rest: spec.rest }),
          ...(spec.rate === undefined ? {} : { rate: spec.rate }),
          ...(cut ? { cut: true } : {}),
        },
      })
    }
    running.set(spec.cell, () => finish(false))
    const next = (): void => {
      requestAnimationFrame(() => {
        rafFrame = frameNumber()
        liveAtFrame = spec.live()
        channel.port2.postMessage(undefined)
      })
    }
    channel.port1.onmessage = () => {
      // The spinner's angle unwrapped across ±180°, so it reads as a running total.
      let shown = spec.shown()
      if (spec.rate !== undefined) {
        if (!Number.isNaN(previousShown) && shown < previousShown - 180) unwrap += 360
        previousShown = shown
        shown += unwrap
      }
      const told = spec.told?.()
      const late = frameNumber() !== rafFrame
      const frame: LiveFrame = {
        shown,
        live: liveAtFrame,
        phase: "after",
        ...(late ? { late: true } : {}),
        ...(told === undefined ? {} : { calls: told.calls, ...(told.updated === undefined ? {} : { updated: told.updated }) }),
      }
      const before = frames[frames.length - 1]
      frames.push(frame)
      still = before !== undefined && Math.abs(before.live - frame.live) <= spec.tolerance / 2 ? still + 1 : 0
      const done = spec.frames === undefined ? still >= STILL_FRAMES : frames.length >= spec.frames
      if (done || performance.now() - startedAt > MAX_MS) {
        finish(!done)
        return
      }
      next()
    }
    // Reset what `onUpdate` counted before the run, so its first frame counts its own; start the frame count.
    spec.told?.()
    frameNumber()
    next()
  }
  return {
    start,
    dispose: (): void => {
      for (const finish of [...running.values()]) finish()
    },
  }
}

/** The scenario View: the bar, the scroll box with its card, the skew and the spinner. */
const View: ScenarioDef["View"] = (props) => {
  const recorder = makeRecorder(props.ctx)
  onCleanup(recorder.dispose)

  let box!: HTMLDivElement
  let card!: HTMLDivElement
  let bar!: HTMLElement
  let reveal!: HTMLElement
  let skew!: HTMLElement
  let spinner!: HTMLElement

  // The box's scroll, and the card's way through it (#234).
  const { scrollY, scrollYProgress } = createScroll({ container: () => box })
  const through = createScroll({ container: () => box, target: () => card, offset: ["start end", "end start"] }).scrollYProgress
  const revealOpacity = createTransform(through, [0, 0.5, 1], [0, 1, 0])
  const skewY = createTransform(createVelocity(scrollY), [-1500, 1500], [-20, 20])
  const rotate = createTransform(createTime(), (ms: number) => (ms / 1000) * 90)

  // What the bar's onUpdate heard since the recorder last read it (#233).
  let calls = 0
  let updated: number | undefined
  const onUpdate = (latest: Readonly<Record<string, number | string>>): void => {
    calls++
    updated = Number(latest["scaleX"])
  }
  const told = (): { readonly calls: number; readonly updated: number | undefined } => {
    const read = { calls, updated }
    calls = 0
    return read
  }

  const barSpec: CellSpec = { cell: "progress bar", lines: ["follows", "updates"], shown: () => scaleXOf(bar), live: scrollYProgress, told, tolerance: 0.002 }
  const revealSpec: CellSpec = { cell: "reveal", lines: ["follows"], shown: () => opacityOf(reveal), live: revealOpacity, tolerance: 0.002 }
  const skewSpec: CellSpec = { cell: "velocity skew", lines: ["moves", "settles"], shown: () => skewYOf(skew), live: scrollY, tolerance: 0.05 }
  const spinSpec: CellSpec = { cell: "spinner", lines: ["ticks"], shown: () => rotationOf(spinner), live: () => performance.now(), tolerance: 0.5, rate: 0.09, frames: 60 }
  const scrolled = (): void => {
    recorder.start(barSpec)
    recorder.start(revealSpec)
    recorder.start(skewSpec)
  }
  // The box's content, grown by "Add rows" with its scroll still (#239): the bar follows its new
  // progress, judged against the box's own, read each frame.
  const [rows, setRows] = createSignal(0)
  const boxProgress = (): number => box.scrollTop / Math.max(1, box.scrollHeight - box.clientHeight)
  const resizeSpec: CellSpec = { cell: "content resize", lines: ["resizes"], shown: () => scaleXOf(bar), live: boxProgress, tolerance: 0.002 }
  const addRows = (): void => {
    recorder.start(resizeSpec)
    setRows(rows() + 8)
  }
  // Busy (#240): a main thread that misses frames, as a page's own work would.
  const [busy, setBusy] = createSignal(false)
  let busyTimer: ReturnType<typeof setInterval> | undefined
  const block = (): void => {
    const until = performance.now() + BUSY_MS
    while (performance.now() < until) {
      // Spin: the main thread does nothing else for BUSY_MS.
    }
  }
  const toggleBusy = (): void => {
    clearInterval(busyTimer)
    busyTimer = undefined
    if (!busy()) busyTimer = setInterval(block, BUSY_EVERY)
    setBusy(!busy())
  }
  onCleanup(() => clearInterval(busyTimer))
  const [sampling, setSampling] = createSignal(false)
  const sample = (): void => {
    setSampling(true)
    recorder.start(spinSpec)
    setTimeout(() => setSampling(false), 1100)
  }

  return (
    <div data-scenario={ID}>
      <style>{REFERENCE_SHEET}</style>
      <div class="stage" style={STAGE_STYLE}>
        <div style={COLUMN} data-cell="column">
          <span style={LABEL}>progress bar: scroll the box · under it, CSS's own</span>
          <wardic.div ref={(el: HTMLElement) => (bar = el)} data-cell="bar" style={{ ...BAR, scaleX: scrollYProgress }} onUpdate={onUpdate} />
          <div data-cell="reference" style={REFERENCE_BAR} />
          <div ref={box} style={SCROLLER} data-cell="scroller" onScroll={scrolled}>
            <div style={COLUMN_INSIDE}>
              <div ref={card} style={CARD}>
                <wardic.div ref={(el: HTMLElement) => (reveal = el)} data-cell="reveal" style={{ width: "100%", height: "100%", background: ACCENT, "border-radius": "6px", opacity: revealOpacity }} />
              </div>
            </div>
            <div data-cell="added">
              <For each={Array.from({ length: rows() }, (_, i) => i)}>{() => <div style={ADDED_ROW} />}</For>
            </div>
          </div>
          <span style={LABEL}>velocity skew · spinner</span>
          <div style={ROW}>
            <wardic.div ref={(el: HTMLElement) => (skew = el)} data-cell="skew" style={{ ...SQUARE, skewY }} />
            <wardic.div ref={(el: HTMLElement) => (spinner = el)} data-cell="spinner" style={{ ...SQUARE, rotate }} />
          </div>
        </div>
      </div>
      <div style={CONTROLS}>
        <button type="button" class="btn secondary small" data-action="sample" disabled={sampling()} onClick={sample}>
          Sample spinner
        </button>
        <button type="button" class="btn secondary small" data-action="add-rows" onClick={addRows}>
          Add rows
        </button>
        <button type="button" class="btn secondary small" data-action="busy" aria-pressed={busy()} onClick={toggleBusy}>
          {busy() ? "Busy: on" : "Busy: off"}
        </button>
      </div>
    </div>
  )
}

export const s19: ScenarioDef = {
  id: ID,
  index: 19,
  kind: "board",
  boardLines: SCROLL_LINKED_LINES,
  title: "scroll-linked (scroll, velocity, time, onUpdate)",
  mechanism:
    "Scroll the box: the bar fills with its progress and reports through onUpdate, the card inside fades in and out as it " +
    "passes, and the square leans with the scroll's speed and stands back up. Sample spinner records the square turning on time. " +
    "Scroll partway, then Add rows: the box's content grows with its scroll still, and the bar follows its new progress. " +
    "The orange bar under the progress bar is CSS's own scroll-driven animation, run with the scroll itself: fling the box with " +
    "Busy on (the main thread blocked 50 ms out of every 100) and watch the gap between the two.",
  prediction: "safe",
  rationale:
    "createScroll's values are set within the box's scroll event (Probe.scroll, ADR-0043 Amendment (#233, #234)), so a value " +
    "derived from one paints in the frame of the scroll; the card's progress runs through Motion's offsets. createVelocity reads " +
    "the scroll's change each frame and 0 once it stops; createTime adds each frame's time; onUpdate is told once a frame the " +
    "bar changed, after the gate's commits, with what it painted. A change of the content's size is read by observers on it " +
    "(ADR-0043 Amendment (#239)), after its layout, so the bar shows it a frame later. The bar is set from the main thread's " +
    "copy of the scroll, so a scroll the browser runs off the main thread (a touch fling) can be ahead of it on screen; the " +
    "CSS reference shows by how much (#240).",
  View,
}
