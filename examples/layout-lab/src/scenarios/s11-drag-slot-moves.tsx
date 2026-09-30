/**
 * Scenario 11: drag an item while its slot moves under it (issue #26, ADR-0016
 * *Amendment (#26)*).
 *
 * A column in the stage: a `layout` sibling S above the draggable `layout` item D.
 * D holds a `layout` child C1 and a plain child C2. Grab D and hold it or move it:
 * once the drag has started, the slot moves every {@link SLOT_MOVE_MS} ms, or on R.
 *
 * - `resize` mode: S grows or shrinks by 60px. Only Wardic's shared ResizeObserver
 *   sees it, so its Measure pass runs after the frame's gate flush.
 * - `reorder` mode: S and D swap under `<LayoutGroup layoutDependency>`, so the
 *   Measure pass runs at the end of the task (as a `<Reorder>` would).
 *
 * The recorder (`drag-recorder.ts`) samples every frame of the press and the release,
 * and the card checks the drag run: D under the pointer, 0 frames behind it, C1 and C2
 * glued to D, each mid-drag pass seeding only S with D's tree drag-blocked, the
 * release moving on its first painted frame and ending on the slot. The "lose the
 * next release" toggle (L while D is held, or its checkbox) swallows the press's
 * pointerup, so the card's `gesture ends` line shows whether the gesture ends anyway
 * (#31, ADR-0019).
 *
 * @module
 */
import { LayoutGroup, wardic } from "@wardic/solid"
import { createSignal, For, type JSX, onCleanup, onMount } from "solid-js"
import { Checkbox, CONTROLS_STYLE, NOTE_STYLE, type Option, Select } from "./controls.tsx"
import { attachDragRecorder } from "./drag-recorder.ts"
import type { ScenarioDef } from "./types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "drag-slot-moves"

/** How often the slot moves while D is held, in ms. */
const SLOT_MOVE_MS = 600

/** The two ways the slot moves. */
type Mode = "resize" | "reorder"

/** The Mode select's options. */
const MODES: ReadonlyArray<Option<Mode>> = [
  { value: "resize", label: "resize (S grows or shrinks)" },
  { value: "reorder", label: "reorder (S and D swap)" },
]

/** The View root: the stage with the controls under it. */
const ROOT_STYLE: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  "align-items": "flex-start",
  gap: "8px",
}

/** A taller stage than the trigger scenarios': S can reach 100px above D's 80px, with room to drag. */
const STAGE_STYLE: JSX.CSSProperties = { "--stage-w": "340px", "--stage-h": "260px" }

/** The column: not positioned, so D's offsetParent is the stage. */
const COLUMN_STYLE: JSX.CSSProperties = { padding: "16px 20px" }

/** S's style for its height. */
const siblingStyle = (height: number): JSX.CSSProperties => ({ width: "200px", height: `${height}px` })

/**
 * D: 160x80, positioned so its children sit inside it, and raised above S. After a
 * swap S follows D in the DOM, so while its FLIP gives it a transform it would paint
 * over D and take a press meant for it (before #31's fix, a held drag's moves too). A
 * `<Reorder>` item needs the same (Motion's `Reorder.Item` sets `zIndex: 1` while it
 * is offset).
 */
const ITEM_STYLE: JSX.CSSProperties = {
  position: "relative",
  "z-index": 1,
  width: "160px",
  height: "80px",
  cursor: "grab",
  "touch-action": "none",
  "user-select": "none",
}

/** C1 (the `layout` child) at (10, 10). */
const C1_STYLE: JSX.CSSProperties = {
  position: "absolute",
  left: "10px",
  top: "10px",
  width: "30px",
  height: "30px",
  background: "var(--lab-box-alt)",
  "pointer-events": "none",
}

/** C2 (the plain child) at (60, 10). */
const C2_STYLE: JSX.CSSProperties = { ...C1_STYLE, left: "60px", background: "var(--lab-surface)" }

/**
 * The scenario View. The recorder listens to every press of D; its `start` phase
 * (the drag has started) starts the slot timer and its `release` phase stops it.
 */
