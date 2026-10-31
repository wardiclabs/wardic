// `createWillChange` on Solid 1 (#443, Motion's `useWillChange`), in a real browser: a `willChange` for
// an element's `style`, `"auto"` until that element starts animating a transform key or a key a
// browser composites, or starts a drag; then `"transform"`, for good.
//
// - WC1: `"auto"` at mount, its `animate` at its target (#448: no leg); `"transform"` once `x` starts
//   to move, and still once it lands and its target returns.
// - WC2: a key no browser composites (`color`) leaves it `"auto"`; `opacity` turns it on.
// - WC3: a drag's start turns it on, before anything animates.
// - WC4: a layout animation doesn't turn it on; nor does another element's animation.
// - WC5: an Imperative animation of the element (`createAnimate`) turns it on.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { createAnimate, createWillChange, wardic, type WardicAnimate, WardicProvider } from "@wardic/solid"
import { type Accessor, createSignal } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"
import { add, glide, mouse, resetScene } from "./reorder-harness.tsx"

afterEach(async () => {
  await resetScene()
  cleanup()
})

/** A few frames. */
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

describe("createWillChange on Solid 1 (#443)", () => {
  it("WC1: auto at mount and at its target; transform once x moves, and for good", async () => {
    let willChange: Accessor<string> | undefined
    const [x, setX] = createSignal(0)
    const Box = () => {
      const value = createWillChange()
      willChange = value
      return <wardic.div data-t initial={{ x: 0 }} animate={{ x: x() }} transition={{ duration: 0.1 }} style={{ "will-change": value }} />
    }
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-t]")!
    await frames(4)
    expect(willChange!()).toBe("auto")
    expect(el.style.willChange).toBe("auto")
    setX(100)
    await until(() => el.style.willChange === "transform", 2000)
    expect(willChange!()).toBe("transform")
    await until(() => el.style.transform === "translateX(100px)", 2000)
    setX(0)
    await until(() => el.style.transform === "none", 2000)
    expect(el.style.willChange, "for good").toBe("transform")
  })

  it("WC2: a key no browser composites leaves it auto; opacity turns it on", async () => {
    const [target, setTarget] = createSignal<Record<string, string | number>>({ color: "rgb(0, 0, 0)" })
    const Box = () => {
      const willChange = createWillChange()
      return <wardic.div data-t animate={target()} transition={{ duration: 0.05 }} style={{ "will-change": willChange }} />
    }
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-t]")!
    await frames(3)
    setTarget({ color: "rgb(255, 0, 0)" })
    await until(() => el.style.color === "rgb(255, 0, 0)", 2000)
    expect(el.style.willChange, "color").toBe("auto")
    setTarget({ color: "rgb(255, 0, 0)", opacity: 0.5 })
    await until(() => el.style.willChange === "transform", 2000)
    expect(el.style.willChange).toBe("transform")
  })

  it("WC3: a drag's start turns it on", async () => {
    const Box = () => {
      const willChange = createWillChange()
      return <wardic.div data-t drag style={{ position: "absolute", top: "400px", left: "40px", width: "100px", height: "60px", "will-change": willChange }} />
    }
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-t]")!
    await frames(3)
    expect(el.style.willChange).toBe("auto")
    const rect = el.getBoundingClientRect()
    const grab = { x: rect.left + 20, y: rect.top + 20 }
    await mouse.down(grab)
    await glide(grab, add(grab, 40, 0), 6)
    await until(() => el.style.willChange === "transform", 2000)
    expect(el.style.willChange).toBe("transform")
    await mouse.up(add(grab, 40, 0))
  })

  it("WC4: a layout animation doesn't turn it on; nor does another element's animation", async () => {
    const [width, setWidth] = createSignal(100)
    const Boxes = () => {
      const willChange = createWillChange()
      return (
        <>
          <wardic.div data-t layout layoutDependency={width()} transition={{ duration: 0.2 }} style={{ width: `${width()}px`, height: "40px", "will-change": willChange }} />
          <wardic.div data-o animate={{ x: width() }} transition={{ duration: 0.1 }} />
        </>
      )
    }
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <Boxes />
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-t]")!
    const other = container.querySelector<HTMLElement>("[data-o]")!
    await frames(4)
    setWidth(300)
    // The layout animation runs: its projection draws a scale.
    await until(() => el.style.transform.includes("scale"), 2000)
    await until(() => other.style.transform === "translateX(300px)", 2000)
    await frames(15)
    expect(el.style.willChange).toBe("auto")
  })

  it("WC5: an Imperative animation of the element turns it on", async () => {
    let animate!: WardicAnimate
    const Box = () => {
      const willChange = createWillChange()
      ;[, animate] = createAnimate()
      return <wardic.div data-t style={{ "will-change": willChange }} />
    }
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-t]")!
    await frames(3)
    expect(el.style.willChange).toBe("auto")
    animate(el, { rotate: 45 }, { duration: 0.1 })
    await until(() => el.style.willChange === "transform", 2000)
    expect(el.style.willChange).toBe("transform")
  })
})
