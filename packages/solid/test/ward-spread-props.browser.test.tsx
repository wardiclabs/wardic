// A guard for #495 on Solid 1: its spread is a plain object (`ward(userProps)`), so an element's
// `name` was never at risk there, as it was on Solid 2.
//
// - WP1: `wardic.input`'s `name`, and a plain input's beside `{...ward()}`, reach the inputs.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { createWard, wardic, WardicProvider } from "@wardic/solid"
import type { JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"

afterEach(cleanup)

describe("a ward spread keeps the element's name on Solid 1 (#495)", () => {
  it("WP1: wardic.input's name, and a plain input's beside {...ward()}, reach the inputs", () => {
    const Field = (): JSX.Element => {
      const ward = createWard({ animate: { opacity: 1 } })
      return <input data-b name="phone" {...ward()} />
    }
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <wardic.input data-a name="email" />
        <Field />
      </WardicProvider>
    ))
    expect(container.querySelector<HTMLInputElement>("[data-a]")!.name).toBe("email")
    expect(container.querySelector<HTMLInputElement>("[data-b]")!.name).toBe("phone")
  })
})
