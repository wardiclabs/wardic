// A tween transition with no `duration` (#107): its other options apply, and its duration is
// core's default, 0.3 s. It used to run on `animateValues`' defaults whole, dropping its `delay`,
// `easing`, `repeat` and `repeatType`, and the stagger the spine folds into `delay`. Real time, so each
// check reads well inside its window.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { createWard, wardic, WardicProvider, type WardicTransition } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { opacityOf, raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** A box that fades 0 → 1 under `transition` once `go` is called. */
const mountFade = async (transition: WardicTransition) => {
  const [on, setOn] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div data-box initial={{ opacity: 0 }} animate={{ opacity: Bool.match(on(), { onTrue: () => 1, onFalse: () => 0 }) }} transition={transition} />
    </WardicProvider>
  ))
  const box = container.querySelector("[data-box]") as HTMLElement
  await raf()
  await raf()
  return { box, go: () => setOn(true) }
}

describe("a tween transition with no duration keeps its other options (#107)", () => {
  it("delay: it holds through its delay, then runs", async () => {
    const m = await mountFade({ type: "tween", delay: 0.4 })
    m.go()
    await wait(200)
    expect(opacityOf(m.box), "still held at 200 ms").toBe(0)
    await until(() => opacityOf(m.box) === 1)
    expect(opacityOf(m.box)).toBe(1)
  })

  it("easing: a step-end easing holds the start until the end", async () => {
    const m = await mountFade({ type: "tween", easing: (t: number) => Math.floor(t) })
    m.go()
    await wait(150)
    expect(opacityOf(m.box), "held at 150 ms of 300").toBe(0)
    await until(() => opacityOf(m.box) === 1)
    expect(opacityOf(m.box)).toBe(1)
  })

  it("repeat and repeatType reverse: it runs out and back, and ends where it started", async () => {
    const m = await mountFade({ type: "tween", repeat: 1, repeatType: "reverse" })
    m.go()
    let peak = 0
    await until(() => {
      peak = Math.max(peak, opacityOf(m.box))
      return peak > 0.9 && opacityOf(m.box) === 0
    })
    expect(peak, "out").toBeGreaterThan(0.9)
    expect(opacityOf(m.box), "and back").toBe(0)
  })

  it("a stagger: the children start in turn", async () => {
    const els: Array<HTMLElement> = []
    const [open, setOpen] = createSignal(false)
    function App() {
      const parent = createWard(() => ({
        variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
        animate: Bool.match(open(), { onTrue: () => "open", onFalse: () => "closed" }),
        transition: { type: "tween", staggerChildren: 0.25 },
      }))
      const Child = (p: { readonly i: number }) => {
        const child = createWard({ initial: { opacity: 0 }, variants: { open: { opacity: 1 }, closed: { opacity: 0 } } })
        return <div {...child({ ref: (node: HTMLElement) => (els[p.i] = node) })}>c</div>
      }
      return (
        <div {...parent()}>
          <parent.Provider>{[0, 1, 2].map((i) => <Child i={i} />)}</parent.Provider>
        </div>
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <App />
      </WardicProvider>
    ))
    await raf()
    await raf()
    setOpen(true)
    await wait(150)
    expect(opacityOf(els[0]!), "the first child has started").toBeGreaterThan(0.1)
    expect(opacityOf(els[2]!), "the third waits its 0.5 s").toBe(0)
  })
})
