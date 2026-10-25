// The Animatable none with real paint (#61, ADR-0015 *Amendment (#61)*): a shadow, a filter or a
// fill whose own value is `none` grows from its zero, and on the way back blends to that zero and
// rests at `none` itself. A shadow from a stylesheet, read colour first with its spread, blends both
// ways with an authored one (the shadow rule). Each frame's computed style is read after paint.
// Before #61 every one of these pairs switched at the first frame.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider, type WardicValues } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { until } from "./browser-helpers.ts"
import { resetScene, sampleFrames, settle, wait } from "./reorder-harness.tsx"

const sheet = document.createElement("style")
sheet.textContent = `.an-card { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); }`
document.head.append(sheet)

afterEach(async () => {
  await resetScene()
  cleanup()
})

const TWEEN = { type: "tween", duration: 0.4 } as const
const BOX: JSX.CSSProperties = { position: "absolute", left: "120px", top: "120px", width: "80px", height: "80px", background: "#68c" }

/** A computed shadow's blur radius and alpha (`rgba(r, g, b, a) x y blur spread`), or `none`. */
const shadowOf = (el: Element): { readonly blur: number; readonly alpha: number } | "none" => {
  const shadow = getComputedStyle(el).boxShadow
  if (shadow === "none") return "none"
  const colour = /rgba?\(([^)]+)\)/.exec(shadow)![1]!.split(",").map(Number)
  const lengths = shadow.replace(/rgba?\([^)]+\)/, "").trim().split(/\s+/).map(Number.parseFloat)
  return { blur: lengths[2]!, alpha: colour[3] ?? 1 }
}

/** A computed filter's blur radius, or `none`. */
const blurOf = (el: Element): number | "none" => {
  const filter = getComputedStyle(el).filter
  if (filter === "none") return "none"
  // A radius near 0 is painted in exponent form (`blur(3.1e-05px)`), as a tween's ends are.
  return Number.parseFloat(/blur\(([\d.e+-]+)px\)/.exec(filter)![1]!)
}

/** Every value of `read` painted over `ms`. */
const sampleFor = async <A,>(ms: number, read: () => A): Promise<Array<A>> => {
  const s = sampleFrames(read)
  await wait(ms)
  return s.stop().map((f) => f.v)
}

/** A `wardic.div` flipping between `off` and `on`. */
const mountToggle = (off: WardicValues, on: WardicValues, children?: JSX.Element) => {
  let el!: HTMLElement
  const [shown, setShown] = createSignal(false)
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} initial={off} animate={Bool.match(shown(), { onTrue: () => on, onFalse: () => off })} transition={TWEEN}>
        {children}
      </wardic.div>
    </WardicProvider>
  ))
  return { el: () => el, flip: () => setShown((s) => !s) }
}

