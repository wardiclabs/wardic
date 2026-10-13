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
 * Z and P also work while D flies back after the release. Since ADR-0016's *Amendment
 * (velocity family)* the release is an offset springing to zero on top of D's layout, so
 * a slot move then animates under it and the flight keeps its speed (#28: before, the
 * whole flight restarted from rest). The **momentum** box (on by default, as
 * `dragMomentum`) gives the release the pointer's velocity over its last 100 ms: a flick
 * carries D on. The **twin** box gives D a `layoutId` twin parked in the stage's corner:
 * D is then a Lead with a hidden Follower, and keeps its opacity through the release
 * (#34: before, it dropped to 0.03 and the twin showed through). Both boxes remount D, so
 * a twin's mount crossfades D in from the corner, which is the one crossfade expected.
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
import { createSignal, type JSX, onCleanup, onMount, Show } from "solid-js"
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

/** The twin's shared `layoutId` (the twin box). */
const TWIN_ID = "lab-s13-twin"

/** The twin: D's size, parked in the stage's bottom-right corner. */
const TWIN_STYLE: JSX.CSSProperties = {
  position: "absolute",
  right: "8px",
  bottom: "8px",
  width: "140px",
  height: "80px",
  background: "var(--lab-box-alt)",
  "pointer-events": "none",
}

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
  const [momentum, setMomentum] = createSignal(true)
  const [twin, setTwin] = createSignal(false)
  let stage: HTMLDivElement | undefined
  let item: HTMLElement | undefined
  let c1: HTMLElement | undefined
  let dragging = false
  // From the release until the recorder ends the run: D is flying back to its slot.
  let flying = false
  let noteLayoutChange = (): void => {}
  let pressing = (): boolean => false

  const onKey = (e: KeyboardEvent): void => {
    if (pressing() && (e.key === "l" || e.key === "L")) setLoseNext((v) => !v)
    if (!dragging && !flying) return
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
        dragging = phase === "start"
        flying = phase === "release"
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
        {/* Drag config is read at mount: the boxes remount D (the twin first, so D is the Lead). */}
        <Show when={`${momentum()}:${twin()}`} keyed>
          {(_mount) => (
            <>
              <Show when={twin()}>
                <wardic.div layoutId={TWIN_ID} style={TWIN_STYLE} />
              </Show>
              <wardic.div layout layoutDependency={right()} style={parentStyle(right())}>
                <wardic.div
                  class="box"
                  layout
                  {...(twin() ? { layoutId: TWIN_ID } : {})}
                  drag
                  dragMomentum={momentum()}
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
            </>
          )}
        </Show>
      </div>
      <div style={CONTROLS_STYLE}>
        <Checkbox label="momentum (dragMomentum)" name="momentum" checked={momentum()} onChange={setMomentum} />
        <Checkbox label="twin (a layoutId Follower)" name="twin" checked={twin()} onChange={setTwin} />
        <Checkbox label="lose the next release (L while held)" name="lose-next-release" checked={loseNext()} onChange={setLoseNext} />
      </div>
      <p style={NOTE_STYLE}>
        Grab the blue item near its centre. While you hold it, or while it flies back: Z resizes its slot, P moves its
        parent. L (held) loses its release. Release still, release while moving (a flick carries it on, with
        momentum), and release back where you grabbed while moving.
      </p>
    </div>
  )
}

/**
 * Scenario 13, release and pointer lag: the release moves on its first painted frame
 * and ends on the slot; the item paints each move in the frame it's delivered in (with a
 * browser's own scheduler too since #32) and stays under the pointer when its slot resizes
 * (Z) or its parent FLIPs (P). A slot move while it flies back keeps the flight's speed,
 * a flick carries into the release, and a Lead keeps its opacity. Expected to be safe.
 */
export const s13: ScenarioDef = {
  id: ID,
  index: 13,
  title: "Release and pointer lag",
  kind: "drag",
  mechanism:
    "Grab the blue item, move it, let go: still, while moving, or back where you grabbed while moving. While held or flying back, Z resizes the item's own slot and P FLIPs its parent 60px right. The boxes turn off momentum, and give the item a layoutId twin.",
  prediction: "safe",
  rationale:
    "Since #26 a pointer move re-derives the dragged item, so it paints in the frame the move reaches it (with a " +
    "browser's own scheduler too since #32); a resized slot is painted at its new size about the same centre; a " +
    "FLIPing parent is re-derived with the item, which stays under the pointer; and the release is a FLIP to the " +
    "slot whose first step is the next frame's tick, painted in that frame (0 held from a pointerup; ADR-0033), " +
    "which always writes the resting projection when it " +
    "lands on the slot. Since the velocity family's fix (ADR-0016) the release is an offset springing to zero on " +
    "top of the item's layout, from the pointer's velocity: a slot move under it (Z, P) keeps its speed, and a " +
    "twin's Lead keeps its opacity, since only a shared-element handover crossfades.",
  dragExpect: {
    underPointerMaxPx: 1,
    framesBehindMax: 0,
    childGlueMaxPx: 1,
    maxSeededPerPass: 1,
    releaseHeldMax: 0,
    endsOnSlotMaxPx: 0.5,
    // #31: no gesture moves the item once it should have ended (ADR-0019).
    gestureEndsMaxPx: 1,
  },
  View,
}
