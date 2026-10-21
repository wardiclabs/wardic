// `{...ward(config)}` (#209): Solid 2 runs a spread's expression again on every run of the
// element's props, making a new ward for the same element each time. The second ward to mount it
// throws, naming the fix, into the nearest `<Errored>`. Its own file: an uncaught throw halts Solid
// 2's reactivity for the page.
//
// - WT1: `{...ward(config)}` throws once the spread runs again, naming the kept ward and the ref.
// - WT2: an element a ward left takes a new ward in a later task: the record of the elements left
//   is cleared at the task's end (#259, one microtask a task).
import { DomLive } from "@wardic/dom"
import { WardicProvider, ward } from "@wardic/solid/unstable/v2"
import { createSignal, Errored, flush, Show } from "solid-js"
import { expect, it } from "vitest"
import { until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

it("WT1: {...ward(config)} throws once the spread runs again, naming the kept ward and the ref", async () => {
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      <Errored fallback={(error) => <p>{String(error())}</p>}>
        <div {...ward({ initial: { opacity: 0 }, animate: { opacity: 1 } })} />
      </Errored>
    </WardicProvider>
  ))
  await until(() => host.querySelector("p") !== null)
  expect(host.querySelector("p")?.textContent).toContain(
    "Make it once, in the component's body, and spread that: `const card = ward(config)` then `<div {...card} />`",
  )
})

it("WT2: an element a ward left takes a new ward in a later task", async () => {
  const shared = document.createElement("div")
  const [showA, setShowA] = createSignal(true)
  const [showB, setShowB] = createSignal(false)
  const HolderA = () => {
    ward({ animate: { opacity: 0.3 } })(shared)
    return null
  }
  const HolderB = () => {
    ward({ animate: { opacity: 0.7 } })(shared)
    return null
  }
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      <Errored fallback={(error) => <p>{String(error())}</p>}>
        <Show when={showA()}>
          <HolderA />
        </Show>
        <Show when={showB()}>
          <HolderB />
        </Show>
      </Errored>
    </WardicProvider>
  ))
  await until(() => shared.style.opacity === "0.3")
  setShowA(false)
  flush()
  await new Promise((resolve) => setTimeout(resolve, 0))
  setShowB(true)
  flush()
  await until(() => shared.style.opacity === "0.7")
  expect(host.querySelector("p"), "no REMADE error").toBeNull()
  expect(shared.style.opacity).toBe("0.7")
})
