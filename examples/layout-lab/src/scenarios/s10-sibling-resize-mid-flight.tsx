/**
 * Scenario 10: a sibling's content grows while the watched box is mid-flight
 * (ADR-0018's rule that a running animation whose box didn't change is left
 * alone).
 *
 * The stage holds two absolutely positioned `wardic.div`s with `layout` that cannot
 * move each other. Box A, the watched one, is 64x64 at the top (top 16px, left 32px
 * or 224px, 192px apart); its `left` and `layoutDependency` come from one signal,
 * as in scenario 1. Box B sits below it (top 88px, left 32px) with `width: auto`
 * and NO `layoutDependency`: it always holds one 64x64 cell, and grows to 128px wide
 * or back when a second cell is added or removed, as in scenario 2.
 *
 * Run marks the `click` trigger and moves A. {@link SIBLING_DELAY_MS} later a timer
 * drops a `grow-sibling` note and adds or removes B's second cell. Only the
 * engine's shared ResizeObserver sees that, and it delivers after the frame's gate
 * flush, so the second Measure pass of the run runs while A is still moving. The
 * run watches A only, so its `passStepRatio` says whether that pass changed A's
 * pace. Repeated runs alternate A's side and B's width.
 *
 * @module
 */
import { wardic } from "@wardic/solid"
import { createSignal, type JSX, onCleanup, Show } from "solid-js"
import type { ScenarioDef } from "./types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "sibling-resize-mid-flight"

/**
 * How long after Run box B changes, in ms. A's 192px FLIP is then well under way
 * and still moving fast: in the desktop logs saved after #2's fix
 * (`logs/2026-09-28T18-50-29-479Z-default.json`, Chrome 153, and
 * `…T18-52-51-410Z…`, Firefox 156), a click's FLIP (scenario 1) had covered 60-65%
 * of its distance at 150 ms, stepping 9-12px a frame and slowing by about a tenth
 * each frame (so an undisturbed `passStepRatio` reads about 0.9), and came within
 * 1px of its destination about 400 ms later.
 */
const SIBLING_DELAY_MS = 150

/** The View root: the stage with the Run button under it. */
const ROOT_STYLE: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  "align-items": "flex-start",
  gap: "8px",
}

/**
 * Box A's absolute position for either side. Both keep the 64x64 box inside the
 * 320x160 stage and above B (left 32px or 224px, top 16px), 192px apart.
 */
const boxAStyle = (atRight: boolean): JSX.CSSProperties => ({
  position: "absolute",
  top: "16px",
  left: atRight ? "224px" : "32px",
})

/**
 * Box B's style. It never changes: the position is fixed (left 32px, top 88px,
 * below A's row) and `width: auto` lets the cells set the width (64px or 128px,
 * both inside the 320x160 stage).
 */
const BOX_B_STYLE: JSX.CSSProperties = {
  position: "absolute",
  top: "88px",
  left: "32px",
  width: "auto",
}

/** The cell that is always inside box B. */
const CELL_STYLE: JSX.CSSProperties = {
  width: "64px",
  height: "64px",
  flex: "none",
}

/** The cell the timer adds or removes, tinted so the growth is visible. */
const EXTRA_CELL_STYLE: JSX.CSSProperties = {
  ...CELL_STYLE,
  background: "var(--lab-box)",
}

/**
 * The scenario View. Run cancels a growth still pending from an earlier Run, marks
 * the `click` trigger inside the click handler, moves A, and starts the timer that
 * toggles B's second cell under `<Show>`.
 */
const View: ScenarioDef["View"] = (props) => {
  const [atRight, setAtRight] = createSignal(false)
  const [grown, setGrown] = createSignal(false)
  // The pending growth of B, if any.
  let timer: ReturnType<typeof setTimeout> | undefined

  /** Cancels B's pending growth, if any. */
  const cancelGrowth = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  onCleanup(cancelGrowth)

  const run = (): void => {
    cancelGrowth()
    props.ctx.markTrigger("click")
    setAtRight((r) => !r)
    timer = setTimeout(() => {
      timer = undefined
      props.ctx.mark("grow-sibling")
      setGrown((g) => !g)
    }, SIBLING_DELAY_MS)
  }

  return (
    <div data-scenario={ID} style={ROOT_STYLE}>
      <div class="stage">
        <wardic.div
          ref={(el) => props.ctx.watch(el)}
          class="box"
          layout
          layoutDependency={atRight()}
          style={boxAStyle(atRight())}
        />
        <wardic.div class="box alt" layout style={BOX_B_STYLE}>
          <span style={CELL_STYLE} />
          <Show when={grown()}>
            <span style={EXTRA_CELL_STYLE} />
          </Show>
        </wardic.div>
      </div>
      <button type="button" class="btn" data-action="run" onClick={run}>
        Run
      </button>
    </div>
  )
}

/**
 * Scenario 10, sibling resize mid-flight: the Run click moves box A, and 150 ms
 * later a timer grows box B's content, which only Wardic's shared ResizeObserver
 * sees. Expected to be safe, holding 0, with A's pace unchanged through B's
 * Measure pass.
 */
export const s10: ScenarioDef = {
  id: ID,
  index: 10,
  title: "Sibling resize mid-flight",
  mechanism:
    "The Run click handler moves box A through its layoutDependency; 150 ms later a timer adds or removes a cell inside box B, which only Wardic's shared ResizeObserver sees.",
  prediction: "safe",
  expectedHeld: 0,
  rationale:
    "A's move is scenario 1's: its Measure pass runs at the end of the click task and A moves on its first painted " +
    "frame (held 0). B's new size reaches Wardic through its ResizeObserver after the frame's gate flush, while A is " +
    "mid-flight, and the second Measure pass it runs seeds B, finds A running with its box unchanged and leaves it " +
    "alone (ADR-0018): passes 2 (2 seeding), and A keeps its pace, a passStepRatio of about 1 (about 0.9, as A's " +
    "spring is slowing there). Had the pass re-written A, that frame would skip a step ahead and read about 2.",
  View,
}
