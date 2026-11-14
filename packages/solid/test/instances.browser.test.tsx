// A Wardic instance at runtime (#516, ADR-0067 *Amendment (#516)*), on the Solid 1 binding:
// `createWardic(features)`'s elements bring its Features wherever they render.
// - IN1: an instance of `hover`: its `w.div` hovers under a provider given no Features.
// - IN2: joined with its section's: under a `LazyWardic` giving `press`, an instance of `hover`'s element
//   taps too, a prop its types don't take, given untyped.
// - IN3: every form of its `w` brings them: `w.create(tag)`, `w.create(Component)`, `w.createWard` and
//   `use:w`.
// - IN7: `strict` allows an instance's elements, an instance of `domMax`'s too; a `wardic.*` still throws.
// - IN4: a load in its list starts at its first element's mount, not as it's made, once for two elements
//   under two providers; nothing is said while it's on its way, and its Feature takes effect as it
//   arrives, in each provider: a drag before then does nothing, one after drags. An element gone before
//   it arrives, or a provider, changes nothing: the next element drags, and nothing loads again.
// - IN5: a failed load is reported once in a provider, for two elements, naming `createWardic`; the next
//   provider to ask loads again.
// - IN6: its layout hooks bring `layout` and count as a use: given at once, the hook alone builds it in its
//   provider; as a load, the hook starts it.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { createWardic, domMax, drag, hover, layout, LazyWardic, press, wardic, WardicProvider } from "@wardic/solid"
import * as Context from "effect/Context"
import * as Option from "effect/Option"
import { createSignal, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { FeatureRegistry } from "../src/feature.ts"
import { DragGesture } from "../src/features/keys.ts"
import { useFeatureRegistry } from "../src/provider.tsx"
import { opacityOf, until } from "./browser-helpers.ts"
import { pushedPointer } from "./pushed-pointer.ts"
import { resetScene, settle, wait } from "./reorder-harness.tsx"

afterEach(async () => {
  await resetScene()
  cleanup()
})

const BOX: JSX.CSSProperties = { width: "40px", height: "40px" }
const TWEEN = { type: "tween", duration: 0.2 } as const

/** Enters `el` with the pointer, then reads `done`: again and again, as the recognizer attaches asynchronously. */
const entering = (el: HTMLElement, done: () => boolean) => (): boolean => {
  el.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1, bubbles: true }))
  return done()
}

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

/** Presses `el` with the primary pointer, then reads `done`: again and again, as the recognizer attaches asynchronously. */
const pressing = (el: HTMLElement, done: () => boolean) => (): boolean => {
  const r = el.getBoundingClientRect()
  el.dispatchEvent(new PointerEvent("pointerdown", { clientX: r.left + 5, clientY: r.top + 5, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true, bubbles: true }))
  return done()
}

/** Enters `el` until `done`, failing after `ms`. */
const hoverUntil = (el: HTMLElement, done: () => boolean, ms: number): Promise<void> => until(entering(el, done), ms)

