// `type: "inertia"` on any value (#435, Motion's): each number glides from where it's drawn at its
// velocity, whatever its target, and rests where its glide does, held within `min` / `max`; a key
// that isn't a number runs on its Default transition. Real frames. Solid 2's are ITV1.
//
// - IT1: a glide at the transition's velocity carries past its target and bounces back to `max`,
//   told start and complete; with no velocity, nothing moves, and it lands at once.
// - IT2: with no `velocity`, a key glides on its own: a spring's, taken over mid-flight.
// - IT3: a colour beside a gliding number eases to its target on its Default transition.
// - IT4: `createAnimate`'s `animate()` glides on it.
// - IT5: a layout animation under it runs on the default layout tween.
import { cleanup, render } from "@solidjs/testing-library"
import * as Inertia from "@wardic/core/Inertia"
import { DomLive } from "@wardic/dom"
import { createAnimate, type WardicAnimate, type WardicAnimationDefinition, wardic, WardicProvider, type WardicTransition } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const xOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41
// Clear of the page's one mouse, parked at (5, 5) for every browser file.
const BOX = { display: "block", width: "40px", height: "40px", "margin-top": "120px", "margin-left": "120px" } as const

/** Render `ui` inside a provider; `q` finds a `data-k`. */
const mount = (ui: () => JSX.Element) => {
  const { container } = render(() => <WardicProvider env={DomLive}>{ui()}</WardicProvider>)
  return (k: string): HTMLElement => container.querySelector<HTMLElement>(`[data-k="${k}"]`)!
}

/** `x`'s value each frame until it stays put for `still` frames (or `limit`). */
const untilStill = async (el: Element, still = 8, limit = 300): Promise<ReadonlyArray<number>> => {
  const seen: Array<number> = []
  for (let i = 0; i < limit; i++) {
    await raf()
    seen.push(xOf(el))
    if (seen.length > still && seen.slice(-still).every((v) => Math.abs(v - seen.at(-1)!) < 0.01)) break
  }
  return seen
}

describe("type: inertia on any value (#435)", () => {
  it("IT1: it glides past its target at its velocity and bounces back to max, told; with none it stays", async () => {
    const calls: Array<string> = []
    const tell = (name: string) => (definition: WardicAnimationDefinition) => calls.push(`${name} ${JSON.stringify(definition)}`)
    const [to, setTo] = createSignal(0)
    // From mount: a quiet mount starts nothing, whatever velocity its transition gives (#475).
    const q = mount(() => (
      <>
        <wardic.div
          data-k="fling"
          initial={false}
          animate={{ x: to() }}
          transition={{ type: "inertia", velocity: 800, max: 50 }}
          onAnimationStart={tell("start")}
          onAnimationComplete={tell("complete")}
          style={BOX}
        />
        <wardic.div data-k="still" initial={false} animate={{ x: to() }} transition={{ type: "inertia" }} style={BOX} />
      </>
    ))
    await frames(3)
    expect(xOf(q("fling")), "nothing at mount (#475)").toBeCloseTo(0, 3)
    setTo(200)
    await frames(2)
    expect(xOf(q("still")), "no velocity: where it was, its target unread").toBeCloseTo(0, 3)
    const seen = await untilStill(q("fling"))
    expect(Math.max(...seen), "past its edge first").toBeGreaterThan(55)
    expect(seen.at(-1), "back on max").toBeCloseTo(50, 1)
    await until(() => calls.length === 2, 1000)
    expect(calls).toEqual(['start {"x":200}', 'complete {"x":200}'])
  })

  it("IT2: with no velocity given, a key glides on its own, a spring's taken over mid-flight", async () => {
    const [transition, setTransition] = createSignal<WardicTransition>({ type: "spring", stiffness: 40, damping: 8 })
    const [to, setTo] = createSignal(0)
    const q = mount(() => <wardic.div data-k="el" initial={false} animate={{ x: to() }} transition={transition()} style={BOX} />)
    await frames(3)
    setTo(300)
    await wait(150)
    const at = xOf(q("el"))
    expect(at, "on its way").toBeGreaterThan(5)
    setTransition({ type: "inertia" })
    setTo(0)
    await frames(4)
    expect(xOf(q("el")), "it carries on, its target unread").toBeGreaterThan(at)
    const seen = await untilStill(q("el"))
    expect(seen.at(-1), "and comes to rest").toBeGreaterThan(at)
  })

  it("IT3: a colour beside a gliding number eases to its target on its Default transition", async () => {
    const [on, setOn] = createSignal(false)
    const q = mount(() => (
      <wardic.div
        data-k="el"
        initial={{ x: 0, "background-color": "rgb(0, 0, 0)" }}
        animate={Bool.match(on(), { onTrue: () => ({ x: 10, "background-color": "rgb(255, 0, 0)" }), onFalse: () => ({ x: 0, "background-color": "rgb(0, 0, 0)" }) })}
        transition={Bool.match(on(), { onTrue: (): WardicTransition => ({ type: "inertia", velocity: 300 }), onFalse: () => ({}) })}
        style={BOX}
      />
    ))
    await frames(3)
    setOn(true)
    await until(() => getComputedStyle(q("el")).backgroundColor === "rgb(255, 0, 0)", 2000)
    expect(getComputedStyle(q("el")).backgroundColor, "at its target").toBe("rgb(255, 0, 0)")
    const seen = await untilStill(q("el"))
    expect(seen.at(-1), "x where its glide rests").toBeCloseTo(Inertia.restOf(0, 300, {}), 1)
  })

  it("IT4: createAnimate's animate() glides on it", async () => {
    let animate!: WardicAnimate
    const Scene = (): JSX.Element => {
      const [scope, made] = createAnimate()
      animate = made
      return (
        <div ref={scope}>
          <div id="it4" style={BOX} />
        </div>
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await frames(2)
    const el = document.getElementById("it4")!
    await animate(el, { x: 0 }, { type: "inertia", velocity: -500, min: -100 })
    expect(xOf(el), "on min").toBeCloseTo(-100, 1)
  })

  it("IT5: a layout animation under it runs on the default layout tween", async () => {
    const [wide, setWide] = createSignal(false)
    const q = mount(() => (
      <wardic.div data-k="el" layout transition={{ type: "inertia", velocity: 500 }} style={{ width: Bool.match(wide(), { onTrue: () => "200px", onFalse: () => "100px" }), height: "20px" }} />
    ))
    await frames(3)
    setWide(true)
    await wait(150)
    const width = q("el").getBoundingClientRect().width
    expect(width, "on its way, not landed at once").toBeGreaterThan(105)
    expect(width).toBeLessThan(195)
    await until(() => Math.abs(q("el").getBoundingClientRect().width - 200) < 0.5, 1500)
    expect(q("el").getBoundingClientRect().width, "landed by the tween's 0.45 s").toBeCloseTo(200, 0)
  })
})
