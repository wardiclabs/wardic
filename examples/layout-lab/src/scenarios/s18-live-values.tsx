/**
 * Scenario 18: Live values (#130, ADR-0043). A value the user moves themselves, given in `style` (a
 * signal here), is the key's `style` link: the element follows it while no layer of the Override
 * stack sets the key, and a gesture or an animation that lets go returns to where it is then. Four
 * cells, driven by hand:
 *
 * - **swipe card**: `drag="x"`, back to its origin on release, its opacity
 *   `createTransform(ward.value("x"), [-150, 0, 150], [0, 1, 0])`, Motion's swipe card. Drag's `x`
 *   comes out through the element's output, and the opacity derived from it paints in the same frame
 *   as the `x` it's from. Each press is a run, judged on **same frame**.
 * - **scroll opacity**: a box whose opacity follows the scroll box beside it (0.15 at the top, 0.6 at
 *   the bottom: `createScroll`'s `scrollYProgress` through `createTransform`, #234), with `whileHover` and `whileTap` both `{ opacity: 1 }`, so a phone, where touch never
 *   hovers, presses it instead. Each hover or press is a run: it **follows** the scroll at rest, the
 *   gesture **wins** while on, however the scroll moves, and once it ends it **returns** to where the
 *   scroll is then, a spring chasing it while it still moves, and follows it again once it rests
 *   there. Scrolling at rest is a run on **follows**.
 * - **slider**: a knob whose `x` follows the range input under the stage, and Hold, which animates its
 *   `x` to 0 over it (`animate`, a 0.4 s tween): held at 0 however the slider moves, then back to the slider (the
 *   tween lands on where it is at its end) and following it. Each hold is a run on all three lines;
 *   moving the slider at rest, on **follows**.
 * - **spring**: a dot whose `x` is `createSpring` of the slider: each slider move is a run on
 *   **returns**: no jump, at rest on the slider's value.
 *
 * The recorder reads each painted value just after its frame (a `MessageChannel` message posted from
 * each rAF), with the Live value as it was when that frame started (read in the rAF callback, so an
 * input a phone delivers after the paint counts for the next frame), and the card judges the run
 * (`liveChecksOf` in `lab/live-board.ts`). A run samples on until it stands still on its Live value,
 * or 4 s after the value last moved; one cut off at 60 s with the value still moving isn't judged.
 *
 * The stage is the lab's default 320px wide, each cell's label above its row, and the slider and
 * Hold sit under the stage, so a phone shows every cell and both controls.
 *
 * @module
 */
import { createScroll, createSpring, createTransform, createWard, wardic } from "@wardic/solid"
import { createSignal, type JSX, onCleanup } from "solid-js"
import { LIVE_VALUE_LINES, type LiveCheckName, type LiveFrame } from "../lab/live-board.ts"
import type { ScenarioContext, ScenarioDef } from "./types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "live-values"

/** Narrow enough for a phone: each cell's label sits above its row, and the controls below the stage. */
const STAGE_STYLE: JSX.CSSProperties = { "--stage-w": "320px", "--stage-h": "280px" }
const COLUMN: JSX.CSSProperties = { display: "flex", "flex-direction": "column", gap: "6px", padding: "8px 10px" }
const CELL: JSX.CSSProperties = { display: "flex", "flex-direction": "column", gap: "2px" }
const ROW: JSX.CSSProperties = { display: "flex", "align-items": "center", gap: "12px", height: "44px" }
const LABEL: JSX.CSSProperties = { "font-size": "10px", "line-height": "12px", opacity: 0.8 }
const ACCENT = "var(--lab-accent, rgb(0, 102, 204))"
const BOX: JSX.CSSProperties = { width: "60px", height: "44px", background: ACCENT, "border-radius": "6px" }
const TRACK: JSX.CSSProperties = { position: "relative", width: "300px", height: "44px", background: "rgba(0, 0, 0, 0.05)", "border-radius": "6px" }
const CONTROLS: JSX.CSSProperties = { display: "flex", "flex-wrap": "wrap", gap: "8px", "align-items": "center", "margin-top": "6px" }
const SLIDER: JSX.CSSProperties = { width: "200px" }
/** The press square: a held finger neither scrolls, selects nor opens the long-press callout. */
const PRESSABLE: JSX.CSSProperties = { "touch-action": "none", "user-select": "none", "-webkit-user-select": "none", "-webkit-touch-callout": "none" }
/** The slider's range: the knob (40px wide) stays on its 300px track. */
const SLIDER_MAX = 260
const SCROLLER: JSX.CSSProperties = { width: "120px", height: "44px", overflow: "auto", "border-radius": "6px", background: "rgba(0, 0, 0, 0.05)" }
const SCROLL_CONTENT: JSX.CSSProperties = { height: "400px", background: "linear-gradient(rgba(0, 102, 204, 0.1), rgba(0, 102, 204, 0.4))" }
const DOT: JSX.CSSProperties = { width: "16px", height: "16px", "border-radius": "8px", background: ACCENT, "margin-top": "14px" }

