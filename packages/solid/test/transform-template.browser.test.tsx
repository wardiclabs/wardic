// `transformTemplate` on Solid 1 (#443, Motion's prop), in a real browser: the element's whole
// transform, from its values and the one Wardic would draw, wherever it's drawn.
//
// - TT1: at rest and animating: its transform keys in Motion's units, and the transform Wardic would
//   draw; its Starting style is drawn through it too, before the first commit.
// - TT2: an element with no transform key takes its template's transform from the start.
// - TT3: a centred layout element (`left: 50%`, `translateX(-50%)`) stays centred through a layout
//   animation: a Measure pass holds it at its template's, so the boxes it flies between are the
//   centred ones. Held at identity, its first frame jumped 100 px left.
// - TT4: a template the element is given after mount is drawn at its next frame.
// - TT5: `onUpdate` never sees the template.
// - TT6: a presence exit is drawn through the template.
// - TT7: an element with a template and nothing to animate keeps its Starting style: the template
//   doesn't commit alone, which would take its `initial` off.
// - TT9: a layout child leaving while its layout parent resizes is drawn by the projection through
//   its template each frame, from its exit's values, as the parent's scale is taken off it.
// - TT8: a keyed child back mid-exit takes over from its leaver through its own template, not the
//   leaver's: a template isn't one of the values it takes over. Its next Retarget runs, and nothing
//   fails.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, type WardicTransformTemplate, WardicProvider } from "@wardic/solid"
import { createSignal, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { leftOf, raf, until } from "./browser-helpers.ts"
import { envWith, type Logged } from "./report-env.ts"

afterEach(cleanup)

const FLY = { type: "tween", duration: 0.5 } as const

/** A template drawing `rotate(10deg)` before what Wardic would draw, recording what it's handed. */
const recording = () => {
  const calls: Array<readonly [Readonly<Record<string, string | number>>, string]> = []
  const template: WardicTransformTemplate = (values, generated) => {
    calls.push([{ ...values }, generated])
    return `rotate(10deg) ${generated}`.trim()
  }
  return { calls, template }
}

/** Each frame until `done`, `read()` after it. */
const watch = async <A,>(read: () => A, done: () => boolean, timeoutMs = 3000): Promise<ReadonlyArray<A>> => {
  const seen: Array<A> = []
  await until(() => {
    seen.push(read())
    return done()
  }, timeoutMs)
  return seen
}

describe("transformTemplate at rest and animating on Solid 1 (#443)", () => {
  it("TT1: its keys in Motion's units and Wardic's transform; its Starting style drawn through it", async () => {
    const { calls, template } = recording()
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div data-t initial={{ x: 10 }} animate={{ x: 100 }} transition={FLY} transformTemplate={template} />
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-t]")!
    // Before the first commit: the Starting style's.
    expect(el.style.transform).toBe("rotate(10deg) translateX(10px)")
    await until(() => el.style.transform === "rotate(10deg) translateX(100px)", 3000)
    expect(el.style.transform).toBe("rotate(10deg) translateX(100px)")
    // Every call: `x` in px, and the transform Wardic would draw.
    for (const [values, generated] of calls) {
      expect(values.x, "x in px").toMatch(/^-?[\d.e-]+px$/)
      expect(generated).toBe(`translateX(${values.x})`)
    }
  })

  it("TT2: with no transform key, its template's transform from the start", async () => {
    const { calls, template } = recording()
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div data-t initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={FLY} transformTemplate={template} />
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-t]")!
    expect(el.style.transform).toBe("rotate(10deg)")
    await until(() => el.style.opacity === "1", 3000)
    expect(el.style.transform).toBe("rotate(10deg)")
    expect(calls.every(([values, generated]) => Object.keys(values).length === 0 && generated === ""), "({}, \"\") each time").toBe(true)
  })

  it("TT4: a template given after mount is drawn at its next frame", async () => {
    const [template, setTemplate] = createSignal<WardicTransformTemplate>((_, generated) => `rotate(10deg) ${generated}`.trim())
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div data-t animate={{ x: 20 }} transition={{ duration: 0.05 }} transformTemplate={template()} />
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-t]")!
    await until(() => el.style.transform === "rotate(10deg) translateX(20px)", 3000)
    setTemplate(() => (_: unknown, generated: string) => `${generated} scale(2)`)
    await raf()
    await raf()
    expect(el.style.transform).toBe("translateX(20px) scale(2)")
  })

  it("TT5: onUpdate never sees the template", async () => {
    const { template } = recording()
    const seen: Array<ReadonlyArray<string>> = []
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div data-t animate={{ x: 20 }} transition={{ duration: 0.1 }} transformTemplate={template} onUpdate={(latest) => seen.push(Object.keys(latest))} />
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-t]")!
    await until(() => el.style.transform === "rotate(10deg) translateX(20px)", 3000)
    expect(seen.length, "told").toBeGreaterThan(0)
    expect(seen.every((keys) => keys.length === 1 && keys[0] === "x"), JSON.stringify(seen)).toBe(true)
  })

  it("TT6: a presence exit is drawn through the template", async () => {
    const { template } = recording()
    const [on, setOn] = createSignal(true)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={on()}>
            <wardic.div data-t exit={{ x: 60 }} transition={FLY} transformTemplate={template} />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-t]")!
    await raf()
    await raf()
    setOn(false)
    const drawn = await watch(() => el.style.transform, () => !el.isConnected)
    const moving = drawn.filter((transform) => transform.includes("translateX"))
    expect(moving.length, "its exit moved it").toBeGreaterThan(3)
    expect(moving.every((transform) => transform.startsWith("rotate(10deg) translateX(")), JSON.stringify(moving)).toBe(true)
  })

  it("TT7: with nothing to animate, it keeps its Starting style: the template doesn't commit alone", async () => {
    const { template } = recording()
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div data-t initial={{ opacity: 0.5 }} transformTemplate={template} />
      </WardicProvider>
    ))
    const el = container.querySelector<HTMLElement>("[data-t]")!
    for (let i = 0; i < 6; i++) await raf()
    expect(el.style.opacity).toBe("0.5")
    expect(el.style.transform).toBe("rotate(10deg)")
  })

  it("TT8: a keyed child back mid-exit takes over through its own template, not its leaver's", async () => {
    const [template, setTemplate] = createSignal<WardicTransformTemplate>(recording().template)
    const [on, setOn] = createSignal(true)
    const [x, setX] = createSignal(0)
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const { container } = render(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <AnimatePresence>
          <Show when={on()}>
            <wardic.div key="k" data-t initial={{ x: 0 }} animate={{ x: x() }} exit={{ x: 80 }} transition={FLY} transformTemplate={template()} />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    const leaver = container.querySelector<HTMLElement>("[data-t]")!
    await raf()
    await raf()
    setOn(false)
    await until(() => /translateX\((?:[2-9]\d|1\d)/.test(leaver.style.transform), 2000)
    // The child comes back with another template; the leaver keeps its own.
    setTemplate(() => (_: unknown, generated: string) => `rotate(20deg) ${generated}`.trim())
    setOn(true)
    await raf()
    const back = container.querySelector<HTMLElement>("[data-t]")!
    expect(back, "a new node").not.toBe(leaver)
    expect(back.style.transform.startsWith("rotate(20deg) translateX("), `taken over through its own template: ${back.style.transform}`).toBe(true)
    await until(() => back.style.transform === "rotate(20deg)", 2000)
    setX(20)
    await until(() => back.style.transform === "rotate(20deg) translateX(20px)", 2000)
    expect(back.style.transform).toBe("rotate(20deg) translateX(20px)")
    expect(logs.filter((log) => log.level === "ERROR").map((log) => log.message)).toEqual([])
    expect(reports).toEqual([])
  })
})

