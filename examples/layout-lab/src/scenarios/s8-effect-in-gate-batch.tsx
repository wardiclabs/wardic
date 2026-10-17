/**
 * Scenario 8: a Solid effect that runs inside the gate flush's `batch()` writes the
 * `layoutDependency` signal.
 *
 * The stage holds two absolutely positioned elements that cannot move each other:
 * the watched 64x64 `wardic.div` with `layout` at the top (left 32px or 224px, top
 * 24px, 192px apart) and, below it, a 28x28 driver dot driven by `createWard`. Its
 * `animate` translates it (`x` 0 or 256px), a transform that reflows nothing. Run
 * arms a one-shot and mounts a new driver, which animates from where the last one
 * ended to the other end. A `createEffect` tracks the driver's `style`, which changes
 * once: at its first frame's Starting-style switch, which the gate runs inside its
 * flush's `batch()` (ADR-0034; a frame itself never goes through `style`). That change
 * disarms, marks the trigger and moves the watched box through the signal bound to
 * its `left` and `layoutDependency`, so repeated runs alternate.
 *
 * @module
 */
import { createWard, wardic } from "@wardic/solid"
import { createEffect, createSignal, For, type JSX, on } from "solid-js"
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

/** The driver's `x` after `run` Runs: 0, then alternately the far end and back. */
const driverX = (run: number): number => (run % 2 === 1 ? DRIVER_TRAVEL : 0)

/**
 * The scenario View. Run drops a `drive` note, arms the one-shot and mounts the next
 * driver. The effect on that driver's `style` then marks the `gate-batch-effect`
 * trigger and moves the watched box, once per Run.
 */
const View: ScenarioDef["View"] = (props) => {
  const [runs, setRuns] = createSignal(0)
  const [atB, setAtB] = createSignal(false)
  // Plain flag, not a signal: the effect must not track it.
  let armed = false

  /** One Run's driver: `x` from the last Run's end to this one's. */
  const Driver = (p: { readonly run: number }): JSX.Element => {
    const ward = createWard({ initial: { x: driverX(p.run - 1) }, animate: { x: driverX(p.run) } })
    const driver = ward({ style: DRIVER_STYLE })
    // The driver's `style` changes once, when the gate switches its Starting style out
    // just before its first commit, inside the flush's batch() (ADR-0034). Solid runs this
    // effect before that batch() returns, so the write below happens while the gate is
    // still flushing. `defer` skips the mount run, and `on` runs the body untracked.
    createEffect(
      on(
        () => driver.style,
        () => {
          if (!armed) return
          armed = false
          props.ctx.markTrigger("gate-batch-effect")
          setAtB((b) => !b)
        },
        { defer: true },
      ),
    )
    return <div ref={driver.ref} style={driver.style} aria-hidden="true" />
  }

  const run = (): void => {
    props.ctx.mark("drive")
    armed = true
    setRuns((n) => n + 1)
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
        <For each={[runs()]}>{(n) => <Driver run={n} />}</For>
      </div>
      <button type="button" class="btn" data-action="run" onClick={run}>
        Run
      </button>
    </div>
  )
}

/**
 * Scenario 8, Solid effect during gate batch: an effect on a new driver element's
 * `style`, which its first frame's Starting-style switch changes, writes the
 * `layoutDependency` signal from inside the gate flush's `batch()`. Expected to be safe,
 * holding 1: the Measure pass runs right after the frame's flush, at the end of the
 * Clock's callback.
 */
export const s8: ScenarioDef = {
  id: ID,
  index: 8,
  title: "Solid effect during gate batch",
  mechanism:
    "A createEffect on a new driver element's style, changed by its first frame's Starting-style switch inside the gate flush's batch(), writes the layoutDependency signal.",
  prediction: "safe",
  expectedHeld: 1,
  rationale:
    "The gate switches a new element's Starting style out inside its flush's batch(), at the end of the Frame loop's " +
    "tick in the Clock's callback (ADR-0033, ADR-0034), and Solid runs this effect before that batch() returns, so the " +
    "layoutDependency flip " +
    "reaches notify during the frame's flush. The Measure pass it queues runs in a microtask at the end of the " +
    "Clock's callback and flushes its own seed (ADR-0018), so the frame paints the origin (held 1), and the next " +
    "frame's tick takes the first step: a click's first step. Before #73 the flush ran before the Clock's callback, " +
    "so a Priming step and that frame's tick both stepped the FLIP before its first painted move.",
  View,
}
