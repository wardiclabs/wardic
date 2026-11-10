// `createBatch` on Solid 2 (#665, ADR-0070 decisions 10–15 and *Amendment (#665)*): Solid 1's, its
// landings an async value. Its shared work is Solid 1's tests' (`../create-batch.browser.test.tsx`).
//
// - CV1: a batched element draws what a `w.div` with the same props draws, frame by frame, through a
//   change of `animate`.
// - CV2: `settled()` is `undefined` and not pending before anything moves, pending while members move,
//   then the landing, with how many set off; `next("settled")` resolves with it; an unmount stops it.
//
// Its misuse errors are the shared work's, and Solid 1's CB7 holds them: one thrown in a Solid 2 render
// halts that root's reactive system for the file's later tests.
import { DomLive } from "@wardic/dom"
import type { JSX } from "@solidjs/web"
import { createBatch, w, WardicProvider } from "@wardic/solid/unstable/v2"
import { createSignal, For, isPending } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const BOX: JSX.CSSProperties = { width: "40px", height: "40px", background: "teal" }
const SPRING = { type: "spring", stiffness: 210, damping: 20 } as const

const xOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41

/** `frames` frames of each element's `x`, read after each frame: one array per element. */
const xsOver = async (frames: number, elements: ReadonlyArray<Element>): Promise<ReadonlyArray<ReadonlyArray<number>>> => {
  const out = elements.map((): Array<number> => [])
  for (let f = 0; f < frames; f++) {
    await raf()
    elements.forEach((el, n) => out[n].push(xOf(el)))
  }
  return out
}

describe("createBatch on Solid 2 (#665)", () => {
  it("CV1: a batched element draws what a w.div with the same props draws, frame by frame", async () => {
    const [target, setTarget] = createSignal(100)
    let ward!: HTMLDivElement
    let member!: HTMLDivElement
    const Scene = (): JSX.Element => {
      const grid = createBatch({ count: 1, initial: { x: 0 }, animate: () => ({ x: target() }), transition: SPRING })
      return (
        <>
          <w.div ref={(el: HTMLDivElement) => (ward = el)} style={BOX} initial={{ x: 0 }} animate={{ x: target() }} transition={SPRING} />
          <div style={BOX} {...grid.at(0, { ref: (el) => (member = el as HTMLDivElement) })} />
        </>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    const there = await xsOver(60, [ward, member])
    expect(there[0].some((x) => x > 1 && x < 99)).toBe(true)
    there[1].forEach((x, f) => expect(x, `frame ${f}`).toBeCloseTo(there[0][f], 6))
    expect(there[1].at(-1)).toBe(100)
    setTarget(30)
    const back = await xsOver(60, [ward, member])
    back[1].forEach((x, f) => expect(x, `frame ${f}`).toBeCloseTo(back[0][f], 6))
    expect(back[1].at(-1)).toBe(30)
  })

  it("CV2: settled() is pending while members move, then their landing; next(\"settled\") resolves; unmount stops it", async () => {
    const [target, setTarget] = createSignal(0)
    const members: Array<HTMLDivElement> = []
    let grid!: ReturnType<typeof createBatch>
    const Scene = (): JSX.Element => {
      grid = createBatch({ count: 2, initial: false, animate: (i) => ({ x: target() + i * 10 }), transition: SPRING })
      return <For each={[0, 1]}>{(i) => <div style={BOX} {...grid.at(i, { ref: (el) => (members[i] = el as HTMLDivElement) })} />}</For>
    }
    const { unmount } = mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await raf()
    await raf()
    expect(grid.settled(), "nothing landed").toBeUndefined()
    expect(isPending(() => grid.settled()), "nor pending").toBe(false)
    const landing = grid.next("settled")
    setTarget(100)
    await raf()
    await raf()
    expect(isPending(() => grid.settled()), "moving").toBe(true)
    await expect(landing).resolves.toEqual({ moved: 2 })
    await raf()
    expect(isPending(() => grid.settled()), "landed").toBe(false)
    expect(grid.settled()).toEqual({ moved: 2 })
    expect(members.map(xOf)).toEqual([100, 110])
    setTarget(0)
    await raf()
    await raf()
    const at = members[0].style.transform
    unmount()
    await raf()
    await raf()
    expect(members[0].style.transform).toBe(at)
  })
})
