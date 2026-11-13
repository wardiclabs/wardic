import { AnimatePresence, w } from "@wardic/solid/unstable/v2"
import { createSignal, For } from "solid-js"

/** Where point `id` sits on the 320 × 160 plot, spread evenly from its number, and which of four colours it takes. */
const pointAt = (id: number) => ({ cx: 20 + ((0.5 + id * 0.7549) % 1) * 280, cy: 20 + ((0.5 + id * 0.5698) % 1) * 120, tone: id % 4 })

/** Points on a plot that grow in and shrink out: an `<AnimatePresence>` inside an `<svg>`, its children SVG circles. */
export default function Plot() {
  const [points, setPoints] = createSignal([1, 2, 3, 4, 5, 6, 7, 8])
  let next = 9
  const add = () => setPoints((all) => [...all, next++])
  const remove = (point: number) => setPoints((all) => all.filter((one) => one !== point))
  return (
    <div class="sample-stack">
      <div class="sample-actions">
        <button class="sample-button" onClick={add}>
          Add
        </button>
        <button class="sample-button" disabled={points().length === 0} onClick={() => remove(points()[0])}>
          Remove
        </button>
      </div>
      <svg class="sample-plot" viewBox="0 0 320 160" role="img" aria-label={`A plot of ${points().length} points`}>
        <line x1="0" y1="53" x2="320" y2="53" />
        <line x1="0" y1="107" x2="320" y2="107" />
        {/* Each circle stays until its exit has shrunk it away. */}
        <AnimatePresence>
          <For each={points()}>
            {(point) => (
              <w.circle
                class="sample-point"
                data-tone={pointAt(point).tone}
                cx={pointAt(point).cx}
                cy={pointAt(point).cy}
                initial={{ r: 0, opacity: 0 }}
                animate={{ r: 9, opacity: 1 }}
                whileHover={{ r: 12 }}
                exit={{ r: 0, opacity: 0, transition: { duration: 0.25 } }}
                transition={{ type: "spring", visualDuration: 0.4, bounce: 0.4 }}
                onClick={() => remove(point)}
              />
            )}
          </For>
        </AnimatePresence>
      </svg>
      <p class="sample-note">Click a point to remove it.</p>
    </div>
  )
}
