// #443's hooks and exports on Solid 2, as Solid 1's SU tests pin them. Real frames.
//
// - SUV1: `createAnimationFrame`: its first frame's time is 0, then wall time; each delta held to
//   1–40 ms; its owner's disposal ends it, its provider still there.
// - SUV2: `createCycle`: steps and wraps; `cycle(i)` jumps; two steps before Solid flushes step twice.
// - SUV3: `createPageInView`: `true`, `false` while the page is hidden, `true` again.
// - SUV4: `createReducedMotionConfig`: the provider's `"always"`, a config's `"never"` over it, a
//   config's change followed. SUV4b: under an emulated preference, a config's `"user"` reads it.
// - SUV5: `WardicConfig`'s `isValidProp` keeps a tag's props off it, asks of no `on` prop, and hands a
//   wrapped component every prop.
// - SUV6: `forwardMotionProps` hands a wrapped component the motion props, which still drive the
//   element; without it, it gets none.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { createAnimationFrame, createCycle, createPageInView, createReducedMotionConfig, wardic, WardicConfig, WardicProvider } from "@wardic/solid/unstable/v2"
import { createSignal, flush, Show, untrack } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { commands } from "vitest/browser"
import { opacityOf, raf, until } from "../browser-helpers.ts"
import "../browser-commands.ts"
import { mount } from "./mount.tsx"

const setVisibility = (state: "hidden" | "visible"): void => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state })
  document.dispatchEvent(new Event("visibilitychange"))
}

