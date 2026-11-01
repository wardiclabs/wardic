// The `layout` Feature (#511, ADR-0067), on the Solid 2 binding, as `../features-layout.browser.test.tsx`
// is on Solid 1's.
// - FLV1, without `layout`, a `w.div`'s `layout` does nothing: the element jumps, and development says
//   so once per provider, naming the import.
// - FLV2, `layout` given at once to the provider: a `w.div` animates its layout change, declared
//   through a `useAnimateLayout` taken before anything built `layout`.
// - FLV3, `layout` loaded lazily: no word while it's on its way, and an element mounted once it's here
//   animates its layout change.
// - FLV4, what brings no Feature works without `layout`, and builds none: an `AnimatePresence`'s Slim
//   child exits, and `useAnimateLayout` runs its change and settles. `LayoutGroup` brings it.
// - FLV5, `colors` given at once to the provider: a `w.div` reads `oklch()` as a colour. #515's
//   sections built such Features only when something read them, which no element did. Last, as colour
//   spaces are the page's.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, colors, type FeatureLoad, layout, LayoutGroup, LazyWardic, useAnimateLayout, w, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { createSignal, flush, For, Show } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { useBuiltProjection } from "../../src/unstable/v2/provider.tsx"
import { leftOf, raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"
import { sampleFrames, settle, wait } from "./reorder-scene.tsx"

const BOX = { position: "absolute", top: "0px", left: "0px", width: "100px", height: "100px" } as const
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
  flush()
  await wait(700)
  return sampling.stop().map((f) => f.v).filter((left) => left > base + 20 && left < base + 180)
}

/** A stage padded `left` px on the left: its boxes move with it. */
const stage = (left: () => number): JSX.CSSProperties => ({ position: "relative", width: "600px", height: "120px", "padding-left": `${left()}px` })

/** Two oklch() colours, `on` the second. */
const tint = (on: boolean): string => Bool.match(on, { onTrue: () => "oklch(0.7 0.3 100)", onFalse: () => "oklch(0.5 0.1 200)" })

describe("The layout Feature (#511), Solid 2", () => {
  it("FLV1: without `layout`, a w.div's layout prop does nothing, and development says so once per provider", async () => {
    const [left, setLeft] = createSignal(0)
    const els: Array<HTMLElement> = []
    const lines = await logged(async () => {
      mount(() => (
        <WardicProvider env={DomLive}>
          <div style={stage(left)}>
            <For each={[0, 1]}>{() => <w.div ref={(n: HTMLElement) => els.push(n)} style={{ ...BOX, position: "relative" }} layout layoutDependency={left()} />}</For>
          </div>
        </WardicProvider>
      ))
      await raf()
      await raf()
      const base = leftOf(els[0]!)
      expect(await between(() => els[0]!, base, () => setLeft(200)), "no frame between: it jumps").toEqual([])
    })
    const words = lines.filter((l) => l.includes(LAYOUT_WORD))
    expect(words, "one word for two elements").toHaveLength(1)
    expect(words[0]).toContain('import { layout } from "@wardic/solid/unstable/v2"')
  })

  it("FLV2: `layout` given at once to the provider: a w.div animates its layout change, declared before it's built", async () => {
    const [left, setLeft] = createSignal(0)
    let el!: HTMLElement
    // Taken before any element builds `layout`: it reads the projection system at each call.
    let animateLayout!: ReturnType<typeof useAnimateLayout>
    const Probe = (): JSX.Element => {
      animateLayout = useAnimateLayout()
      return undefined
    }
    mount(() => (
      <WardicProvider env={DomLive} features={[layout]}>
        <Probe />
        <div style={stage(left)}>
          <w.div ref={(n: HTMLElement) => (el = n)} style={{ ...BOX, position: "relative" }} layout />
        </div>
      </WardicProvider>
    ))
    await raf()
    await raf()
    const base = leftOf(el)
    const moves = await between(
      () => el,
      base,
      () =>
        void animateLayout(() => {
          setLeft(200)
          flush()
        }),
    )
    expect(moves.length, "frames between").toBeGreaterThan(3)
    await until(() => Math.abs(leftOf(el) - (base + 200)) < 1)
  })

  it("FLV3: `layout` loaded lazily: no word while it's on its way, and an element mounted once it's here animates", async () => {
    let arrive!: () => void
    const load: FeatureLoad = () =>
      new Promise((resolve) => {
        arrive = () => resolve([layout])
      })
    const [shown, setShown] = createSignal(false)
    const [left, setLeft] = createSignal(0)
    let el!: HTMLElement
    const lines = await logged(async () => {
      mount(() => (
        <WardicProvider env={DomLive}>
          <div style={stage(left)}>
            <LazyWardic features={load}>
              <w.div style={BOX} layout />
              <Show when={shown()}>
                <w.div ref={(n: HTMLElement) => (el = n)} style={{ ...BOX, position: "relative" }} layout layoutDependency={left()} />
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
    flush()
    await raf()
    await raf()
    const base = leftOf(el)
    expect((await between(() => el, base, () => setLeft(200))).length, "frames between").toBeGreaterThan(3)
  })

  it("FLV4: an AnimatePresence's Slim child exits and useAnimateLayout settles without `layout`, building none; LayoutGroup brings it", async () => {
    const [shown, setShown] = createSignal(true)
    let built!: () => unknown
    let animateLayout!: ReturnType<typeof useAnimateLayout>
    const Probe = (): JSX.Element => {
      built = useBuiltProjection()
      animateLayout = useAnimateLayout()
      return undefined
    }
    const first = mount(() => (
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
    flush()
    await until(() => first.host.querySelector("[data-leaver]") === null, 2000)
    expect(first.host.querySelector("[data-leaver]"), "the exit ran and the child went").toBeNull()
    await expect(animateLayout(() => 7), "the change ran and settled").resolves.toBe(7)
    expect(built(), "no projection system built").toBeUndefined()

    first.unmount()
    mount(() => (
      <WardicProvider env={DomLive}>
        <Probe />
        <LayoutGroup>
          <div />
        </LayoutGroup>
      </WardicProvider>
    ))
    expect(built(), "LayoutGroup built it").toBeDefined()
  })

  it("FLV5: `colors` given at once to the provider: a w.div reads oklch() as a colour", async () => {
    const [on, setOn] = createSignal(false)
    let el!: HTMLElement
    mount(() => (
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
    flush()
    await wait(500)
    const painted = sampling.stop().map((f) => f.v)
    expect(painted.filter((v) => v.startsWith("rgb")).length, "frames in sRGB").toBeGreaterThan(3)
  })
})
