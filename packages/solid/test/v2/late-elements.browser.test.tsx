// A ward's element that comes after mount, or after the last one left the page (#414), on Solid 2, as
// the Solid 1 binding's LE tests pin it. Real frames, under the diagnostics gate.
//
// - LE7: a wrapped component that renders nothing at mount is waited on, with no error; its element,
//   when it comes, enters from `initial`.
// - LE8: an element that comes after the last one left the page enters fresh, from `initial`.
// - LE9: one that replaces the last within the same update carries on from where the ward is.
// - LE10: with `initial={false}`, the returning element starts at `animate`.
// - LE11: a ward spread on an element (`{...card}`) that goes and comes back enters fresh too.
// - LE12: a component that renders an element and forwards its ref to none still throws, at mount
//   and when its element comes later.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { ward, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { createSignal, Errored, flush, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { allowDiagnostic } from "./diagnostics.ts"
import { mount } from "./mount.tsx"

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

// Slow and linear, so a frame reads where the entrance is.
const ENTER = { initial: { opacity: 0, x: 40 }, animate: { opacity: 1, x: 0 }, transition: { type: "tween", duration: 0.5, ease: "linear" } } as const

/** A computed `transform` as a matrix, the identity for `none`. */
const matrixOf = (transform: string): DOMMatrix => {
  if (transform === "none") return new DOMMatrix()
  return new DOMMatrix(transform)
}

/** The element's opacity and translate, as drawn. */
const drawnOf = (el: HTMLElement): { readonly opacity: number; readonly x: number } => {
  const style = getComputedStyle(el)
  return { opacity: Number(style.opacity), x: matrixOf(style.transform).e }
}

/** A component that renders its element only while `shown`, forwarding its ref to it. */
const Later = (props: { readonly shown: boolean; readonly ref?: JSX.Ref<HTMLDivElement>; readonly style?: JSX.CSSProperties | string }) => (
  <Show when={props.shown}>
    <div data-later ref={props.ref} style={props.style} />
  </Show>
)
const WardicLater = wardic.create(Later)

const later = (host: Element): HTMLElement | null => host.querySelector<HTMLElement>("[data-later]")

/** Set a signal and flush, as an event handler's write lands. */
const set = <T,>(setter: (value: T) => unknown, value: T): void => {
  setter(value)
  flush()
}

