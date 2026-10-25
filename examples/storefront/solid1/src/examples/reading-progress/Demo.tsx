import { LAGOON_ARTICLE } from "@wardic/example-storefront-shared/stories"
import { createScroll, createTransform, wardic } from "@wardic/solid"
import { For } from "solid-js"

export default function ReadingProgress() {
  let panel!: HTMLDivElement
  // How far the article's panel is scrolled, from 0 to 1. Without `container`, it's the page's.
  const { scrollYProgress } = createScroll({ container: () => panel })
  // The minutes left, read from the same progress.
  const minutesLeft = createTransform(scrollYProgress, [0, 1], [LAGOON_ARTICLE.minutes, 0])

  return (
    <div class="reading">
      <div class="reading-head">
        <strong>{LAGOON_ARTICLE.title}</strong>
        <span class="muted" aria-live="polite">
          {Math.ceil(minutesLeft())} min left
        </span>
      </div>
      {/* The bar is the scroll itself, scaled across from its left edge: no animation of its own. */}
      <wardic.div class="reading-bar" style={{ scaleX: scrollYProgress }} />
      <div class="reading-panel" ref={panel} tabindex="0" aria-label={LAGOON_ARTICLE.title}>
        <For each={LAGOON_ARTICLE.sections}>
          {(section) => (
            <section>
              <h3>{section.heading}</h3>
              <For each={section.paragraphs}>{(paragraph) => <p>{paragraph}</p>}</For>
            </section>
          )}
        </For>
      </div>
    </div>
  )
}