describe("transformTemplate on a layout element on Solid 1 (#443)", () => {
  it("TT9: a layout child leaving as its layout parent resizes is drawn through its template each frame", async () => {
    const [on, setOn] = createSignal(true)
    const [width, setWidth] = createSignal(100)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div layout layoutDependency={width()} transition={FLY} style={{ position: "relative", width: `${width()}px`, height: "60px" }}>
          <AnimatePresence>
            <Show when={on()}>
              <wardic.div data-c layout exit={{ opacity: 0 }} transition={FLY} transformTemplate={(_, generated) => `rotate(10deg) ${generated}`.trim()} style={{ width: "40px", height: "40px" }} />
            </Show>
          </AnimatePresence>
        </wardic.div>
      </WardicProvider>
    ))
    const child = container.querySelector<HTMLElement>("[data-c]")!
    for (let i = 0; i < 4; i++) await raf()
    setOn(false)
    setWidth(300)
    const drawn = await watch(() => child.style.transform, () => !child.isConnected)
    const projected = drawn.filter((transform) => transform.includes("scale("))
    expect(projected.length, "the projection drew it as the parent scaled").toBeGreaterThan(3)
    expect(projected.every((transform) => transform.startsWith("rotate(10deg) ")), JSON.stringify(projected.slice(0, 4))).toBe(true)
  })

  it("TT3: a centred layout element stays centred through a layout animation", async () => {
    const [width, setWidth] = createSignal(100)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div data-root style={{ position: "relative", width: "400px", height: "60px" }}>
          <wardic.div
            data-t
            layout
            layoutDependency={width()}
            transition={FLY}
            transformTemplate={(_, generated) => `translateX(-50%) ${generated}`.trim()}
            style={{ position: "absolute", left: "50%", top: "0px", width: `${width()}px`, height: "40px", background: "#8af" }}
          />
        </div>
      </WardicProvider>
    ))
    const root = container.querySelector<HTMLElement>("[data-root]")!
    const el = container.querySelector<HTMLElement>("[data-t]")!
    for (let i = 0; i < 4; i++) await raf()
    const centre = leftOf(root) + 200
    const box = (): DOMRect => el.getBoundingClientRect()
    expect(box().left + box().width / 2, "centred at rest").toBeCloseTo(centre, 0)
    setWidth(300)
    const start = performance.now()
    const frames = await watch(box, () => performance.now() - start > 700)
    // It flew: from the old box's width to the new one's.
    expect(frames[1]!.width, "starts near its old width").toBeLessThan(150)
    expect(frames.at(-1)!.width).toBeCloseTo(300, 0)
    for (const frame of frames) expect(frame.left + frame.width / 2, `centred each frame (${frame.left}, ${frame.width})`).toBeCloseTo(centre, 0)
    expect(el.style.transform.startsWith("translateX(-50%)"), el.style.transform).toBe(true)
  })
})
