/**
 * Scenario 2: content added inside the box, seen only by Wardic's ResizeObserver.
 *
 * The box is a `wardic.div` with `layout` and NO `layoutDependency`, absolutely
 * positioned at a fixed spot in the stage with `width: auto`. It always holds one
 * 64x64 cell; each Run adds or removes a second one, so the box grows from 64px to
 * 128px wide and back on alternate runs. No Wardic prop changes, so the only thing
 * that can trigger a measure is the projection system's shared ResizeObserver.
 *
 * @module
 */
import { wardic } from "@wardic/solid"
import { createSignal, type JSX, Show } from "solid-js"
import type { ScenarioDef } from "./types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "ro-content-growth"

/** The View root: the stage with the Run button under it. */
const ROOT_STYLE: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  "align-items": "flex-start",
  gap: "8px",
}

/**
 * The box's style. It never changes: the position is fixed (left 32px, top 48px)
 * and `width: auto` lets the cells set the width (64px or 128px, both inside the
 * 320x160 stage). The height stays at `.box`'s 64px.
 */
const BOX_STYLE: JSX.CSSProperties = {
  position: "absolute",
  top: "48px",
  left: "32px",
  width: "auto",
}

/** The cell that is always inside the box. */
const CELL_STYLE: JSX.CSSProperties = {
  width: "64px",
  height: "64px",
  flex: "none",
}

/** The cell each Run adds or removes, tinted so the growth is visible. */
const EXTRA_CELL_STYLE: JSX.CSSProperties = {
  ...CELL_STYLE,
  background: "var(--lab-box-alt)",
}

/**
 * The scenario View. Run marks the `content-growth` trigger inside the click
 * handler, then toggles the extra cell under `<Show>`.
 */
const View: ScenarioDef["View"] = (props) => {
  const [grown, setGrown] = createSignal(false)

  const run = (): void => {
    props.ctx.markTrigger("content-growth")
    setGrown((g) => !g)
  }

  return (
    <div data-scenario={ID} style={ROOT_STYLE}>
      <div class="stage">
        <wardic.div ref={(el) => props.ctx.watch(el)} class="box" layout style={BOX_STYLE}>
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
 * Scenario 2, ResizeObserver-only content growth: the Run click handler changes
 * the box's content, and only Wardic's shared ResizeObserver sees the new size.
 * Expected to be safe, holding 0: the observer delivers after the frame's tick, and
 * its Measure pass, knowing it, takes the first step before the paint (#673).
 */
export const s2: ScenarioDef = {
  id: ID,
  index: 2,
  title: "ResizeObserver-only content growth",
  mechanism:
    "The Run click handler adds or removes a 64px cell inside the box; only Wardic's shared ResizeObserver sees the size change.",
  prediction: "safe",
  expectedHeld: 0,
  rationale:
    "Nothing Wardic tracks changes, so Wardic hears of the new size only from its shared ResizeObserver, which " +
    "delivers in the next rendering update after the rAF callbacks and layout, so after the frame's tick. " +
    "The delivery queues a Measure pass, which runs in a microtask at the end of the callback and flushes its seed " +
    "before the frame paints (ADR-0018). A pass queued in the engine's own observer delivery knows it runs after " +
    "the frame's tick, so it takes the box's first step too, at that tick's dt (nominal cold), and the frame " +
    "paints it: the box grows from that frame (held 0, cold or warm; ADR-0018 *Amendment (#673)*). Until #673 " +
    "the frame showed the old size and the next tick took the first step (held 1).",
  View,
}
