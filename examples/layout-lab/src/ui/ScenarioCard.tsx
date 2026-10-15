/**
 * One scenario card: the scenario's metadata and prediction (stated before any
 * run), the scenario's own View (its fixed-size `.stage` and Run button), and the
 * last observed result: the verdict, framesToMeasure, the hold checked against the
 * scenario's `expectedHeld`, the outcome, the run's Measure passes, its first steps
 * and its `passStepRatio`.
 *
 * A drag scenario's card (`kind: "drag"`, issue #26) shows its last drag run
 * instead, one line per check against the scenario's `dragExpect` (see
 * `dragChecksOf` in `lab/drag-run.ts`), and has no Timeline button: a drag run is
 * not a sampling run, so the timeline panel has nothing to draw for it. A board
 * scenario's card (`kind: "board"`, #47) shows its last board run's cell and its
 * `start` / `end` lines (`boardChecksOf` in `lab/base-values-board.ts`), with no
 * Timeline button either. A drag scenario with a `restExpect` (scenario 12, #144) shows its
 * last at-rest run instead while that is newer than its last drag run: the `slot moved`,
 * `ends on slot`, `child glued` and `isolated` lines (`restChecksOf` in `lab/rest-run.ts`).
 *
 * The result area has a fixed height and is always rendered, so a result arriving
 * never changes the card's height and never moves a `.stage` below it.
 *
 * @module
 */
import { createMemo, For, type JSX, Show } from "solid-js"
import { BOARD_CHECK_NAMES, type BoardCheck, type BoardRunInput, boardChecksOf } from "../lab/base-values-board.ts"
import { DRAG_CHECK_NAMES, type DragExpect, type DragRun, dragChecksOf, FLING_CHECK_NAMES, type FlingExpect, flingChecksOf } from "../lab/drag-run.ts"
import { REORDER_CHECK_NAMES, type ReorderExpect, reorderChecksOf } from "../lab/reorder-run.ts"
import { REST_CHECK_NAMES, type RestExpect, type RestRun, restChecksOf } from "../lab/rest-run.ts"
import { heldCheckOf } from "../lab/held-frames.ts"
import type { LabRun } from "../lab/lab.ts"
import { formatPasses, measurePassesOf } from "../lab/measure-passes.ts"
import type { ExpectedHeld, ScenarioContext, ScenarioDef } from "../scenarios/types.ts"

/** Props are static values; `lastRun`, `lastDragRun` and `selected` are tracked prop getters. */
export interface ScenarioCardProps {
  readonly def: ScenarioDef
  readonly ctx: ScenarioContext
  /** The scenario's most recent completed run, if any. */
  readonly lastRun: LabRun | undefined
  /** A drag scenario's most recent drag run, if any. */
  readonly lastDragRun: DragRun | undefined
  /** A board scenario's most recent board run, if any. */
  readonly lastBoardRun: BoardRunInput | undefined
  /** A drag scenario's most recent at-rest run (#144), if any. */
  readonly lastRestRun: RestRun | undefined
  /** Whether the timeline panel is showing this card's last run. */
  readonly selected: boolean
  /** Shows this card's last run in the timeline panel. */
  readonly onSelect: () => void
}

/** Renders one scenario card. */
export const ScenarioCard = (props: ScenarioCardProps): JSX.Element => {
  const def = props.def
  const View = def.View
  // `def` is static, so the card's kind is fixed for its lifetime.
  const drag = def.kind === "drag"
  const board = def.kind === "board"
  return (
    <article class="card" classList={{ selected: props.selected }}>
      <header class="card-head">
        <span class="card-index">{def.index === 0 ? "∗" : def.index}</span>
        <div class="card-titles">
          <h2 class="card-title">{def.title}</h2>
          <p class="card-mechanism">{def.mechanism}</p>
        </div>
        {drag || board ? null : (
          <button
            type="button"
            class="btn secondary small card-timeline"
            disabled={props.lastRun === undefined}
            onClick={() => props.onSelect()}
          >
            Timeline
          </button>
        )}
      </header>
      <p class="card-prediction">
        <span class={`pill prediction-${def.prediction}`}>{def.prediction}</span>
        <span class="card-rationale">{def.rationale}</span>
      </p>
      <View ctx={props.ctx} />
      {board ? (
        <BoardResult run={props.lastBoardRun} lines={def.boardLines ?? BOARD_CHECK_NAMES} />
      ) : drag ? (
        <Show
          when={restIsLatest(props.lastRestRun, props.lastDragRun)}
          fallback={<DragResult run={props.lastDragRun} expect={def.dragExpect} reorderExpect={def.reorderExpect} flingExpect={def.flingExpect} />}
        >
          <RestResult run={props.lastRestRun} expect={def.restExpect} />
        </Show>
      ) : (
        <TriggerResult def={def} lastRun={props.lastRun} />
      )}
    </article>
  )
}

