// A ward's element that comes after mount, or after the last one left the page (#414), on Solid 1.
// Real frames.
//
// - LE1: a wrapped component that renders nothing at mount (a component library's part that shows
//   only while selected) is waited on, with no error; its element, when it comes, enters from
//   `initial`. It threw "did not forward its ref" at mount.
// - LE2: an element that comes after the last one left the page enters fresh, from `initial`, as a
//   mount does: its first frame at `initial`, then the animation. It came at the ward's values.
// - LE3: one that replaces the last within the same update carries on from where the ward is.
// - LE4: with `initial={false}`, the returning element starts at `animate`, as a mount does.
// - LE5: a ward spread on an element (`{...card()}`) that goes and comes back enters fresh too.
// - LE6: a component that renders an element and forwards its ref to none still throws, at mount, and
//   also when its element comes later (the check runs each time what it renders changes).
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { createWard, wardic, WardicProvider } from "@wardic/solid"
import { createSignal, ErrorBoundary, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

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
const Later = (props: { readonly shown: boolean; readonly ref?: (el: HTMLElement) => void; readonly style?: JSX.CSSProperties }) => (
  <Show when={props.shown}>
    <div data-later ref={props.ref} style={{ width: "40px", height: "40px", ...props.style }} />
  </Show>
)
const WardicLater = wardic.create(Later)

const later = (host: Element): HTMLElement | null => host.querySelector<HTMLElement>("[data-later]")

describe("a ward's element that comes after mount, or comes back (#414)", () => {
  it("LE1: a wrapped component that renders nothing at mount is waited on, and its element enters from initial", async () => {
    const [shown, setShown] = createSignal(false)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <WardicLater shown={shown()} {...ENTER} />
      </WardicProvider>
    ))
    await frames(3)
    expect(later(container), "nothing rendered yet").toBeNull()
    setShown(true)
    const el = later(container)!
    await raf()
    expect(drawnOf(el).opacity, "its first frame at initial").toBeLessThan(0.1)
    expect(drawnOf(el).x).toBeGreaterThan(35)
    await until(() => drawnOf(el).opacity === 1, 3000)
    expect(drawnOf(el)).toEqual({ opacity: 1, x: 0 })
  })

  it("LE2: an element that comes after the last one left the page enters fresh, from initial", async () => {
    const [shown, setShown] = createSignal(true)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <WardicLater shown={shown()} {...ENTER} />
      </WardicProvider>
    ))
    await until(() => drawnOf(later(container)!).opacity === 1, 3000)
    setShown(false)
    await frames(2)
    setShown(true)
    const el = later(container)!
    expect(drawnOf(el).opacity, "drawn at initial before its first frame").toBe(0)
    await raf()
    expect(drawnOf(el).opacity, "its first frame at initial").toBeLessThan(0.1)
    expect(drawnOf(el).x).toBeGreaterThan(35)
    await frames(10)
    expect(drawnOf(el).opacity, "entering").toBeGreaterThan(0.1)
    await until(() => drawnOf(el).opacity === 1, 3000)
    expect(drawnOf(el)).toEqual({ opacity: 1, x: 0 })
  })

  it("LE3: an element that replaces the last within the same update carries on", async () => {
    const [which, setWhich] = createSignal("a")
    const Swapping = (props: { readonly which: string; readonly ref?: (el: HTMLElement) => void; readonly style?: JSX.CSSProperties }) => (
      <Show when={props.which} keyed>
        {(name) => <div data-later data-which={name} ref={props.ref} style={{ width: "40px", height: "40px", ...props.style }} />}
      </Show>
    )
    const WardicSwapping = wardic.create(Swapping)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <WardicSwapping which={which()} {...ENTER} />
      </WardicProvider>
    ))
    // Landed: the gate's own values on it, not a style's defaults.
    await until(() => later(container)!.style.opacity === "1", 3000)
    expect(drawnOf(later(container)!), "the first element landed").toEqual({ opacity: 1, x: 0 })
    setWhich("b")
    const el = later(container)!
    expect(el.dataset.which, "a new element").toBe("b")
    await raf()
    expect(drawnOf(el), "where the ward is").toEqual({ opacity: 1, x: 0 })
  })

  it("LE4: with initial={false}, the returning element starts at animate", async () => {
    const [shown, setShown] = createSignal(true)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <WardicLater shown={shown()} {...ENTER} initial={false} />
      </WardicProvider>
    ))
    await frames(3)
    expect(drawnOf(later(container)!), "it starts at animate").toEqual({ opacity: 1, x: 0 })
    setShown(false)
    await frames(2)
    setShown(true)
    const el = later(container)!
    expect(drawnOf(el).opacity, "drawn at animate before its first frame").toBe(1)
    await frames(3)
    expect(drawnOf(el)).toEqual({ opacity: 1, x: 0 })
  })

  it("LE5: a ward spread on an element that goes and comes back enters fresh too", async () => {
    const [shown, setShown] = createSignal(true)
    const Host = () => {
      const card = createWard(ENTER)
      return (
        <Show when={shown()}>
          <div data-later {...card({ style: { width: "40px", height: "40px" } })} />
        </Show>
      )
    }
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <Host />
      </WardicProvider>
    ))
    await until(() => drawnOf(later(container)!).opacity === 1, 3000)
    setShown(false)
    await frames(2)
    setShown(true)
    const el = later(container)!
    expect(drawnOf(el).opacity, "drawn at initial before its first frame").toBe(0)
    await frames(10)
    expect(drawnOf(el).opacity, "entering").toBeGreaterThan(0.1)
    expect(drawnOf(el).opacity).toBeLessThan(1)
  })

  it("LE6: an element rendered without the ref forwarded to it still throws, at mount and later", async () => {
    const NoRef = (props: { readonly shown: boolean; readonly ref?: (el: HTMLElement) => void }) => (
      <Show when={props.shown}>
        <div data-later />
      </Show>
    )
    const WardicNoRef = wardic.create(NoRef)
    const [shown, setShown] = createSignal(false)
    const late: { error?: Error } = {}
    render(() => (
      <WardicProvider env={DomLive}>
        <ErrorBoundary
          fallback={(error: Error) => {
            late.error = error
            return <p>failed</p>
          }}
        >
          <WardicNoRef shown={shown()} {...ENTER} />
        </ErrorBoundary>
      </WardicProvider>
    ))
    await frames(2)
    expect(late.error, "nothing rendered yet: waited on").toBeUndefined()
    setShown(true)
    await until(() => late.error !== undefined, 1000)
    expect(late.error?.message).toMatch(/rendered an element but did not forward its ref/)

    const AtOnce = (_props: { readonly ref?: (el: HTMLElement) => void }) => <div>no ref</div>
    const WardicAtOnce = wardic.create(AtOnce)
    const atOnce: { error?: Error } = {}
    render(() => (
      <WardicProvider env={DomLive}>
        <ErrorBoundary
          fallback={(error: Error) => {
            atOnce.error = error
            return <p>failed</p>
          }}
        >
          <WardicAtOnce {...ENTER} />
        </ErrorBoundary>
      </WardicProvider>
    ))
    await until(() => atOnce.error !== undefined, 1000)
    expect(atOnce.error?.message, "one that renders at mount: at once").toMatch(/did not forward its ref/)
  })
})