describe("a ward's element that comes after mount, or comes back, on Solid 2 (#414)", () => {
  it("LE7: a wrapped component that renders nothing at mount is waited on, and its element enters from initial", async () => {
    const [shown, setShown] = createSignal(false)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <WardicLater shown={shown()} {...ENTER} />
      </WardicProvider>
    ))
    await frames(3)
    expect(later(host), "nothing rendered yet").toBeNull()
    set(setShown, true)
    const el = later(host)!
    await raf()
    expect(drawnOf(el).opacity, "its first frame at initial").toBeLessThan(0.1)
    expect(drawnOf(el).x).toBeGreaterThan(35)
    await until(() => drawnOf(el).opacity === 1, 3000)
    expect(drawnOf(el)).toEqual({ opacity: 1, x: 0 })
  })

  it("LE8: an element that comes after the last one left the page enters fresh, from initial", async () => {
    const [shown, setShown] = createSignal(true)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <WardicLater shown={shown()} {...ENTER} />
      </WardicProvider>
    ))
    await until(() => drawnOf(later(host)!).opacity === 1, 3000)
    set(setShown, false)
    await frames(2)
    set(setShown, true)
    const el = later(host)!
    expect(drawnOf(el).opacity, "drawn at initial before its first frame").toBe(0)
    await raf()
    expect(drawnOf(el).opacity, "its first frame at initial").toBeLessThan(0.1)
    expect(drawnOf(el).x).toBeGreaterThan(35)
    await frames(10)
    expect(drawnOf(el).opacity, "entering").toBeGreaterThan(0.1)
    await until(() => drawnOf(el).opacity === 1, 3000)
    expect(drawnOf(el)).toEqual({ opacity: 1, x: 0 })
  })

  it("LE9: an element that replaces the last within the same update carries on", async () => {
    const [which, setWhich] = createSignal("a")
    const Swapping = (props: { readonly which: string; readonly ref?: JSX.Ref<HTMLDivElement>; readonly style?: JSX.CSSProperties | string }) => (
      <Show when={props.which} keyed>
        {(name) => <div data-later data-which={name} ref={props.ref} style={props.style} />}
      </Show>
    )
    const WardicSwapping = wardic.create(Swapping)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <WardicSwapping which={which()} {...ENTER} />
      </WardicProvider>
    ))
    // Landed: the gate's own values on it, not a style's defaults.
    await until(() => later(host)!.style.opacity === "1", 3000)
    expect(drawnOf(later(host)!), "the first element landed").toEqual({ opacity: 1, x: 0 })
    set(setWhich, "b")
    const el = later(host)!
    expect(el.dataset.which, "a new element").toBe("b")
    await raf()
    expect(drawnOf(el), "where the ward is").toEqual({ opacity: 1, x: 0 })
  })

  it("LE10: with initial={false}, the returning element starts at animate", async () => {
    const [shown, setShown] = createSignal(true)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <WardicLater shown={shown()} {...ENTER} initial={false} />
      </WardicProvider>
    ))
    await frames(3)
    expect(drawnOf(later(host)!), "it starts at animate").toEqual({ opacity: 1, x: 0 })
    set(setShown, false)
    await frames(2)
    set(setShown, true)
    const el = later(host)!
    expect(drawnOf(el).opacity, "drawn at animate before its first frame").toBe(1)
    await frames(3)
    expect(drawnOf(el)).toEqual({ opacity: 1, x: 0 })
  })

  it("LE11: a ward spread on an element that goes and comes back enters fresh too", async () => {
    // A returning element enters fresh once its ref has set it and the last one is off the page, a
    // DOM fact, so its restart re-runs the spread's style once: a relay the style can't derive (#320).
    allowDiagnostic("EFFECT_WRITES_OWN_SOURCE", "a returning element's restart re-runs the spread's style")
    const [shown, setShown] = createSignal(true)
    const Host = () => {
      const card = ward(ENTER)
      return (
        <Show when={shown()}>
          <div data-later {...card} />
        </Show>
      )
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Host />
      </WardicProvider>
    ))
    await until(() => drawnOf(later(host)!).opacity === 1, 3000)
    set(setShown, false)
    await frames(2)
    set(setShown, true)
    const el = later(host)!
    expect(drawnOf(el).opacity, "drawn at initial before its first frame").toBe(0)
    await frames(10)
    expect(drawnOf(el).opacity, "entering").toBeGreaterThan(0.1)
    expect(drawnOf(el).opacity).toBeLessThan(1)
  })

  it("LE12: an element rendered without the ref forwarded to it still throws, at mount and later", async () => {
    const NoRef = (props: { readonly shown: boolean; readonly ref?: JSX.Ref<HTMLDivElement> }) => (
      <Show when={props.shown}>
        <div data-later />
      </Show>
    )
    const WardicNoRef = wardic.create(NoRef)
    const [shown, setShown] = createSignal(false)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Errored fallback={(error) => <p data-err>{String(error())}</p>}>
          <WardicNoRef shown={shown()} {...ENTER} />
        </Errored>
      </WardicProvider>
    ))
    await frames(2)
    expect(host.querySelector("[data-err]"), "nothing rendered yet: waited on").toBeNull()
    set(setShown, true)
    await until(() => host.querySelector("[data-err]") !== null, 1000)
    expect(host.querySelector("[data-err]")?.textContent).toMatch(/rendered an element but did not forward its ref/)

    const AtOnce = (_props: { readonly ref?: JSX.Ref<HTMLDivElement> }) => <div>no ref</div>
    const WardicAtOnce = wardic.create(AtOnce)
    const atOnce = mount(() => (
      <WardicProvider env={DomLive}>
        <Errored fallback={(error) => <p data-err>{String(error())}</p>}>
          <WardicAtOnce {...ENTER} />
        </Errored>
      </WardicProvider>
    ))
    await until(() => atOnce.host.querySelector("[data-err]") !== null, 1000)
    expect(atOnce.host.querySelector("[data-err]")?.textContent, "one that renders at mount: at once").toMatch(/did not forward its ref/)
  })
})
