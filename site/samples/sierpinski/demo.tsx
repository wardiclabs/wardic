/**
 * The Sierpiński page's demo (#665's PR 7, Q24): the sample, one Batch, beside the same triangle with a
 * Wardic element per leaf, to compare their frames. Not a code tab: the tabs show the bindings' files.
 */
import { w } from "@wardic/solid/unstable/v2"
import { createSignal, For, onSettled, Show } from "solid-js"
import { framesPerSecond } from "../frames.ts"
import Sierpinski, { SPRING } from "./solid2.tsx"
import { colorOf, DEPTH, HEIGHT, LEAVES, leafAt, WIDTH } from "./triangle.ts"

const LEAF_INDICES: ReadonlyArray<number> = Array.from({ length: LEAVES }, (_, i) => i)

/** The same triangle with a ward per leaf, on the sample's spring: each depth retargets 2,187 elements, each on its own. */
function WardEach() {
  const [depth, setDepth] = createSignal(0)
  const [fps, setFps] = createSignal<number>()
  let climb: ReturnType<typeof setInterval> | undefined
  onSettled(() => {
    let steps = 0
    climb = setInterval(() => {
      steps++
      setDepth(steps)
      if (steps === 5) clearInterval(climb)
    }, 700)
    const stopFrames = framesPerSecond(setFps)
    return () => {
      clearInterval(climb)
      stopFrames()
    }
  })
  return (
    <div class="sample-stack">
      <div class="sample-sierpinski" style={{ width: `${WIDTH}px`, height: `${HEIGHT}px` }}>
        <For each={LEAF_INDICES}>
          {(i) => <w.div class="sample-leaf" style={{ color: colorOf(i) }} initial={false} animate={leafAt(i, depth())} transition={SPRING} />}
        </For>
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
      <p class="sample-note">{LEAVES.toLocaleString("en")} Wardic elements · {fps() ?? "–"} fps</p>
    </div>
  )
}

export default function Demo() {
  const [batched, setBatched] = createSignal(true)
  return (
    <div class="sample-stack">
      <div class="sample-tabs" role="group" aria-label="Animated as">
        <button class="sample-tab" aria-pressed={batched() ? "true" : "false"} onClick={() => setBatched(true)}>
          One Batch
        </button>
        <button class="sample-tab" aria-pressed={batched() ? "false" : "true"} onClick={() => setBatched(false)}>
          A ward each
        </button>
      </div>
      <Show when={batched()} fallback={<WardEach />}>
        <Sierpinski />
      </Show>
    </div>
  )
}
