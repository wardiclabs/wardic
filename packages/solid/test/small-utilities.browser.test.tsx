// #443's hooks and exports on Solid 1, Motion's small utilities, in a real browser.
//
// - SU1: `createAnimationFrame`: its first frame's time is 0, then wall time; each delta the frame's,
//   held to 1–40 ms; its owner's disposal ends it.
// - SU2: a callback that throws every frame but the fourth is logged at its runs' first throws, and
//   called every frame.
// - SU3: `createCycle`: the first, each step the next, the first after the last; `cycle(i)` jumps to
//   `i`; anything but a number steps; two steps in one batch step twice.
// - SU4: `createPageInView`: `true`, `false` while the page is hidden, `true` again; `false` from the
//   start on a page hidden before it's made.
// - SU5: `createReducedMotionConfig`: the provider's `"always"`, a config's `"never"` over it, and a
//   config's `"user"` the preference; a config's change followed. SU5b: under an emulated preference,
//   a config's `"user"` reads it. SU5c (#584): the provider's change is followed too.
// - SU6: `WardicConfig`'s `isValidProp` keeps a tag's props it says aren't valid off its element, asks
//   of no `on` prop, hands a wrapped component every prop; an inner config with none passes it on, and
//   an inner one's replaces it.
// - SU7: `forwardMotionProps` hands a wrapped component, and a tag, the motion props, which still
//   drive the element; without it, neither gets them.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import {
  createAnimationFrame,
  createCycle,
  createPageInView,
  createReducedMotion,
  createReducedMotionConfig,
  wardic,
  WardicConfig,
  WardicProvider,
} from "@wardic/solid"
import { batch, type Component, createSignal, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { commands } from "vitest/browser"
import { opacityOf, raf, until } from "./browser-helpers.ts"
import "./browser-commands.ts"
import { envWith, errorsNamed, type Logged } from "./report-env.ts"

afterEach(cleanup)

/** Sets what `document.visibilityState` reads and tells the document, as a browser does as a tab hides. */
const setVisibility = (state: "hidden" | "visible"): void => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state })
  document.dispatchEvent(new Event("visibilitychange"))
}

describe("createAnimationFrame (#443, Motion's useAnimationFrame)", () => {
  it("SU1: its first frame's time is 0, then wall time; each delta the frame's, held to 1–40 ms; disposal ends it", async () => {
    const calls: Array<readonly [number, number]> = []
    const [on, setOn] = createSignal(true)
    const Ticker = (): JSX.Element => {
      createAnimationFrame((time, delta) => void calls.push([time, delta]))
      return null
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Show when={on()}>
          <Ticker />
        </Show>
      </WardicProvider>
    ))
    await until(() => calls.length >= 8, 3000)
    expect(calls[0]?.[0], "0 at its first frame").toBe(0)
    for (let i = 1; i < calls.length; i++) {
      const [time, delta] = calls[i]!
      const [before] = calls[i - 1]!
      expect(time, "time rises").toBeGreaterThan(before)
      expect(delta, "delta held to 1–40 ms").toBeGreaterThanOrEqual(1)
      expect(delta).toBeLessThanOrEqual(40)
      // A frame under 40 ms: its delta is the time it adds.
      if (time - before < 40) expect(delta).toBeCloseTo(time - before, 6)
    }
    setOn(false)
    await raf()
    await raf()
    const told = calls.length
    await raf()
    await raf()
    expect(calls.length, "no frame once its owner is gone").toBe(told)
  })

  it("SU2: one that throws every frame but the fourth is logged at its runs' first throws, and called every frame", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    let calls = 0
    const Ticker = (): JSX.Element => {
      createAnimationFrame(() => {
        calls++
        if (calls !== 4) throw new Error(`the app's frame broke at ${calls}`)
      })
      return null
    }
    render(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <Ticker />
      </WardicProvider>
    ))
    await until(() => calls >= 8, 3000)
    expect(reports.slice(0, 2)).toEqual(["the app's frame broke at 1", "the app's frame broke at 5"])
    expect(errorsNamed(logs, "wardic.createAnimationFrame: the callback failed")).toHaveLength(2)
  })
})

