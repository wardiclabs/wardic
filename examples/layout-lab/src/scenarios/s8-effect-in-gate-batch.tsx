/**
 * Scenario 8: a Solid effect that runs inside the gate flush's `batch()` writes the
 * `layoutDependency` signal.
 *
 * The stage holds two absolutely positioned elements that cannot move each other:
 * the watched 64x64 `wardic.div` with `layout` at the top (left 32px or 224px, top
 * 24px, 192px apart) and, below it, a 28x28 driver dot driven by `useWardic`. Its
 * `animate` translates it (`x` 0 or 256px), a transform that reflows nothing. Run
 * arms a one-shot and flips the driver's `animate`. A `createEffect` tracks
 * `ward().style`, the gate's signal-sink output, which the gate only ever sets
 * inside its flush's `batch()`. The first style change after arming disarms, marks
 * the trigger and moves the watched box through the signal bound to its `left` and
 * `layoutDependency`, so repeated runs alternate.
 *
 * @module
 */
import { useWardic, wardic } from "@wardic/solid"
import { createEffect, createSignal, type JSX, on } from "solid-js"
import type { ScenarioDef } from "./types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "effect-in-gate-batch"

/** The View root: the stage with the Run button under it. */
const ROOT_STYLE: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  "align-items": "flex-start",
  gap: "8px",
}

/** How far (px) the driver translates: from left 16px to 272px, inside the 320px stage. */
const DRIVER_TRAVEL = 256

/**
 * The driver dot's static style, below the watched box (top 112px). Only its
 * transform animates, so it never reflows the watched box.
 */
const DRIVER_STYLE: JSX.CSSProperties = {
  position: "absolute",
  top: "112px",
  left: "16px",
  width: "28px",
  height: "28px",
  "border-radius": "50%",
  background: "var(--lab-box-alt)",
}

/**
 * The box's absolute position for state A or B. Both keep the 64x64 box inside the
 * 320x160 stage and above the driver.
 */
const boxStyle = (atB: boolean): JSX.CSSProperties => ({
  position: "absolute",
  top: "24px",
  left: atB ? "224px" : "32px",
})

/**
 * The scenario View. Run drops a `drive` note, arms the one-shot and flips the
 * driver's `animate` target. The effect on `ward().style` then marks the
 * `gate-batch-effect` trigger and moves the watched box, once per Run.
 */
const View: ScenarioDef["View"] = (props) => {
  const [driven, setDriven] = createSignal(false)
  const [atB, setAtB] = createSignal(false)
  // Plain flag, not a signal: the effect must not track it.
  let armed = false

  const ward = useWardic(() => ({ animate: { x: driven() ? DRIVER_TRAVEL : 0 } }))
  const driver = ward({ style: DRIVER_STYLE })

  // `ward().style` reads the per-element style signal, which only the gate's flush
  // sets, inside its batch(). Solid runs this effect before that batch() returns,
  // so the write below happens while the gate is still flushing. `defer` skips the
  // mount run, and `on` runs the body untracked.
  createEffect(
    on(
      () => ward().style,
      () => {
        if (!armed) return
        armed = false
        props.ctx.markTrigger("gate-batch-effect")
        setAtB((b) => !b)
      },
      { defer: true },
    ),
  )

  const run = (): void => {
    props.ctx.mark("drive")
    armed = true
    setDriven((d) => !d)
  }

  return (
    <div data-scenario={ID} style={ROOT_STYLE}>
      <div class="stage">
        <wardic.div
          ref={(el) => props.ctx.watch(el)}
          class="box"
          layout
          layoutDependency={atB()}
          style={boxStyle(atB())}
        />
        <div ref={driver.ref} style={driver.style} aria-hidden="true" />
      </div>
      <button type="button" class="btn" data-action="run" onClick={run}>
        Run
      </button>
    </div>
  )
}

/**
 * Scenario 8, Solid effect during gate batch: an effect on a driver element's
 * `ward().style` writes the `layoutDependency` signal from inside the gate flush's
 * `batch()`. Expected to flash.
 */
export const s8: ScenarioDef = {
  id: ID,
  index: 8,
  title: "Solid effect during gate batch",
  mechanism:
    "A createEffect on a driver element's ward().style, run inside the gate flush's batch(), writes the layoutDependency signal.",
  prediction: "flash-risk",
  rationale:
    "The gate sets signal-sink styles inside flush()'s batch(), and Solid runs this effect before that batch() " +
    "returns, so the layoutDependency flip calls scheduleMeasure while flushing is still true. In " +
    "packages/solid/src/gate.ts, scheduleMeasure adds the pass to measurePasses, but scheduleFlush returns early " +
    "(`if (scheduled || flushing) return`), so no rAF is requested. The pass is stranded until the next gate write " +
    "or ResizeObserver delivery, so at least one paint shows the destination box.",
  View,
}
