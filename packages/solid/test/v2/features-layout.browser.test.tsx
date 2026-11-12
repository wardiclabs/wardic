// The `layout` Feature (#511, ADR-0067), on the Solid 2 binding, as `../features-layout.browser.test.tsx`
// is on Solid 1's.
// - FLV1, without `layout`, a `w.div`'s `layout` does nothing: the element jumps, and development says
//   so once per provider, naming the import.
// - FLV2, `layout` given at once to the provider: a `w.div` animates its layout change, declared
//   through a `useAnimateLayout` taken before anything built `layout`.
// - FLV3, `layout` loaded lazily: no word while it's on its way, and an element mounted once it's here
//   animates its layout change.
// - FLV7 (#582), an element mounted while `layout` is on its way makes its node as it arrives, and
//   animates its next layout change, as Motion's does.
// - FLV8 (#582), a lazy load that lands without `layout`: development says so then, once.
// - FLV9 (#582), `drag` and `layout` from one lazy load: an element mounted while they're on their way
//   drags as one that had both at mount, through its layout node.
// - FLV4, what brings no Feature works without `layout`, and builds none: an `AnimatePresence`'s Slim
//   child exits, and `useAnimateLayout` runs its change and settles. `LayoutGroup` brings it.
// - FLV6 (#535), a provider builds its own Features at the browser's idle time once it has settled, with
//   no element under it: none at its mount, `layout` once idle.
// - FLV5, `colors` given at once to the provider: a `w.div` reads `oklch()` as a colour. #515's
//   sections built such Features only when something read them, which no element did. Last, as colour
//   spaces are the page's.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, colors, drag, type FeatureLoad, type FeaturesProp, hover, layout, LayoutGroup, LazyWardic, useAnimateLayout, w, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { constVoid } from "effect/Function"
import { createSignal, flush, For, Show } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { useBuiltProjection } from "../../src/unstable/v2/provider.tsx"
import { leftOf, raf, until } from "../browser-helpers.ts"
import { pushedPointer } from "../pushed-pointer.ts"
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
    expect(words[0], "no Complete element, which `strict` makes an error (#581)").not.toContain("wardic.*")
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

  it("FLV7: `layout` loaded lazily: an element mounted while it's on its way animates its layout change once it's here (#582)", async () => {
    let arrive!: () => void
    const load: FeatureLoad = () =>
      new Promise((resolve) => {
        arrive = () => resolve([layout])
      })
    const [left, setLeft] = createSignal(0)
    let el!: HTMLElement
    mount(() => (
      <WardicProvider env={DomLive}>
        <div style={stage(left)}>
          <LazyWardic features={load}>
            <w.div ref={(n: HTMLElement) => (el = n)} style={{ ...BOX, position: "relative" }} layout layoutDependency={left()} />
          </LazyWardic>
        </div>
      </WardicProvider>
    ))
    await settle()
    arrive()
    await wait(50)
    const base = leftOf(el)
    expect((await between(() => el, base, () => setLeft(200))).length, "frames between").toBeGreaterThan(3)
    await until(() => Math.abs(leftOf(el) - (base + 200)) < 1)
  })

  it("FLV8: a lazy load that lands without `layout`: development says so then, once (#582)", async () => {
    let arrive!: () => void
    const load: FeatureLoad = () =>
      new Promise((resolve) => {
        arrive = () => resolve([hover])
      })
    const before = await logged(async () => {
      mount(() => (
        <WardicProvider env={DomLive}>
          <div style={stage(() => 0)}>
            <LazyWardic features={load}>
              <For each={[0, 1]}>{() => <w.div style={BOX} layout />}</For>
            </LazyWardic>
          </div>
        </WardicProvider>
      ))
      await settle()
    })
    expect(before.filter((l) => l.includes(LAYOUT_WORD)), "nothing said while the load is on its way").toEqual([])
    const after = await logged(async () => {
      arrive()
      await wait(50)
    })
    expect(after.filter((l) => l.includes(LAYOUT_WORD)), "one word for two elements, once it has landed").toHaveLength(1)
  })

  it("FLV9: `drag` and `layout` from one lazy load: an element mounted while they're on their way drags as one that had them at mount (#582)", async () => {
    /** One gesture on a `w.div drag layout` under `features`: where it's drawn as it's held, and once it has landed. */
    const gesture = async (features: FeaturesProp, arrive: () => void): Promise<{ readonly held: number; readonly after: number }> => {
      // Pushed input: one draggable on the page at a time, as drags are claimed page-wide (ADR-0019).
      const pointer = pushedPointer()
      let el!: HTMLElement
      const scene = mount(() => (
        <WardicProvider env={pointer.env}>
          <div style={stage(() => 0)}>
            <LazyWardic features={features}>
              <w.div ref={(n: HTMLElement) => (el = n)} style={BOX} drag="x" dragMomentum={false} layout />
            </LazyWardic>
          </div>
        </WardicProvider>
      ))
      await settle()
      arrive()
      await wait(50)
      const x0 = leftOf(el)
      pointer.push("down", 0)
      for (let k = 1; k <= 5; k++) pointer.push("move", 20 * k)
      await raf()
      await raf()
      const held = leftOf(el) - x0
      pointer.push("up", 100)
      await wait(1200)
      const after = leftOf(el) - x0
      scene.unmount()
      return { held, after }
    }
    let arrive!: () => void
    const load: FeatureLoad = () =>
      new Promise((resolve) => {
        arrive = () => resolve([drag, layout])
      })
    const late = await gesture(load, () => arrive())
    const atMount = await gesture([drag, layout], constVoid)
    expect(late.held, "it follows the pointer").toBeGreaterThan(90)
    expect(Math.round(late.after), "and lands as the one that had both at mount").toBe(Math.round(atMount.after))
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

  it("FLV6: a provider builds its own Features at idle once it has settled, with no element under it", async () => {
    let built!: () => unknown
    const Probe = (): JSX.Element => {
      built = useBuiltProjection()
      return null
    }
    mount(() => (
      <WardicProvider env={DomLive} features={[layout]}>
        <Probe />
      </WardicProvider>
    ))
    expect(built(), "none at its mount").toBeUndefined()
    await until(() => built() !== undefined, 2000, "`layout` built at idle")
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
