/**
 * Scenario 3: an app-owned ResizeObserver writes the `layoutDependency` signal.
 *
 * The stage holds two absolutely positioned elements that cannot move each other:
 * a thin driver bar at the top (48px or 144px wide) and, below it, the watched 64x64
 * `wardic.div` with `layout`. Run only resizes the driver. The app's ResizeObserver
 * on the driver then moves the box 192px sideways (left 32px or 224px) through the
 * signal bound to its `left` and `layoutDependency`, so repeated runs alternate.
 *
 * @module
 */
import { wardic } from "@wardic/solid"
import { createSignal, type JSX, onCleanup, onMount } from "solid-js"
import type { ScenarioDef } from "./types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "app-ro-signal"

/** The View root: the stage with the Run button under it. */
const ROOT_STYLE: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  "align-items": "flex-start",
  gap: "8px",
}

/** The driver's narrow and wide widths, in px. */
const DRIVER_NARROW = 48
const DRIVER_WIDE = 144

/** An observed driver width above this counts as wide (the midpoint of the two). */
const DRIVER_WIDE_THRESHOLD = (DRIVER_NARROW + DRIVER_WIDE) / 2

/**
 * The driver bar's style: top 16px, 16px tall, above the box so its width change
 * never reaches it.
 */
const driverStyle = (wide: boolean): JSX.CSSProperties => ({
  position: "absolute",
  top: "16px",
  left: "16px",
  width: `${wide ? DRIVER_WIDE : DRIVER_NARROW}px`,
  height: "16px",
  "border-radius": "4px",
  background: "var(--lab-box-alt)",
})

/**
 * The box's absolute position for state A or B. Both keep the 64x64 box inside the
 * 320x160 stage (left 32px or 224px, top 72px), 192px apart.
 */
const boxStyle = (atB: boolean): JSX.CSSProperties => ({
  position: "absolute",
  top: "72px",
  left: atB ? "224px" : "32px",
})

/**
 * The scenario View. Run drops a `resize-driver` note and toggles the driver's
 * width. The app ResizeObserver callback marks the `app-ro` trigger, then writes
 * the box signal to match the driver width it observed.
 */
const View: ScenarioDef["View"] = (props) => {
  const [driverWide, setDriverWide] = createSignal(false)
  const [atB, setAtB] = createSignal(false)
  let driver: HTMLDivElement | undefined

  // observe() always makes one delivery for the driver's starting size. It is not
  // a resize, so it is skipped and starts no run.
  let initialDelivery = true

  const observer = new ResizeObserver((entries) => {
    if (initialDelivery) {
      initialDelivery = false
      return
    }
    const entry = entries.at(-1)
    if (entry === undefined) return
    const wide = entry.contentRect.width > DRIVER_WIDE_THRESHOLD
    // The box already matches this width (no move to make), so start no run.
    if (wide === atB()) return
    props.ctx.markTrigger("app-ro")
    setAtB(wide)
  })

  onMount(() => {
    if (driver !== undefined) observer.observe(driver)
  })
  onCleanup(() => observer.disconnect())

  const run = (): void => {
    props.ctx.mark("resize-driver")
    setDriverWide((w) => !w)
  }

  return (
    <div data-scenario={ID} style={ROOT_STYLE}>
      <div class="stage">
        <div ref={driver} style={driverStyle(driverWide())} />
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
 * Scenario 3, app ResizeObserver -> signal: the app's own ResizeObserver on a
 * separate driver element writes the `layoutDependency` signal. Expected to flash.
 */
export const s3: ScenarioDef = {
  id: ID,
  index: 3,
  title: "App ResizeObserver -> signal",
  mechanism:
    "An app-owned ResizeObserver on a separate driver element writes the layoutDependency signal after the click resizes the driver.",
  prediction: "flash-risk",
  rationale:
    "The app's ResizeObserver callback runs in the rendering update after that frame's rAF callbacks. Its signal " +
    "write moves the box and runs Wardic's layoutDependency effect synchronously, but the gate rAF that notify " +
    "requests there lands on the next frame, so the browser re-lays out and paints the box at its destination first.",
  View,
}
