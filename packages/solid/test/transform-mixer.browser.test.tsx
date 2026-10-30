// `createTransform`'s `mixer` and descending ranges on Solid 1 (#440, Motion's `useTransform`).
//
// - TX1: a `mixer` blends the outputs in place of `animate`'s: a stepping mixer flips a colour at its
//   stretch's middle, where the registry would blend it, and its value reaches `style`.
// - TX2: a mixer's outputs can be any type: a point mixed from pairs, read by another transform.
// - TX3: a descending range of three stops maps as Motion's, into `style`.
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { createTransform, wardic, WardicProvider } from "@wardic/solid"
import { type Accessor, createSignal } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { BOX } from "./base-values-harness.ts"
import { resetScene, settle } from "./reorder-harness.tsx"

afterEach(resetScene)

/** A mixer that steps: the first output until the stretch's middle, then the second. */
const stepping = (from: string, to: string) => (t: number): string => [from, to][Number(t >= 0.5)]!

describe("createTransform's mixer and descending ranges on Solid 1 (#440)", () => {
  it("TX1: a mixer blends in place of animate's, and reaches style", async () => {
    let el!: HTMLDivElement
    let colour!: Accessor<string>
    const [x, setX] = createSignal(0)
    const Box = () => {
      colour = createTransform(x, [0, 100], ["rgb(255, 0, 0)", "rgb(0, 0, 255)"], { mixer: stepping })
      return <wardic.div ref={el} style={{ ...BOX, "background-color": colour }} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await settle()
    setX(40)
    await settle()
    expect(colour(), "before the middle: the first, not a blend").toBe("rgb(255, 0, 0)")
    expect(el.style.backgroundColor).toBe("rgb(255, 0, 0)")
    setX(60)
    await settle()
    expect(el.style.backgroundColor, "past it: the second").toBe("rgb(0, 0, 255)")
  })

  it("TX2: a mixer's outputs can be any type", async () => {
    let point!: Accessor<readonly [number, number]>
    let y!: Accessor<number>
    const [x, setX] = createSignal(0)
    const Box = () => {
      const mixPair = (a: readonly [number, number], b: readonly [number, number]) => (t: number): readonly [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      point = createTransform(x, [0, 100], [[0, 0] as const, [200, 80] as const], { mixer: mixPair })
      y = createTransform(point, (p) => p[1])
      return <wardic.div style={{ ...BOX, y }} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await settle()
    setX(25)
    await settle()
    expect(point()).toEqual([50, 20])
    expect(y()).toBe(20)
  })

  it("TX3: a descending range of three stops maps as Motion's, into style", async () => {
    let el!: HTMLDivElement
    const [x, setX] = createSignal(100)
    const Box = () => {
      const opacity = createTransform(x, [100, 50, 0], [0, 1, 0])
      return <wardic.div ref={el} style={{ ...BOX, opacity }} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await settle()
    const seen: Array<number> = []
    for (const v of [100, 75, 50, 25, 0]) {
      setX(v)
      await settle()
      seen.push(Number(el.style.opacity))
    }
    expect(seen).toEqual([0, 0.5, 1, 0.5, 0])
  })
})
