/**
 * The timeline panel: one run drawn on a shared millisecond axis, with the
 * trigger mark at 0.
 *
 * Lanes, top to bottom:
 * - **marks**: the trigger mark and any note marks.
 * - **paints**: one tick per painted frame. Paints between the trigger and the
 *   first measure pass (the ones framesToMeasure counts) are highlighted, and the
 *   flash frame, if any, is drawn in the flash colour.
 * - **measure**: `wardic.projection.measure` spans.
 * - **coordinator**: `wardic.projection.coordinator` spans (one per animation
 *   burst: the coordinator's run on the Frame loop, #75). A span still in flight
 *   when the run ended is drawn open-ended.
 *
 * The panel renders only when the selection changes (once per completed run, or a
 * user pick), never per frame.
 *
 * @module
 */
import { For, type JSX, Show } from "solid-js"
import type { LabRun } from "../lab/lab.ts"
import type { SpanRecord, TimelineWindow } from "../probe/timeline.ts"
import { formatHeld } from "./ScenarioCard.tsx"

/** A run plus the timeline slice captured when it ended. */
export interface TimelineSelection {
  readonly run: LabRun
  readonly window: TimelineWindow
}

/** Props are static values; `selection` and `following` are tracked prop getters. */
export interface TimelinePanelProps {
  /** The run to draw, if any. */
  readonly selection: TimelineSelection | undefined
  /** Whether the panel follows the latest run (as opposed to a picked card). */
  readonly following: boolean
  /** Switches back to following the latest run. */
  readonly onFollowLatest: () => void
}

/** SVG geometry, in viewBox units. */
const WIDTH = 360
const LABEL_W = 78
const RIGHT_PAD = 10
const LANE_H = 24
const AXIS_H = 22
const LANES = ["marks", "paints", "measure", "coordinator"] as const
const HEIGHT = LANES.length * LANE_H + AXIS_H

const MEASURE_SPAN = "wardic.projection.measure"
const COORDINATOR_SPAN = "wardic.projection.coordinator"

/** How far before the trigger the axis starts, at least, in ms. */
const MIN_LEAD_MS = 10

/** Tick steps the axis may use, in ms. */
const TICK_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]

/** Everything the SVG needs, precomputed from one selection. */
interface Layout {
  readonly t0: number
  readonly tMin: number
  readonly tMax: number
  readonly x: (t: number) => number
  readonly ticks: ReadonlyArray<number>
  readonly measures: ReadonlyArray<SpanRecord>
  readonly coordinators: ReadonlyArray<SpanRecord>
  readonly firstMeasureStart: number | undefined
  readonly flashT: number | undefined
}

const laneY = (lane: (typeof LANES)[number]): number => LANES.indexOf(lane) * LANE_H

/** Builds the axis and the lane contents for one selection. */
const layoutOf = (selection: TimelineSelection): Layout => {
  const { run, window } = selection
  const t0 = run.triggerAt
  const spans = run.spans
  const measures = spans.filter((s) => s.name === MEASURE_SPAN)
  const coordinators = spans.filter((s) => s.name === COORDINATOR_SPAN)
  const earliest = Math.min(
    -MIN_LEAD_MS,
    ...window.marks.map((m) => m.t - t0),
    ...spans.map((s) => s.start - t0),
  )
  const tMin = earliest
  const tMax = Math.max(run.endedAt - t0, 1)
  const span = tMax - tMin
  const x = (t: number): number => LABEL_W + ((t - tMin) / span) * (WIDTH - LABEL_W - RIGHT_PAD)
  const step = TICK_STEPS.find((s) => span / s <= 6) ?? TICK_STEPS[TICK_STEPS.length - 1]
  const ticks: Array<number> = []
  for (let t = Math.ceil(tMin / step) * step; t <= tMax; t += step) ticks.push(t)
  const firstMeasure = measures.find((s) => s.start > t0)
  const flashT = run.teleportIndex === undefined ? undefined : run.samples[run.teleportIndex]?.t
  return {
    t0,
    tMin,
    tMax,
    x,
    ticks,
    measures,
    coordinators,
    firstMeasureStart: firstMeasure?.start,
    flashT,
  }
}

/** Formats a relative time in ms. */
const ms = (t: number): string => `${t >= 0 ? "+" : ""}${t.toFixed(1)} ms`

/** Renders the timeline panel. */
export const TimelinePanel = (props: TimelinePanelProps): JSX.Element => (
  <section class="panel">
    <header class="panel-head">
      <h2>Timeline</h2>
      <Show
        when={props.following}
        fallback={
          <button type="button" class="btn secondary small" onClick={() => props.onFollowLatest()}>
            Follow latest
          </button>
        }
      >
        <span class="panel-note">latest run</span>
      </Show>
    </header>
    <Show when={props.selection} fallback={<p class="panel-note">No run yet: press Run on a scenario.</p>}>
      {(selection) => <TimelineChart selection={selection()} />}
    </Show>
  </section>
)

