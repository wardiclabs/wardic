// A ward spread hands the element its props and nothing else (#495), on Solid 2. Solid 2's `merge`
// calls a function source and reads each key off what it returns with `in`; a ward returned itself,
// so its own names (`name`, `length`, its methods) shadowed the element's props of those names.
//
// - WP1: `wardic.input`'s `name` reaches the input; so do `length`, `read` and `next`.
// - WP2: a plain element given `{...card}` after its own props keeps them.
// - WP3: a `wardic.create` component gets its `name`.
// - WP4: a Reorder group spread after the list's own props keeps them.
// - WP5: called with nothing, a ward gives its spread's props alone, reaching no other name, not even
//   `Object.prototype`'s; its `.with()` too.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { reorderGroup, ward, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { createSignal, untrack } from "solid-js"
import { describe, expect, it } from "vitest"
import { mount } from "./mount.tsx"

/** Props by name, as a spread gives them, past the JSX element types. */
const named = (props: Record<string, string>): Record<string, unknown> => props

describe("a ward spread hands the element its props alone (#495)", () => {
  it("WP1: wardic.input's name reaches the input; so do length, read and next", () => {
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.input data-a name="email" {...named({ length: "8", read: "r", next: "n" })} />
      </WardicProvider>
    ))
    const input = host.querySelector<HTMLInputElement>("[data-a]")!
    expect(input.name).toBe("email")
    expect([input.getAttribute("length"), input.getAttribute("read"), input.getAttribute("next")]).toEqual(["8", "r", "n"])
  })

  it("WP2: a plain element given {...card} after its own props keeps them", () => {
    const Field = (): JSX.Element => {
      const card = ward({ animate: { opacity: 1 } })
      return <input data-b name="email" {...named({ read: "r", with: "w" })} {...card} />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Field />
      </WardicProvider>
    ))
    const input = host.querySelector<HTMLInputElement>("[data-b]")!
    expect(input.name).toBe("email")
    expect([input.getAttribute("read"), input.getAttribute("with")]).toEqual(["r", "w"])
  })

  it("WP3: a wardic.create component gets its name", () => {
    let given: unknown
    const Input = (props: { readonly ref?: JSX.Ref<HTMLInputElement>; readonly style?: JSX.CSSProperties; readonly name?: string }): JSX.Element => {
      given = untrack(() => props.name)
      return <input ref={props.ref} style={props.style} name={props.name} />
    }
    const WardicInput = wardic.create(Input)
    mount(() => (
      <WardicProvider env={DomLive}>
        <WardicInput name="email" />
      </WardicProvider>
    ))
    expect(given).toBe("email")
  })

  it("WP4: a Reorder group spread after the list's own props keeps them", () => {
    const List = (): JSX.Element => {
      const [items, setItems] = createSignal<ReadonlyArray<string>>([])
      const list = reorderGroup({ values: items, onReorder: setItems })
      return <ul data-c {...named({ name: "sizes", next: "n", axis: "a" })} {...list} />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <List />
      </WardicProvider>
    ))
    const ul = host.querySelector("[data-c]")!
    expect([ul.getAttribute("name"), ul.getAttribute("next"), ul.getAttribute("axis")]).toEqual(["sizes", "n", "a"])
  })

  it("WP5: called with nothing, a ward gives its spread's props alone, reaching no other name; its .with() too", () => {
    let spread: object | undefined
    let withed: object | undefined
    const Card = (): JSX.Element => {
      const card = ward({ animate: { opacity: 1 }, drag: "x" })
      spread = card()
      withed = card.with({ style: { color: "red" } })
      return <div {...card} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    for (const props of [spread, withed]) {
      expect(Object.keys(props!).sort()).toEqual(["draggable", "ref", "style"])
      for (const name of ["name", "length", "read", "next", "with", "constructor", "toString", "hasOwnProperty"]) expect(name in props!, name).toBe(false)
    }
  })
})
