/**
 * One scenario's card: its title and what it shows, its canvas and scene, its buttons, and a report line
 * read twice a second.
 *
 * @module
 */
import { createSignal, For, onSettled } from "solid-js"
import type { Control, Scenario } from "./scenarios.ts"
import { HEIGHT, makeStage, WIDTH } from "./stage.ts"

export const Card = (props: { readonly scenario: Scenario }) => {
  let canvas!: HTMLCanvasElement
  const [controls, setControls] = createSignal<ReadonlyArray<Control>>([])
  const [readout, setReadout] = createSignal("")
  onSettled(() => {
    const stage = makeStage(canvas)
    const built = props.scenario.setup(stage)
    setControls(built.controls)
    setReadout(built.readout())
    const timer = setInterval(() => setReadout(built.readout()), 250)
    return () => {
      clearInterval(timer)
      stage.dispose()
    }
  })
  return (
    <article class="card" data-scenario={props.scenario.id}>
      <header>
        <h2>{props.scenario.title}</h2>
        <p>{props.scenario.about}</p>
      </header>
      <canvas ref={canvas} width={WIDTH} height={HEIGHT} />
      <div class="controls">
        <For each={controls()}>{(control) => <button type="button" onClick={() => control.run()}>{control.label}</button>}</For>
      </div>
      <output>{readout()}</output>
    </article>
  )
}
