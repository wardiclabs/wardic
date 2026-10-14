/**
 * The scenario contract: what a layout-lab scenario is, and the context the lab
 * hands it.
 *
 * A scenario is one way a layout change can reach Wardic's Measure pass (a click
 * writing `layoutDependency`, a ResizeObserver delivery, a write inside rAF, and so
 * on). The lab samples the watched element's painted box after every frame and
 * reports whether the destination box was painted before the FLIP started (a
 * "flash", issue #2), how many frames it held at the origin, and how it moved.
 *
 * A drag scenario (`kind: "drag"`, issue #26) is driven by hand instead: grab the
 * item, hold it still or move it, release it. It has no Run button and never calls
 * `markTrigger`. Its recorder samples each press and hands the lab one
 * `DragRunInput` through `recordDragRun`, and the card checks the resulting
 * `DragRun` against the scenario's `dragExpect` (see `lab/drag-run.ts`).
 *
 * Scenario rules (every scenario must follow all of them):
 *
 * 1. The watched element (in a drag scenario, the dragged item's slot) moves or
 *    resizes by at least 40px per run, so the sampler can tell origin, destination
 *    and every FLIP frame apart.
 * 2. The mutation stays inside a fixed-size `.stage` (see styles.css). Nothing
 *    outside the stage reflows, so no other scenario's box moves.
 * 3. The View root carries `data-scenario={id}`, so a scripted smoke run can find
 *    the scenario.
 * 4. A trigger scenario's Run button carries `data-action="run"`; a drag
 *    scenario's drag handle carries `data-action="drag"`.
 * 5. Props are static. A View takes `{ ctx }` as a plain value; reactive values
 *    are Solid Accessors created inside the View, never `MaybeAccessor` props.
 *
 * @module
 */
import type { Component } from "solid-js"
import type { BoardCheck, BoardRunInput } from "../lab/base-values-board.ts"
import type { DragExpect, DragRunInput, FlingExpect } from "../lab/drag-run.ts"
import type { ReorderExpect } from "../lab/reorder-run.ts"
import type { RestExpect, RestRunInput } from "../lab/rest-run.ts"

/**
 * What the scenario author expects before running it.
 *
 * - `safe`: the Measure pass runs, and its seed is applied, before the first paint
 *   that could show the destination box, so no flash is expected.
 * - `flash-risk`: at least one paint is expected to show the destination box
 *   before the FLIP starts.
 * - `unknown`: the timing depends on something the author cannot predict (for
 *   example Effect's scheduler), so the lab result is the answer.
 */
export type Prediction = "safe" | "flash-risk" | "unknown"

/** JSON-safe facts a scenario attaches to a run at trigger time (see `markTrigger`). */
export type TriggerMeta = Readonly<Record<string, string | number | boolean>>

/**
 * The lab-side hooks a scenario View receives. One context is bound to one
 * scenario id, and every mark or run it starts is attributed to that id.
 */
export interface ScenarioContext {
  /**
   * Registers `el` as the scenario's watched element: the element whose painted
   * box the sampler follows. Call it from the element's `ref`.
   *
   * It may be called again mid-run to follow a replacement element (for example
   * the newly mounted twin in a `layoutId` switch). The active run then samples
   * the new element from the next painted frame on.
   */
  readonly watch: (el: HTMLElement) => void
  /**
   * Starts a run. Call it IMMEDIATELY BEFORE the layout-mutating write, in the
   * execution context the scenario is testing (the click handler, the observer
   * callback, the rAF callback, and so on). Never call it earlier or from a
   * different task. A drag scenario never calls it (see {@link recordDragRun}).
   *
   * It synchronously snapshots the watched element's origin box, starts a
   * sampling run, and drops a `trigger` mark labelled `source` on the timeline.
   * The run records `source` as its `trigger`, and `meta` (if given) as its
   * `triggerMeta`, so a saved log says what each run was set up with.
   *
   * @param source a short label naming the trigger path, e.g. `"click"`.
   * @param meta JSON-safe facts about the run's setup, read at trigger time (e.g.
   *   scenario 7's container scroll offsets).
   */
  readonly markTrigger: (source: string, meta?: TriggerMeta) => void
  /**
   * Drops an auxiliary `note` mark on the timeline, labelled `label`. It starts
   * no run. Use it for the steps that lead up to the trigger (for example the
   * click that resizes an observed driver element).
   */
  readonly mark: (label: string) => void
  /**
   * Subscribes `cb` to the end of each `wardic.projection.coordinator` span, the
   * closest proxy the lab has for "a layout animation finished" (Wardic exposes no
   * layout-animation-complete callback).
   *
   * @returns an unsubscribe function. Call it in `onCleanup`, or as soon as the
   * callback has done its job.
   */
  readonly onLayoutAnimationComplete: (cb: () => void) => () => void
  /**
   * Records one press of a drag scenario (issue #26): call it once per press, after
   * the release has settled (or the press ended without one), with everything the
   * recorder sampled. The lab joins the `wardic.*` spans that started in
   * `[input.grabAt, input.endedAt]` from its timeline, reads a `DragRun` from both
   * (`dragRunOf` in `lab/drag-run.ts`), attributes it to this context's scenario id,
   * keeps it (the same cap as runs), and notifies `Lab.subscribeDragRuns`. It starts
   * no sampling run and drops no mark.
   */
  readonly recordDragRun: (input: DragRunInput) => void
  /**
   * Records one gesture on a board scenario's cell (#47, scenario 15): call it once the
   * gesture's value has stood still, with what its recorder sampled. The lab keeps it (the
   * same cap as runs), attributes it to this context's scenario id and notifies
   * `Lab.subscribeBoardRuns`. It starts no sampling run and drops no mark.
   */
  readonly recordBoardRun: (input: Omit<BoardRunInput, "scenarioId">) => void
  /**
   * Records one at-rest run (#144, scenario 12's X): call it once the change's layout
   * animations have stood still, with what the drag recorder sampled (`recordAtRest`). The lab
   * reads a `RestRun` from it (`restRunOf` in `lab/rest-run.ts`), keeps it (the same cap as
   * runs), attributes it to this context's scenario id and notifies `Lab.subscribeRestRuns`. It
   * starts no sampling run and drops no mark.
   */
  readonly recordRestRun: (input: RestRunInput) => void
}

