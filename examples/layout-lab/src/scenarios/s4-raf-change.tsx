/**
 * Scenario 4: a `requestAnimationFrame` callback writes the `layoutDependency`
 * signal.
 *
 * The box is a 64x64 `wardic.div` with `layout`, absolutely positioned inside the
 * stage, and its `left` and `layoutDependency` both come from one signal. Run only
 * requests an animation frame; the frame callback flips the signal, so the box
 * jumps 192px sideways (left 32px or 224px) and back on alternate runs.
 *
 * @module
 */
import { wardic } from "@wardic/solid"
import { createSignal, type JSX, onCleanup } from "solid-js"
import type { ScenarioDef } from "./types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "raf-change"

/** The View root: the stage with the Run button under it. */
const ROOT_STYLE: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  "align-items": "flex-start",
  gap: "8px",
}

/**
 * The box's absolute position for state A or B. Both keep the 64x64 box inside the
 * 320x160 stage (left 32px or 224px, top 48px), 192px apart.
 */
const boxStyle = (atB: boolean): JSX.CSSProperties => ({
  position: "absolute",
  top: "48px",
  left: atB ? "224px" : "32px",
})

/**
 * The scenario View. Run drops a `click` note and requests an animation frame. The
 * frame callback marks the `raf` trigger, then flips the box signal.
 */
const View: ScenarioDef["View"] = (props) => {
  const [atB, setAtB] = createSignal(false)
  // The pending frame request, if any. At most one is pending, so two quick
  // clicks cannot flip the box twice in one frame.
  let frame: number | undefined

  const run = (): void => {
    props.ctx.mark("click")
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = undefined
      props.ctx.markTrigger("raf")
      setAtB((b) => !b)
    })
  }

  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  return (
    <div data-scenario={ID} style={ROOT_STYLE}>
      <div class="stage">
        <wardic.div
          ref={(el) => props.ctx.watch(el)}
          class="box"
          layout
          layoutDependency={atB()}
          style={boxStyle(atB())}
        />
      </div>
      <button type="button" class="btn" data-action="run" onClick={run}>
        Run
      </button>
    </div>
  )
}

/**
 * Scenario 4, change inside rAF: a `requestAnimationFrame` callback, requested by
 * the Run click, writes the `layoutDependency` signal. Expected to be safe,
 * holding 1: the callback runs after the frame's gate flush, or in a frame with
 * none.
 */
export const s4: ScenarioDef = {
  id: ID,
  index: 4,
  title: "Change inside rAF",
  mechanism: "A requestAnimationFrame callback, requested by the Run click, writes the layoutDependency signal.",
  prediction: "safe",
  expectedHeld: 1,
  rationale:
    "The callback runs after the frame's gate flush when the Clock is ticking (the gate requested its frame " +
    "first), and in a frame with no gate flush at all when it is not. The signal write runs Wardic's " +
    "layoutDependency effect synchronously, and notify queues a Measure pass that runs in a microtask at the end " +
    "of the callback, before the frame's layout, and flushes its seed (ADR-0018), so the frame paints the origin. " +
    "The Priming step waits for the next frame's gate flush (held 1, cold or warm).",
  View,
}
