// `createWillChange` on Solid 2 (#443): Solid 1's WC1 and WC3, on an element's `style` prop and in a
// ward's config `style`.
//
// - WCV1: `"auto"` at mount and at its target; `"transform"` once `x` moves, and for good.
// - WCV2: in a ward's config `style`, under its camel-cased name, an `opacity` animation turns it on.
// - WCV3: a drag's start turns it on.
import { DomLive } from "@wardic/dom"
import { createWillChange, ward, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { createSignal, flush } from "solid-js"
import { describe, expect, it } from "vitest"
import { commands } from "vitest/browser"
import "../browser-commands.ts"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

/** A few frames. */
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

describe("createWillChange on Solid 2 (#443)", () => {
  it("WCV1: auto at mount and at its target; transform once x moves, and for good", async () => {
    const [x, setX] = createSignal(0)
    const Box = () => {
      const willChange = createWillChange()
      return <wardic.div data-t initial={{ x: 0 }} animate={{ x: x() }} transition={{ duration: 0.1 }} style={{ "will-change": willChange }} />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    const el = host.querySelector<HTMLElement>("[data-t]")!
    await frames(4)
    expect(el.style.willChange).toBe("auto")
    setX(100)
    flush()
    await until(() => el.style.willChange === "transform", 2000)
    await until(() => el.style.transform === "translateX(100px)", 2000)
    setX(0)
    flush()
    await until(() => el.style.transform === "none", 2000)
    expect(el.style.willChange, "for good").toBe("transform")
  })

  it("WCV2: in a ward's config style, an opacity animation turns it on", async () => {
    const [opacity, setOpacity] = createSignal(1)
    const Card = () => {
      const willChange = createWillChange()
      const card = ward({ animate: () => ({ opacity: opacity() }), transition: { duration: 0.05 }, style: { willChange } })
      return <div data-t {...card()} />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    const el = host.querySelector<HTMLElement>("[data-t]")!
    await frames(4)
    expect(el.style.willChange).toBe("auto")
    setOpacity(0.5)
    flush()
    await until(() => el.style.willChange === "transform", 2000)
    expect(el.style.willChange).toBe("transform")
  })

  it("WCV3: a drag's start turns it on", async () => {
    const Box = () => {
      const willChange = createWillChange()
      return <wardic.div data-t drag style={{ position: "absolute", top: "400px", left: "40px", width: "100px", height: "60px", "will-change": willChange }} />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    const el = host.querySelector<HTMLElement>("[data-t]")!
    await frames(3)
    expect(el.style.willChange).toBe("auto")
    const rect = el.getBoundingClientRect()
    const x = rect.left + 20
    const y = rect.top + 20
    await commands.realMouse("down", x, y)
    try {
      for (let k = 1; k <= 6; k++) await commands.realMouse("move", x + k * 7, y)
      await until(() => el.style.willChange === "transform", 2000)
      expect(el.style.willChange).toBe("transform")
    } finally {
      await commands.realMouse("up", x + 42, y)
    }
  })
})