describe("A Wardic instance (#516), Solid 1", () => {
  it("IN1: an instance of hover: its w.div hovers under a provider given no Features", async () => {
    const { w } = createWardic([hover])
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <w.div ref={(n: HTMLElement) => (el = n)} style={BOX} initial={{ opacity: 0.2 }} animate={{ opacity: 0.2 }} whileHover={{ opacity: 1 }} transition={TWEEN} />
      </WardicProvider>
    ))
    await settle()
    await hoverUntil(el, () => opacityOf(el) > 0.5, 2000)
    await until(() => opacityOf(el) === 1, 2000)
    expect(opacityOf(el)).toBe(1)
  })

  it("IN3: every form brings them: w.create(tag), w.create(Component), w.createWard and use:w", async () => {
    const { w } = createWardic([hover])
    const HOVERS = { initial: { opacity: 0.2 }, animate: { opacity: 0.2 }, whileHover: { opacity: 1 }, transition: TWEEN } as const
    const Span = w.create("span")
    const Section = w.create((props: { readonly ref?: (el: HTMLElement) => void; readonly style?: JSX.CSSProperties }) => <section {...props} />)
    const els: Array<HTMLElement> = []
    const Spread = (): JSX.Element => {
      const ward = w.createWard(HOVERS)
      return <div {...ward({ ref: (n: HTMLElement) => els.push(n), style: BOX })} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Span ref={(n: HTMLElement) => els.push(n)} style={BOX} {...HOVERS} />
        <Section ref={(n: HTMLElement) => els.push(n)} style={BOX} {...HOVERS} />
        <Spread />
        <div ref={(n: HTMLElement) => els.push(n)} style={{ ...BOX, opacity: 0.2 }} use:w={HOVERS} />
      </WardicProvider>
    ))
    await settle()
    expect(els).toHaveLength(4)
    for (const el of els) await hoverUntil(el, () => opacityOf(el) > 0.5, 2000)
    await until(() => els.every((el) => opacityOf(el) === 1), 2000)
    expect(els.map(opacityOf)).toEqual([1, 1, 1, 1])
  })

  it("IN2: joined with its section's: under a LazyWardic giving press, an instance of hover's element taps too", async () => {
    const { w } = createWardic([hover])
    // A prop its types don't take: the section's Feature works all the same.
    const taps = { whileTap: { opacity: 1 } } as {}
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <LazyWardic features={[press]}>
          <w.div ref={(n: HTMLElement) => (el = n)} style={BOX} initial={{ opacity: 0.2 }} animate={{ opacity: 0.2 }} transition={TWEEN} {...taps} />
        </LazyWardic>
      </WardicProvider>
    ))
    await settle()
    await until(pressing(el, () => opacityOf(el) > 0.5), 2000)
    await until(() => opacityOf(el) === 1, 2000)
    expect(opacityOf(el)).toBe(1)
  })

  it("IN7: strict allows an instance's elements, an instance of domMax's too; a wardic.* still throws", async () => {
    const { w } = createWardic(domMax)
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive} strict>
        <w.div ref={(n: HTMLElement) => (el = n)} style={BOX} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={TWEEN} />
      </WardicProvider>
    ))
    await until(() => opacityOf(el) === 1, 2000)
    expect(opacityOf(el)).toBe(1)
    cleanup()
    expect(() =>
      render(() => (
        <WardicProvider env={DomLive} strict>
          <wardic.div />
        </WardicProvider>
      )),
    ).toThrow(/strict WardicProvider or LazyWardic/)
  })

  it("IN4: a load starts at the first element's mount, once for two providers; its Feature takes effect as it arrives", async () => {
    const pointer = pushedPointer()
    const other = pushedPointer()
    let calls = 0
    let arrive!: () => void
    const load = (): Promise<typeof drag> => {
      calls += 1
      return new Promise((resolve) => {
        arrive = () => resolve(drag)
      })
    }
    const { w } = createWardic([load])
    expect(calls, "nothing loads as the instance is made").toBe(0)
    let el!: HTMLElement
    let second!: HTMLElement
    const lines = await logged(async () => {
      render(() => (
        <>
          <WardicProvider env={pointer.env}>
            <w.div ref={(n: HTMLElement) => (el = n)} style={BOX} drag="x" dragMomentum={false} />
          </WardicProvider>
          <WardicProvider env={other.env}>
            <w.div ref={(n: HTMLElement) => (second = n)} style={BOX} drag="x" dragMomentum={false} />
          </WardicProvider>
        </>
      ))
      await settle()
    })
    expect(calls, "one load, at the first mount").toBe(1)
    expect(lines.filter((l) => l.includes(word("drag"))), "nothing said while it's on its way").toEqual([])
    const x0 = el.getBoundingClientRect().left
    const fling = (by: typeof pointer = pointer): void => {
      by.push("down", 0)
      for (let k = 1; k <= 5; k++) by.push("move", 20 * k)
      by.push("up", 100)
    }
    fling()
    await wait(100)
    expect(el.getBoundingClientRect().left - x0, "a drag before it arrives does nothing").toBe(0)
    arrive()
    await wait(50)
    fling()
    await until(() => el.getBoundingClientRect().left - x0 > 90, 2000)
    expect(el.getBoundingClientRect().left - x0, "dragged once it's here").toBeGreaterThan(90)
    const x1 = second.getBoundingClientRect().left
    fling(other)
    await until(() => second.getBoundingClientRect().left - x1 > 90, 2000)
    expect(second.getBoundingClientRect().left - x1, "the other provider's element drags too").toBeGreaterThan(90)
    expect(calls, "still one load").toBe(1)
  })

  it("IN4b: an element gone before its load arrives, or its provider, changes nothing: the next element drags, nothing loads again", async () => {
    let calls = 0
    let arrive!: () => void
    const load = (): Promise<typeof drag> => {
      calls += 1
      return new Promise((resolve) => {
        arrive = () => resolve(drag)
      })
    }
    const { w } = createWardic([load])
    const [shown, setShown] = createSignal(true)
    let goneRegistry!: FeatureRegistry
    const Probe = (): JSX.Element => {
      goneRegistry = useFeatureRegistry()
      return undefined
    }
    const gone = render(() => (
      <WardicProvider env={DomLive}>
        <Probe />
        <Show when={shown()}>
          <w.div style={BOX} drag="x" />
        </Show>
      </WardicProvider>
    ))
    await settle()
    setShown(false)
    await settle()
    gone.unmount()
    const lines = await logged(async () => {
      arrive()
      await wait(50)
    })
    expect(lines, "a load arriving after its provider ended says nothing").toEqual([])
    const goneBuilt = goneRegistry.built() as Context.Context<DragGesture>
    expect(Option.isNone(Context.getOption(goneBuilt, DragGesture)), "nor builds it into that provider").toBe(true)
    const pointer = pushedPointer()
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={pointer.env}>
        <w.div ref={(n: HTMLElement) => (el = n)} style={BOX} drag="x" dragMomentum={false} />
      </WardicProvider>
    ))
    await settle()
    const x0 = el.getBoundingClientRect().left
    pointer.push("down", 0)
    for (let k = 1; k <= 5; k++) pointer.push("move", 20 * k)
    pointer.push("up", 100)
    await until(() => el.getBoundingClientRect().left - x0 > 90, 2000)
    expect(el.getBoundingClientRect().left - x0, "a new provider's element drags at once").toBeGreaterThan(90)
    expect(calls, "one load").toBe(1)
  })

  it("IN5: a failed load is reported once in a provider, for two elements", async () => {
    let calls = 0
    const { w } = createWardic([
      (): Promise<typeof drag> => {
        calls += 1
        return Promise.reject(new Error("no such chunk"))
      },
    ])
    const lines = await logged(async () => {
      render(() => (
        <WardicProvider env={DomLive}>
          <w.div style={BOX} drag="x" />
          <w.div style={BOX} drag="y" />
        </WardicProvider>
      ))
      await settle()
      await wait(50)
    })
    expect(lines.filter((l) => l.includes("wardic.createWardic: a lazy load of Features failed")), "once, for two elements").toHaveLength(1)
    expect(lines.some((l) => l.includes("no such chunk")), "its cause").toBe(true)
    await logged(async () => {
      render(() => (
        <WardicProvider env={DomLive}>
          <w.div style={BOX} drag="x" />
        </WardicProvider>
      ))
      await settle()
      await wait(50)
    })
    expect(calls, "the next provider loads again").toBe(2)
  })

  it("IN6: its layout hooks bring layout and count as a use", async () => {
    const given = createWardic([layout])
    let registry!: FeatureRegistry
    const Hooked = (): JSX.Element => {
      given.useAnimateLayout()
      registry = useFeatureRegistry()
      return undefined
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Hooked />
      </WardicProvider>
    ))
    const built = registry.built() as Context.Context<ProjectionSystem.ProjectionSystem>
    expect(Option.isSome(Context.getOption(built, ProjectionSystem.ProjectionSystem)), "layout built by the hook alone").toBe(true)
    cleanup()

    let calls = 0
    const later = createWardic([
      (): Promise<typeof layout> => {
        calls += 1
        return new Promise(() => {})
      },
    ])
    const Resets = (): JSX.Element => {
      later.createResetProjection()
      return undefined
    }
    expect(calls, "nothing loads as the instance is made").toBe(0)
    render(() => (
      <WardicProvider env={DomLive}>
        <Resets />
      </WardicProvider>
    ))
    await settle()
    expect(calls, "the hook started its load").toBe(1)
  })
})