/** A scenario's expected hold (see {@link ScenarioDef.expectedHeld}). */
export type ExpectedHeld = NonNullable<ScenarioDef["expectedHeld"]>

/** One scenario definition: its metadata plus the View the lab mounts. */
export interface ScenarioDef {
  /** A unique kebab-case id. It is also the View root's `data-scenario` value. */
  readonly id: string
  /** The display order: 1 and up for the numbered scenarios, 0 for free-play. */
  readonly index: number
  /**
   * How the scenario is run: `trigger` (the default) has a Run button that calls
   * `markTrigger`, and the lab samples the watched element; `drag` is driven by hand
   * (grab, hold or move, release), records one run per press through
   * `recordDragRun`, and its card shows the drag checks instead of the trigger
   * results; `board` (#47) is a set of cells driven by hand, records one run per gesture
   * through `recordBoardRun`, and its card shows the last run's checks.
   */
  readonly kind?: "trigger" | "drag" | "board"
  /** A short human-readable title. */
  readonly title: string
  /** One line naming what schedules the layout-mutating write. */
  readonly mechanism: string
  /** The author's expectation, stated before any run. */
  readonly prediction: Prediction
  /** Why the author expects that: the event-loop reasoning behind the prediction. */
  readonly rationale: string
  /**
   * What the run's `heldFrames` (issue #14) counts from: `measure` (the default) is
   * the first `wardic.projection.measure` pass after the trigger; `trigger` is for
   * a scenario with no measure pass (scenario 9's spring).
   */
  readonly heldFramesFrom?: "measure" | "trigger"
  /**
   * The `heldFrames` the author expects (issues #2 and #14), which the card checks
   * every run against: `held 0 · warm ✓`, or `held 1 · cold ✗ expected 0`. A number
   * holds for either Clock start; `{ cold, warm }` gives one per Clock start (see
   * `heldCheckOf` in `lab/held-frames.ts`). Left out, the card shows no check (free
   * play, whose timing depends on the selection).
   *
   * A layout change made in an ordinary task (a click, an IntersectionObserver
   * callback) is measured at the end of that task, and its first painted frame is
   * already one step along: 0. One made after the frame's tick (a ResizeObserver
   * callback, a later rAF callback, the Clock's callback, an effect inside the gate's
   * flush) paints the origin in that frame and moves on the next: 1. Both hold cold or
   * warm (ADR-0018, ADR-0033).
   */
  readonly expectedHeld?: number | { readonly cold: number; readonly warm: number }
  /**
   * What a drag scenario expects of every press, which the card checks each drag run
   * against (see `dragChecksOf` in `lab/drag-run.ts`). Left out, the card shows the
   * numbers with no check. A trigger scenario leaves it out.
   */
  readonly dragExpect?: DragExpect
  /**
   * What a `<Reorder>` drag scenario expects of every press, which the card's reorder
   * lines check (scenario 14, see `reorderChecksOf` in `lab/reorder-run.ts`). Given,
   * the card shows those lines after the drag lines.
   */
  readonly reorderExpect?: ReorderExpect
  /**
   * What a drag scenario with a free item expects of its release (#139, scenario 13's free
   * box), which the card's `fling` and `rests` lines check (see `flingChecksOf` in
   * `lab/drag-run.ts`). Given, the card shows those lines after the drag lines.
   */
  readonly flingExpect?: FlingExpect
  /**
   * What a drag scenario expects of every at-rest run (#144, scenario 12's X), which the card
   * checks each one against (see `restChecksOf` in `lab/rest-run.ts`) when it is the scenario's
   * latest run.
   */
  readonly restExpect?: RestExpect
  /**
   * The lines a board scenario's card shows (#5): scenario 15's (`BOARD_CHECK_NAMES`) when left
   * out, scenario 16's crossfade lines (`CROSSFADE_CHECK_NAMES`) for its runs.
   */
  readonly boardLines?: ReadonlyArray<BoardCheck["name"]>
  /**
   * The scenario's UI: a `.stage` holding the watched element, and a Run button (a
   * drag scenario: its drag handle). It receives its context as a static prop (see
   * the scenario rules above).
   */
  readonly View: Component<{ readonly ctx: ScenarioContext }>
}
