// A custom property keeps its name on every path, and is a style property on SVG too (#151,
// ADR-0014 *Amendment (#151)*; Motion's `isCSSVariableName`). Each element's opacity is
// `var(--brandLevel)`, so its painted opacity shows whether the animation reaches the custom
// property the page reads. Before #151 the commit wrote `--brand-level`, an svg-inner element
// wrote an attribute, and holding the key removed the element's own `--brandLevel`: the
// opacity stayed at 1.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { useWardic, wardic, WardicProvider, type WardicValues } from "@wardic/solid"
import { createSignal, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { until } from "./browser-helpers.ts"
import { max, opacityOf } from "./base-values-harness.ts"
import { resetScene, sampleFrames, wait } from "./reorder-harness.tsx"

afterEach(async () => {
  await resetScene()
  cleanup()
})

const TWEEN = { type: "tween", duration: 0.3 } as const
const BOX: JSX.CSSProperties = { width: "40px", height: "40px", background: "#68c" }
/** The element's opacity reads the custom property, which starts at 1. */
const LEVEL = { ...BOX, opacity: "var(--brandLevel)", "--brandLevel": "1" } as JSX.CSSProperties
const HALF = { "--brandLevel": 0.5 } as WardicValues

/** Every painted value of `read` over `ms` from now. */
const sampleFor = async (ms: number, read: () => number): Promise<Array<number>> => {
  const s = sampleFrames(read)
  await wait(ms)
  return s.stop().map((f) => f.v)
}

/** The element ends at 0.5 under `--brandLevel` itself, with no `--brand-level` and no attribute. */
const expectHalf = (el: Element): void => {
  const style = (el as HTMLElement).style
  expect(opacityOf(el), "the painted opacity follows var(--brandLevel)").toBeCloseTo(0.5, 2)
  expect(Number(style.getPropertyValue("--brandLevel")), "--brandLevel").toBeCloseTo(0.5, 2)
  expect(style.getPropertyValue("--brand-level"), "no --brand-level").toBe("")
  expect(el.getAttribute("--brand-level"), "no attribute").toBeNull()
}

describe("a custom property keeps its name (#151)", () => {
  it("CP1: a wardic.div animates --brandLevel itself: from its own 1 to 0.5, frames between", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={LEVEL} animate={HALF} transition={TWEEN} />
      </WardicProvider>
    ))
    const opacities = await sampleFor(600, () => opacityOf(el))
    expect(max(opacities), "it starts at its own 1").toBeGreaterThan(0.95)
    expect(opacities.filter((v) => v > 0.55 && v < 0.95).length, "frames on the way").toBeGreaterThan(3)
    expectHalf(el)
  })

  it("CP2: through a useWardic spread", async () => {
    let el!: HTMLElement
    function Spread(): JSX.Element {
      const ward = useWardic({ animate: HALF, transition: TWEEN })
      return <div {...ward({ ref: (n: HTMLElement) => (el = n), style: LEVEL })} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Spread />
      </WardicProvider>
    ))
    await wait(600)
    expectHalf(el)
  })

  it("CP3: through a wardic.create(Component) wrap", async () => {
    let el!: HTMLElement
    const Card = (p: { ref?: (el: HTMLElement) => void; style?: JSX.CSSProperties | string }): JSX.Element => (
      <article ref={p.ref} style={{ ...LEVEL, ...(typeof p.style === "object" ? p.style : {}) }} />
    )
    const WCard = wardic.create(Card)
    render(() => (
      <WardicProvider env={DomLive}>
        <WCard ref={(n: HTMLElement) => (el = n)} animate={HALF} transition={TWEEN} />
      </WardicProvider>
    ))
    await wait(600)
    expectHalf(el)
  })

  it("CP4: an SVG circle writes it as a style property, not an attribute", async () => {
    let el!: SVGElement
    render(() => (
      <WardicProvider env={DomLive}>
        <svg width="40" height="40">
          <wardic.circle ref={(n: SVGElement) => (el = n)} r={10} cx={20} cy={20} style={LEVEL} animate={HALF} transition={TWEEN} />
        </svg>
      </WardicProvider>
    ))
    await wait(600)
    expectHalf(el)
  })

  it("CP5: a key animate lets go of goes back to the element's own value, which is never removed", async () => {
    let el!: HTMLElement
    const [on, setOn] = createSignal(true)
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={LEVEL} animate={(on() ? HALF : {}) as WardicValues} transition={TWEEN} />
      </WardicProvider>
    ))
    await until(() => Math.abs(opacityOf(el) - 0.5) < 0.01, 3000)
    setOn(false)
    const back = await sampleFor(800, () => opacityOf(el))
    expect(back.filter((v) => v > 0.55 && v < 0.95).length, "frames on the way back").toBeGreaterThan(3)
    expect(opacityOf(el), "back at its own 1").toBeCloseTo(1, 2)
    expect(el.style.getPropertyValue("--brandLevel").trim()).toBe("1")
  })

  it("CP6: holding --brandColor leaves the element's separate --brand-color alone", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(n: HTMLElement) => (el = n)}
          style={{ ...BOX, "--brand-color": "blue" } as JSX.CSSProperties}
          initial={{ "--brandColor": "#000000" } as WardicValues}
          animate={{ "--brandColor": "#ff0000" } as WardicValues}
          transition={TWEEN}
        />
      </WardicProvider>
    ))
    await wait(600)
    expect(el.style.getPropertyValue("--brand-color").trim()).toBe("blue")
    expect(el.style.getPropertyValue("--brandColor")).not.toBe("")
  })
})
