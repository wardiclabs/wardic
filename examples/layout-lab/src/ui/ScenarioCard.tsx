/**
 * One scenario card: the scenario's metadata and prediction (stated before any
 * run), the scenario's own View (its fixed-size `.stage` and Run button), and the
 * last observed result.
 *
 * The result area has a fixed height and is always rendered, so a result arriving
 * never changes the card's height and never moves a `.stage` below it.
 *
 * @module
 */
import type { JSX } from "solid-js"
import type { LabRun } from "../lab/lab.ts"
import type { ScenarioContext, ScenarioDef } from "../scenarios/types.ts"

/** Props are static values; `lastRun` and `selected` are tracked prop getters. */
export interface ScenarioCardProps {
  readonly def: ScenarioDef
  readonly ctx: ScenarioContext
  /** The scenario's most recent completed run, if any. */
  readonly lastRun: LabRun | undefined
  /** Whether the timeline panel is showing this card's last run. */
  readonly selected: boolean
  /** Shows this card's last run in the timeline panel. */
  readonly onSelect: () => void
}

/** Renders one scenario card. */
export const ScenarioCard = (props: ScenarioCardProps): JSX.Element => {
  const def = props.def
  const View = def.View
  return (
    <article class="card" classList={{ selected: props.selected }}>
      <header class="card-head">
        <span class="card-index">{def.index === 0 ? "∗" : def.index}</span>
        <div class="card-titles">
          <h2 class="card-title">{def.title}</h2>
          <p class="card-mechanism">{def.mechanism}</p>
        </div>
        <button
          type="button"
          class="btn secondary small card-timeline"
          disabled={props.lastRun === undefined}
          onClick={() => props.onSelect()}
        >
          Timeline
        </button>
      </header>
      <p class="card-prediction">
        <span class={`pill prediction-${def.prediction}`}>{def.prediction}</span>
        <span class="card-rationale">{def.rationale}</span>
      </p>
      <View ctx={props.ctx} />
      <footer class="card-result" aria-live="polite">
        <div class="result-cell">
          <span class="result-label">verdict</span>
          <span class={`pill verdict-${props.lastRun?.verdict ?? "none"}`}>{props.lastRun?.verdict ?? "not run"}</span>
        </div>
        <div class="result-cell">
          <span class="result-label">framesToMeasure</span>
          <span class="result-value">{formatFrames(props.lastRun)}</span>
        </div>
        <div class="result-cell">
          <span class="result-label">held</span>
          <span class="result-value">{formatHeld(props.lastRun)}</span>
        </div>
        <div class="result-cell">
          <span class="result-label">outcome</span>
          <span class={`pill outcome-${outcomeClass(props.lastRun)}`}>{props.lastRun?.outcome ?? "–"}</span>
        </div>
      </footer>
    </article>
  )
}

/** framesToMeasure as text: `–` before any run, `?` when no measure span was seen. */
const formatFrames = (run: LabRun | undefined): string => {
  if (run === undefined) return "–"
  return run.framesToMeasure === null ? "?" : String(run.framesToMeasure)
}

/**
 * Issue #14's hold and the Clock start as text, e.g. `1 · cold`: `–` before any
 * run, `?` when the run's anchor was never seen or nothing moved after it.
 */
export const formatHeld = (run: LabRun | undefined): string => {
  if (run === undefined) return "–"
  const held = run.heldFrames === null ? "?" : String(run.heldFrames)
  return run.clock === null ? held : `${held} · ${run.clock}`
}

/** A CSS-safe class suffix for an outcome (`n/a` has a slash). */
const outcomeClass = (run: LabRun | undefined): string => {
  if (run === undefined) return "none"
  return run.outcome === "n/a" ? "na" : run.outcome
}