describe("#443's hooks on Solid 2", () => {
  it("SUV1: createAnimationFrame: 0 at its first frame, then wall time; delta held to 1–40 ms; its owner's disposal ends it", async () => {
    const calls: Array<readonly [number, number]> = []
    const [on, setOn] = createSignal(true)
    const Ticker = (): JSX.Element => {
      createAnimationFrame((time, delta) => void calls.push([time, delta]))
      return null
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Show when={on()}>
          <Ticker />
        </Show>
      </WardicProvider>
    ))
    await until(() => calls.length >= 8, 3000)
    expect(calls[0]?.[0]).toBe(0)
    for (let i = 1; i < calls.length; i++) {
      const [time, delta] = calls[i]!
      expect(time).toBeGreaterThan(calls[i - 1]![0])
      expect(delta).toBeGreaterThanOrEqual(1)
      expect(delta).toBeLessThanOrEqual(40)
    }
    setOn(false)
    flush()
    await raf()
    await raf()
    const told = calls.length
    await raf()
    await raf()
    expect(calls.length, "no frame once its owner is gone").toBe(told)
  })

  it("SUV2: createCycle: steps and wraps; cycle(i) jumps; two steps before Solid flushes step twice", () => {
    const [item, cycle] = createCycle("a", "b", "c")
    expect(item()).toBe("a")
    cycle()
    flush()
    expect(item()).toBe("b")
    cycle(0)
    flush()
    expect(item()).toBe("a")
    cycle()
    cycle()
    flush()
    expect(item(), "two steps, one flush").toBe("c")
    cycle()
    flush()
    expect(item(), "the first after the last").toBe("a")
  })

  describe("createPageInView", () => {
    afterEach(() => {
      delete (document as { visibilityState?: unknown }).visibilityState
      document.dispatchEvent(new Event("visibilitychange"))
    })

    it("SUV3: true, false while the page is hidden, and true again", () => {
      const Read = (): JSX.Element => {
        const visible = createPageInView()
        return <p data-visible>{String(visible())}</p>
      }
      const { host } = mount(() => (
        <WardicProvider env={DomLive}>
          <Read />
        </WardicProvider>
      ))
      const p = host.querySelector("[data-visible]")!
      expect(p.textContent).toBe("true")
      setVisibility("hidden")
      flush()
      expect(p.textContent).toBe("false")
      setVisibility("visible")
      flush()
      expect(p.textContent).toBe("true")
    })
  })

  it("SUV4: createReducedMotionConfig: the provider's always, a config's never over it, a config's change followed", () => {
    const [setting, setSetting] = createSignal<"always" | "never">("never")
    const Read = (props: { readonly name: string }): JSX.Element => {
      const applies = createReducedMotionConfig()
      return <p data-name={props.name}>{String(applies())}</p>
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive} reducedMotion="always">
        <Read name="provider" />
        <WardicConfig reducedMotion="never">
          <Read name="never" />
        </WardicConfig>
        <WardicConfig reducedMotion={setting()}>
          <Read name="changing" />
        </WardicConfig>
      </WardicProvider>
    ))
    const read = (name: string): string | null => host.querySelector(`[data-name="${name}"]`)!.textContent
    expect(read("provider")).toBe("true")
    expect(read("never")).toBe("false")
    expect(read("changing")).toBe("false")
    setSetting("always")
    flush()
    expect(read("changing")).toBe("true")
  })

  it("SUV4b: under the user's preference for reduced motion, a config's user is true", async () => {
    await commands.emulateReducedMotion(true)
    try {
      const Read = (): JSX.Element => {
        const applies = createReducedMotionConfig()
        return <p data-user>{String(applies())}</p>
      }
      const { host } = mount(() => (
        <WardicProvider env={DomLive} reducedMotion="never">
          <WardicConfig reducedMotion="user">
            <Read />
          </WardicConfig>
        </WardicProvider>
      ))
      await until(() => host.querySelector("[data-user]")!.textContent === "true", 2000)
      expect(host.querySelector("[data-user]")!.textContent).toBe("true")
    } finally {
      await commands.emulateReducedMotion(false)
    }
  })

  it("SUV5: WardicConfig's isValidProp keeps a tag's props off it, asks of no on prop, and hands a wrapped component every prop", () => {
    const asked: Array<string> = []
    let clicked = 0
    let given: unknown
    const Box = (props: { readonly ref?: JSX.Ref<HTMLDivElement>; readonly style?: JSX.CSSProperties; readonly tone?: string }): JSX.Element => {
      given = untrack(() => props.tone)
      return <div data-box ref={props.ref} style={props.style} />
    }
    const WardicBox = wardic.create(Box)
    const props = { tone: "danger" } as Record<string, unknown>
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <WardicConfig
          isValidProp={(key) => {
            asked.push(key)
            return key !== "tone"
          }}
        >
          <wardic.button data-kept {...props} title="t" onClick={() => clicked++} />
          <WardicBox {...props} />
        </WardicConfig>
      </WardicProvider>
    ))
    const button = host.querySelector<HTMLElement>("[data-kept]")!
    expect(button.hasAttribute("tone")).toBe(false)
    expect(button.getAttribute("title")).toBe("t")
    button.click()
    expect(clicked).toBe(1)
    expect(asked.filter((key) => key.startsWith("on"))).toEqual([])
    expect(given).toBe("danger")
  })

  it("SUV6: forwardMotionProps hands a wrapped component the motion props, which still drive the element; without it, none", async () => {
    const seen: Record<string, unknown> = {}
    const Box = (props: { readonly ref?: JSX.Ref<HTMLDivElement>; readonly style?: JSX.CSSProperties; readonly name: string; readonly animate?: unknown }): JSX.Element => {
      untrack(() => {
        seen[props.name] = props.animate
      })
      return <div data-name={props.name} ref={props.ref} style={props.style} />
    }
    const Forwarding = wardic.create(Box, { forwardMotionProps: true })
    const Plain = wardic.create(Box)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Forwarding name="forwarding" initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} transition={{ duration: 0.05 }} />
        <Plain name="plain" animate={{ opacity: 0.5 }} />
      </WardicProvider>
    ))
    expect(seen.forwarding).toEqual({ opacity: 0.5 })
    expect(seen.plain).toBeUndefined()
    const forwarding = host.querySelector<HTMLElement>('[data-name="forwarding"]')!
    await until(() => opacityOf(forwarding) === 0.5, 3000)
    expect(opacityOf(forwarding)).toBe(0.5)
  })
})
