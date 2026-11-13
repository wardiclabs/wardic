import { AnimatePresence, createBatch, stagger } from "@wardic/solid"
import { createMemo, createSignal, For } from "solid-js"

type Series = "Teal" | "Blue" | "Purple"
const SERIES: ReadonlyArray<{ readonly name: Series; readonly x: number; readonly y: number }> = [
  { name: "Teal", x: 100, y: 75 },
  { name: "Blue", x: 210, y: 65 },
  { name: "Purple", x: 160, y: 120 },
]
const PER_SERIES = 60
/** 180 points, 60 a series, each series a disc of points around its centre, from the middle out. */
const POINTS = SERIES.flatMap((series, s) =>
  Array.from({ length: PER_SERIES }, (_, k) => {
    const out = Math.sqrt((k + 0.5) / PER_SERIES)
    return { id: s * PER_SERIES + k, series: series.name, x: series.x + out * 48 * Math.cos(k * 2.4), y: series.y + out * 40 * Math.sin(k * 2.4) }
  }),
)
const FILTERS = ["All", "Teal", "Blue", "Purple"] as const

/** A scatter plot filtered by series: each point an SVG circle, the ones filtered out shrinking away. */
export default function Scatter() {
  const [filter, setFilter] = createSignal<(typeof FILTERS)[number]>("All")
  const shown = createMemo(() => POINTS.filter((point) => filter() === "All" || point.series === filter()))
  const points = createBatch({
    each: shown,
    key: "id",
    initial: { scale: 0, opacity: 0 },
    animate: () => ({ scale: 1, opacity: 1 }),
    whileHover: { scale: 1.8 },
    // stagger() counts the points entering together, and in `exit`, the points leaving together.
    transition: { type: "spring", visualDuration: 0.4, bounce: 0.35, delay: stagger(0.003) },
    exit: { scale: 0, opacity: 0, transition: { duration: 0.2, delay: stagger(0.003) } },
  })
  return (
    <div class="sample-stack">
      <div class="sample-tabs sample-filters" role="group" aria-label="Show">
        <For each={FILTERS}>
          {(name) => (
            <button class="sample-tab" aria-pressed={filter() === name ? "true" : "false"} onClick={() => setFilter(name)}>
              {name}
            </button>
          )}
        </For>
      </div>
      <svg class="sample-plot" viewBox="0 0 320 180" role="img" aria-label={`A scatter plot of ${shown().length} points`}>
        {/* A leaving point's circle stays until its exit lands. */}
        <AnimatePresence>
          <For each={shown()}>
            {(point) => <circle class="sample-scatter-point" data-series={point.series} cx={point.x} cy={point.y} r="4" {...points.member(point.id)} />}
          </For>
        </AnimatePresence>
      </svg>
      <p class="sample-note">
        {shown().length} of {POINTS.length}
      </p>
    </div>
  )
}