describe("the Animatable none with real paint (#61)", () => {
  it("AB1: a box-shadow grows from none, fading in, and rests at none on the way back", async () => {
    const box = mountToggle({ boxShadow: "none" } as WardicValues, { boxShadow: "0px 0px 10px rgb(255, 0, 0)" } as WardicValues)
    await settle()
    expect(shadowOf(box.el())).toBe("none")
    box.flip()
    const growing = await sampleFor(700, () => shadowOf(box.el()))
    const between = growing.filter((s) => s !== "none" && s.blur > 0.5 && s.blur < 9.5 && s.alpha > 0.05 && s.alpha < 0.95)
    expect(between.length, "frames growing and fading in").toBeGreaterThan(5)
    box.flip()
    const shrinking = await sampleFor(700, () => shadowOf(box.el()))
    expect(shrinking.filter((s) => s !== "none" && s.blur > 0.5 && s.blur < 9.5).length, "frames shrinking").toBeGreaterThan(5)
    expect(shadowOf(box.el())).toBe("none")
    expect(box.el().style.boxShadow, "none at rest, not a zero shadow").toBe("none")
  })

  it("AB2: a blur grows from none, and rests at none, so a fixed child is placed by the viewport again", async () => {
    let child!: HTMLElement
    const box = mountToggle(
      { filter: "none" } as WardicValues,
      { filter: "blur(4px)" } as WardicValues,
      <div ref={(n: HTMLElement) => (child = n)} style={{ position: "fixed", left: "0px", top: "0px", width: "10px", height: "10px" }} />,
    )
    await settle()
    expect(child.getBoundingClientRect().left, "placed by the viewport").toBe(0)
    box.flip()
    const growing = await sampleFor(700, () => blurOf(box.el()))
    expect(growing.filter((b) => b !== "none" && b > 0.2 && b < 3.8).length, "frames blurring in").toBeGreaterThan(5)
    // A filter makes the card the fixed child's containing block while it runs.
    expect(child.getBoundingClientRect().left, "placed by the card while filtered").toBeGreaterThan(100)
    box.flip()
    await until(() => blurOf(box.el()) === "none", 2000)
    await settle()
    expect(box.el().style.filter, "none at rest, not blur(0px)").toBe("none")
    expect(child.getBoundingClientRect().left, "placed by the viewport again").toBe(0)
  })

  it("AB3: an SVG fill fades in from transparent, and rests at none on the way back", async () => {
    let circle!: SVGElement
    const [shown, setShown] = createSignal(false)
    render(() => (
      <WardicProvider env={DomLive}>
        <svg width="100" height="100" style={{ position: "absolute", left: "120px", top: "120px" }}>
          <wardic.circle
            ref={(n: SVGElement) => (circle = n)}
            cx={50}
            cy={50}
            r={40}
            initial={{ fill: "none" } as WardicValues}
            animate={Bool.match(shown(), { onTrue: () => ({ fill: "#ff0000" }), onFalse: () => ({ fill: "none" }) }) as WardicValues}
            transition={TWEEN}
          />
        </svg>
      </WardicProvider>
    ))
    await settle()
    expect(getComputedStyle(circle).fill).toBe("none")
    setShown(true)
    const fading = await sampleFor(700, () => getComputedStyle(circle).fill)
    expect(fading.filter((f) => /^rgba\(255, 0, 0, 0\.\d+\)$/.test(f)).length, "frames fading in").toBeGreaterThan(5)
    setShown(false)
    await until(() => getComputedStyle(circle).fill === "none", 2000)
    await settle()
    expect(getComputedStyle(circle).fill, "none at rest, not a transparent fill").toBe("none")
  })

  it("AB4: a stylesheet shadow blends into a larger one and back, though the browser writes it colour first with a spread", async () => {
    const box = (() => {
      let el!: HTMLElement
      const [on, setOn] = createSignal(false)
      render(() => (
        <WardicProvider env={DomLive}>
          <wardic.div
            ref={(n: HTMLElement) => (el = n)}
            class="an-card"
            style={BOX}
            animate={Bool.match(on(), { onTrue: () => ({ boxShadow: "0px 8px 24px rgba(0, 0, 0, 0.3)" }), onFalse: () => ({}) }) as WardicValues}
            transition={TWEEN}
          />
        </WardicProvider>
      ))
      return { el: () => el, flip: () => setOn((o) => !o) }
    })()
    await settle()
    box.flip()
    const growing = await sampleFor(700, () => shadowOf(box.el()))
    expect(growing.filter((s) => s !== "none" && s.blur > 2.5 && s.blur < 23.5).length, "frames growing").toBeGreaterThan(5)
    box.flip()
    const back = await sampleFor(700, () => shadowOf(box.el()))
    // Motion switches this way at once: the painted shadow has 3 numbers, the computed one 4.
    expect(back.filter((s) => s !== "none" && s.blur > 2.5 && s.blur < 23.5).length, "frames shrinking back").toBeGreaterThan(5)
    expect(getComputedStyle(box.el()).boxShadow).toBe("rgba(0, 0, 0, 0.2) 0px 1px 2px 0px")
  })
})