/** The chart for one selection. */
const TimelineChart = (props: { readonly selection: TimelineSelection }): JSX.Element => {
  const run = (): LabRun => props.selection.run
  const layout = (): Layout => layoutOf(props.selection)
  return (
    <div class="timeline">
      <p class="timeline-summary">
        <strong>{run().scenarioId}</strong> · {run().trigger} · {run().verdict} · framesToMeasure{" "}
        <strong>{run().framesToMeasure ?? "?"}</strong> · held <strong>{formatHeld(run())}</strong>
      </p>
      <svg
        class="timeline-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Timeline of ${run().scenarioId}: framesToMeasure ${run().framesToMeasure ?? "unknown"}`}
      >
        <For each={LANES}>
          {(lane) => (
            <g>
              <line class="tl-lane" x1={LABEL_W} x2={WIDTH - RIGHT_PAD} y1={laneY(lane) + LANE_H - 0.5} y2={laneY(lane) + LANE_H - 0.5} />
              <text class="tl-label" x={0} y={laneY(lane) + LANE_H / 2 + 4}>
                {lane}
              </text>
            </g>
          )}
        </For>

        {/* The trigger (t = 0) through every lane. */}
        <line class="tl-zero" x1={layout().x(0)} x2={layout().x(0)} y1={0} y2={LANES.length * LANE_H} />

        <For each={props.selection.window.marks}>
          {(mark) => {
            const t = mark.t - layout().t0
            return (
              <g class={mark.kind === "trigger" ? "tl-trigger" : "tl-note"}>
                <line x1={layout().x(t)} x2={layout().x(t)} y1={laneY("marks") + 3} y2={laneY("marks") + LANE_H - 3} />
                <title>{`${mark.kind} ${mark.label} ${ms(t)}`}</title>
              </g>
            )
          }}
        </For>

        <For each={props.selection.window.paints}>
          {(p) => {
            const t = p - layout().t0
            const early =
              p > layout().t0 && layout().firstMeasureStart !== undefined && p < (layout().firstMeasureStart ?? 0)
            const flash = layout().flashT === p
            return (
              <line
                class={flash ? "tl-paint flash" : early ? "tl-paint early" : "tl-paint"}
                x1={layout().x(t)}
                x2={layout().x(t)}
                y1={laneY("paints") + 5}
                y2={laneY("paints") + LANE_H - 5}
              >
                <title>{`paint ${ms(t)}${flash ? " (flash frame)" : early ? " (before measure)" : ""}`}</title>
              </line>
            )
          }}
        </For>

        <For each={layout().measures}>{(s) => <SpanBar span={s} lane="measure" layout={layout()} />}</For>
        <For each={layout().coordinators}>{(s) => <SpanBar span={s} lane="coordinator" layout={layout()} />}</For>

        <For each={layout().ticks}>
          {(t) => (
            <g class="tl-tick">
              <line x1={layout().x(t)} x2={layout().x(t)} y1={LANES.length * LANE_H} y2={LANES.length * LANE_H + 4} />
              <text x={layout().x(t)} y={HEIGHT - 4} text-anchor="middle">
                {t}
              </text>
            </g>
          )}
        </For>
      </svg>
      <p class="panel-note">
        ms relative to the trigger mark. Highlighted paints happened after the trigger and before the first measure pass.
      </p>
    </div>
  )
}

/** One span drawn as a bar in its lane; an in-flight span runs to the axis end. */
const SpanBar = (props: {
  readonly span: SpanRecord
  readonly lane: "measure" | "coordinator"
  readonly layout: Layout
}): JSX.Element => {
  const start = (): number => Math.max(props.span.start - props.layout.t0, props.layout.tMin)
  const end = (): number => {
    const e = props.span.end
    return e === undefined ? props.layout.tMax : Math.min(e - props.layout.t0, props.layout.tMax)
  }
  const x1 = (): number => props.layout.x(start())
  const width = (): number => Math.max(props.layout.x(end()) - x1(), 2)
  return (
    <rect
      class={`tl-span ${props.lane}${props.span.end === undefined ? " open" : ""}`}
      x={x1()}
      y={laneY(props.lane) + 6}
      width={width()}
      height={LANE_H - 12}
      rx={2}
    >
      <title>
        {`${props.span.name} ${ms(props.span.start - props.layout.t0)}` +
          (props.span.end === undefined ? " (in flight)" : ` for ${(props.span.end - props.span.start).toFixed(2)} ms`)}
      </title>
    </rect>
  )
}
