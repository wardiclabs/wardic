// `createAnimate`'s `animate` of a Batch, on Solid 1 (#665, ADR-0069 decisions 12 and 15): a call drives
// every member, or one, through the same Playback controls an element's call has, each held to the
// same call on plain elements under the same provider.
//
// - CBA1: `animate(grid, { x: (i) => … }, { delay: stagger() })` moves each member as the same call on a
//   plain element moves it, frame for frame; awaited, it resolves as they land.
// - CBA2: its controls act as a plain element's call's do: `pause` holds, `time` seeks, `play` goes on,
//   `speed` 2 runs it twice as fast, `complete` lands it, `cancel` puts it back; `state` follows each.
// - CBA3: a change of `createBatch`'s `animate` takes a member's key back: it goes there, and the call
//   never finishes (a ward's latest-wins).
// - CBA4: `animate(grid.at(i), …)` moves that member alone; two stops start each member from its first.
// - CBA5: a key the Batch doesn't have, and more than two stops, are errors naming them.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { createAnimate, createBatch, stagger, type WardicAnimate, type WardicBatch, WardicProvider } from "@wardic/solid"
import { createSignal, For, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"

afterEach(cleanup)

const BOX: JSX.CSSProperties = { width: "40px", height: "40px", background: "teal" }
const SPRING = { type: "spring", stiffness: 210, damping: 20 } as const

const matrixOf = (el: Element): DOMMatrix => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
const xOf = (el: Element): number => matrixOf(el).m41
const scaleOf = (el: Element): number => matrixOf(el).a
const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)

/** `frames` frames of `read` on each element: one array per element. */
const readsOver = async (frames: number, elements: ReadonlyArray<Element>, read: (el: Element) => number): Promise<ReadonlyArray<ReadonlyArray<number>>> => {
  const out = elements.map((): Array<number> => [])
  for (let f = 0; f < frames; f++) {
    await raf()
    elements.forEach((el, n) => out[n].push(read(el)))
  }
  return out
}

/** Each frame of `batched` within 1e-6 of `plain`'s. */
const expectSame = (batched: ReadonlyArray<number>, plain: ReadonlyArray<number>): void => {
  expect(batched.length).toBe(plain.length)
  batched.forEach((value, f) => expect(value, `frame ${f}`).toBeCloseTo(plain[f], 6))
}

/** `count` batched members and `count` plain elements under one provider and one scope; the Batch, `animate`, and the elements. */
const mountBoth = (count: number, animate: (i: number) => { readonly x?: number; readonly scale?: number; readonly opacity?: number } = () => ({ x: 0 })) => {
  let grid!: WardicBatch
  let call!: WardicAnimate
  const members: Array<HTMLDivElement> = []
  const plain: Array<HTMLDivElement> = []
  const indices = Array.from({ length: count }, (_, i) => i)
  const Scene = (): JSX.Element => {
    grid = createBatch({ count, initial: false, animate })
    const [scope, made] = createAnimate()
    call = made
    return (
      <div ref={scope}>
        <For each={indices}>{(i) => <div style={BOX} {...grid.at(i, { ref: (el) => (members[i] = el as HTMLDivElement) })} />}</For>
        <For each={indices}>{(i) => <div style={BOX} ref={(el) => (plain[i] = el)} />}</For>
      </div>
    )
  }
  render(() => (
    <WardicProvider env={DomLive}>
      <Scene />
    </WardicProvider>
  ))
  return { grid, animate: call, members, plain }
}

describe("animate of a Batch on Solid 1 (#665)", () => {
  it("CBA1: each member moves as the same call on a plain element moves it; awaited, it resolves as they land", async () => {
    const { grid, animate, members, plain } = mountBoth(3)
    await raf()
    const delay = stagger(0.05)
    let landed = false
    void animate(grid, { x: (i) => 40 + i * 30 }, { ...SPRING, delay }).then(() => {
      landed = true
    })
    plain.forEach((el, i) => animate(el, { x: 40 + i * 30 }, { ...SPRING, delay: delay(i, 3) }))
    const frames = await readsOver(70, [...members, ...plain], xOf)
    Array.from({ length: 3 }).forEach((_, i) => expectSame(frames[i], frames[i + 3]))
    expect(frames[2].at(-1)).toBe(100)
    expect(landed).toBe(true)
  })

  it("CBA2: its controls act as a plain element's call's: pause, time, play, speed, complete, cancel, state", async () => {
    const { grid, animate, members, plain } = mountBoth(1)
    await raf()
    const batched = animate(grid, { x: 120 }, SPRING)
    const own = animate(plain[0], { x: 120 }, SPRING)
    await readsOver(5, [members[0], plain[0]], xOf)
    batched.pause()
    own.pause()
    expect([batched.state, own.state]).toEqual(["paused", "paused"])
    const held = await readsOver(4, [members[0], plain[0]], xOf)
    expect(new Set(held[0]).size).toBe(1)
    expectSame(held[0], held[1])
    batched.time = 0.3
    own.time = 0.3
    await raf()
    expect(xOf(members[0])).toBeCloseTo(xOf(plain[0]), 6)
    batched.speed = 2
    own.speed = 2
    batched.play()
    own.play()
    expectSame(...((await readsOver(6, [members[0], plain[0]], xOf)) as [ReadonlyArray<number>, ReadonlyArray<number>]))
    batched.complete()
    own.complete()
    await raf()
    await raf()
    expect([xOf(members[0]), batched.state, own.state]).toEqual([120, "finished", "finished"])
    const again = animate(grid, { x: 0 }, SPRING)
    await readsOver(4, [members[0]], xOf)
    again.cancel()
    await raf()
    await raf()
    expect([xOf(members[0]), again.state]).toEqual([120, "idle"])
  })

  it("CBA3: a change of createBatch's animate takes a member's key back, and the call never finishes", async () => {
    const [target, setTarget] = createSignal(0)
    const { grid, animate, members } = mountBoth(1, () => ({ x: target() }))
    await raf()
    const call = animate(grid, { x: 200 }, SPRING)
    await readsOver(5, members, xOf)
    setTarget(-30)
    await readsOver(70, members, xOf)
    expect(xOf(members[0])).toBe(-30)
    expect(call.state).toBe("running")
  })

  it("CBA4: animate(grid.at(i)) moves that member alone; two stops start each from its first", async () => {
    const { grid, animate, members, plain } = mountBoth(3, () => ({ scale: 1, opacity: 1 }))
    await raf()
    void animate(grid.at(1), { scale: 1.5 }, SPRING)
    const scales = await readsOver(60, members, scaleOf)
    expect([scales[0].at(-1), scales[1].at(-1), scales[2].at(-1)]).toEqual([1, 1.5, 1])
    void animate(grid, { opacity: [0, 1] }, { duration: 0.3 })
    plain.forEach((el) => animate(el, { opacity: [0, 1] }, { duration: 0.3 }))
    const faded = await readsOver(24, [members[0], plain[0]], opacityOf)
    expectSame(faded[0], faded[1])
    expect(Math.min(...faded[0])).toBeLessThan(0.2)
  })

  it("CBA5: a key the Batch doesn't have, and more than two stops, are errors naming them", async () => {
    const { grid, animate } = mountBoth(1)
    await raf()
    expect(() => animate(grid, { y: 10 } as never)).toThrow(/"y"/)
    expect(() => animate(grid, { x: [0, 10, 20] } as never)).toThrow(/"x"/)
  })
})