describe("createCycle (#443, Motion's useCycle)", () => {
  it("SU3: steps through its items, wrapping; cycle(i) jumps; anything but a number steps; two steps in one batch step twice", () => {
    const [item, cycle] = createCycle("a", "b", "c")
    const seen = [item()]
    cycle()
    seen.push(item())
    cycle()
    seen.push(item())
    cycle()
    seen.push(item())
    expect(seen, "the first after the last").toEqual(["a", "b", "c", "a"])
    cycle(2)
    expect(item(), "cycle(2)").toBe("c")
    ;(cycle as (event: unknown) => void)(new MouseEvent("click"))
    expect(item(), "an event steps").toBe("a")
    batch(() => {
      cycle()
      cycle()
    })
    expect(item(), "two steps in one batch").toBe("c")
  })
})

describe("createPageInView (#443, Motion's usePageInView)", () => {
  afterEach(() => {
    // The document's own getter again.
    delete (document as { visibilityState?: unknown }).visibilityState
    document.dispatchEvent(new Event("visibilitychange"))
  })

  it("SU4: true, false while the page is hidden, and true again", () => {
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          const visible = createPageInView()
          return <p data-visible>{String(visible())}</p>
        })()}
      </WardicProvider>
    ))
    const p = container.querySelector("[data-visible]")!
    expect(p.textContent).toBe("true")
    setVisibility("hidden")
    expect(p.textContent).toBe("false")
    setVisibility("visible")
    expect(p.textContent).toBe("true")
    cleanup()
    setVisibility("hidden")
    const hidden = render(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          const visible = createPageInView()
          return <p data-visible>{String(visible())}</p>
        })()}
      </WardicProvider>
    ))
    expect(hidden.container.querySelector("[data-visible]")!.textContent, "hidden from the start").toBe("false")
  })
})

describe("createReducedMotionConfig (#443, Motion's useReducedMotionConfig)", () => {
  it("SU5: the provider's always; a config's never over it; a config's user the preference; a config's change followed", () => {
    const [setting, setSetting] = createSignal<"always" | "never">("never")
    const Read = (props: { readonly name: string }): JSX.Element => {
      const applies = createReducedMotionConfig()
      const prefers = createReducedMotion()
      return (
        <p data-name={props.name} data-prefers={String(prefers())}>
          {String(applies())}
        </p>
      )
    }
    const { container } = render(() => (
      <WardicProvider env={DomLive} reducedMotion="always">
        <Read name="provider" />
        <WardicConfig reducedMotion="never">
          <Read name="never" />
        </WardicConfig>
        <WardicConfig reducedMotion="user">
          <Read name="user" />
        </WardicConfig>
        <WardicConfig reducedMotion={setting()}>
          <Read name="changing" />
        </WardicConfig>
      </WardicProvider>
    ))
    const read = (name: string): string | null => container.querySelector(`[data-name="${name}"]`)!.textContent
    expect(read("provider")).toBe("true")
    expect(read("never")).toBe("false")
    const user = container.querySelector<HTMLElement>('[data-name="user"]')!
    expect(read("user"), "the preference").toBe(user.dataset.prefers)
    expect(read("changing")).toBe("false")
    setSetting("always")
    expect(read("changing")).toBe("true")
  })

  it("SU5b: under the user's preference for reduced motion, a config's user is true, and its never false", async () => {
    await commands.emulateReducedMotion(true)
    try {
      const Read = (props: { readonly name: string }): JSX.Element => {
        const applies = createReducedMotionConfig()
        return <p data-name={props.name}>{String(applies())}</p>
      }
      const { container } = render(() => (
        <WardicProvider env={DomLive} reducedMotion="never">
          <WardicConfig reducedMotion="user">
            <Read name="user" />
          </WardicConfig>
          <Read name="never" />
        </WardicProvider>
      ))
      await until(() => container.querySelector('[data-name="user"]')!.textContent === "true", 2000)
      expect(container.querySelector('[data-name="user"]')!.textContent).toBe("true")
      expect(container.querySelector('[data-name="never"]')!.textContent).toBe("false")
    } finally {
      await commands.emulateReducedMotion(false)
    }
  })
})

