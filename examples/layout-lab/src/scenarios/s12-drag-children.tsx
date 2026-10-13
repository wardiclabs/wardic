/**
 * Scenario 12: every kind of resting child rides a dragged item (issue #26, ADR-0016
 * *Amendment (#26)*, the Drag block).
 *
 * The draggable `layout` item D holds four resting children, all checked for glue:
 * a `layout` child C1, a `layoutAnchor: false` child C2, and a `layoutRoot` R with
 * its own `layout` child G. Before #26 each of the three `layout` kinds was left at
 * its slot while D moved (a counter-transform), and jumped onto D at a pass or the
 * release. A sibling above D can move D's slot while it is held: every 900 ms, or on
 * S. A fifth child, M, starts a slow FLIP across D when you grab it (the "animate a
 * child on grab" toggle): it should keep animating on D, with no jump, which the eye
 * checks (its offset changes by design, so it is not in the glue check; each frame
 * records its box in `watched`, for #38's release stutter). The "lose
 * the next release" toggle (L while D is held, or its checkbox) swallows the press's
 * pointerup, for the card's `gesture ends` line (#31, ADR-0019).
 *
 * **X**, at rest, moves D's slot the same way, and D FLIPs to it: an eye check of #33
 * (ADR-0013, *Amendment (#33)*). C1 and C2 ride D's FLIP; R, a `layoutRoot`, is isolated
 * from it, as Motion's is, and paints at its new place from the first frame, G with it.
 * Before, R rode D and G was thrown the other way, about twice the move. Nothing is
 * recorded (no press); a grab during that FLIP is judged from where it lands (the
 * recorder's `flyingAtPress`), and R and G's glue lines then read the isolation.
 *
 * @module
 */
import { wardic } from "@wardic/solid"
import { createSignal, type JSX, onCleanup, onMount } from "solid-js"
import { Checkbox, CONTROLS_STYLE, NOTE_STYLE } from "./controls.tsx"
import { attachDragRecorder } from "./drag-recorder.ts"
import type { ScenarioDef } from "./types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "drag-children"

/** How often the slot moves while D is held, in ms. */
const SLOT_MOVE_MS = 900

/** How long after X D's FLIP may still be running, in ms (the default spring settles in about 750). */
const FLIGHT_MS = 1000

const ROOT_STYLE: JSX.CSSProperties = { display: "flex", "flex-direction": "column", "align-items": "flex-start", gap: "8px" }
const STAGE_STYLE: JSX.CSSProperties = { "--stage-w": "340px", "--stage-h": "260px" }
const COLUMN_STYLE: JSX.CSSProperties = { padding: "16px 20px" }

/** D: 220x96, positioned so its children sit inside it. */
const ITEM_STYLE: JSX.CSSProperties = {
  position: "relative",
  width: "220px",
  height: "96px",
  cursor: "grab",
  "touch-action": "none",
  "user-select": "none",
}

/** A 28x28 child at (left, top) inside D. */
const childStyle = (left: number, top: number, background: string): JSX.CSSProperties => ({
  position: "absolute",
  left: `${left}px`,
  top: `${top}px`,
  width: "28px",
  height: "28px",
  background,
  "pointer-events": "none",
})

/** G, inside R. */
const G_STYLE: JSX.CSSProperties = { ...childStyle(8, 8, "var(--lab-surface)"), width: "12px", height: "12px" }

/** M's style: bottom row, left or right. */
const mStyle = (right: boolean): JSX.CSSProperties => ({ ...childStyle(right ? 180 : 10, 60, "var(--lab-muted)"), width: "24px", height: "24px" })

/** M's slow spring, so it is still running while you drag. */
const M_TRANSITION = { stiffness: 30, damping: 12 } as const

