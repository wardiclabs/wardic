/**
 * The flash counter: total flash verdicts and a per-scenario breakdown since the
 * last reset. Reset zeroes the counts and removes every ghost outline.
 *
 * @module
 */
import type { JSX } from "#binding"
import { classOf } from "./class-of.ts"
import { For } from "solid-js"
import type { FlashCounts } from "../lab/lab.ts"
import type { ScenarioDef } from "../scenarios/types.ts"

/** Props are static values; `counts` is a tracked prop getter. */
export interface FlashCounterProps {
  readonly scenarios: ReadonlyArray<ScenarioDef>
  readonly counts: FlashCounts
  readonly onReset: () => void
}

/** Renders the flash counter panel. */
export const FlashCounter = (props: FlashCounterProps): JSX.Element => (
  <section class="panel">
    <header class="panel-head">
      <h2>Flashes</h2>
      <span class={classOf("flash-total", { hot: props.counts.total > 0 })}>
        {props.counts.total}
      </span>
      <button type="button" class="btn secondary small" onClick={() => props.onReset()}>
        Reset
      </button>
    </header>
    <ul class="flash-list">
      <For each={props.scenarios}>
        {(def) => (
          <li class={classOf("", { hot: (props.counts.perScenario[def.id] ?? 0) > 0 })}>
            <span class="flash-index">{def.index === 0 ? "∗" : def.index}</span>
            <span class="flash-title">{def.title}</span>
            <span class="flash-count">{props.counts.perScenario[def.id] ?? 0}</span>
          </li>
        )}
      </For>
    </ul>
  </section>
)
