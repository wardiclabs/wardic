/**
 * Scenario 1: a click handler writes the signal bound to `layoutDependency`.
 *
 * The baseline path. The box is a 64x64 `wardic.div` with `layout`, absolutely
 * positioned inside the stage, and its `left` and `layoutDependency` both come
 * from one signal. Each Run flips that signal, so the box jumps 192px sideways and
 * back on alternate runs.
 *
 * @module
 */
import { wardic } from "@wardic/solid"
import { createSignal, type JSX } from "solid-js"
import type { ScenarioDef } from "./types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "click-layout-dependency"

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
 * The scenario View. Run marks the `click` trigger inside the click handler, then
 * flips the signal that drives both the box's `left` and its `layoutDependency`.
 */
const View: ScenarioDef["View"] = (props) => {
  const [atB, setAtB] = createSignal(false)

  const run = (): void => {
    props.ctx.markTrigger("click")
    setAtB((b) => !b)
  }

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
 * Scenario 1, click -> layoutDependency: the Run click handler writes the
 * `layoutDependency` signal directly. Expected to be safe, holding 0.
 */
export const s1: ScenarioDef = {
  id: ID,
  index: 1,
  title: "click -> layoutDependency",
  mechanism: "The Run click handler writes the signal bound to the box's layoutDependency.",
  prediction: "safe",
  expectedHeld: 0,
  rationale:
    "The signal write runs Wardic's layoutDependency effect synchronously, and its notify queues a Measure pass, " +
    "which the engine runs in a microtask at the end of the click task (ADR-0018). The pass seeds the FLIP and " +
    "flushes that seed before it returns, so no paint shows the destination box. Its Priming step is applied by the " +
    "next frame's gate flush, so the first painted frame is already one step along (held 0, cold or warm).",
  View,
}