const View: ScenarioDef["View"] = (props) => {
  const [tall, setTall] = createSignal(false)
  const [mRight, setMRight] = createSignal(false)
  const [animateOnGrab, setAnimateOnGrab] = createSignal(true)
  const [loseNext, setLoseNext] = createSignal(false)
  let stage: HTMLDivElement | undefined
  let item: HTMLElement | undefined
  let c1: HTMLElement | undefined
  let c2: HTMLElement | undefined
  let r: HTMLElement | undefined
  let g: HTMLElement | undefined
  let m: HTMLElement | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let dragging = false
  // From the drag's start until the recorder ends its run (the flight back included).
  let live = false
  // When X last moved D's slot at rest, starting D's FLIP (#33).
  let restMoveAt = Number.NEGATIVE_INFINITY
  let noteLayoutChange = (): void => {}
  let pressing = (): boolean => false

  const moveSlot = (): void => {
    noteLayoutChange()
    setTall((t) => !t)
  }
  const stopTimer = (): void => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }
  const onKey = (e: KeyboardEvent): void => {
    if (dragging && (e.key === "s" || e.key === "S")) moveSlot()
    else if (pressing() && (e.key === "l" || e.key === "L")) setLoseNext((v) => !v)
    else if (!live && !pressing() && (e.key === "x" || e.key === "X")) {
      restMoveAt = performance.now()
      setTall((t) => !t)
    }
  }
  const onGrab = (): void => {
    if (animateOnGrab()) setMRight((v) => !v) // M starts its FLIP as the press begins
  }

  onMount(() => {
    const recorder = attachDragRecorder({
      stage: () => stage,
      item: () => item,
      children: () => ({ c1, c2, r, g }),
      // M moves by design, so it is recorded for the log but not glue-checked (#38).
      watched: () => ({ m }),
      mode: () => (animateOnGrab() ? "animate-on-grab" : "resting"),
      onPhase: (phase) => {
        live = phase !== "end"
        if (phase === "start") {
          dragging = true
          stopTimer()
          timer = setInterval(moveSlot, SLOT_MOVE_MS)
        } else if (phase === "release") {
          dragging = false
          stopTimer()
        }
      },
      // D's FLIP from an X less than FLIGHT_MS ago may still run under the press (#30).
      flyingAtPress: () => performance.now() - restMoveAt < FLIGHT_MS,
      record: (input) => props.ctx.recordDragRun(input),
      loseNextRelease: { armed: loseNext, disarm: () => setLoseNext(false) },
    })
    noteLayoutChange = recorder.noteLayoutChange
    pressing = recorder.pressing
    item?.addEventListener("pointerdown", onGrab)
    window.addEventListener("keydown", onKey)
    onCleanup(() => {
      recorder.detach()
      stopTimer()
      item?.removeEventListener("pointerdown", onGrab)
      window.removeEventListener("keydown", onKey)
    })
  })

  return (
    <div data-scenario={ID} style={ROOT_STYLE}>
      <div class="stage" ref={stage} style={STAGE_STYLE}>
        <div style={COLUMN_STYLE}>
          <wardic.div class="box alt" layout style={{ width: "200px", height: `${tall() ? 70 : 20}px` }} />
          {/* eslint-disable-next-line solid/reactivity */}
          <wardic.div class="box" layout drag data-action="drag" ref={(el: HTMLElement) => (item = el)} style={ITEM_STYLE}>
            {/* eslint-disable-next-line solid/reactivity */}
            <wardic.div layout ref={(el: HTMLElement) => (c1 = el)} style={childStyle(10, 10, "var(--lab-box-alt)")} />
            {/* eslint-disable-next-line solid/reactivity */}
            <wardic.div layout layoutAnchor={false} ref={(el: HTMLElement) => (c2 = el)} style={childStyle(50, 10, "var(--lab-box-alt)")} />
            {/* eslint-disable-next-line solid/reactivity */}
            <wardic.div layoutRoot ref={(el: HTMLElement) => (r = el)} style={{ ...childStyle(90, 10, "var(--lab-box-alt)"), width: "40px", height: "40px" }}>
              {/* eslint-disable-next-line solid/reactivity */}
              <wardic.div layout ref={(el: HTMLElement) => (g = el)} style={G_STYLE} />
            </wardic.div>
            {/* eslint-disable-next-line solid/reactivity */}
            <wardic.div layout layoutDependency={mRight()} transition={M_TRANSITION} ref={(el: HTMLElement) => (m = el)} style={mStyle(mRight())} />
          </wardic.div>
        </div>
      </div>
      <div style={CONTROLS_STYLE}>
        <label style={{ display: "flex", gap: "6px", "align-items": "center", "font-size": "12px" }}>
          <input type="checkbox" name="animate-on-grab" checked={animateOnGrab()} onChange={(e) => setAnimateOnGrab(e.currentTarget.checked)} />
          animate a child on grab (M, by eye)
        </label>
        <Checkbox label="lose the next release (L while held)" name="lose-next-release" checked={loseNext()} onChange={setLoseNext} />
      </div>
      <p style={NOTE_STYLE}>
        Grab the blue item near its centre and hold it. Its slot moves every 900 ms, or press S; L loses its release.
        Every child should stay on it. At rest, X moves its slot and it slides there: the two left children ride it,
        and the layoutRoot (with its small child) is already at its new place (#33, as Motion's).
      </p>
    </div>
  )
}

/**
 * Scenario 12, children ride the drag: a `layout` child, a `layoutAnchor: false`
 * child, and a `layoutRoot` with its own child all stay on the dragged item, through
 * slot moves and the release. Expected to be safe.
 */
export const s12: ScenarioDef = {
  id: ID,
  index: 12,
  title: "Children ride the drag",
  kind: "drag",
  mechanism:
    "Grab the blue item. It holds a layout child, a layoutAnchor:false child, and a layoutRoot with a child of its own; the orange sibling moves its slot every 900 ms (or on S). M (grey) FLIPs across it when you grab. At rest, X moves its slot (an eye check of #33).",
  prediction: "safe",
  rationale:
    "Since #26 a dragged item is its subtree's relative parent (layoutAnchor:false included) and its resting " +
    "descendants aren't derived while it is dragged, so CSS carries them; a pass during the drag updates their " +
    "slots without animating them (the Drag block). Before, each layout child was held at its slot while the item " +
    "moved and jumped onto it at a pass or the release. M, animating when you grab, keeps animating on the item, " +
    "and since the velocity family's fix (ADR-0016) doesn't step back as the item lands. X at rest FLIPs the item: " +
    "a layoutRoot is isolated from an ancestor's layout animation (ADR-0013, Amendment (#33)), so R and G sit at " +
    "their new place at once, by eye.",
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
