// Variable values with real paint (#55, ADR-0035 *Amendment (#55)*): a key whose start or target is
// wholly a `var()` blends what it resolves to on the element, resolved once when the leg starts, and
// rests as the `var()` itself, so the element follows the custom property again (Motion's, run on
// framer-motion 13.4.0: `.tmp/vel/vars-drive.ts`). Before #55 each of these pairs switched at the
// first frame.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider, type WardicTransition, type WardicValues } from "@wardic/solid"
import { createSignal, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { until } from "./browser-helpers.ts"
import { resetScene, sampleFrames, settle, wait } from "./reorder-harness.tsx"

afterEach(async () => {
  await resetScene()
  cleanup()
})

const TWEEN = { type: "tween", duration: 0.4 } as const
const BOX: JSX.CSSProperties = { width: "40px", height: "40px" }
const VARS = { "--brand": "#0000ff", "--a": "#ff0000", "--b": "#00ff00", "--o": "0.4", "--shadow": "0px 0px 10px rgb(255, 0, 0)" } as JSX.CSSProperties

type Rgba = readonly [number, number, number, number]
/** A computed colour's channels, alpha last. */
const rgbaOf = (colour: string): Rgba => {
  const v = /\(([^)]+)\)/.exec(colour)![1]!.split(",").map(Number)
  return [v[0]!, v[1]!, v[2]!, v[3] ?? 1]
}
const backgroundOf = (el: Element): Rgba => rgbaOf(getComputedStyle(el).backgroundColor)

/** A box under a parent defining `VARS`, flipping `background-color` (or `key`) between `off` and `on`. */
const mountFlip = (off: WardicValues, on: WardicValues, transition: WardicTransition = TWEEN) => {
  let parent!: HTMLElement
  let el!: HTMLElement
  const [shown, setShown] = createSignal(false)
  render(() => (
    <WardicProvider env={DomLive}>
      <div ref={(n: HTMLElement) => (parent = n)} style={VARS}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} initial={off} animate={shown() ? on : off} transition={transition} />
      </div>
    </WardicProvider>
  ))
  return { el: () => el, parent: () => parent, flip: () => setShown((s) => !s) }
}

/** Every value of `read` painted over `ms`. */
const sampleFor = async <A,>(ms: number, read: () => A): Promise<Array<A>> => {
  const s = sampleFrames(read)
  await wait(ms)
  return s.stop().map((f) => f.v)
}

