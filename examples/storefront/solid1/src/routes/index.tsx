/** The showcase's gallery (#296 Q3): each area, with its examples. */
import { A } from "@solidjs/router"
import { AREAS, examplesIn, routeOf } from "@wardic/example-storefront-shared/examples"
import { CARD, TAG } from "@wardic/example-storefront-shared/micro"
import { wardic } from "@wardic/solid"
import { For, Show } from "solid-js"

/** A gallery card: the router's link through `wardic.create`, so it lifts, glows and gives (#365). */
const Card = wardic.create(A)

export default function Home() {
  const ready = AREAS.filter((area) => examplesIn(area.id).length > 0)
  const next = AREAS.filter((area) => examplesIn(area.id).length === 0)
  return (
    <main class="page">
      <section class="hero">
        <p class="eyebrow">Wardic on Solid 1</p>
        <h1>A small shop built to show what Wardic does.</h1>
        <p>Each example is a feature of the shop, with the code that makes it move and why it's worth reaching for.</p>
      </section>
      <For each={ready}>
        {(area) => (
          <section class="area" aria-labelledby={`area-${area.id}`}>
            <div class="area-head">
              <h2 id={`area-${area.id}`}>{area.title}</h2>
              <p class="muted">{area.blurb}</p>
            </div>
            <div class="example-cards">
              <For each={examplesIn(area.id)}>
                {(example) => (
                  <Card class="example-card" href={routeOf(example)} variants={CARD} initial="rest" animate="rest" whileHover="hover" whileFocus="hover" whileTap="press">
                    <h3>{example.title}</h3>
                    <p class="muted">{example.summary}</p>
                    <ul class="tags">
                      <For each={example.uses}>{(use) => <wardic.li variants={TAG}>{use}</wardic.li>}</For>
                    </ul>
                  </Card>
                )}
              </For>
            </div>
          </section>
        )}
      </For>
      <Show when={next.length > 0}>
        <section class="area" aria-labelledby="area-next">
          <div class="area-head">
            <h2 id="area-next">Coming next</h2>
            <p class="muted">{next.map((area) => area.title).join(", ")}.</p>
          </div>
        </section>
      </Show>
    </main>
  )
}
