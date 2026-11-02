// The gesture Features (#511, ADR-0067 decisions 3 and 14), on the Solid 1 binding: each gesture is a
// Feature, and they stand on one input, the Environment's when it gives one, else the DOM's, which
// `DomLive` no longer builds.
// - FG1, without `hover`, a `w.div`'s `whileHover` does nothing, no input is built, and development says
//   so once per provider, naming the import.
// - FG2, `hover` given at once: a `w.div` hovers, over the DOM's input, which the Feature built.
// - FG3, `domAnimation` loaded lazily: no word while it's on its way, and once it arrives, an element
//   already mounted hovers.
// - FG4, `drag` given at once, under an Environment that gives its own input: the drag runs on that
//   input. Without `drag`, `drag` does nothing, and development says so.
import { cleanup, render } from "@solidjs/testing-library"
import * as InputSource from "@wardic/core/InputSource"
import { DomLive } from "@wardic/dom"
import { domAnimation, drag, type FeatureLoad, hover, LazyWardic, w, WardicProvider } from "@wardic/solid"
import { TestInput } from "@wardic/test"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { For, type JSX } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { FeatureRegistry } from "../src/feature.ts"
import { useFeatureRegistry } from "../src/provider.tsx"
import { opacityOf, until, waitAtMost } from "./browser-helpers.ts"
import { resetScene, settle, wait } from "./reorder-harness.tsx"

afterEach(async () => {
  await resetScene()
  cleanup()
})

const BOX: JSX.CSSProperties = { width: "40px", height: "40px" }
const TWEEN = { type: "tween", duration: 0.2 } as const
const word = (feature: string): string => `needs the \`${feature}\` Feature`

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

/** Enters `el` with the pointer, then reads `done`: again and again, as the recognizer attaches asynchronously. */
const entering = (el: HTMLElement, done: () => boolean) => (): boolean => {
  el.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1, bubbles: true }))
  return done()
}

/** Enters `el` until `done`, failing after `ms`. */
const hoverUntil = (el: HTMLElement, done: () => boolean, ms: number): Promise<void> => until(entering(el, done), ms)

/** Whether its provider's Features have built the gestures' input. */
const hasInput = (registry: FeatureRegistry): boolean => Option.isSome(Context.getOption(registry.built() as Context.Context<InputSource.InputSource>, InputSource.InputSource))

describe("The gesture Features (#511), Solid 1", () => {
  it("FG1: without `hover`, a w.div's whileHover does nothing, no input is built, and development says so once per provider", async () => {
    const els: Array<HTMLElement> = []
    let registry!: FeatureRegistry
    const Probe = (): JSX.Element => {
      registry = useFeatureRegistry()
      return undefined
    }
    const lines = await logged(async () => {
      render(() => (
        <WardicProvider env={DomLive}>
          <Probe />
          <For each={[0, 1]}>
            {() => <w.div ref={(n: HTMLElement) => els.push(n)} style={BOX} initial={{ opacity: 0.2 }} animate={{ opacity: 0.2 }} whileHover={{ opacity: 1 }} transition={TWEEN} />}
          </For>
        </WardicProvider>
      ))
      await settle()
      // Entered for 400 ms, long past the recognizer's attaching: it never hovers.
      await waitAtMost(400, entering(els[0]!, () => opacityOf(els[0]!) > 0.5))
      expect(opacityOf(els[0]!), "it never hovered").toBeCloseTo(0.2, 2)
    })
    expect(hasInput(registry), "no input built").toBe(false)
    const words = lines.filter((l) => l.includes(word("hover")))
    expect(words, "one word for two elements").toHaveLength(1)
    expect(words[0]).toContain('import { hover } from "@wardic/solid"')
  })

  it("FG2: `hover` given at once: a w.div hovers, over the DOM's input the Feature built", async () => {
    let el!: HTMLElement
    let registry!: FeatureRegistry
    const Probe = (): JSX.Element => {
      registry = useFeatureRegistry()
      return undefined
    }
    render(() => (
      <WardicProvider env={DomLive} features={[hover]}>
        <Probe />
        <w.div ref={(n: HTMLElement) => (el = n)} style={BOX} initial={{ opacity: 0.2 }} animate={{ opacity: 0.2 }} whileHover={{ opacity: 1 }} transition={TWEEN} />
      </WardicProvider>
    ))
    await settle()
    await hoverUntil(el, () => opacityOf(el) > 0.5, 2000)
    await until(() => opacityOf(el) === 1, 2000)
    expect(opacityOf(el)).toBe(1)
    expect(hasInput(registry), "the input built").toBe(true)
  })

  it("FG3: domAnimation loaded lazily: no word while it's on its way, and an element already mounted hovers once it's here", async () => {
    let arrive!: () => void
    const load: FeatureLoad = () =>
      new Promise((resolve) => {
        arrive = () => resolve(domAnimation)
      })
    let el!: HTMLElement
    const lines = await logged(async () => {
      render(() => (
        <WardicProvider env={DomLive}>
          <LazyWardic features={load}>
            <w.div ref={(n: HTMLElement) => (el = n)} style={BOX} initial={{ opacity: 0.2 }} animate={{ opacity: 0.2 }} whileHover={{ opacity: 1 }} transition={TWEEN} />
          </LazyWardic>
        </WardicProvider>
      ))
      await settle()
    })
    expect(lines.filter((l) => l.includes(word("hover"))), "nothing said while the load is on its way").toEqual([])
    arrive()
    await wait(50)
    await hoverUntil(el, () => opacityOf(el) > 0.5, 2000)
    await until(() => opacityOf(el) === 1, 2000)
    expect(opacityOf(el)).toBe(1)
  })

  it("FG4: `drag` runs on the Environment's own input; without `drag`, development says so", async () => {
    const input = Effect.runSync(TestInput.pushable())
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={input.layer.pipe(Layer.provideMerge(DomLive))} features={[drag]}>
        <w.div ref={(n: HTMLElement) => (el = n)} style={BOX} drag="x" dragMomentum={false} />
      </WardicProvider>
    ))
    await settle()
    const x0 = el.getBoundingClientRect().left
    let t = 0
    const push = (type: InputSource.PointerLikeEvent["type"], x: number): void => {
      t += 20
      Effect.runSync(input.push(InputSource.makePointerLikeEvent({ type, x, y: 0, timeStamp: t })))
    }
    push("down", 0)
    for (let k = 1; k <= 5; k++) push("move", 20 * k)
    push("up", 100)
    await until(() => el.getBoundingClientRect().left - x0 > 90, 2000)
    expect(el.getBoundingClientRect().left - x0, "dragged on the pushed input").toBeGreaterThan(90)

    cleanup()
    const lines = await logged(async () => {
      render(() => (
        <WardicProvider env={DomLive}>
          <w.div style={BOX} drag="x" />
        </WardicProvider>
      ))
      await settle()
    })
    expect(lines.filter((l) => l.includes(word("drag"))), "one word").toHaveLength(1)
  })
})
