// `{...ward(config)}` (#209): Solid 2 runs a spread's expression again on every run of the
// element's props, making a new ward for the same element each time. The second ward to mount it
// throws, naming the fix, into the nearest `<Errored>`. Its own file: an uncaught throw halts Solid
// 2's reactivity for the page.
import { DomLive } from "@wardic/dom"
import { WardicProvider, ward } from "@wardic/solid/unstable/v2"
import { Errored } from "solid-js"
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
