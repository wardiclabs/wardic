import { LazyWardic, w } from "@wardic/solid/unstable/v2"
import { createSignal, Show } from "solid-js"

/** A ball that drags once you ask: the page fetches `drag` on the press, not with itself. */
export default function Shipping() {
  const [wanted, setWanted] = createSignal(false)
  // How long `drag` took to arrive, from the press: absent until it has.
  const [arrivedIn, setArrivedIn] = createSignal<number>()
  let arena!: HTMLDivElement
  let pressedAt = 0

  // The section's Features, as a function: it runs as the section renders, so on the press.
  const loadDrag = async () => {
    const { drag } = await import("./drag-feature.ts")
    setArrivedIn(Math.round(performance.now() - pressedAt))
    return drag
  }

  const load = () => {
    pressedAt = performance.now()
    setWanted(true)
  }

  return (
    <div class="sample-stack">
      <button class="sample-button" disabled={wanted()} onClick={load}>
        Load drag
      </button>
      <div class="sample-arena" ref={arena}>
        <Show when={wanted()} fallback={<div class="sample-ball" />}>
          <LazyWardic features={loadDrag}>
            <w.div class="sample-ball" drag dragConstraints={() => arena} whileDrag={{ scale: 1.15 }} />
          </LazyWardic>
        </Show>
      </div>
      <p class="sample-note" aria-live="polite">
        <Show when={wanted()} fallback={<>No drag yet: the ball stays put.</>}>
          <Show when={arrivedIn() !== undefined} fallback={<>Loading drag…</>}>
            Drag arrived in {arrivedIn()} ms.
          </Show>
        </Show>
      </p>
    </div>
  )
}