const View: ScenarioDef["View"] = (props) => {
  const [mode, setMode] = createSignal<Mode>("resize")
  const [tall, setTall] = createSignal(false)
  const [order, setOrder] = createSignal<ReadonlyArray<"s" | "d">>(["s", "d"])
  const [loseNext, setLoseNext] = createSignal(false)
  let stage: HTMLDivElement | undefined
  let item: HTMLElement | undefined
  let c1: HTMLElement | undefined
  let c2: HTMLDivElement | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let dragging = false

  let noteLayoutChange = (): void => {}
  let pressing = (): boolean => false

  /** Moves D's slot once, the current mode's way. */
  const moveSlot = (): void => {
    noteLayoutChange()
    if (mode() === "resize") setTall((t) => !t)
    else setOrder((o) => [o[1]!, o[0]!])
  }
  const stopTimer = (): void => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }
  const onKey = (e: KeyboardEvent): void => {
    if (dragging && (e.key === "r" || e.key === "R")) moveSlot()
    else if (pressing() && (e.key === "l" || e.key === "L")) setLoseNext((v) => !v)
  }

  onMount(() => {
    const recorder = attachDragRecorder({
      stage: () => stage,
      item: () => item,
      children: () => ({ c1, c2 }),
      mode,
      onPhase: (phase) => {
        if (phase === "start") {
          dragging = true
          stopTimer()
          timer = setInterval(moveSlot, SLOT_MOVE_MS)
        } else if (phase === "release") {
          dragging = false
          stopTimer()
        }
      },
      record: (input) => props.ctx.recordDragRun(input),
      loseNextRelease: { armed: loseNext, disarm: () => setLoseNext(false) },
    })
    noteLayoutChange = recorder.noteLayoutChange
    pressing = recorder.pressing
    window.addEventListener("keydown", onKey)
    onCleanup(() => {
      recorder.detach()
      stopTimer()
      window.removeEventListener("keydown", onKey)
    })
  })

  /** A mode change puts the column back to S above D at S's short height. */
  const changeMode = (next: Mode): void => {
    setMode(next)
    setTall(false)
    setOrder(["s", "d"])
  }

  return (
    <div data-scenario={ID} style={ROOT_STYLE}>
      <div class="stage" ref={stage} style={STAGE_STYLE}>
        <LayoutGroup layoutDependency={order()}>
          <div style={COLUMN_STYLE}>
            <For each={order()}>
              {(key) =>
                key === "s" ? (
                  <wardic.div class="box alt" layout style={siblingStyle(tall() ? 100 : 40)} />
                ) : (
                  <wardic.div
                    class="box"
                    layout
                    drag
                    data-action="drag"
                    // eslint-disable-next-line solid/reactivity
                    ref={(el: HTMLElement) => (item = el)}
                    style={ITEM_STYLE}
                  >
                    {/* eslint-disable-next-line solid/reactivity */}
                    <wardic.div layout ref={(el: HTMLElement) => (c1 = el)} style={C1_STYLE} />
                    {/* eslint-disable-next-line solid/reactivity */}
                    <div ref={(el: HTMLDivElement) => (c2 = el)} style={C2_STYLE} />
                  </wardic.div>
                )
              }
            </For>
          </div>
        </LayoutGroup>
      </div>
      <div style={CONTROLS_STYLE}>
        <Select label="Mode" name="mode" options={MODES} value={mode()} onChange={changeMode} />
        <Checkbox label="lose the next release (L while held)" name="lose-next-release" checked={loseNext()} onChange={setLoseNext} />
      </div>
      <p style={NOTE_STYLE}>
        Grab the blue item near its centre. While you hold it, the slot moves every 600 ms, or press R; L loses its
        release.
      </p>
    </div>
  )
}

/**
 * Scenario 11, drag while the slot moves: grab D, hold it or move it, and its slot
 * moves every 600 ms (or on R), by S resizing or by S and D swapping. Expected to be
 * safe: D stays under the pointer and its children on it, the passes seed only S,
 * and the release moves on its first painted frame and ends on the slot.
 */
export const s11: ScenarioDef = {
  id: ID,
  index: 11,
  title: "Drag while the slot moves",
  kind: "drag",
  mechanism:
    "Grab the blue item and hold or move it. While it is dragged its slot moves every 600 ms (or on R): the orange sibling above it grows or shrinks (resize), or the two swap under a LayoutGroup (reorder).",
  prediction: "safe",
  rationale:
    "Since #26 a Measure pass during a drag gives the dragged item and its subtree a slot-only update (a Drag block, " +
    "ADR-0016 Amendment (#26)): the item keeps its target at the pointer, the pass seeds only the sibling, and the " +
    "item's layout child rides the drag. A pointer move re-derives the dragged item, so it paints in the frame the " +
    "move arrives in, and the release is a FLIP to the latest slot with a Priming step, so it moves on its first " +
    "painted frame.",
  // Frames behind and release held: 0 with `?scheduler=microtask`; with a browser's own
  // scheduler, pointer input reaches the drag one `setTimeout(0)` hop late, so 1.
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
