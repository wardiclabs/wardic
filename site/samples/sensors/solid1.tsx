import { createDrag, createHover, createWardic, domAnimation, drag } from "@wardic/solid/v1"
import { createSignal, Show } from "solid-js"

// This page drags: its own Wardic instance brings `drag`, so pages that don't never load it.
const { w } = createWardic([domAnimation, drag])

/** A card's hover and drag, read as state: Solid 1's sensors take the element itself. */
export default function Sensors() {
  const [card, setCard] = createSignal<HTMLElement>()
  return (
    <div class="sample-stack">
      <w.div class="sample-card" ref={setCard} whileHover={{ scale: 1.04 }} drag="x" dragSnapToOrigin dragElastic={0.3}>
        Drag me
      </w.div>
      <Show when={card()}>{(element) => <Readout card={element()} />}</Show>
    </div>
  )
}

/** The card's hover and drag, read where its element exists. */
function Readout(props: { readonly card: HTMLElement }) {
  const hovered = createHover(props.card)
  // `claim: false`: the card's own drag moves it, and this only reads the gesture.
  const dragged = createDrag(props.card, { claim: false })
  return (
    <p class="sample-note">
      <Show when={hovered()} fallback="Away">
        Over
      </Show>
      , dragged {Math.round(dragged()?.offset.x ?? 0)}px
    </p>
  )
}
