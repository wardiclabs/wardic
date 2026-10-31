// `transformTemplate` on Solid 2 (#443): Solid 1's TT cases, the prop given to the element, and as a
// ward config key, read as it is (a callback key, never called as an accessor).
//
// - TTV1: its keys in Motion's units and Wardic's transform; its Starting style drawn through it.
// - TTV3: a centred layout element stays centred through a layout animation.
// - TTV4: a template given after mount is drawn at its next frame.
// - TTV5: `ward({ transformTemplate })`: the function is the template, not an accessor of one.
// - TTV6: a presence exit is drawn through the template.
// - TTV7: with nothing to animate, it keeps its Starting style: the template doesn't commit alone.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, ward, wardic, type WardicTransformTemplate, WardicProvider } from "@wardic/solid/unstable/v2"
import { createSignal, flush, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { leftOf, raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const FLY = { type: "tween", duration: 0.5 } as const

const rotated: WardicTransformTemplate = (_, generated) => `rotate(10deg) ${generated}`.trim()

/** Each frame until `done`, `read()` after it. */
const watch = async <A,>(read: () => A, done: () => boolean, timeoutMs = 3000): Promise<ReadonlyArray<A>> => {
  const seen: Array<A> = []
  await until(() => {
    seen.push(read())
    return done()
  }, timeoutMs)
  return seen
}

describe("transformTemplate on Solid 2 (#443)", () => {
  it("TTV1: its keys in Motion's units and Wardic's transform; its Starting style drawn through it", async () => {
    const calls: Array<readonly [Readonly<Record<string, string | number>>, string]> = []
    const template: WardicTransformTemplate = (values, generated) => {
      calls.push([{ ...values }, generated])
      return rotated(values, generated)
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div data-t initial={{ x: 10 }} animate={{ x: 100 }} transition={FLY} transformTemplate={template} />
      </WardicProvider>
    ))
    const el = host.querySelector<HTMLElement>("[data-t]")!
    expect(el.style.transform).toBe("rotate(10deg) translateX(10px)")
    await until(() => el.style.transform === "rotate(10deg) translateX(100px)", 3000)
    expect(el.style.transform).toBe("rotate(10deg) translateX(100px)")
    for (const [values, generated] of calls) {
      expect(values.x, "x in px").toMatch(/^-?[\d.e-]+px$/)
      expect(generated).toBe(`translateX(${values.x})`)
    }
  })

  it("TTV3: a centred layout element stays centred through a layout animation", async () => {
    const [width, setWidth] = createSignal(100)
    const { host } = mount(() => (
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
    const root = host.querySelector<HTMLElement>("[data-root]")!
    const el = host.querySelector<HTMLElement>("[data-t]")!
    for (let i = 0; i < 4; i++) await raf()
    const centre = leftOf(root) + 200
    const box = (): DOMRect => el.getBoundingClientRect()
    expect(box().left + box().width / 2, "centred at rest").toBeCloseTo(centre, 0)
    setWidth(300)
    flush()
    const start = performance.now()
    const frames = await watch(box, () => performance.now() - start > 700)
    expect(frames[1]!.width, "starts near its old width").toBeLessThan(150)
    expect(frames.at(-1)!.width).toBeCloseTo(300, 0)
    for (const frame of frames) expect(frame.left + frame.width / 2, `centred each frame (${frame.left}, ${frame.width})`).toBeCloseTo(centre, 0)
  })

  it("TTV4: a template given after mount is drawn at its next frame", async () => {
    // A function given to Solid 2's `createSignal` is its compute: the template is what it returns.
    const [template, setTemplate] = createSignal<WardicTransformTemplate>(() => rotated)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div data-t animate={{ x: 20 }} transition={{ duration: 0.05 }} transformTemplate={template()} />
      </WardicProvider>
    ))
    const el = host.querySelector<HTMLElement>("[data-t]")!
    await until(() => el.style.transform === "rotate(10deg) translateX(20px)", 3000)
    setTemplate(() => (_: unknown, generated: string) => `${generated} scale(2)`)
    flush()
    await raf()
    await raf()
    expect(el.style.transform).toBe("translateX(20px) scale(2)")
  })

  it("TTV5: ward({ transformTemplate }): the function is the template, not an accessor of one", async () => {
    const Card = () => {
      const card = ward({ initial: { x: 5 }, animate: { x: 30 }, transition: { duration: 0.05 }, transformTemplate: rotated })
      return <div data-t {...card()} />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    const el = host.querySelector<HTMLElement>("[data-t]")!
    expect(el.style.transform).toBe("rotate(10deg) translateX(5px)")
    await until(() => el.style.transform === "rotate(10deg) translateX(30px)", 3000)
    expect(el.style.transform).toBe("rotate(10deg) translateX(30px)")
  })

  it("TTV6: a presence exit is drawn through the template", async () => {
    const [on, setOn] = createSignal(true)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={on()}>
            <wardic.div data-t exit={{ x: 60 }} transition={FLY} transformTemplate={rotated} />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    const el = host.querySelector<HTMLElement>("[data-t]")!
    await raf()
    await raf()
    setOn(false)
    flush()
    const drawn = await watch(() => el.style.transform, () => !el.isConnected)
    const moving = drawn.filter((transform) => transform.includes("translateX"))
    expect(moving.length, "its exit moved it").toBeGreaterThan(3)
    expect(moving.every((transform) => transform.startsWith("rotate(10deg) translateX(")), JSON.stringify(moving)).toBe(true)
  })

  it("TTV7: with nothing to animate, it keeps its Starting style: the template doesn't commit alone", async () => {
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div data-t initial={{ opacity: 0.5 }} transformTemplate={rotated} />
      </WardicProvider>
    ))
    const el = host.querySelector<HTMLElement>("[data-t]")!
    for (let i = 0; i < 6; i++) await raf()
    expect(el.style.opacity).toBe("0.5")
    expect(el.style.transform).toBe("rotate(10deg)")
  })
})
