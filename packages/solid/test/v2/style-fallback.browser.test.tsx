// The element's `style` once the gate commits its frames, on Solid 2 (#209, #79, ADR-0034), as the
// Solid 1 binding's style-fallback tests pin it: Wardic's value wins a key while it drives it, and
// the user's `style` is the fallback, never written over the keys the gate holds.
//
// - F1–F8: the Solid 1 binding's, through `wardic.div`, `wardic.create(Component)` and a kept
//   ward's spread (onto an element, and onto components that apply its ref and style their ways).
// - F9: a key the user's style sets, taken by a one-frame animation, keeps Wardic's value: the gate
//   tells the binding the keys it holds in its `batch`, so Solid 2 drops the key from `style`
//   before the commit, not after it (ADR-0034, *Amendment (#209)*).
import { DomLive } from "@wardic/dom"
import { ward, wardic, WardicProvider, type WardicTransition } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import type { JSX } from "@solidjs/web"
import { type Component, createEffect, createSignal, flush } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const TWEEN: WardicTransition = { type: "tween", duration: 0.15 }

/** Two Refresh frames: one for Solid's effect to run, one for any later commit. */
const twoFrames = async (): Promise<void> => {
  await raf()
  await raf()
}

/** A component that forwards its ref and applies `props.style` to its root. */
const Card = (props: { readonly ref?: JSX.Ref<HTMLDivElement>; readonly style?: JSX.CSSProperties | string }): JSX.Element => (
  <div ref={props.ref} style={props.style}>
    card
  </div>
)
const WCard = wardic.create(Card)

