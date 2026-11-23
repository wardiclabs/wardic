import { colourOf, FAMILIES, type FamilyId, familyName, type Glaze } from "@wardic/example-storefront-shared/glazes"
import { type GlazeYear, highest, type MeasureId, MEASURES, YEAR } from "@wardic/example-storefront-shared/year"
import { AnimatePresence, createBatch, stagger } from "@wardic/solid"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"

/** The plot's edges in the chart's own units: room on the left for the axis's numbers, below for its words. */
const PLOT = { left: 52, right: 620, top: 16, bottom: 312 }

/** Across: the palest glazes on the left, the darkest on the right. */
const xOf = (glaze: Glaze) => PLOT.left + ((92 - glaze.lightness) / 82) * (PLOT.right - PLOT.left)

/** The studio's year, a glaze a point: one Batch of SVG circles, a measure or a family one change for all of them. */
export default function StudioYear() {
  const [measure, setMeasure] = createSignal<MeasureId>("sold")
  const [family, setFamily] = createSignal<FamilyId | "all">("all")
  const [hovered, setHovered] = createSignal<GlazeYear>()
  const shown = createMemo(() => YEAR.filter((one) => family() === "all" || one.glaze.family === family()))
  const top = createMemo(() => highest(measure()))
  const yOf = (one: GlazeYear) => PLOT.bottom - (one[measure()] / top()) * (PLOT.bottom - PLOT.top)

  // Keyed by glaze: a new measure moves every point up or down in one change, from where it is;
  // a family picked shrinks the rest away, and brings them back from the axis.
  const points = createBatch({
    each: shown,
    key: (one) => one.glaze.id,
    initial: (one) => ({ x: xOf(one.glaze), y: PLOT.bottom, scale: 0, opacity: 0 }),
    animate: (one) => ({ x: xOf(one.glaze), y: yOf(one), scale: 1, opacity: 1 }),
    transition: { type: "spring", visualDuration: 0.5, bounce: 0.2, delay: stagger(0.002) },
    exit: { scale: 0, opacity: 0, transition: { duration: 0.2, delay: stagger(0.002) } },
    whileHover: { scale: 2, transition: { duration: 0.15 } },
  })
  createEffect(points.when("hoverStart"), ({ item }) => {
    setHovered(item as GlazeYear)
  })
  createEffect(points.when("hoverEnd"), () => {
    setHovered(undefined)
  })

  const unit = () => MEASURES.find((one) => one.id === measure())!.unit
  const said = (one: GlazeYear) => `${unit()}${one[measure()]}`

  return (
    <figure class="chart">
      <div class="chart-tools">
        <div class="segmented chart-measures" role="group" aria-label="Measure">
          <For each={MEASURES}>
            {(one) => (
              <button aria-pressed={measure() === one.id ? "true" : "false"} onClick={() => setMeasure(one.id)}>
                {one.name}
              </button>
            )}
          </For>
        </div>
        <div class="chips" role="group" aria-label="Family">
          <For each={[{ id: "all", name: "All" } as const, ...FAMILIES]}>
            {(one) => (
              <button class="chip" aria-pressed={family() === one.id ? "true" : "false"} onClick={() => setFamily(one.id)}>
                {one.name}
              </button>
            )}
          </For>
        </div>
      </div>
      <svg class="chart-plot" viewBox="0 0 640 352" aria-hidden="true">
        <line class="chart-axis" x1={PLOT.left} y1={PLOT.bottom} x2={PLOT.right} y2={PLOT.bottom} />
        <line class="chart-axis" x1={PLOT.left} y1={PLOT.top} x2={PLOT.left} y2={PLOT.bottom} />
        <For each={[0, 0.5, 1]}>
          {(share) => (
            <text class="chart-tick" x={PLOT.left - 8} y={PLOT.bottom - share * (PLOT.bottom - PLOT.top) + 4} text-anchor="end">
              {unit()}
              {Math.round(share * top())}
            </text>
          )}
        </For>
        <text class="chart-tick" x={PLOT.left} y={PLOT.bottom + 26}>
          ← paler glazes
        </text>
        <text class="chart-tick" x={PLOT.right} y={PLOT.bottom + 26} text-anchor="end">
          darker glazes →
        </text>
        {/* A leaving point's circle stays until its exit lands. */}
        <AnimatePresence>
          <For each={shown()}>{(one) => <circle class="chart-point" r="4" fill={colourOf(one.glaze)} {...points.member(one.glaze.id)} />}</For>
        </AnimatePresence>
      </svg>
      <figcaption class="chart-caption">
        <Show when={hovered()} fallback={<span class="muted">Point at a glaze to read it.</span>}>
          {(one) => (
            <>
              <span class="glaze-chip" style={{ background: colourOf(one().glaze) }} />
              <strong>{one().glaze.name}</strong> · {MEASURES.find((each) => each.id === measure())!.name.toLowerCase()}: {said(one())}
            </>
          )}
        </Show>
      </figcaption>
      {/* The chart as a table, for a screen reader, or to read the numbers. */}
      <details class="chart-numbers">
        <summary>The numbers</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Glaze</th>
              <th scope="col">Family</th>
              <th scope="col">{MEASURES.find((one) => one.id === measure())!.name}</th>
            </tr>
          </thead>
          <tbody>
            <For each={shown()}>
              {(one) => (
                <tr>
                  <td>{one.glaze.name}</td>
                  <td>{familyName(one.glaze.family)}</td>
                  <td>{said(one)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </details>
    </figure>
  )
}