/** The painted translateX (the computed matrix's e), 0 for none. */
const translateXOf = (el: Element): number => {
  const t = getComputedStyle(el).transform
  if (t === "" || t === "none") return 0
  const v = /\(([^)]+)\)/.exec(t)![1]!.split(",").map(Number)
  return t.startsWith("matrix3d") ? v[12]! : v[4]!
}
const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)

/** How a cell's runs are read and judged. */
interface CellSpec {
  readonly cell: string
  readonly lines: ReadonlyArray<LiveCheckName>
  /** The watched key's painted value. */
  readonly read: () => number
  /** The value it should show at rest. */
  readonly live: () => number
  /** The swipe card's derived key: its painted value and what the mapping gives for the read. */
  readonly derived?: () => { readonly derived: number; readonly expected: number }
  readonly held?: number
  readonly maxStep: number
  readonly tolerance: number
}

/** A run still sampling. */
interface Recording {
  phase: LiveFrame["phase"]
  readonly frames: Array<LiveFrame>
  readonly startedAt: number
  /** Consecutive frames on its Live value, with the Live value still, since the gesture's end. */
  still: number
  /** When its Live value last moved. */
  movedAt: number
  /** Cut off at {@link MAX_MS} while its Live value still moved. */
  cut: boolean
  readonly finish: () => void
}

/** Frames on a still Live value that end a run. */
const STILL_FRAMES = 12
/** How long a run samples on after its Live value last moved, ms: one not on it by then fails. */
const SETTLE_MS = 4000
/** The longest a run samples while its Live value keeps moving, ms: then it's cut off, unjudged. */
const MAX_MS = 60000

/**
 * Sample each cell's runs just after every painted frame and record each as a board run of kind
 * `live` once it has stood still on its Live value.
 */
