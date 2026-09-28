/**
 * Scenario 9: a click starts a `useWardic` spring (issue #14's non-layout half).
 *
 * The box is a 64x64 `wardic.div` whose `animate` target `x` is 0 or 192px, flipped
 * by each Run, so it springs 192px sideways and back on alternate runs. There is no
 * layout change and no measure pass, so nothing can flash; the run is about when the
 * box starts moving. Its `heldFrames` therefore counts from the trigger
 * (`heldFramesFrom: "trigger"`).
 *
 * With nothing else animating, the click is a Cold start: the Clock delivers its
 * Priming tick at the end of the click task, the spring writes its first moved value
 * there, and the gate paints it in the next frame, so the run holds 0 frames. Before
 * #14's fix the first tick came a frame later and carried dt 0, and the run held 2.
 * With Keep Clock warm on, the spring joins a Clock that is already ticking: its
 * first value comes from the next frame's tick and the gate paints it a frame later
 * (ADR-0006's one-frame latency), so a warm run holds 1.
 *
 * @module
 */
import { wardic } from "@wardic/solid"
import { createSignal, type JSX } from "solid-js"
import type { ScenarioDef } from "./types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "cold-spring-click"

/** How far the box springs, in px: from left 32px to 224px inside the 320px stage. */
const TRAVEL_PX = 192

/** The View root: the stage with the Run button under it. */
const ROOT_STYLE: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  "align-items": "flex-start",
  gap: "8px",
}

/** The box's resting position (state A); the spring's `x` carries it to state B. */
const BOX_STYLE: JSX.CSSProperties = { position: "absolute", top: "48px", left: "32px" }

/** The scenario View. Run marks the `click` trigger inside the click handler, then flips the spring's target. */
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
          style={BOX_STYLE}
          animate={{ x: atB() ? TRAVEL_PX : 0 }}
        />
      </div>
      <button type="button" class="btn" data-action="run" onClick={run}>
        Run
      </button>
    </div>
  )
}

/**
 * Scenario 9, click -> useWardic spring: the Run click handler flips the spring's
 * `animate` target. Expected to be safe (no layout change); `held` is the result.
 */
export const s9: ScenarioDef = {
  id: ID,
  index: 9,
  title: "click -> useWardic spring",
  mechanism: "The Run click handler flips a useWardic animate target. No layout change, so no measure pass.",
  prediction: "safe",
  heldFramesFrom: "trigger",
  rationale:
    "Nothing changes layout, so nothing can flash; the run measures the Clock's Cold start (#14). With nothing else " +
    "animating, the Priming tick runs at the end of the click task, so the first moved frame is the next paint " +
    "(held 0 · cold). With Keep Clock warm on, the spring's first value comes from the next tick and paints a frame " +
    "later (held 1 · warm). Before the fix a cold run held 2.",
  View,
}
