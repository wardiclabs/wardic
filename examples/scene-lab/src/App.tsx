/**
 * The lab's page: a card for each scenario.
 *
 * @module
 */
import { For } from "solid-js"
import { Card } from "./Card.tsx"
import { DragCard } from "./hooks/DragCard.tsx"
import { GraphVariantsCard } from "./hooks/GraphVariantsCard.tsx"
import { SceneObjectCard } from "./hooks/SceneObjectCard.tsx"
import { StageCard } from "./hooks/StageCard.tsx"
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
    <header class="page">
      <h2>Solid hooks</h2>
      <p>
        <code>@wardic/three/solid</code>: each card a Solid component, its scene run by <code>createStage</code> and moved by <code>@wardic/solid</code>'s hooks.
      </p>
    </header>
    <section class="cards">
      <StageCard />
      <SceneObjectCard />
      <GraphVariantsCard />
      <DragCard />
    </section>
  </main>
)