describe("createReducedMotionConfig, the provider's change (#584)", () => {
  it("SU5c: a reader under the provider follows a change of the provider's reducedMotion, as one under a config does", () => {
    const [setting, setSetting] = createSignal<"always" | "never">("never")
    const Read = (): JSX.Element => {
      const applies = createReducedMotionConfig()
      return <p data-name="provider">{String(applies())}</p>
    }
    const { container } = render(() => (
      <WardicProvider env={DomLive} reducedMotion={setting()}>
        <Read />
      </WardicProvider>
    ))
    const read = (): string | null => container.querySelector('[data-name="provider"]')!.textContent
    expect(read()).toBe("false")
    setSetting("always")
    expect(read(), "the provider's change").toBe("true")
  })
})

describe("WardicConfig's isValidProp (#443, Motion's MotionConfig isValidProp)", () => {
  it("SU6: a tag's props it says aren't valid stay off; no on prop asked; a wrapped component gets every one; an inner config's replaces it", () => {
    const asked: Array<string> = []
    let clicked = 0
    let given: unknown
    const Box: Component<{ readonly ref?: (el: HTMLElement) => void; readonly style?: JSX.CSSProperties; readonly tone?: string }> = (props) => {
      given = props.tone
      return <div data-box ref={props.ref} style={props.style} />
    }
    const WardicBox = wardic.create(Box)
    const props = { tone: "danger" } as Record<string, unknown>
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <WardicConfig
          isValidProp={(key) => {
            asked.push(key)
            return key !== "tone"
          }}
        >
          <wardic.button data-kept {...props} title="t" onClick={() => clicked++} />
          <WardicBox {...props} />
          <WardicConfig transition={{ duration: 0.2 }}>
            <wardic.i data-passed {...props} />
          </WardicConfig>
          <WardicConfig isValidProp={() => true}>
            <wardic.span data-inner {...props} />
          </WardicConfig>
        </WardicConfig>
      </WardicProvider>
    ))
    const button = container.querySelector<HTMLElement>("[data-kept]")!
    expect(button.hasAttribute("tone"), "kept off").toBe(false)
    expect(button.getAttribute("title"), "a valid one reaches it").toBe("t")
    button.click()
    expect(clicked, "an on prop reaches it, unasked").toBe(1)
    expect(asked.filter((key) => key.startsWith("on")), "no on prop asked").toEqual([])
    expect(given, "a wrapped component gets every prop").toBe("danger")
    expect(container.querySelector("[data-passed]")!.hasAttribute("tone"), "an inner config with none passes it on").toBe(false)
    expect(container.querySelector("[data-inner]")!.getAttribute("tone"), "an inner config's replaces it").toBe("danger")
  })
})

describe("wardic.create's forwardMotionProps (#443, Motion's)", () => {
  it("SU7: a wrapped component and a tag get the motion props, which still drive the element; without it, neither", async () => {
    const seen: Record<string, unknown> = {}
    const Box: Component<{ readonly ref?: (el: HTMLElement) => void; readonly style?: JSX.CSSProperties; readonly name: string; readonly animate?: unknown }> = (props) => {
      seen[props.name] = props.animate
      return <div data-name={props.name} ref={props.ref} style={props.style} />
    }
    const Forwarding = wardic.create(Box, { forwardMotionProps: true })
    const Plain = wardic.create(Box)
    const ForwardingDiv = wardic.create("div", { forwardMotionProps: true })
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <Forwarding name="forwarding" initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} transition={{ duration: 0.05 }} />
        <Plain name="plain" animate={{ opacity: 0.5 }} />
        <ForwardingDiv data-div custom="hello" />
      </WardicProvider>
    ))
    expect(seen.forwarding, "forwarded").toEqual({ opacity: 0.5 })
    expect(seen.plain, "not forwarded").toBeUndefined()
    expect(container.querySelector("[data-div]")!.getAttribute("custom"), "a tag's, as an attribute").toBe("hello")
    const forwarding = container.querySelector<HTMLElement>('[data-name="forwarding"]')!
    await until(() => opacityOf(forwarding) === 0.5, 3000)
    expect(opacityOf(forwarding), "they still drive the element").toBe(0.5)
  })
})
