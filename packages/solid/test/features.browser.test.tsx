// Features and the Slim element (#511, ADR-0067), on the Solid 1 binding. culori keeps its colour spaces
// in one registry for the page, and a test file is a page of its own: the cases run in order, those
// before any `colors` first. The Complete element's own registration is `features-complete`'s.
// - FE1, every form of `w` animates values with no Feature.
// - FE2, without `colors`, a `w.div`'s `oklch()` isn't read as a colour, and development says so once
//   per provider, naming the import.
// - FE3, `colors` loaded lazily: no word while it's on its way, and once it arrives the element reads
//   a wide-gamut colour as a colour, from its next target on, a pair it resolved before included.
// - FE4, a section's Features: its provider's and every `LazyWardic`'s between, none of a sibling's.
// - FE5, `strict`: a Complete element under it is an error in development; a Slim one and a Reorder
//   aren't.
// - FE6, a failed lazy load is reported once, and its section stops waiting.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { colors, type FeatureLoad, LazyWardic, Reorder, w, wardic, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, For, type JSX } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"
import { hasService } from "../src/gesture-features.ts"
import { useFeatureSection } from "../src/provider.tsx"
import { opacityOf, until } from "./browser-helpers.ts"
import { resetScene, sampleFrames, settle, wait } from "./reorder-harness.tsx"

afterEach(async () => {
  await resetScene()
  cleanup()
})

const BOX: JSX.CSSProperties = { width: "40px", height: "40px" }
const TWEEN = { type: "tween", duration: 0.4 } as const

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

const COLORS_WORD = "needs the `colors` Feature"

/** Two oklch() colours, `on` the second. */
const tint = (on: boolean): string => Bool.match(on, { onTrue: () => "oklch(0.7 0.3 100)", onFalse: () => "oklch(0.5 0.1 200)" })

/** The background colours a box paints while it flies from `from` to `to`. */
const flight = async (el: () => HTMLElement, go: () => void): Promise<ReadonlyArray<string>> => {
  const sampling = sampleFrames(() => el().style.backgroundColor)
  go()
  await wait(500)
  return sampling.stop().map((f) => f.v)
}