const makeRecorder = (ctx: ScenarioContext) => {
  const running = new Map<string, Recording>()
  const start = (spec: CellSpec, phase: LiveFrame["phase"]): Recording => {
    running.get(spec.cell)?.finish()
    const channel = new MessageChannel()
    let done = false
    const rec: Recording = {
      phase,
      frames: [],
      startedAt: performance.now(),
      still: 0,
      movedAt: performance.now(),
      cut: false,
      finish: () => {
        if (done) return
        done = true
        channel.port1.close()
        if (running.get(spec.cell) === rec) running.delete(spec.cell)
        const split = rec.frames.findIndex((f) => f.phase === "after")
        const shown = rec.frames.map((f) => f.shown)
        const at = split === -1 ? shown.length : split
        ctx.recordBoardRun({
          cell: spec.cell,
          kind: "live",
          base: rec.frames[0]?.live ?? Number.NaN,
          target: spec.held ?? rec.frames[0]?.live ?? Number.NaN,
          before: Number.NaN,
          during: shown.slice(0, at),
          after: shown.slice(at),
          startedAt: rec.startedAt,
          endedAt: performance.now(),
          live: {
            frames: rec.frames,
            lines: spec.lines,
            ...(spec.held === undefined ? {} : { held: spec.held }),
            maxStep: spec.maxStep,
            tolerance: spec.tolerance,
            ...(rec.cut ? { cut: true } : {}),
          },
        })
      },
    }
    running.set(spec.cell, rec)
    let lastLive = Number.NaN
    // The Live value as the frame starts (its rAF callback): what its paint should show. A phone can
    // deliver an input after the paint and before the read just after it (#184's late reads), which
    // only the next frame can show.
    let liveAtFrame = Number.NaN
    const nextFrame = (): void => {
      requestAnimationFrame(() => {
        liveAtFrame = spec.live()
        channel.port2.postMessage(undefined)
      })
    }
    channel.port1.onmessage = () => {
      const live = liveAtFrame
      const now = performance.now()
      const derived = spec.derived?.()
      const frame: LiveFrame = { shown: spec.read(), live, phase: rec.phase, ...(derived === undefined ? {} : derived) }
      rec.frames.push(frame)
      const moved = Math.abs(live - lastLive) > spec.tolerance / 2
      if (moved) rec.movedAt = now
      lastLive = live
      rec.still = rec.phase !== "held" && !moved && Math.abs(frame.shown - live) <= spec.tolerance ? rec.still + 1 : 0
      const settled = rec.phase !== "held" && now - rec.movedAt > SETTLE_MS
      rec.cut = now - rec.startedAt > MAX_MS
      if (rec.still >= STILL_FRAMES || settled || rec.cut) {
        rec.finish()
        return
      }
      nextFrame()
    }
    nextFrame()
    return rec
  }
  return {
    /** A gesture starts: a new run, held. */
    begin: (spec: CellSpec): void => void start(spec, "held"),
    /** The gesture ends: its run samples on, after it, until it stands still. */
    end: (spec: CellSpec): void => {
      const rec = running.get(spec.cell)
      if (rec !== undefined && rec.phase === "held") rec.phase = "after"
    },
    /** The Live value moved: a run in `phase` unless one is sampling already. */
    touch: (spec: CellSpec, phase: LiveFrame["phase"]): void => {
      if (!running.has(spec.cell)) start(spec, phase)
    },
    dispose: (): void => {
      for (const rec of [...running.values()]) rec.finish()
    },
  }
}

