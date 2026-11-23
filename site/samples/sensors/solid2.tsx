import { createDrag, createHover, createWardic, domAnimation, drag } from "@wardic/solid"
import { Show } from "solid-js"

// This page drags: its own Wardic instance brings `drag`, so pages that don't never load it.
const { w } = createWardic([domAnimation, drag])

/** A card's hover and drag, read as state: the sensors hear the card's own gestures, through its ward. */
export default function Sensors() {
  const card = w.ward({ whileHover: { scale: 1.04 }, drag: "x", dragSnapToOrigin: true, dragElastic: 0.3 })
  const hovered = createHover(card)
  const dragged = createDrag(card)
  return (
    <div class="sample-stack">
      <div class="sample-card" {...card}>
        Drag me
      </div>
      <p class="sample-note">
        <Show when={hovered()} fallback="Away">
          Over
        </Show>
        , dragged {Math.round(dragged()?.offset.x ?? 0)}px
      </p>
    </div>
  )
}