/**
 * A trigger card's result row: the last run's verdict, framesToMeasure, hold,
 * outcome, passes, steps and passStepRatio. Props are static values; `lastRun` is a
 * tracked prop getter.
 */
const TriggerResult = (props: { readonly def: ScenarioDef; readonly lastRun: LabRun | undefined }): JSX.Element => {
  const def = props.def
  return (
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
        <span class="result-value" classList={{ "held-miss": heldMissed(props.lastRun, def.expectedHeld) }}>
          {formatHeld(props.lastRun, def.expectedHeld)}
        </span>
      </div>
      <div class="result-cell">
        <span class="result-label">outcome</span>
        <span class={`pill outcome-${outcomeClass(props.lastRun)}`}>{props.lastRun?.outcome ?? "–"}</span>
      </div>
      <div class="result-cell">
        <span class="result-label">passes</span>
        <span class="result-value">{formatRunPasses(props.lastRun)}</span>
      </div>
      <div class="result-cell">
        <span class="result-label">steps</span>
        <span class="result-value">{formatSteps(props.lastRun)}</span>
      </div>
      <div class="result-cell">
        <span class="result-label">passStepRatio</span>
        <span class="result-value">{formatRatio(props.lastRun)}</span>
      </div>
    </footer>
  )
}

/** Props are static values; `run` is a tracked prop getter. */
interface DragResultProps {
  /** The scenario's most recent drag run, if any. */
  readonly run: DragRun | undefined
  /** The scenario's `dragExpect`; left out, every line shows its value with no check. */
  readonly expect: DragExpect | undefined
  /** A `<Reorder>` scenario's `reorderExpect` (scenario 14): given, the reorder lines follow the drag lines. */
  readonly reorderExpect: ReorderExpect | undefined
  /** A scenario with a free item's `flingExpect` (scenario 13, #139): given, its `fling` and `rests` lines follow. */
  readonly flingExpect: FlingExpect | undefined
}

/** Lines whose whole text is the point, so they wrap rather than end in an ellipsis: what a keyboard run announced (#43). */
const WRAPPING_LINES: ReadonlySet<string> = new Set(["announced"])

/**
 * A drag card's result: one line per drag check, `–` before the first press. A
 * missed check is coloured, and a line too long for the card ends in an ellipsis
 * with its whole text as the value's tooltip. The checks are recomputed once per
 * drag run. A scenario with no watched children (scenario 14's items) has no `child
 * glued` line, and a `<Reorder>` scenario's reorder lines follow the drag lines, as a
 * free item's `fling` and `rests` lines do (scenario 13, #139: `–` for its other item's runs).
 */
const DragResult = (props: DragResultProps): JSX.Element => {
  const checks = createMemo(() =>
    props.run === undefined
      ? undefined
      : [
          ...dragChecksOf(props.run, props.expect ?? {}),
          ...reorderChecksOf(props.run, props.reorderExpect ?? {}),
          ...flingChecksOf(props.run, props.flingExpect),
        ],
  )
  // `reorderExpect` is static: a reorder scenario's card always has its lines, and no child glue.
  const names: ReadonlyArray<string> = [
    ...(props.reorderExpect === undefined
      ? DRAG_CHECK_NAMES
      : [...DRAG_CHECK_NAMES.filter((name) => name !== "child glued"), ...REORDER_CHECK_NAMES]),
    ...(props.flingExpect === undefined ? [] : FLING_CHECK_NAMES),
  ]
  return (
    <footer class="card-result drag" aria-live="polite">
      <For each={names}>
        {(name) => {
          const check = () => checks()?.find((c) => c.name === name)
          return (
            <div class="result-cell">
              <span class="result-label">{name}</span>
              <span class="result-value" classList={{ "check-miss": check()?.ok === false, wraps: WRAPPING_LINES.has(name) }} title={check()?.text}>
                {check()?.text ?? "–"}
              </span>
            </div>
          )
        }}
      </For>
    </footer>
  )
}

/** Whether the at-rest run is a drag scenario's latest run: newer than its last drag run. */
const restIsLatest = (rest: RestRun | undefined, drag: DragRun | undefined): boolean =>
  rest !== undefined && (drag === undefined || rest.startedAt > drag.grabAt)

