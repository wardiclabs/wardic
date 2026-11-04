import { createScroll, w } from "@wardic/solid"
import { For } from "solid-js"

const LINES = [
  "The kiln is cooling.",
  "Twelve bowls went in this morning, glazed in lagoon blue.",
  "By evening the glaze has run and pooled where the walls meet the foot.",
  "Each one comes out a little different from the last.",
  "Two have crazed: fine lines all over, like ice on a pond.",
  "One cracked in the cooling, and goes on the shelf by the door.",
  "The rest are wrapped in paper and packed for the morning post.",
]

/** A panel's scroll, shown as a bar across its top: the bar is the scroll itself, with no animation of its own. */
export default function Story() {
  let panel!: HTMLDivElement
  // How far the panel is scrolled, from 0 to 1. Without `container`, it's the page's.
  const { scrollYProgress } = createScroll({ container: () => panel })
  return (
    <div class="sample-scroller">
      <w.div class="sample-progress" style={{ scaleX: scrollYProgress }} />
      <div class="sample-scroll" ref={panel} tabindex="0" aria-label="From the studio">
        <For each={LINES}>{(line) => <p>{line}</p>}</For>
      </div>
    </div>
  )
}
