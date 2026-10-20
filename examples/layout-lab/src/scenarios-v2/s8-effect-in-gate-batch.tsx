/**
 * Scenario 8 on the Solid 2 binding (#209 PR 5): Solid 1's (`../scenarios/s8-effect-in-gate-batch.tsx`),
 * with a kept `ward` for its driver and Solid 2's split effect. A Solid effect that runs inside the
 * gate's flush writes the `layoutDependency` signal. Solid 2 has no `batch()`: the gate applies a
 * frame's Starting-style switches and drains them with Solid's `flush()` before it commits
 * (ADR-0045), and the driver's effect runs in that `flush()`.
 *
 * The stage holds two absolutely positioned elements that cannot move each other:
 * the watched 64x64 `wardic.div` with `layout` at the top (left 32px or 224px, top
 * 24px, 192px apart) and, below it, a 28x28 driver dot driven by a kept `ward`. Its
 * `animate` translates it (`x` 0 or 256px), a transform that reflows nothing. Run
 * arms a one-shot and mounts a new driver, which animates from where the last one
 * ended to the other end. A `createEffect` tracks the driver's `style`, which changes
 * once: at its first frame's Starting-style switch, which the gate runs inside its
 * flush (ADR-0034; a frame itself never goes through `style`). That change
 * disarms, marks the trigger and moves the watched box through the signal bound to
 * its `left` and `layoutDependency`, so repeated runs alternate.
 *
 * @module
 */
import { ward, wardic } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import { createEffect, createSignal, For } from "solid-js"
import type { ScenarioDef } from "../scenarios/types.ts"

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
    const driver = ward({ initial: { x: driverX(p.run - 1) }, animate: { x: driverX(p.run) }, style: DRIVER_STYLE })
    // The driver's `style` changes once, when the gate switches its Starting style out
    // just before its first commit (ADR-0034), and drains the switch with Solid 2's flush().
    // That flush runs this effect before it returns, so the write below happens while the gate
    // is still flushing. `defer` skips the mount run; the apply runs untracked.
    createEffect(
      () => driver.style,
      () => {
        if (!armed) return
        armed = false
        props.ctx.markTrigger("gate-batch-effect")
        setAtB((b) => !b)
      },
      { defer: true },
    )
    return <div {...driver} aria-hidden="true" />
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
 * Scenario 8, Solid effect during the gate's flush: an effect on a new driver element's
 * `style`, which its first frame's Starting-style switch changes, writes the
 * `layoutDependency` signal from inside the gate's flush (Solid 2's `flush()`). Expected to be
 * safe, holding 1: the Measure pass runs right after the frame's flush, at the end of the
 * Clock's callback.
 */
export const s8: ScenarioDef = {
  id: ID,
  index: 8,
  title: "Solid effect during the gate's flush",
  mechanism:
    "A createEffect on a new driver ward's style, changed by its first frame's Starting-style switch, which the gate drains with Solid 2's flush(), writes the layoutDependency signal.",
  prediction: "safe",
  expectedHeld: 1,
  rationale:
    "The gate switches a new element's Starting style out and drains the switch with Solid 2's flush() before it " +
    "commits, at the end of the Frame loop's tick in the Clock's callback (ADR-0033, ADR-0034, ADR-0045), and that " +
    "flush() runs this effect before it returns, so the layoutDependency flip reaches notify during the frame's " +
    "flush. The Measure pass it queues runs in a microtask at the end of the Clock's callback and flushes its own " +
    "seed (ADR-0018), so the frame paints the origin (held 1), and the next frame's tick takes the first step: a " +
    "click's first step.",
  View,
}