/**
 * An at-rest run's result (#144): its four lines, each missed one coloured, as the drag
 * lines are. Props are static values; `run` is a tracked prop getter.
 */
const RestResult = (props: { readonly run: RestRun | undefined; readonly expect: RestExpect | undefined }): JSX.Element => {
  const checks = createMemo(() => (props.run === undefined ? undefined : restChecksOf(props.run, props.expect ?? {})))
  return (
    <footer class="card-result drag" aria-live="polite">
      <For each={REST_CHECK_NAMES}>
        {(name) => {
          const check = () => checks()?.find((c) => c.name === name)
          return (
            <div class="result-cell">
              <span class="result-label">{name}</span>
              <span class="result-value" classList={{ "check-miss": check()?.ok === false, wraps: WRAPPING_LINES.has(name) }} title={check()?.text}>
                {check()?.text ?? "–"}
              </span>
            </div>
          )
        }}
      </For>
    </footer>
  )
}

/**
 * A board card's result (#47): the last run's cell and gesture, then its `start` and `end`
 * lines, `–` before the first run. Props are static values; `run` is a tracked prop getter.
 */
const BoardResult = (props: { readonly run: BoardRunInput | undefined; readonly lines: ReadonlyArray<BoardCheck["name"]> }): JSX.Element => {
  const checks = createMemo(() => (props.run === undefined ? undefined : boardChecksOf(props.run)))
  return (
    <footer class="card-result drag" aria-live="polite">
      <div class="result-cell">
        <span class="result-label">cell</span>
        <span class="result-value">{props.run === undefined ? "–" : `${props.run.cell} · ${props.run.kind}`}</span>
      </div>
      <For each={props.lines}>
        {(name) => {
          const check = () => checks()?.find((c) => c.name === name)
          return (
            <div class="result-cell">
              <span class="result-label">{name}</span>
              <span class="result-value" classList={{ "check-miss": check()?.ok === false, wraps: WRAPPING_LINES.has(name) }} title={check()?.text}>
                {check()?.text ?? "–"}
              </span>
            </div>
          )
        }}
      </For>
    </footer>
  )
}

/** framesToMeasure as text: `–` before any run, `?` when no measure span was seen. */
const formatFrames = (run: LabRun | undefined): string => {
  if (run === undefined) return "–"
  return run.framesToMeasure === null ? "?" : String(run.framesToMeasure)
}

/**
 * Issue #14's hold and the Clock start as text, e.g. `1 · cold`: `–` before any
 * run, `?` when the run's anchor was never seen or nothing moved after it. Given
 * the scenario's `expected` hold, it adds the check: `0 · warm ✓`, or
 * `1 · cold ✗ expected 0` (see `heldCheckOf`).
 */
export const formatHeld = (run: LabRun | undefined, expected?: ExpectedHeld): string => {
  if (run === undefined) return "–"
  const held = run.heldFrames === null ? "?" : String(run.heldFrames)
  const text = run.clock === null ? held : `${held} · ${run.clock}`
  const check = heldCheckOf(expected, run.heldFrames, run.clock)
  if (check === undefined) return text
  return check.ok ? `${text} ✓` : `${text} ✗ expected ${check.expected}`
}

/** Whether the run's hold missed the scenario's expectation (the held cell is then coloured). */
const heldMissed = (run: LabRun | undefined, expected: ExpectedHeld | undefined): boolean =>
  run !== undefined && heldCheckOf(expected, run.heldFrames, run.clock)?.ok === false

/** The run's Measure passes as text, e.g. `2 (1 seeding)`: `–` before any run. */
const formatRunPasses = (run: LabRun | undefined): string =>
  run === undefined ? "–" : formatPasses(measurePassesOf(run.spans, run.triggerAt))

/** `firstSteps` as text, e.g. `5.1 10.7 13.7`: `–` before any run, `none` when nothing moved. */
const formatSteps = (run: LabRun | undefined): string => {
  if (run === undefined) return "–"
  return run.firstSteps.length === 0 ? "none" : run.firstSteps.map((s) => s.toFixed(1)).join(" ")
}

/** `passStepRatio` as text, e.g. `0.97`: `–` before any run, `n/a` when it is `null`. */
const formatRatio = (run: LabRun | undefined): string => {
  if (run === undefined) return "–"
  return run.passStepRatio === null ? "n/a" : run.passStepRatio.toFixed(2)
}

/** A CSS-safe class suffix for an outcome (`n/a` has a slash). */
const outcomeClass = (run: LabRun | undefined): string => {
  if (run === undefined) return "none"
  return run.outcome === "n/a" ? "na" : run.outcome
}
