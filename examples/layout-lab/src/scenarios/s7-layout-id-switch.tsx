/**
 * Scenario 7: a click swaps two `layoutId` twins.
 *
 * The stage holds exactly one of two 64x64 `wardic.div` twins sharing
 * `layoutId="lab-s7"`, swapped under `<Show>`: twin A (left 32px) and twin B
 * (left 224px, the alternate colour), both at top 48px, 192px apart. Run marks the
 * trigger while the current twin is watched, then flips the `<Show>` condition. The
 * newly mounted twin hands itself to `ctx.watch` from its ref, a mid-run retarget
 * (it is not connected yet at that point), and Wardic FLIPs it from the leaver's
 * box. Repeated runs alternate A to B and B to A.
 *
 * @module
 */
import { wardic } from "@wardic/solid"
import { createSignal, type JSX, Show } from "solid-js"
import type { ScenarioDef } from "./types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "layout-id-switch"

/** The `layoutId` both twins share. */
const LAYOUT_ID = "lab-s7"

/** The View root: the stage with the Run button under it. */
const ROOT_STYLE: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  "align-items": "flex-start",
  gap: "8px",
}

/** Twin A's absolute position: left 32px, top 48px. */
const TWIN_A_STYLE: JSX.CSSProperties = { position: "absolute", top: "48px", left: "32px" }

/** Twin B's absolute position: left 224px, top 48px (192px right of twin A). */
const TWIN_B_STYLE: JSX.CSSProperties = { position: "absolute", top: "48px", left: "224px" }

/**
 * The scenario View. Run marks the `layoutId-switch` trigger in the click handler
 * while the current twin is watched, then flips which twin `<Show>` renders.
 */
const View: ScenarioDef["View"] = (props) => {
  const [showB, setShowB] = createSignal(false)

  const run = (): void => {
    props.ctx.markTrigger("layoutId-switch")
    setShowB((b) => !b)
  }

  // Each twin's ref calls ctx.watch, so the lab follows whichever twin is mounted.
  // On a swap the new twin's ref runs mid-run, before the twin is inserted.
  return (
    <div data-scenario={ID} style={ROOT_STYLE}>
      <div class="stage">
        <Show
          when={showB()}
          fallback={
            <wardic.div ref={(el) => props.ctx.watch(el)} class="box" layoutId={LAYOUT_ID} style={TWIN_A_STYLE}>
              A
            </wardic.div>
          }
        >
          <wardic.div ref={(el) => props.ctx.watch(el)} class="box alt" layoutId={LAYOUT_ID} style={TWIN_B_STYLE}>
            B
          </wardic.div>
        </Show>
      </div>
      <button type="button" class="btn" data-action="run" onClick={run}>
        Run
      </button>
    </div>
  )
}

/**
 * Scenario 7, layoutId switch: a click swaps two `layoutId` twins under `<Show>`,
 * and the new twin's mount schedules the measure pass. Expected to be safe.
 */
export const s7: ScenarioDef = {
  id: ID,
  index: 7,
  title: "layoutId switch",
  mechanism:
    "The Run click swaps two layoutId twins under <Show>; the new twin's mount registers its projection node, which schedules the measure.",
  prediction: "safe",
  rationale:
    "The <Show> swap runs synchronously in the click task: Solid disposes the leaver, then the new twin's mount " +
    "effect registers its projection node, and register() calls scheduleMeasure. The gate rAF is therefore " +
    "requested from the click task and lands in the same frame's rAF, before paint, where the first measure FLIPs " +
    "the new twin from the leaver's box in the layoutId registry.",
  View,
}
