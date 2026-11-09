/**
 * The Measure passes that answered a run (ADR-0018): its `wardic.projection.measure`
 * spans that started at or after the trigger, and how many of them seeded a node.
 *
 * The engine records one span per Measure pass and annotates it with `nodes`,
 * `active`, `seeded` (the nodes that started or restarted a layout animation in
 * the pass), `stepped` (the nodes it took the first step of itself, as a pass after
 * its frame's tick does, ADR-0018 *Amendment (#673)*) and `rounds`. The lab copies a span's attributes when it ends
 * (`probe/timeline.ts`), so a span still in flight reads `{}` and counts as not
 * seeding. A pass that seeds nothing is one that found nothing to animate, such as
 * the engine ResizeObserver's first delivery for a newly observed node (scenario 7:
 * `passes 2 (1 seeding)`, until that delivery is filtered).
 *
 * Pure (no DOM), so the node test tier imports it (`test/measure-passes.test.ts`).
 *
 * @module
 */
import type { SpanRecord } from "../probe/timeline.ts"

/** The span that marks one Measure pass. */
const MEASURE_SPAN = "wardic.projection.measure"

/** A run's Measure passes (see the module doc). */
export interface MeasurePasses {
  /** How many Measure passes started at or after the trigger. */
  readonly count: number
  /** How many of those seeded at least one node (`attributes.seeded > 0`). */
  readonly seeding: number
  /** How many of those took a node's first step themselves (`attributes.stepped > 0`, #673). */
  readonly stepping: number
  /** Their start times, oldest first (`performance.now()`, ms). */
  readonly starts: ReadonlyArray<number>
}

/**
 * The Measure passes among `spans` that started at or after `triggerAt`. `>=`, not
 * `>`: Firefox coarsens `performance.now()` to whole milliseconds, so a pass can
 * start in the trigger's own millisecond. `spans` are in start order, as the
 * timeline records them.
 */
export const measurePassesOf = (spans: ReadonlyArray<SpanRecord>, triggerAt: number): MeasurePasses => {
  const starts: Array<number> = []
  let seeding = 0
  let stepping = 0
  for (const span of spans) {
    if (span.name !== MEASURE_SPAN || span.start < triggerAt) continue
    starts.push(span.start)
    const seeded = span.attributes.seeded
    if (typeof seeded === "number" && seeded > 0) seeding++
    const stepped = span.attributes.stepped
    if (typeof stepped === "number" && stepped > 0) stepping++
  }
  return { count: starts.length, seeding, stepping, starts }
}

/**
 * The card's `passes` text: `2 (1 seeding)`, `1 (1 seeding, 1 stepped)` when a pass took
 * its nodes' first step itself (after its frame's tick, #673), or `0` for a run no
 * Measure pass answered (scenario 9's spring).
 */
export const formatPasses = (passes: MeasurePasses): string => {
  if (passes.count === 0) return "0"
  if (passes.stepping === 0) return `${passes.count} (${passes.seeding} seeding)`
  return `${passes.count} (${passes.seeding} seeding, ${passes.stepping} stepped)`
}
