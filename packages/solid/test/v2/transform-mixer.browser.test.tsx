// `createTransform`'s `mixer` and descending ranges on Solid 2 (#440): Solid 1's TX1 and TX3.
//
// - TXV1: a stepping `mixer` flips a colour at its stretch's middle, where the registry would blend it,
//   and its value reaches `style`.
// - TXV2: a descending range of three stops maps as Motion's, into `style`.
import { DomLive } from "@wardic/dom"
import { createTransform, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { createSignal, flush } from "solid-js"
import { describe, expect, it } from "vitest"
import { afterPaint, raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await raf()
  await afterPaint()
}
const BOX = { width: "40px", height: "40px" } as const

/** A mixer that steps: the first output until the stretch's middle, then the second. */
const stepping = (from: string, to: string) => (t: number): string => [from, to][Number(t >= 0.5)]!

describe("createTransform's mixer and descending ranges on Solid 2 (#440)", () => {
  it("TXV1: a mixer blends in place of animate's, and reaches style", async () => {
    let el!: HTMLElement
    const [x, setX] = createSignal(0)
    const Box = () => {
      const colour = createTransform(x, [0, 100], ["rgb(255, 0, 0)", "rgb(0, 0, 255)"], { mixer: stepping })
      return <wardic.div ref={(n: HTMLElement) => (el = n)} style={{ ...BOX, "background-color": colour }} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await settle()
    setX(40)
    flush()
    await settle()
    expect(el.style.backgroundColor, "before the middle: the first, not a blend").toBe("rgb(255, 0, 0)")
    setX(60)
    flush()
    await settle()
    expect(el.style.backgroundColor, "past it: the second").toBe("rgb(0, 0, 255)")
  })

  it("TXV2: a descending range of three stops maps as Motion's, into style", async () => {
    let el!: HTMLElement
    const [x, setX] = createSignal(100)
    const Box = () => {
      const opacity = createTransform(x, [100, 50, 0], [0, 1, 0])
      return <wardic.div ref={(n: HTMLElement) => (el = n)} style={{ ...BOX, opacity }} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await settle()
    const seen: Array<number> = []
    for (const v of [100, 75, 50, 25, 0]) {
      setX(v)
      flush()
      await settle()
      seen.push(Number(el.style.opacity))
    }
    expect(seen).toEqual([0, 0.5, 1, 0.5, 0])
  })
})
