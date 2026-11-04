// The `layout` Feature (#511, ADR-0067), on the Solid 1 binding: the projection system is a Feature,
// built once for its provider when an element whose section has it first asks, or when a component
// that brings it does.
// - FL1, without `layout`, a `w.div`'s `layout` does nothing: the element jumps, and development says so
//   once per provider, naming the import.
// - FL2, `layout` given at once to the provider: a `w.div` animates its layout change, declared through a
//   `useAnimateLayout` taken before anything built `layout`.
// - FL3, `layout` loaded lazily: no word while it's on its way, and an element mounted once it's here
//   animates its layout change.
// - FL4, what brings no Feature works without `layout`, and builds none: an `AnimatePresence`'s Slim
//   child exits, and `useAnimateLayout` runs its change and settles. `LayoutGroup` brings it.
// - FL6 (#535), a provider builds its own Features at the browser's idle time once it has mounted, with
//   no element under it: none at its mount, `layout` once idle.
// - FL5, `colors` given at once to the provider: a `w.div` reads `oklch()` as a colour. #515's sections
//   built such Features only when something read them, which no element did. Last, as colour spaces are
//   the page's.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, colors, type FeatureLoad, layout, LayoutGroup, LazyWardic, useAnimateLayout, w, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useBuiltProjection } from "../src/provider.tsx"
import { leftOf, raf, until } from "./browser-helpers.ts"
import { resetScene, sampleFrames, settle, wait } from "./reorder-harness.tsx"

afterEach(async () => {
  await resetScene()
  cleanup()
})

const CSS = `
  .fl-stage{position:relative;width:600px;height:120px}
  .fl-box{position:absolute;top:0;left:0;width:100px;height:100px}
  .fl-box.moved{left:200px}
`
const LAYOUT_WORD = "needs the `layout` Feature"

/** Every line logged while `run` runs. */
const logged = async (run: () => Promise<void>): Promise<ReadonlyArray<string>> => {
  const lines: Array<string> = []
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: Array<unknown>) => {
      lines.push(args.map(String).join(" "))
    }),
  )
  try {
    await run()
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
  return lines
}

/** The lefts a box paints at, frame by frame, while `go` moves it 200 px right of `base`: those between. */
const between = async (el: () => HTMLElement, base: number, go: () => void): Promise<ReadonlyArray<number>> => {
  const sampling = sampleFrames(() => leftOf(el()))
  go()
  await wait(700)
  return sampling.stop().map((f) => f.v).filter((left) => left > base + 20 && left < base + 180)
}

/** Two oklch() colours, `on` the second. */
const tint = (on: boolean): string => Bool.match(on, { onTrue: () => "oklch(0.7 0.3 100)", onFalse: () => "oklch(0.5 0.1 200)" })

