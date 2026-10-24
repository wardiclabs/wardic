// Keys a Retarget carries, on Solid 1 (#325, ADR-0005 Amendment (#325)): the spine is the Solid 2
// binding's (`v2/carried-keys`), so these pin what Solid 1 reads of it. Each test runs the element
// beside a twin whose keys don't change, mounted in the same task; each frame is read just after it
// paints.
//
// - KC1: one key of two changes mid-flight: the other draws as its twin's, and lands with it.
// - KC5: `onAnimationComplete` for a Retarget comes when the keys it carries land too (Q2 B), after
//   the changed key's shorter leg.
// - KC11: a list's name whose keys carry on is told complete when they land, after the name whose
//   key changed (#297's names, each told with the legs of the keys it drives).
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { type WardicAnimationDefinition, type WardicTransition, wardic, WardicProvider, type WardicVariants } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"

afterEach(cleanup)

const TWEEN = { type: "tween", duration: 0.6, ease: "linear" } as const
const FAST = { type: "tween", duration: 0.1, ease: "linear" } as const
const BOX = { display: "block", width: "20px", height: "20px" } as const

const xOf = (el: HTMLElement): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41
const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)

/** Resolve just after the next frame paints: a `MessageChannel` message its rAF posts. */
const painted = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        channel.port1.close()
        resolve()
      }
      channel.port2.postMessage(undefined)
    })
  })

/** Painted frames until `done()`, at most `most`; whether it was. */
const paintedUntil = async (done: () => boolean, most = 240): Promise<boolean> => {
  for (let i = 0; i < most; i++) {
    if (done()) return true
    await painted()
  }
  return done()
}

/** Render `ui` inside a provider; `q` finds a `data-k`. */
const mount = (ui: () => JSX.Element) => {
  const { container } = render(() => <WardicProvider env={DomLive}>{ui()}</WardicProvider>)
  return (k: string): HTMLElement => container.querySelector<HTMLElement>(`[data-k="${k}"]`)!
}

describe("a Retarget carries the keys whose target didn't change, on Solid 1 (#325)", () => {
  it("KC1: one key of two changes mid-flight: the other draws as its twin's, and lands with it", async () => {
    const [o, setO] = createSignal(1)
    const q = mount(() => (
      <>
        <wardic.div data-k="el" initial={{ x: 0, opacity: 0 }} animate={{ x: 100, opacity: o() }} transition={TWEEN} style={BOX} />
        <wardic.div data-k="twin" initial={{ x: 0, opacity: 0 }} animate={{ x: 100, opacity: 1 }} transition={TWEEN} style={BOX} />
      </>
    ))
    expect(await paintedUntil(() => xOf(q("el")) > 20), "mid-flight").toBe(true)
    setO(0.3)
    const gaps: Array<number> = []
    await paintedUntil(() => {
      gaps.push(Math.abs(xOf(q("el")) - xOf(q("twin"))))
      return xOf(q("twin")) >= 100
    })
    expect(gaps.length, "it ran on").toBeGreaterThan(5)
    expect(Math.max(...gaps), "x draws as its twin's").toBeLessThan(0.5)
    expect(xOf(q("el")), "and lands with it").toBe(100)
    expect(await paintedUntil(() => Math.abs(opacityOf(q("el")) - 0.3) < 0.001), "opacity lands on its new target").toBe(true)
  })

  it("KC5: onAnimationComplete for a Retarget comes when the keys it carries land, after the changed key's shorter leg", async () => {
    const [fast, setFast] = createSignal(false)
    const [o, setO] = createSignal(1)
    const completes: Array<{ readonly definition: WardicAnimationDefinition; readonly x: number }> = []
    let el!: HTMLDivElement
    mount(() => (
      <wardic.div
        ref={el}
        initial={{ x: 0, opacity: 0 }}
        animate={{ x: 100, opacity: o() }}
        transition={Bool.match(fast(), { onTrue: (): WardicTransition => FAST, onFalse: (): WardicTransition => TWEEN })}
        onAnimationComplete={(definition) => completes.push({ definition, x: xOf(el) })}
        style={BOX}
      />
    ))
    expect(await paintedUntil(() => xOf(el) > 20), "mid-flight").toBe(true)
    setFast(true)
    setO(0.3)
    let opacityLandedAtX = -1
    await paintedUntil(() => {
      if (Math.abs(opacityOf(el) - 0.3) < 0.001 && opacityLandedAtX < 0) opacityLandedAtX = xOf(el)
      return completes.length > 0
    })
    expect(opacityLandedAtX, "opacity landed first").toBeLessThan(90)
    expect(completes, "told once, when x landed too").toEqual([{ definition: { x: 100, opacity: 0.3 }, x: 100 }])
  })

  it("KC11: a list's name whose keys carry on is told complete when they land, after the name whose key changed", async () => {
    const [names, setNames] = createSignal<ReadonlyArray<string>>(["a", "b"])
    const variants: WardicVariants = { a: { x: 100 }, b: { opacity: 1 }, c: { opacity: 0.3, transition: FAST } }
    const completes: Array<{ readonly definition: WardicAnimationDefinition; readonly x: number }> = []
    let el!: HTMLDivElement
    mount(() => (
      <wardic.div
        ref={el}
        variants={variants}
        initial={{ x: 0, opacity: 0 }}
        animate={names() as Array<string>}
        transition={TWEEN}
        onAnimationComplete={(definition) => completes.push({ definition, x: xOf(el) })}
        style={BOX}
      />
    ))
    expect(await paintedUntil(() => xOf(el) > 20), "mid-flight").toBe(true)
    setNames(["a", "c"])
    await paintedUntil(() => completes.some((complete) => complete.definition === "a"))
    expect(completes.map((complete) => complete.definition), "c first, then a").toEqual(["c", "a"])
    expect(completes[1]!.x, "a is told once its x lands").toBe(100)
    expect(completes[0]!.x, "c's own key landed while a's ran on").toBeLessThan(90)
  })
})