describe("Features and the Slim element (#511), Solid 1", () => {
  it("FE1: w.div, w.create, w.createWard and use:w animate values with no Feature", async () => {
    const Span = w.create("span")
    let div!: HTMLElement
    let span!: HTMLElement
    let spread!: HTMLElement
    let directed!: HTMLElement
    const Spread = () => {
      const ward = w.createWard({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: TWEEN })
      return <div {...ward({ ref: (n: HTMLElement) => (spread = n), style: BOX })} />
    }
    const directive = w
    void directive
    render(() => (
      <WardicProvider env={DomLive}>
        <w.div ref={(n: HTMLElement) => (div = n)} style={BOX} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={TWEEN} />
        <Span ref={(n: HTMLElement) => (span = n)} style={BOX} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={TWEEN} />
        <Spread />
        <div ref={(n: HTMLElement) => (directed = n)} style={{ ...BOX, opacity: 0 }} use:w={{ animate: { opacity: 1 }, transition: TWEEN }} />
      </WardicProvider>
    ))
    await until(() => [div, span, spread, directed].every((el) => opacityOf(el) === 1), 3000)
    expect([div, span, spread, directed].map(opacityOf)).toEqual([1, 1, 1, 1])
  })

  it("FE2: without `colors`, an oklch() isn't read as a colour, and development says so once per provider", async () => {
    const els: Array<HTMLElement> = []
    const [on, setOn] = createSignal(false)
    const lines = await logged(async () => {
      render(() => (
        <WardicProvider env={DomLive}>
          <For each={[0, 1]}>
            {() => <w.div ref={(n: HTMLElement) => els.push(n)} style={BOX} initial={{ "background-color": tint(false) }} animate={{ "background-color": tint(on()) }} transition={TWEEN} />}
          </For>
        </WardicProvider>
      ))
      await settle()
      const painted = await flight(() => els[0]!, () => setOn(true))
      // Read as a complex value, its numbers blended as written: never an sRGB colour.
      expect(painted.filter((v) => v.startsWith("rgb")), "no frame in sRGB").toEqual([])
      expect(painted.filter((v) => v.startsWith("oklch(") && v !== tint(false) && v !== tint(true)).length, "frames between, in oklch").toBeGreaterThan(3)
    })
    const words = lines.filter((l) => l.includes(COLORS_WORD))
    expect(words, "one word for two elements").toHaveLength(1)
    expect(words[0]).toContain('import { colors } from "@wardic/solid"')
    expect(words[0]).toContain("oklch(")
  })

  it("FE3: colors loaded lazily: no word while it's on its way, and from its arrival on, oklch() is a colour", async () => {
    let arrive!: () => void
    const load: FeatureLoad = () =>
      new Promise((resolve) => {
        arrive = () => resolve([colors])
      })
    let el!: HTMLElement
    const [target, setTarget] = createSignal("oklch(0.5 0.1 200)")
    const lines = await logged(async () => {
      render(() => (
        <WardicProvider env={DomLive}>
          <LazyWardic features={load}>
            <w.div
              ref={(n: HTMLElement) => (el = n)}
              style={BOX}
              initial={{ "background-color": "oklch(0.5 0.1 200)" }}
              animate={{ "background-color": target() }}
              transition={TWEEN}
            />
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
    // The pair it resolved before the arrival, again: a colour now.
    const painted = await flight(() => el, () => setTarget("oklch(0.6 0.2 150)"))
    expect(painted.filter((v) => v.startsWith("rgb")).length, "frames in sRGB once colors is here").toBeGreaterThan(3)
  })

  it("FE4: a section has its provider's Features and every LazyWardic's between, none of a sibling's", async () => {
    const seen: Record<string, boolean> = {}
    const Probe = (props: { readonly name: string }) => {
      const section = useFeatureSection()
      seen[props.name] = hasService(section.services(), colors.key)
      return null
    }
    render(() => (
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
    cleanup()
    render(() => (
      <WardicProvider env={DomLive} features={[[colors], colors]}>
        <Probe name="provided" />
      </WardicProvider>
    ))
    expect(seen.provided).toBe(true)
  })

  it("FE5: strict makes a Complete element below it an error in development; a Slim one and a Reorder render", async () => {
    expect(() =>
      render(() => (
        <WardicProvider env={DomLive}>
          <LazyWardic features={[]} strict>
            <wardic.div />
          </LazyWardic>
        </WardicProvider>
      )),
    ).toThrow(/strict WardicProvider or LazyWardic/)
    cleanup()
    expect(() =>
      render(() => (
        <WardicProvider env={DomLive} strict>
          <w.div animate={{ opacity: 1 }} />
          <Reorder.Group values={["a"]} onReorder={() => {}}>
            <Reorder.Item value="a">a</Reorder.Item>
          </Reorder.Group>
        </WardicProvider>
      )),
    ).not.toThrow()
  })

  it("FE6: a failed lazy load is reported once, and its section stops waiting", async () => {
    let pending: (() => boolean) | undefined
    const Probe = () => {
      pending = useFeatureSection().pending
      return null
    }
    const failing: FeatureLoad = () => Promise.reject(new Error("no such chunk"))
    const lines = await logged(async () => {
      render(() => (
        <WardicProvider env={DomLive}>
          <LazyWardic features={failing}>
            <Probe />
          </LazyWardic>
        </WardicProvider>
      ))
      expect(pending!()).toBe(true)
      await until(() => !pending!(), 1000)
    })
    expect(lines.filter((l) => l.includes("a lazy load of Features failed"))).toHaveLength(1)
    expect(lines.some((l) => l.includes("no such chunk"))).toBe(true)
  })

})
