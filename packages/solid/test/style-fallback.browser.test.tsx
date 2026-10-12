// The element's `style` once the gate commits its frames (#79, ADR-0034): Wardic's value wins a
// key while it drives it, and the user's `style` is the fallback. The gate commits every frame
// onto the element, and the `style` Solid applies leaves out the keys the gate holds, so a user
// style change never writes over them: not a reactive key that's also animated (F1, F3), not a
// change to another key (Solid's `style()` writes every key again), and not CSS text, which
// Solid writes as `cssText` over every inline key (F2, F4). No frame re-runs the `style` (F5).
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { useWardic, wardic, WardicProvider, type WardicTransition } from "@wardic/solid"
import { type Component, createEffect, createSignal, type JSX, on } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const TWEEN: WardicTransition = { type: "tween", duration: 0.15 }

/** Two Refresh frames: one for Solid's effect to run, one for any later commit. */
const twoFrames = async (): Promise<void> => {
  await raf()
  await raf()
}

/** A component that forwards its ref and applies `props.style` to its root. */
const Card = (props: { ref?: (el: HTMLElement) => void; style?: JSX.CSSProperties | string }): JSX.Element => (
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
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={el}
          style={{ opacity: dim() ? 0.5 : 1, color: tone() }}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0.2 }}
          transition={TWEEN}
        />
      </WardicProvider>
    ))
    await until(() => el.style.opacity === "0.2", 2000)
    setTone("rgb(0, 0, 255)") // another key: Solid's style() writes every key again
    await twoFrames()
    expect(el.style.color).toBe("rgb(0, 0, 255)")
    expect(el.style.opacity).toBe("0.2")
    setDim(true) // the key itself
    await twoFrames()
    expect(el.style.opacity).toBe("0.2")
  })

  it("F2: wardic.div: a user style given as CSS text never wipes the keys Wardic holds", async () => {
    let el!: HTMLDivElement
    const [css, setCss] = createSignal("color: rgb(255, 0, 0)")
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={el} style={css()} initial={{ x: 0 }} animate={{ x: 40 }} transition={TWEEN} />
      </WardicProvider>
    ))
    await until(() => el.style.transform === "translateX(40px)", 2000)
    setCss("color: rgb(0, 0, 255)")
    await twoFrames()
    expect(el.style.color).toBe("rgb(0, 0, 255)")
    expect(el.style.transform).toBe("translateX(40px)")
  })

  it("F3: wardic.create(Component): once the animation settles, a change to the user's style keeps the animated key", async () => {
    let el!: HTMLElement
    const [tone, setTone] = createSignal("rgb(255, 0, 0)")
    render(() => (
      <WardicProvider env={DomLive}>
        <WCard
          ref={(n: HTMLElement) => (el = n)}
          style={{ opacity: 1, color: tone() }}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0.2 }}
          transition={TWEEN}
        />
      </WardicProvider>
    ))
    await until(() => el.style.opacity === "0.2", 2000)
    setTone("rgb(0, 0, 255)")
    await twoFrames()
    expect(el.style.color).toBe("rgb(0, 0, 255)")
    expect(el.style.opacity).toBe("0.2")
  })

  it("F4: wardic.create(Component): a user style given as CSS text never wipes the keys Wardic holds", async () => {
    let el!: HTMLElement
    const [css, setCss] = createSignal("color: rgb(255, 0, 0)")
    render(() => (
      <WardicProvider env={DomLive}>
        <WCard ref={(n: HTMLElement) => (el = n)} style={css()} initial={{ x: 0 }} animate={{ x: 40 }} transition={TWEEN} />
      </WardicProvider>
    ))
    await until(() => el.style.transform === "translateX(40px)", 2000)
    setCss("color: rgb(0, 0, 255)")
    await twoFrames()
    expect(el.style.color).toBe("rgb(0, 0, 255)")
    expect(el.style.transform).toBe("translateX(40px)")
  })

  it("F5: a useWardic spread's style re-runs at the first commit, and never for a frame", async () => {
    let el!: HTMLElement
    let runs = 0
    const Box = () => {
      const ward = useWardic({ initial: { x: 0, opacity: 1 }, animate: { x: 40, opacity: 0.2 }, transition: TWEEN })
      createEffect(on(() => ward().style, () => void runs++, { defer: true }))
      return <div {...ward({ ref: (n) => (el = n), style: { color: "rgb(255, 0, 0)" } })} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await until(() => el.style.transform === "translateX(40px)" && el.style.opacity === "0.2", 2000)
    expect(runs).toBe(1)
  })

  it("F6: a useWardic spread onto a component animates the element its ref reaches", async () => {
    let root!: HTMLElement
    let inner!: HTMLElement
    const Split: Component<{ ref?: (el: HTMLElement) => void; style?: JSX.CSSProperties }> = (props) => (
      <div ref={props.ref}>
        <span ref={inner} style={props.style}>
          x
        </span>
      </div>
    )
    const Box = () => {
      const ward = useWardic({ initial: { opacity: 1 }, animate: { opacity: 0.2 }, transition: TWEEN })
      return <Split {...ward({ ref: (n) => (root = n) })} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await until(() => root.style.opacity === "0.2", 2000)
    expect(inner.style.opacity).toBe("")
  })

  it("F7: a useWardic spread onto a component that forwards its ref only animates that element", async () => {
    let root!: HTMLElement
    const RefOnly: Component<{ ref?: (el: HTMLElement) => void }> = (props) => <div ref={props.ref}>x</div>
    const Box = () => {
      const ward = useWardic({ initial: { opacity: 1 }, animate: { opacity: 0.2 }, transition: TWEEN })
      return <RefOnly {...ward({ ref: (n) => (root = n) })} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await until(() => root.style.opacity === "0.2", 2000)
  })

  it("F8: a useWardic spread onto a component that reads props.style once animates its ref's element", async () => {
    let root!: HTMLElement
    const ReadsOnce: Component<{ ref?: (el: HTMLElement) => void; style?: JSX.CSSProperties }> = (props) => {
      const style = props.style
      return (
        <div ref={props.ref} style={style}>
          x
        </div>
      )
    }
    const Box = () => {
      const ward = useWardic({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: TWEEN })
      return <ReadsOnce {...ward({ ref: (n) => (root = n) })} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    expect(root.style.opacity).toBe("0") // the Starting style, read once
    await until(() => root.style.opacity === "1", 2000)
  })
})
