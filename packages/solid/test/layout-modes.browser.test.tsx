// A Layout mode with real paint (#42, ADR-0009 *Amendment (#42)*): the `layout` prop's mode reaches
// the projection engine, is read at each layout animation's start, and a `Reorder.Item` takes
// `true` or `"position"`. Each frame's painted box is read after paint. Before #42 a string mode
// registered no projection node, so the element jumped with no layout animation at all.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { Reorder, wardic, WardicProvider } from "@wardic/solid"
import { createSignal, For, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { resetScene, sampleFrames, wait } from "./reorder-harness.tsx"

afterEach(async () => {
  await resetScene()
  cleanup()
})

const SPRING = { type: "spring", stiffness: 170, damping: 26 } as const

interface Painted {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}
const paintedOf = (el: Element): Painted => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}
const near = (a: number, b: number, tol = 0.5): boolean => Math.abs(a - b) < tol
const between = (v: number, lo: number, hi: number): boolean => v > lo + 1 && v < hi - 1

/** A box at (40, 40), 100x50, under `layout`; `go()` moves it to (140, 60) and makes it 200 wide. */
const mountBox = (layout: () => boolean | "position" | "size" | "x" | "y" | "preserve-aspect") => {
  let el!: HTMLElement
  const [go, setGo] = createSignal(false)
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div
        ref={(n: HTMLElement) => (el = n)}
        layout={layout()}
        layoutDependency={go()}
        transition={SPRING}
        style={{ position: "absolute", left: go() ? "140px" : "40px", top: go() ? "60px" : "40px", width: go() ? "200px" : "100px", height: "50px", background: "#68c" }}
      />
    </WardicProvider>
  ))
  return { el: () => el, go: () => setGo((g) => !g) }
}

/** `read` after every painted frame for `ms`. */
const sampleFor = async <A,>(ms: number, read: () => A): Promise<Array<A>> => {
  const s = sampleFrames(read)
  await wait(ms)
  return s.stop().map((f) => f.v)
}

describe("a Layout mode with real paint (#42)", () => {
  it("LS1: layout=\"position\" paints the new width from the first frame and slides its top-left", async () => {
    const box = mountBox(() => "position")
    await wait(100)
    const origin = paintedOf(box.el())
    box.go()
    const frames = await sampleFor(500, () => paintedOf(box.el()))
    const moving = frames.filter((f) => between(f.left, origin.left, origin.left + 100))
    expect(moving.length, "frames on the way").toBeGreaterThan(3)
    for (const f of frames) expect(near(f.width, 200), `width ${f.width}`).toBe(true)
  })

  it("LS2: layout=\"size\" paints the new place from the first frame and grows", async () => {
    const box = mountBox(() => "size")
    await wait(100)
    const origin = paintedOf(box.el())
    box.go()
    const frames = await sampleFor(500, () => paintedOf(box.el()))
    for (const f of frames) expect(near(f.left, origin.left + 100) && near(f.top, origin.top + 20), `at ${f.left},${f.top}`).toBe(true)
    expect(frames.filter((f) => between(f.width, 100, 200)).length, "frames growing").toBeGreaterThan(3)
  })

  it("LS3: the mode is read at each layout animation's start: position, then true", async () => {
    const [mode, setMode] = createSignal<"position" | true>("position")
    const box = mountBox(mode)
    await wait(100)
    box.go()
    const first = await sampleFor(900, () => paintedOf(box.el()))
    for (const f of first) expect(near(f.width, 200), `first change, width ${f.width}`).toBe(true)
    setMode(true)
    box.go()
    const second = await sampleFor(500, () => paintedOf(box.el()))
    expect(second.filter((f) => between(f.width, 100, 200)).length, "the second change scales").toBeGreaterThan(3)
  })

  it("LS4 (guard): layout={true} scales from its old size, as before", async () => {
    const box = mountBox(() => true)
    await wait(100)
    box.go()
    const frames = await sampleFor(500, () => paintedOf(box.el()))
    expect(frames.filter((f) => between(f.width, 100, 200)).length).toBeGreaterThan(3)
  })

  it("LS5: a Reorder.Item with layout=\"position\" takes its new cell's width at once; with true it scales", async () => {
    // A grid of a 100 px and a 200 px column: swapping the two items changes each one's width.
    const run = async (layout: true | "position"): Promise<Array<number>> => {
      const [values, setValues] = createSignal(["a", "b"])
      render(() => (
        <WardicProvider env={DomLive}>
          <Reorder.Group
            as="div"
            axis="x"
            values={values()}
            onReorder={setValues}
            style={{ display: "grid", "grid-template-columns": "100px 200px", width: "300px", position: "absolute", left: "40px", top: "40px" }}
          >
            <For each={values()}>
              {(v) => (
                <Reorder.Item as="div" value={v} data-v={v} layout={layout} transition={SPRING} style={{ height: "40px", background: "#68c" } as JSX.CSSProperties} />
              )}
            </For>
          </Reorder.Group>
        </WardicProvider>
      ))
      await wait(150)
      const a = document.querySelector<HTMLElement>("[data-v=a]")!
      setValues(["b", "a"])
      const widths = await sampleFor(500, () => a.getBoundingClientRect().width)
      await resetScene()
      cleanup()
      return widths
    }
    const position = await run("position")
    for (const w of position) expect(near(w, 200), `position: width ${w}`).toBe(true)
    const both = await run(true)
    expect(both.filter((w) => between(w, 100, 200)).length, "true: it scales").toBeGreaterThan(3)
  })
})