describe("Variable values with real paint (#55)", () => {
  it("VB1: a colour → var(--brand) blends red into blue, rests as var(--brand), and follows it at rest", async () => {
    const box = mountFlip({ "background-color": "#ff0000" } as WardicValues, { "background-color": "var(--brand)" } as WardicValues)
    await settle()
    box.flip()
    const frames = await sampleFor(700, () => backgroundOf(box.el()))
    expect(frames.filter(([r, , b]) => r > 10 && r < 245 && b > 10 && b < 245).length, "frames in between").toBeGreaterThan(5)
    frames.forEach(([, , , a], i) => expect(a, `frame ${i} opaque`).toBe(1))
    expect(box.el().style.backgroundColor, "rests as the var() itself").toBe("var(--brand)")
    box.parent().style.setProperty("--brand", "#00ff00")
    await until(() => backgroundOf(box.el())[1] === 255, 1000)
    expect(backgroundOf(box.el())).toEqual([0, 255, 0, 1])
  })

  it("VB2: var(--a) → var(--b) blends the two colours and rests as var(--b)", async () => {
    const box = mountFlip({ "background-color": "var(--a)" } as WardicValues, { "background-color": "var(--b)" } as WardicValues)
    await settle()
    expect(backgroundOf(box.el())).toEqual([255, 0, 0, 1])
    box.flip()
    const frames = await sampleFor(700, () => backgroundOf(box.el()))
    expect(frames.filter(([r, g]) => r > 10 && r < 245 && g > 10 && g < 245).length, "frames in between").toBeGreaterThan(5)
    expect(box.el().style.backgroundColor).toBe("var(--b)")
  })

  it("VB3: under the default spring, a var() target blends and rests as the var()", async () => {
    const box = mountFlip({ "background-color": "#ff0000" } as WardicValues, { "background-color": "var(--brand)" } as WardicValues, {})
    await settle()
    box.flip()
    const s = sampleFrames(() => backgroundOf(box.el()))
    await until(() => box.el().style.backgroundColor === "var(--brand)", 4000)
    await settle()
    expect(s.stop().filter((f) => f.v[0] > 10 && f.v[0] < 245).length, "frames in between").toBeGreaterThan(5)
  })

  it("VB4: a fallback chain resolves: var(--missing, var(--brand)) blends into blue", async () => {
    const box = mountFlip({ "background-color": "#ff0000" } as WardicValues, { "background-color": "var(--missing, var(--brand))" } as WardicValues)
    await settle()
    box.flip()
    const frames = await sampleFor(700, () => backgroundOf(box.el()))
    expect(frames.filter(([r, , b]) => r > 10 && r < 245 && b > 10 && b < 245).length).toBeGreaterThan(5)
    expect(backgroundOf(box.el())).toEqual([0, 0, 255, 1])
  })

  it("VB5 (guard): a var() that doesn't resolve switches at the first frame, as written (Motion's)", async () => {
    const box = mountFlip({ "background-color": "#ff0000" } as WardicValues, { "background-color": "var(--missing)" } as WardicValues)
    await settle()
    box.flip()
    const frames = await sampleFor(600, () => box.el().style.backgroundColor)
    expect(frames.filter((f) => f !== "var(--missing)" && f !== "rgb(255, 0, 0)").length, "no colour in between").toBe(0)
    expect(box.el().style.backgroundColor).toBe("var(--missing)")
  })

  it("VB6: a mid-leg change to the variable isn't followed until the last frame writes the var()", async () => {
    const box = mountFlip({ "background-color": "#ff0000" } as WardicValues, { "background-color": "var(--brand)" } as WardicValues, {
      type: "tween",
      duration: 0.6,
    })
    await settle()
    box.flip()
    await wait(150)
    box.parent().style.setProperty("--brand", "#00ff00")
    const frames = await sampleFor(700, () => backgroundOf(box.el()))
    const beforeLast = frames.slice(0, -1).filter(([, g]) => g === 0)
    expect(beforeLast.length, "it keeps blending toward the blue it resolved").toBeGreaterThan(3)
    expect(backgroundOf(box.el()), "then follows the green").toEqual([0, 255, 0, 1])
  })

  it("VB7: a shadow from none to var(--shadow) grows from its zero (the DOM's other rules still apply)", async () => {
    const box = mountFlip({ "box-shadow": "none" } as WardicValues, { "box-shadow": "var(--shadow)" } as WardicValues)
    await settle()
    box.flip()
    const frames = await sampleFor(700, () => getComputedStyle(box.el()).boxShadow)
    const growing = frames.filter((f) => /rgba\(255, 0, 0, 0\.\d+\) 0px 0px [\d.]+px/.test(f))
    expect(growing.length, "frames growing and fading in").toBeGreaterThan(5)
    expect(box.el().style.boxShadow).toBe("var(--shadow)")
  })

  it("VB8: a numeric variable: opacity 1 → var(--o) fades to 0.4 and rests as var(--o)", async () => {
    const box = mountFlip({ opacity: 1 } as WardicValues, { opacity: "var(--o)" } as WardicValues)
    await settle()
    box.flip()
    const frames = await sampleFor(700, () => Number(getComputedStyle(box.el()).opacity))
    expect(frames.filter((o) => o > 0.45 && o < 0.95).length, "frames in between").toBeGreaterThan(5)
    expect(Number(getComputedStyle(box.el()).opacity)).toBeCloseTo(0.4, 5)
    expect(box.el().style.opacity).toBe("var(--o)")
  })

  it("VB9: a presence exit to a var() blends what it resolves to on the leaving element", async () => {
    let el!: HTMLElement
    const [shown, setShown] = createSignal(true)
    render(() => (
      <WardicProvider env={DomLive}>
        <div style={VARS}>
          <AnimatePresence>
            <Show when={shown()}>
              <wardic.div
                ref={(n: HTMLElement) => (el = n)}
                style={{ ...BOX, "background-color": "#ff0000" }}
                exit={{ "background-color": "var(--brand)" } as WardicValues}
              />
            </Show>
          </AnimatePresence>
        </div>
      </WardicProvider>
    ))
    await settle()
    const leaving = el
    setShown(false)
    const frames = await sampleFor(900, () => (leaving.isConnected ? backgroundOf(leaving) : undefined))
    const between = frames.filter((f): f is Rgba => f !== undefined && f[0] > 10 && f[0] < 245 && f[2] > 10 && f[2] < 245)
    expect(between.length, "frames in between before it goes").toBeGreaterThan(3)
  })
})
