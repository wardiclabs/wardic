/**
 * Scenario 13: the release, the pointer lag, and a slot that changes under the drag in
 * the other two ways (issue #26, ADR-0016 *Amendment (#26)*).
 *
 * The draggable `layout` item D, holding a `layout` child C1, sits inside a `layout`
 * parent P. While D is held:
 *
 * - **Z** resizes D's own slot (80px ↔ 120px tall). The drag target takes the new size
 *   about its centre, so D paints its new size under the pointer (A1c), and its child
 *   stays on it.
 * - **P** moves P, and with it D's slot, 60px right as a FLIP. The Measure pass seeds P
 *   and drag-blocks D and C1; D stays under the pointer while P animates under it.
 *
 * The card's release lines are the point of the plain runs: a release from a
 * pointerup moves on its first painted frame, and it always ends on the slot, even when
 * you let go back where you grabbed while still moving (the release that used to stay
 * stuck off its slot). The "lose the next release" toggle (L while D is held, or its
 * checkbox) swallows the press's pointerup, for the card's `gesture ends` line (#31,
 * ADR-0019).
 *
 * @module
 */
import { wardic } from "@wardic/solid"
import { createSignal, type JSX, onCleanup, onMount } from "solid-js"
import { Checkbox, CONTROLS_STYLE, NOTE_STYLE } from "./controls.tsx"
import { attachDragRecorder } from "./drag-recorder.ts"
import type { ScenarioDef } from "./types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "drag-release"

const ROOT_STYLE: JSX.CSSProperties = { display: "flex", "flex-direction": "column", "align-items": "flex-start", gap: "8px" }
const STAGE_STYLE: JSX.CSSProperties = { "--stage-w": "340px", "--stage-h": "260px" }

/** P: a `layout` parent, left 16px or 76px. Not the offsetParent of D (see ITEM_STYLE). */
const parentStyle = (right: boolean): JSX.CSSProperties => ({
  "margin-top": "16px",
  "margin-left": right ? "76px" : "16px",
  width: "240px",
  "padding-top": "20px",
  "padding-left": "20px",
})

/** D: 140 wide, 80 or 120 tall. */
const itemStyle = (tall: boolean): JSX.CSSProperties => ({
  position: "relative",
  width: "140px",
  height: tall ? "120px" : "80px",
  cursor: "grab",
  "touch-action": "none",
  "user-select": "none",
})

const C1_STYLE: JSX.CSSProperties = {
  position: "absolute",
  left: "10px",
  top: "10px",
  width: "28px",
  height: "28px",
  background: "var(--lab-box-alt)",
  "pointer-events": "none",
}

const View: ScenarioDef["View"] = (props) => {
  const [tall, setTall] = createSignal(false)
  const [right, setRight] = createSignal(false)
  const [loseNext, setLoseNext] = createSignal(false)
  let stage: HTMLDivElement | undefined
  let item: HTMLElement | undefined
  let c1: HTMLElement | undefined
  let dragging = false
  let noteLayoutChange = (): void => {}
  let pressing = (): boolean => false

  const onKey = (e: KeyboardEvent): void => {
    if (pressing() && (e.key === "l" || e.key === "L")) setLoseNext((v) => !v)
    if (!dragging) return
    if (e.key === "z" || e.key === "Z") {
      noteLayoutChange()
      setTall((t) => !t)
    } else if (e.key === "p" || e.key === "P") {
      noteLayoutChange()
      setRight((r) => !r)
    }
  }

  onMount(() => {
    const recorder = attachDragRecorder({
      stage: () => stage,
      item: () => item,
      children: () => ({ c1 }),
      mode: () => "release",
      onPhase: (phase) => {
        if (phase === "start") dragging = true
        else if (phase === "release") dragging = false
      },
      record: (input) => props.ctx.recordDragRun(input),
      loseNextRelease: { armed: loseNext, disarm: () => setLoseNext(false) },
    })
    noteLayoutChange = recorder.noteLayoutChange
    pressing = recorder.pressing
    window.addEventListener("keydown", onKey)
    onCleanup(() => {
      recorder.detach()
      window.removeEventListener("keydown", onKey)
    })
  })

  return (
    <div data-scenario={ID} style={ROOT_STYLE}>
      <div class="stage" ref={stage} style={STAGE_STYLE}>
        <wardic.div layout layoutDependency={right()} style={parentStyle(right())}>
          <wardic.div
            class="box"
            layout
            drag
            layoutDependency={tall()}
            data-action="drag"
            // eslint-disable-next-line solid/reactivity
            ref={(el: HTMLElement) => (item = el)}
            style={itemStyle(tall())}
          >
            {/* eslint-disable-next-line solid/reactivity */}
            <wardic.div layout ref={(el: HTMLElement) => (c1 = el)} style={C1_STYLE} />
          </wardic.div>
        </wardic.div>
      </div>
      <div style={CONTROLS_STYLE}>
        <Checkbox label="lose the next release (L while held)" name="lose-next-release" checked={loseNext()} onChange={setLoseNext} />
      </div>
      <p style={NOTE_STYLE}>
        Grab the blue item near its centre. While you hold it: Z resizes its slot, P moves its parent, L loses its
        release. Release still, release while moving, and release back where you grabbed while moving. Keep the
        pointer on the item (#31).
      </p>
    </div>
  )
}

/**
 * Scenario 13, release and pointer lag: the release moves on its first painted frame
 * and ends on the slot; the item paints each move one frame after it (with a
 * browser's scheduler; #32) and stays under the pointer when its slot resizes (Z) or
 * its parent FLIPs (P). Expected to be safe.
 */
export const s13: ScenarioDef = {
  id: ID,
  index: 13,
  title: "Release and pointer lag",
  kind: "drag",
  mechanism:
    "Grab the blue item, move it, let go: still, while moving, or back where you grabbed while moving. While held, Z resizes the item's own slot and P FLIPs its parent 60px right.",
  prediction: "safe",
  rationale:
    "Since #26 a pointer move re-derives the dragged item, so it paints in the frame the move reaches it (one frame " +
    "late with a browser's scheduler, #32); a resized slot is painted at its new size about the same centre; a " +
    "FLIPing parent is re-derived with the item, which stays under the pointer; and the release is a FLIP to the " +
    "slot with a Priming step (0 held from a pointerup), which always writes the resting projection when it " +
    "lands on the slot.",
  dragExpect: {
    underPointerMaxPx: 1,
    framesBehindMax: { default: 1, microtask: 0 },
    childGlueMaxPx: 1,
    maxSeededPerPass: 1,
    releaseHeldMax: { default: 1, microtask: 0 },
    endsOnSlotMaxPx: 0.5,
    // #31: no gesture moves the item once it should have ended (ADR-0019).
    gestureEndsMaxPx: 1,
  },
  View,
}
