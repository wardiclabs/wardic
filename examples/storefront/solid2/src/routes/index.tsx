/** The showcase's gallery (#296 Q3): each area, with its examples. */
import { AREAS, examplesIn, routeOf } from "@wardic/example-storefront-shared/examples"
import { CARD, TAG } from "@wardic/example-storefront-shared/micro"
import { wardic } from "@wardic/solid/unstable/v2"
import { For, Show } from "solid-js"

export default function Home() {
  const ready = AREAS.filter((area) => examplesIn(area.id, "solid2").length > 0)
  const next = AREAS.filter((area) => examplesIn(area.id, "solid2").length === 0)
  return (
    <main class="page">
      <section class="hero">
        <div class="hero-badges">
          <p class="eyebrow">Wardic on</p>
          <span class="badge badge-binding">Solid 2</span>
          <span class="badge badge-unstable">Unstable</span>
        </div>
        <p class="unstable-note">
          These examples run on <code>@wardic/solid/unstable/v2</code>, Wardic for Solid 2's release candidate (2.0.0-rc.18). Any release of either may
          change it; once Solid 2.0 is stable, it becomes <code>@wardic/solid</code>.
        </p>
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
              <For each={examplesIn(area.id, "solid2")}>
                {(example) => (
                  <wardic.a class="example-card" href={routeOf(example)} variants={CARD} initial="rest" animate="rest" whileHover="hover" whileFocus="hover" whileTap="press">
                    <h3>{example.title}</h3>
                    <p class="muted">{example.summary}</p>
                    <ul class="tags">
                      <For each={example.uses}>{(use) => <wardic.li variants={TAG}>{use}</wardic.li>}</For>
                    </ul>
                  </wardic.a>
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
