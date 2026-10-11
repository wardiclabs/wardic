/**
 * Scenario 5: the end of a Wardic layout animation writes the `layoutDependency`
 * signal.
 *
 * The box is a 64x64 `wardic.div` with `layout`, absolutely positioned inside the
 * stage (left 32px or 224px, top 48px, 192px apart). One Run is a one-shot pair of
 * moves: the click moves the box A to B (a plain FLIP, no run), and the end of the
 * `wardic.projection.coordinator` span that carries that FLIP moves it B to A.
 * Only the second move is measured: its trigger is the span end, the lab's proxy
 * for "a layout animation finished".
 *
 * @module
 */
import { wardic } from "@wardic/solid"
import { createSignal, type JSX, onCleanup } from "solid-js"
import type { ScenarioDef } from "./types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "animation-complete"

/** The View root: the stage with the Run button under it. */
const ROOT_STYLE: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  "align-items": "flex-start",
  gap: "8px",
}

/** The box's `left` in state A and state B, in px. */
const LEFT_A = 32
const LEFT_B = 224

/**
 * How far (px) the box's painted left edge may sit from its layout slot and still
 * count as settled. The default layout spring only settles once its progress
 * velocity is below 0.01/s, so a settled box sits well under 1px from its slot. A
 * box whose 192px FLIP started less than about a third of a second ago is further
 * away than this.
 */
const SETTLED_TOLERANCE = 8

/**
 * The box's absolute position for state A or B. Both keep the 64x64 box inside the
 * 320x160 stage.
 */
const boxStyle = (atB: boolean): JSX.CSSProperties => ({
  position: "absolute",
  top: "48px",
  left: `${atB ? LEFT_B : LEFT_A}px`,
})

/**
 * Whether `el` is painted at its layout slot: its painted left edge (which includes
 * the projection transform) is within {@link SETTLED_TOLERANCE} of its layout left
 * edge (`offsetLeft`, which ignores transforms). Both are measured from the
 * offsetParent's padding edge (the stage). A detached element counts as unsettled.
 */
const isAtLayoutSlot = (el: HTMLElement): boolean => {
  const parent = el.offsetParent
  if (!(parent instanceof HTMLElement)) return false
  const paintedLeft = el.getBoundingClientRect().left - parent.getBoundingClientRect().left - parent.clientLeft
  return Math.abs(paintedLeft - el.offsetLeft) < SETTLED_TOLERANCE
}

/**
 * The scenario View. Run drops an `arm` note, moves the box A to B and subscribes
 * once to the coordinator span end. The first qualifying callback unsubscribes,
 * marks the `animation-complete` trigger and moves the box B to A. It never
 * re-arms, and Run is disabled while it is armed.
 *
 * Unrelated span ends. The coordinator is provider-wide, so a span that is already
 * in flight when Run is pressed (this box's own B to A leg, or another scenario's
 * animation) can end after the subscription is made. Its end may even be delivered
 * a scheduler hop late, after this box's A to B FLIP has started. So a callback
 * counts only when both hold:
 *
 * 1. A MutationObserver has seen the box's inline `transform` change, after Run,
 *    to a non-identity value. That proves the A to B FLIP was seeded.
 * 2. The box is painted at its layout slot ({@link isAtLayoutSlot}). A late end of
 *    an older span arrives while the FLIP is still far from its slot.
 *
 * A callback that fails either check is ignored and the subscription stays live.
 */
const View: ScenarioDef["View"] = (props) => {
  const [atB, setAtB] = createSignal(false)
  const [armed, setArmed] = createSignal(false)
  let box: HTMLDivElement | undefined
  let unsubscribe: (() => void) | undefined
  let observer: MutationObserver | undefined

  /** Drops the span-end subscription and the transform observer, if any. */
  const release = (): void => {
    unsubscribe?.()
    unsubscribe = undefined
    observer?.disconnect()
    observer = undefined
  }
  onCleanup(release)

  const run = (): void => {
    const el = box
    if (el === undefined || armed()) return
    setArmed(true)

    // Guard 1: watch for the A to B FLIP seed. The click's own `left` write also
    // mutates the style attribute, but it leaves `transform` at its Run-time value.
    const transformAtRun = el.style.transform
    let flipSeeded = false
    observer = new MutationObserver(() => {
      const t = el.style.transform
      if (t === transformAtRun || t === "" || t === "none") return
      flipSeeded = true
      observer?.disconnect()
      observer = undefined
    })
    observer.observe(el, { attributes: true, attributeFilter: ["style"] })

    props.ctx.mark("arm")
    setAtB(true)
    unsubscribe = props.ctx.onLayoutAnimationComplete(() => {
      if (!flipSeeded || !isAtLayoutSlot(el)) return
      release()
      props.ctx.markTrigger("animation-complete")
      setAtB(false)
      setArmed(false)
    })
  }

  return (
    <div data-scenario={ID} style={ROOT_STYLE}>
      <div class="stage">
        <wardic.div
          ref={(el) => {
            box = el
            props.ctx.watch(el)
          }}
          class="box"
          layout
          layoutDependency={atB()}
          style={boxStyle(atB())}
        />
      </div>
      <button type="button" class="btn" data-action="run" disabled={armed()} onClick={run}>
        Run
      </button>
    </div>
  )
}

/**
 * Scenario 5, on Wardic animation complete: the end of the coordinator span that
 * carried the click's A to B FLIP writes the `layoutDependency` signal (B to A).
 * Expected to be safe, holding 1: the span end is delivered inside the Clock's
 * callback, in the frame's tick.
 */
export const s5: ScenarioDef = {
  id: ID,
  index: 5,
  title: "On Wardic animation complete",
  mechanism:
    "The end of the wardic.projection.coordinator span (ctx.onLayoutAnimationComplete) writes the layoutDependency signal.",
  prediction: "safe",
  expectedHeld: 1,
  rationale:
    "The span end, and so the signal write, lands inside the Clock's rAF callback, in the frame's tick, where the " +
    "coordinator's run settles (the lab's frame trace shows it in the Clock's callback in Chrome and Firefox). " +
    "notify queues a Measure pass that runs in a microtask at the end of that callback and flushes its seed before " +
    "the frame paints (ADR-0018), so the frame shows the box at its origin and the next frame's tick moves it " +
    "(held 1; ADR-0033). Were Effect's scheduler to " +
    "deliver the end in a later task instead, that would be a task trigger: still safe, held 0. The span end is " +
    "only a proxy: Wardic exposes no layout-animation-complete callback.",
  View,
}
