// The Solid 2 toolchain in a browser (#209): Solid 2's DOM compile, `@solidjs/web`'s render, reads
// that lag their setters until `flush()`, and a ref factory.
import * as Solid from "solid-js"
import { createSignal, flush } from "solid-js"
import { render } from "@solidjs/web"
import { describe, expect, it } from "vitest"

describe("Solid 2 in a browser", () => {
  it("renders, updates after flush, and calls a ref factory's ref", () => {
    expect((Solid as Record<string, unknown>).batch).toBeUndefined()
    const host = document.createElement("div")
    document.body.append(host)
    const [label, setLabel] = createSignal("one")
    const seen: Array<string> = []
    const tag = (name: string) => (el: HTMLElement) => void seen.push(`${name}:${el.tagName}`)
    const dispose = render(() => <p ref={tag("p")}>{label()}</p>, host)
    expect(host.textContent).toBe("one")
    setLabel("two")
    expect(label(), "a read lags its setter").toBe("one")
    flush()
    expect(host.textContent).toBe("two")
    expect(seen).toEqual(["p:P"])
    dispose()
    host.remove()
  })
})