describe("the user's style is the fallback (ADR-0034)", () => {
  it("F1: wardic.div: once the animation settles, a change to the user's style keeps the animated key", async () => {
    let el!: HTMLDivElement
    const [tone, setTone] = createSignal("rgb(255, 0, 0)")
    const [dim, setDim] = createSignal(false)
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(n: HTMLDivElement) => (el = n)}
          style={{ opacity: Bool.match(dim(), { onTrue: () => 0.5, onFalse: () => 1 }), color: tone() }}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0.2 }}
          transition={TWEEN}
        />
      </WardicProvider>
    ))
    await until(() => el.style.opacity === "0.2", 2000)
    setTone("rgb(0, 0, 255)")
    flush()
    await twoFrames()
    expect(el.style.color).toBe("rgb(0, 0, 255)")
    expect(el.style.opacity).toBe("0.2")
    setDim(true)
    flush()
    await twoFrames()
    expect(el.style.opacity).toBe("0.2")
  })

  it("F2: wardic.div: a user style given as CSS text never wipes the keys Wardic holds", async () => {
    let el!: HTMLDivElement
    const [css, setCss] = createSignal("color: rgb(255, 0, 0)")
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLDivElement) => (el = n)} style={css()} initial={{ x: 0 }} animate={{ x: 40 }} transition={TWEEN} />
      </WardicProvider>
    ))
    await until(() => el.style.transform === "translateX(40px)", 2000)
    setCss("color: rgb(0, 0, 255)")
    flush()
    await twoFrames()
    expect(el.style.color).toBe("rgb(0, 0, 255)")
    expect(el.style.transform).toBe("translateX(40px)")
  })

  it("F3: wardic.create(Component): once the animation settles, a change to the user's style keeps the animated key", async () => {
    let el!: HTMLElement
    const [tone, setTone] = createSignal("rgb(255, 0, 0)")
    mount(() => (
      <WardicProvider env={DomLive}>
        <WCard ref={(n: HTMLElement) => (el = n)} style={{ opacity: 1, color: tone() }} initial={{ opacity: 1 }} animate={{ opacity: 0.2 }} transition={TWEEN} />
      </WardicProvider>
    ))
    await until(() => el.style.opacity === "0.2", 2000)
    setTone("rgb(0, 0, 255)")
    flush()
    await twoFrames()
    expect(el.style.color).toBe("rgb(0, 0, 255)")
    expect(el.style.opacity).toBe("0.2")
  })

  it("F4: wardic.create(Component): a user style given as CSS text never wipes the keys Wardic holds", async () => {
    let el!: HTMLElement
    const [css, setCss] = createSignal("color: rgb(255, 0, 0)")
    mount(() => (
      <WardicProvider env={DomLive}>
        <WCard ref={(n: HTMLElement) => (el = n)} style={css()} initial={{ x: 0 }} animate={{ x: 40 }} transition={TWEEN} />
      </WardicProvider>
    ))
    await until(() => el.style.transform === "translateX(40px)", 2000)
    setCss("color: rgb(0, 0, 255)")
    flush()
    await twoFrames()
    expect(el.style.color).toBe("rgb(0, 0, 255)")
    expect(el.style.transform).toBe("translateX(40px)")
  })

  it("F5: a kept ward's style re-runs at the first commit, and never for a frame", async () => {
    let el!: HTMLElement
    let runs = 0
    const Box = () => {
      const card = ward({ initial: { x: 0, opacity: 1 }, animate: { x: 40, opacity: 0.2 }, transition: TWEEN, style: { color: "rgb(255, 0, 0)" } })
      createEffect(
        () => card.style,
        () => {
          runs++
        },
        { defer: true },
      )
      return <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await until(() => el.style.transform === "translateX(40px)" && el.style.opacity === "0.2", 2000)
    expect(runs).toBe(1)
    expect(el.style.color).toBe("rgb(255, 0, 0)")
  })

  it("F6: a kept ward spread onto a component animates the element its ref reaches", async () => {
    let root!: HTMLElement
    let inner!: HTMLElement
    const Split: Component<{ readonly ref?: JSX.Ref<HTMLDivElement>; readonly style?: JSX.CSSProperties }> = (props) => (
      <div ref={props.ref}>
        <span ref={(n: HTMLSpanElement) => (inner = n)} style={props.style}>
          x
        </span>
      </div>
    )
    const Box = () => {
      const card = ward({ initial: { opacity: 1 }, animate: { opacity: 0.2 }, transition: TWEEN })
      return <Split {...card} ref={[card, (n: HTMLDivElement) => (root = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await until(() => root.style.opacity === "0.2", 2000)
    expect(root.style.opacity).toBe("0.2")
    expect(inner.style.opacity).toBe("")
  })

  it("F7: a kept ward spread onto a component that forwards its ref only animates that element", async () => {
    let root!: HTMLElement
    const RefOnly: Component<{ readonly ref?: JSX.Ref<HTMLDivElement> }> = (props) => <div ref={props.ref}>x</div>
    const Box = () => {
      const card = ward({ initial: { opacity: 1 }, animate: { opacity: 0.2 }, transition: TWEEN })
      return <RefOnly {...card} ref={[card, (n: HTMLDivElement) => (root = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await until(() => root.style.opacity === "0.2", 2000)
    expect(root.style.opacity).toBe("0.2")
  })

  it("F8: a kept ward spread onto a component that reads props.style once animates its ref's element", async () => {
    let root!: HTMLElement
    const ReadsOnce: Component<{ readonly ref?: JSX.Ref<HTMLDivElement>; readonly style?: JSX.CSSProperties }> = (props) => {
      const style = props.style
      return (
        <div ref={props.ref} style={style}>
          x
        </div>
      )
    }
    const Box = () => {
      const card = ward({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: TWEEN })
      return <ReadsOnce {...card} ref={[card, (n: HTMLDivElement) => (root = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    expect(root.style.opacity).toBe("0")
    await until(() => root.style.opacity === "1", 2000)
    expect(root.style.opacity).toBe("1")
  })

  it("F9: a key the user's style sets, taken in one frame, keeps Wardic's value", async () => {
    let el!: HTMLDivElement
    mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(n: HTMLDivElement) => (el = n)}
          style={{ opacity: 0.5 }}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0.2 }}
          transition={{ type: "tween", duration: 0 }}
        />
      </WardicProvider>
    ))
    await until(() => el.style.opacity === "0.2", 2000)
    await twoFrames()
    await twoFrames()
    expect(el.style.opacity).toBe("0.2")
  })
})
