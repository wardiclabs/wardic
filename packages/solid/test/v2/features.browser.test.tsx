// Features and the Slim element (#511, ADR-0067), on the Solid 2 binding, as `../features.browser.test.tsx`
// is on Solid 1's. culori keeps its colour spaces in one registry for the page, and a test file is a
// page of its own: the cases run in order, those before any `colors` first. The Complete element's own
// registration is `features-complete`'s.
// - FW1, `w.<tag>`, `w.create` and `w.ward()` animate values with no Feature.
// - FW2, without `colors`, a `w.div`'s `oklch()` isn't read as a colour, and development says so once
//   per provider, naming the import.
// - FW3, `colors` loaded lazily: no word while it's on its way, and once it arrives the element reads
//   a wide-gamut colour as a colour, from its next target on.
// - FW4, a section's Features: its provider's and every `LazyWardic`'s between, none of a sibling's.
// - FW5, `strict`: a Complete element under it is an error in development; a Slim one and a Reorder
//   aren't.
// - FW6, a failed lazy load is reported once, and its section stops waiting.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { colors, type FeatureLoad, LazyWardic, Reorder, w, ward, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { createSignal, Errored, flush, For, untrack } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { has } from "../../src/feature.ts"
import { useFeatureSection } from "../../src/unstable/v2/provider.tsx"
import { opacityOf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"
import { sampleFrames, settle, wait } from "./reorder-scene.tsx"

const BOX = { width: "40px", height: "40px" } as const
const TWEEN = { type: "tween", duration: 0.4 } as const
const COLORS_WORD = "needs the `colors` Feature"

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

/** The background colours a box paints while `go` sends it on. */
const flight = async (el: () => HTMLElement, go: () => void): Promise<ReadonlyArray<string>> => {
  const sampling = sampleFrames(() => el().style.backgroundColor)
  go()
  flush()
  await wait(500)
  return sampling.stop().map((f) => f.v)
}

/** Two oklch() colours, `on` the second. */
const tint = (on: boolean): string => Bool.match(on, { onTrue: () => "oklch(0.7 0.3 100)", onFalse: () => "oklch(0.5 0.1 200)" })

describe("Features and the Slim element (#511), Solid 2", () => {
  it("FW1: w.div, w.create and w.ward() animate values with no Feature", async () => {
    const Span = w.create("span")
    let div!: HTMLElement
    let span!: HTMLElement
    const Spread = (): JSX.Element => {
      const card = w.ward({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: TWEEN })
      return <div data-spread {...card} />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <w.div ref={(n: HTMLElement) => (div = n)} style={BOX} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={TWEEN} />
        <Span ref={(n: HTMLElement) => (span = n)} style={BOX} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={TWEEN} />
        <Spread />
      </WardicProvider>
    ))
    const spread = host.querySelector<HTMLElement>("[data-spread]")!
    await until(() => [div, span, spread].every((el) => opacityOf(el) === 1), 3000)
    expect([div, span, spread].map(opacityOf)).toEqual([1, 1, 1])
  })

  it("FW2: without `colors`, an oklch() isn't read as a colour, and development says so once per provider", async () => {
    const els: Array<HTMLElement> = []
    const [on, setOn] = createSignal(false)
    const lines = await logged(async () => {
      mount(() => (
        <WardicProvider env={DomLive}>
          <For each={[0, 1]}>
            {() => <w.div ref={(n: HTMLElement) => els.push(n)} style={BOX} initial={{ "background-color": tint(false) }} animate={{ "background-color": tint(on()) }} transition={TWEEN} />}
          </For>
        </WardicProvider>
      ))
      await settle()
      const painted = await flight(() => els[0]!, () => setOn(true))
      expect(painted.filter((v) => v.startsWith("rgb")), "no frame in sRGB").toEqual([])
      expect(painted.filter((v) => v.startsWith("oklch(") && v !== tint(false) && v !== tint(true)).length, "frames between, in oklch").toBeGreaterThan(3)
    })
    const words = lines.filter((l) => l.includes(COLORS_WORD))
    expect(words, "one word for two elements").toHaveLength(1)
    expect(words[0]).toContain('import { colors } from "@wardic/solid/unstable/v2"')
  })

  it("FW3: colors loaded lazily: no word while it's on its way, and from its arrival on, oklch() is a colour", async () => {
    let arrive!: () => void
    const load: FeatureLoad = () =>
      new Promise((resolve) => {
        arrive = () => resolve([colors])
      })
    let el!: HTMLElement
    const [target, setTarget] = createSignal("oklch(0.5 0.1 200)")
    const lines = await logged(async () => {
      mount(() => (
        <WardicProvider env={DomLive}>
          <LazyWardic features={load}>
            <w.div ref={(n: HTMLElement) => (el = n)} style={BOX} initial={{ "background-color": "oklch(0.5 0.1 200)" }} animate={{ "background-color": target() }} transition={TWEEN} />
          </LazyWardic>
        </WardicProvider>
      ))
      await settle()
      const before = await flight(() => el, () => setTarget("oklch(0.6 0.2 150)"))
      expect(before.filter((v) => v.startsWith("rgb")), "no frame in sRGB before it arrives").toEqual([])
      setTarget("oklch(0.5 0.1 200)")
      await settle()
    })
    expect(lines.filter((l) => l.includes(COLORS_WORD)), "nothing said while the load is on its way").toEqual([])
    arrive()
    await wait(50)
    const painted = await flight(() => el, () => setTarget("oklch(0.6 0.2 150)"))
    expect(painted.filter((v) => v.startsWith("rgb")).length, "frames in sRGB once colors is here").toBeGreaterThan(3)
  })

  it("FW4: a section has its provider's Features and every LazyWardic's between, none of a sibling's", () => {
    const seen: Record<string, boolean> = {}
    const Probe = (props: { readonly name: string }): JSX.Element => {
      const section = useFeatureSection()
      seen[untrack(() => props.name)] = untrack(() => has(section.services(), colors))
      return undefined
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Probe name="root" />
        <LazyWardic features={[colors]}>
          <Probe name="inside" />
          <LazyWardic features={[]}>
            <Probe name="nested" />
          </LazyWardic>
        </LazyWardic>
        <LazyWardic features={[]}>
          <Probe name="sibling" />
        </LazyWardic>
      </WardicProvider>
    ))
    expect(seen).toEqual({ root: false, inside: true, nested: true, sibling: false })
  })

  it("FW5: strict makes a Complete element below it an error in development; a Slim one and a Reorder render", () => {
    const Ward = (): JSX.Element => {
      ward({ animate: { opacity: 1 } })
      return undefined
    }
    for (const complete of [() => <wardic.div />, () => <Ward />]) {
      const { host } = mount(() => (
        <WardicProvider env={DomLive}>
          <Errored fallback={(error) => <p data-error>{String(error())}</p>}>
            <LazyWardic features={[]} strict>
              {complete()}
            </LazyWardic>
          </Errored>
        </WardicProvider>
      ))
      flush()
      expect(host.querySelector("[data-error]")?.textContent).toMatch(/strict WardicProvider or LazyWardic.*w\.\*, w\.create, w\.ward\(\)/)
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive} strict>
        <Errored fallback={(error) => <p data-error>{String(error())}</p>}>
          <w.div animate={{ opacity: 1 }} />
          <Reorder.Group values={["a"]} onReorder={() => {}}>
            <Reorder.Item value="a">a</Reorder.Item>
          </Reorder.Group>
        </Errored>
      </WardicProvider>
    ))
    flush()
    expect(host.querySelector("[data-error]")).toBeNull()
  })

  it("FW6: a failed lazy load is reported once, and its section stops waiting", async () => {
    let pending: (() => boolean) | undefined
    const Probe = (): JSX.Element => {
      pending = useFeatureSection().pending
      return undefined
    }
    const failing: FeatureLoad = () => Promise.reject(new Error("no such chunk"))
    const lines = await logged(async () => {
      mount(() => (
        <WardicProvider env={DomLive}>
          <LazyWardic features={failing}>
            <Probe />
          </LazyWardic>
        </WardicProvider>
      ))
      expect(untrack(() => pending!())).toBe(true)
      await until(() => !untrack(() => pending!()), 1000)
    })
    expect(lines.filter((l) => l.includes("a lazy load of Features failed"))).toHaveLength(1)
    expect(lines.some((l) => l.includes("no such chunk"))).toBe(true)
  })
})
