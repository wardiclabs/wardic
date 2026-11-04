import { layout, LazyWardic, w } from "@wardic/solid/unstable/v2"
import { createSignal } from "solid-js"

/** A switch: the stylesheet moves its knob across, and `layout` animates the move. */
export default function Switch() {
  const [on, setOn] = createSignal(false)
  return (
    // This page lays out, so it brings `layout` itself: pages that don't never load it.
    <LazyWardic features={[layout]}>
      <button class="sample-switch" role="switch" aria-checked={on() ? "true" : "false"} aria-label="Lights" onClick={() => setOn(!on())}>
        {/* Nothing re-renders in Solid: `layoutDependency` says when to look for a move. */}
        <w.span class="sample-knob" layout layoutDependency={on()} transition={{ type: "spring", stiffness: 500, damping: 30 }} />
      </button>
    </LazyWardic>
  )
}