/** The scenario View: the four cells, top to bottom. */
const View: ScenarioDef["View"] = (props) => {
  const recorder = makeRecorder(props.ctx)
  onCleanup(recorder.dispose)

  // --- the swipe card ---
  let card!: HTMLElement
  const swipe = createWard({ drag: "x", dragSnapToOrigin: true })
  const swipeOpacity = createTransform(swipe.value("x"), [-150, 0, 150], [0, 1, 0])
  const swipeSpec: CellSpec = {
    cell: "swipe card",
    lines: ["same frame"],
    read: () => translateXOf(card),
    live: () => 0,
    derived: () => {
      const x = translateXOf(card)
      return { derived: opacityOf(card), expected: Math.max(0, 1 - Math.abs(x) / 150) }
    },
    maxStep: 1000,
    tolerance: 0.002,
  }
  const release = (): void => recorder.end(swipeSpec)
  window.addEventListener("pointerup", release)
  onCleanup(() => window.removeEventListener("pointerup", release))

  // --- scroll opacity: the scroll box's progress, from createScroll (#234) ---
  let target!: HTMLElement
  let scroller!: HTMLDivElement
  const { scrollYProgress } = createScroll({ container: () => scroller })
  const scrollOpacity = createTransform(scrollYProgress, [0, 1], [0.15, 0.6])
  const scrollSpec: CellSpec = {
    cell: "scroll opacity",
    lines: ["follows", "wins", "returns"],
    read: () => opacityOf(target),
    live: scrollOpacity,
    held: 1,
    maxStep: 0.2,
    tolerance: 0.002,
  }
  const scrollRestSpec: CellSpec = { ...scrollSpec, cell: "scroll opacity", lines: ["follows"] }
  // A scroll at rest starts a run (the value itself is createScroll's, set within the same event).
  const scrolled = (): void => recorder.touch(scrollRestSpec, "rest")

  // --- the slider, and the spring following it ---
  let knob!: HTMLElement
  let dot!: HTMLElement
  const [slider, setSlider] = createSignal(80)
  const [holding, setHolding] = createSignal(false)
  const spring = createSpring(slider, { stiffness: 120, damping: 14 })
  const sliderSpec: CellSpec = {
    cell: "slider",
    lines: ["follows", "wins", "returns"],
    read: () => translateXOf(knob),
    live: slider,
    held: 0,
    maxStep: 40,
    tolerance: 0.05,
  }
  const sliderRestSpec: CellSpec = { ...sliderSpec, lines: ["follows"] }
  const springSpec: CellSpec = { cell: "spring", lines: ["returns"], read: () => translateXOf(dot), live: slider, maxStep: 40, tolerance: 0.05 }
  const slid = (e: Event): void => {
    setSlider(Number((e.currentTarget as HTMLInputElement).value))
    recorder.touch(sliderRestSpec, "rest")
    recorder.touch(springSpec, "after")
  }
  const hold = (): void => {
    const on = !holding()
    if (on) recorder.begin(sliderSpec)
    else recorder.end(sliderSpec)
    setHolding(on)
  }

  return (
    <div data-scenario={ID}>
      <div class="stage" style={STAGE_STYLE}>
        <div style={COLUMN}>
          <div style={CELL}>
            <span style={LABEL}>swipe card: drag it either way</span>
            <div style={TRACK}>
              <div
                {...swipe({ ref: (el) => (card = el), style: { ...BOX, position: "absolute", left: "120px", opacity: swipeOpacity } })}
                data-cell="swipe"
                data-action="drag"
                onPointerDown={() => recorder.begin(swipeSpec)}
              />
            </div>
          </div>
          <div style={CELL}>
            <span style={LABEL}>scroll opacity: scroll the box, hover or press the square</span>
            <div style={ROW}>
              <div ref={scroller} style={SCROLLER} data-cell="scroller" onScroll={scrolled}>
                <div style={SCROLL_CONTENT} />
              </div>
              <wardic.div
                ref={(el: HTMLElement) => (target = el)}
                data-cell="scroll-target"
                style={{ ...BOX, ...PRESSABLE, opacity: scrollOpacity }}
                whileHover={{ opacity: 1 }}
                whileTap={{ opacity: 1 }}
                onPointerEnter={() => recorder.begin(scrollSpec)}
                onPointerLeave={() => recorder.end(scrollSpec)}
              />
            </div>
          </div>
          <div style={CELL}>
            <span style={LABEL}>slider: its knob's x</span>
            <div style={TRACK}>
              <wardic.div
                ref={(el: HTMLElement) => (knob = el)}
                data-cell="knob"
                style={{ ...BOX, width: "40px", x: slider }}
                animate={holding() ? { x: 0 } : {}}
                transition={{ type: "tween", duration: 0.4 }}
              />
            </div>
          </div>
          <div style={CELL}>
            <span style={LABEL}>spring: follows the slider</span>
            <div style={TRACK}>
              <wardic.div ref={(el: HTMLElement) => (dot = el)} data-cell="dot" style={{ ...DOT, x: spring }} />
            </div>
          </div>
        </div>
      </div>
      <div style={CONTROLS}>
        <input type="range" min="0" max={SLIDER_MAX} value={slider()} style={SLIDER} data-cell="slider" aria-label="slider" onInput={slid} />
        <button type="button" class="btn secondary small" data-action="hold" onClick={hold}>
          {holding() ? "Let go" : "Hold at 0"}
        </button>
      </div>
    </div>
  )
}

export const s18: ScenarioDef = {
  id: ID,
  index: 18,
  kind: "board",
  boardLines: LIVE_VALUE_LINES,
  title: "live values (style follows a value you move)",
  mechanism:
    "Drag the swipe card: its opacity, derived from its own x, fades with it in the same frame. Hover or press the scroll opacity square and " +
    "scroll the box beside it, before, during and after. Move the slider; Hold animates the knob to 0 over it and " +
    "Let go returns it to the slider, which the spring dot follows.",
  prediction: "safe",
  rationale:
    "A Live value in `style` is the key's `style` link (ADR-0043): followed through the gate while no layer of the Override " +
    "stack sets the key, written as it changes, so it paints in the next frame. A hover or an animation that sets the key wins; " +
    "letting go returns to where the value is then, a spring chasing it and a tween easing toward it, and the key is followed " +
    "again once the return lands. `ward.value(\"x\")` is set as each write lands, so a value derived from it is written in the same " +
    "frame and commits with it.",
  View,
}
