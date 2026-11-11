import { createBatch } from "@wardic/solid"
import { createSignal, For, onCleanup, onMount } from "solid-js"
import { framesPerSecond } from "../frames.ts"
import { colorOf, DEPTH, HEIGHT, LEAVES, leafAt, WIDTH } from "./triangle.ts"

const LEAF_INDICES: ReadonlyArray<number> = Array.from({ length: LEAVES }, (_, i) => i)
const SPRING = { type: "spring", visualDuration: 0.5, bounce: 0.25 } as const

/** Sierpiński's triangle in 2,187 leaves, one Batch: a new depth moves every leaf in one change. */
export default function Sierpinski() {
  const [depth, setDepth] = createSignal(0)
  const [moving, setMoving] = createSignal(false)
  const [fps, setFps] = createSignal<number>()
  // Its entrance climbs a level every 0.7 s, to 5, until the slider takes over.
  let climb: ReturnType<typeof setInterval> | undefined
  onMount(() => {
    let steps = 0
    climb = setInterval(() => {
      steps++
      setDepth(steps)
      if (steps === 5) clearInterval(climb)
    }, 700)
    onCleanup(framesPerSecond(setFps))
  })
  onCleanup(() => clearInterval(climb))
  const leaves = createBatch({
    count: LEAVES,
    initial: false,
    animate: (i) => leafAt(i, depth()),
    transition: SPRING,
    onAnimationStart: () => setMoving(true),
    onAnimationComplete: () => setMoving(false),
  })
  return (
    <div class="sample-stack">
      <div class="sample-sierpinski" style={{ width: `${WIDTH}px`, height: `${HEIGHT}px` }}>
        <For each={LEAF_INDICES}>{(i) => <div class="sample-leaf" {...leaves.at(i, { style: { background: colorOf(i) } })} />}</For>
      </div>
      <label class="sample-range">
        Depth {depth()} · {(3 ** depth()).toLocaleString("en")} triangles
        <input
          type="range"
          min="0"
          max={DEPTH}
          value={depth()}
          onInput={(event) => {
            clearInterval(climb)
            setDepth(event.currentTarget.valueAsNumber)
          }}
        />
      </label>
      <p class="sample-note">
        {LEAVES.toLocaleString("en")} elements · {moving() ? "Moving…" : "Ready"} · {fps() ?? "–"} fps
      </p>
    </div>
  )
}
