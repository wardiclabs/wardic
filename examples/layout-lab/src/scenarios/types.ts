/**
 * The scenario contract: what a layout-lab scenario is, and the context the lab
 * hands it.
 *
 * A scenario is one way a layout change can reach Wardic's measure pass (a click
 * writing `layoutDependency`, a ResizeObserver delivery, a write inside rAF, and so
 * on). The lab samples the watched element's painted box after every frame and
 * reports whether the destination box was painted before the FLIP started (a
 * "flash").
 *
 * Scenario rules (every scenario must follow all of them):
 *
 * 1. The watched element moves or resizes by at least 40px per run, so the
 *    sampler can tell origin, destination and every FLIP frame apart.
 * 2. The mutation stays inside a fixed-size `.stage` (see styles.css). Nothing
 *    outside the stage reflows, so no other scenario's box moves.
 * 3. The View root carries `data-scenario={id}`, so a scripted smoke run can find
 *    the scenario.
 * 4. The Run button carries `data-action="run"`.
 * 5. Props are static. A View takes `{ ctx }` as a plain value; reactive values
 *    are Solid Accessors created inside the View, never `MaybeAccessor` props.
 *
 * @module
 */
import type { Component } from "solid-js"

/**
 * What the scenario author expects before running it.
 *
 * - `safe`: the measure pass runs before the frame that would show the
 *   destination box, so no flash is expected.
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
   * different task.
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
}

/** One scenario definition: its metadata plus the View the lab mounts. */
export interface ScenarioDef {
  /** A unique kebab-case id. It is also the View root's `data-scenario` value. */
  readonly id: string
  /** The display order: 1-9 for the numbered scenarios, 0 for free-play. */
  readonly index: number
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
   * The scenario's UI: a `.stage` holding the watched element, and a Run button.
   * It receives its context as a static prop (see the scenario rules above).
   */
  readonly View: Component<{ readonly ctx: ScenarioContext }>
}
