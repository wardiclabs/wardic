// The Solid 2 toolchain on a server (#209): Solid 2's SSR compile and `@solidjs/web`'s render.
import * as Solid from "solid-js"
import { createSignal } from "solid-js"
import { renderToString } from "@solidjs/web"
import { describe, expect, it } from "vitest"

describe("Solid 2 on a server", () => {
  it("is Solid 2: `flush` exists, `batch` doesn't", () => {
    expect(typeof (Solid as Record<string, unknown>).flush).toBe("function")
    expect((Solid as Record<string, unknown>).batch).toBeUndefined()
  })

  it("renders with Solid 2", () => {
    const Card = () => {
      // A signal never written, on purpose: the smoke test renders a Solid 2 signal's read on a server.
      // eslint-disable-next-line solid/no-unused-signal -- as above
      const [label] = createSignal("two")
      return <p class="card">{label()}</p>
    }
    expect(renderToString(() => <Card />)).toContain(">two</p>")
  })
})