describe("The layout Feature (#511), Solid 1", () => {
  it("FL1: without `layout`, a w.div's layout prop does nothing, and development says so once per provider", async () => {
    const [moved, setMoved] = createSignal(false)
    const els: Array<HTMLElement> = []
    const lines = await logged(async () => {
      render(() => (
        <WardicProvider env={DomLive}>
          <style>{CSS}</style>
          <div class="fl-stage">
            <For each={[0, 1]}>{() => <w.div ref={(n: HTMLElement) => els.push(n)} class="fl-box" classList={{ moved: moved() }} layout layoutDependency={moved()} />}</For>
          </div>
        </WardicProvider>
      ))
      await raf()
      await raf()
      const base = leftOf(els[0]!)
      expect(await between(() => els[0]!, base, () => setMoved(true)), "no frame between: it jumps").toEqual([])
    })
    const words = lines.filter((l) => l.includes(LAYOUT_WORD))
    expect(words, "one word for two elements").toHaveLength(1)
    expect(words[0]).toContain('import { layout } from "@wardic/solid"')
    expect(words[0], "no Complete element, which `strict` makes an error (#581)").not.toContain("wardic.*")
  })

  it("FL2: `layout` given at once to the provider: a w.div animates its layout change, declared before it's built", async () => {
    const [moved, setMoved] = createSignal(false)
    let el!: HTMLElement
    // Taken before any element builds `layout`: it reads the projection system at each call.
    let animateLayout!: ReturnType<typeof useAnimateLayout>
    const Probe = (): JSX.Element => {
      animateLayout = useAnimateLayout()
      return undefined
    }
    render(() => (
      <WardicProvider env={DomLive} features={[layout]}>
        <style>{CSS}</style>
        <Probe />
        <div class="fl-stage">
          <w.div ref={(n: HTMLElement) => (el = n)} class="fl-box" classList={{ moved: moved() }} layout />
        </div>
      </WardicProvider>
    ))
    await raf()
    await raf()
    const base = leftOf(el)
    expect((await between(() => el, base, () => animateLayout(() => setMoved(true)))).length, "frames between").toBeGreaterThan(3)
    await until(() => Math.abs(leftOf(el) - (base + 200)) < 1)
  })

  it("FL3: `layout` loaded lazily: no word while it's on its way, and an element mounted once it's here animates", async () => {
    let arrive!: () => void
    const load: FeatureLoad = () =>
      new Promise((resolve) => {
        arrive = () => resolve([layout])
      })
    const [shown, setShown] = createSignal(false)
    const [moved, setMoved] = createSignal(false)
    let el!: HTMLElement
    const lines = await logged(async () => {
      render(() => (
        <WardicProvider env={DomLive}>
          <style>{CSS}</style>
          <div class="fl-stage">
            <LazyWardic features={load}>
              <w.div class="fl-box" layout />
              <Show when={shown()}>
                <w.div ref={(n: HTMLElement) => (el = n)} class="fl-box" classList={{ moved: moved() }} layout layoutDependency={moved()} />
              </Show>
            </LazyWardic>
          </div>
        </WardicProvider>
      ))
      await settle()
    })
    expect(lines.filter((l) => l.includes(LAYOUT_WORD)), "nothing said while the load is on its way").toEqual([])
    arrive()
    await wait(50)
    setShown(true)
    await raf()
    await raf()
    const base = leftOf(el)
    expect((await between(() => el, base, () => setMoved(true))).length, "frames between").toBeGreaterThan(3)
  })

  it("FL4: an AnimatePresence's Slim child exits and useAnimateLayout settles without `layout`, building none; LayoutGroup brings it", async () => {
    const [shown, setShown] = createSignal(true)
    let built!: () => unknown
    let animateLayout!: ReturnType<typeof useAnimateLayout>
    const Probe = (): JSX.Element => {
      built = useBuiltProjection()
      animateLayout = useAnimateLayout()
      return undefined
    }
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <Probe />
        <AnimatePresence>
          <Show when={shown()}>
            <w.div data-leaver style={{ width: "40px", height: "40px" }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await settle()
    setShown(false)
    await until(() => container.querySelector("[data-leaver]") === null, 2000)
    expect(container.querySelector("[data-leaver]"), "the exit ran and the child went").toBeNull()
    let settled = false
    expect(animateLayout(() => 7, { onSettled: () => (settled = true) }), "the change ran").toBe(7)
    expect(settled, "and settled").toBe(true)
    expect(built(), "no projection system built").toBeUndefined()

    cleanup()
    render(() => (
      <WardicProvider env={DomLive}>
        <Probe />
        <LayoutGroup>
          <div />
        </LayoutGroup>
      </WardicProvider>
    ))
    expect(built(), "LayoutGroup built it").toBeDefined()
  })

  it("FL6: a provider builds its own Features at idle once it has mounted, with no element under it", async () => {
    let built!: () => unknown
    const Probe = (): JSX.Element => {
      built = useBuiltProjection()
      return null
    }
    render(() => (
      <WardicProvider env={DomLive} features={[layout]}>
        <Probe />
      </WardicProvider>
    ))
    expect(built(), "none at its mount").toBeUndefined()
    await until(() => built() !== undefined, 2000, "`layout` built at idle")
  })

  it("FL5: `colors` given at once to the provider: a w.div reads oklch() as a colour", async () => {
    const [on, setOn] = createSignal(false)
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive} features={[colors]}>
        <w.div
          ref={(n: HTMLElement) => (el = n)}
          style={{ width: "40px", height: "40px" }}
          initial={{ "background-color": tint(false) }}
          animate={{ "background-color": tint(on()) }}
          transition={{ type: "tween", duration: 0.4 }}
        />
      </WardicProvider>
    ))
    await settle()
    const sampling = sampleFrames(() => el.style.backgroundColor)
    setOn(true)
    await wait(500)
    const painted = sampling.stop().map((f) => f.v)
    expect(painted.filter((v) => v.startsWith("rgb")).length, "frames in sRGB").toBeGreaterThan(3)
  })
})
