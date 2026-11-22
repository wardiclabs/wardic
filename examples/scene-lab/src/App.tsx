/**
 * The lab's page: a card for each scenario.
 *
 * @module
 */
import { For } from "solid-js"
import { Card } from "./Card.tsx"
import { scenarios } from "./scenarios.ts"

export const App = () => (
  <main>
    <header class="page">
      <h1>Wardic scene lab</h1>
      <p>
        <code>@wardic/three</code> on three.js: each card is a scene of its own, its runtime's <code>frame(t)</code> called before each render.
      </p>
    </header>
    <section class="cards">
      <For each={scenarios}>{(scenario) => <Card scenario={scenario} />}</For>
    </section>
  </main>
)
