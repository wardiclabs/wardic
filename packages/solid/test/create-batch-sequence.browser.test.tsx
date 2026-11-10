// A Batch as a sequence's Segment, on Solid 1 (#665, Q36–Q40): `animate([[grid, …], …])` moves each
// member through its own keyframes in the Batch, held to the same sequence on plain elements under the
// same provider, frame for frame.
//
// - CBS1: a sequence of Batch Segments, a value and stops for every member and a function of each
//   member's index, staggered and placed with `at`, then an element's Segment after them, moves each
//   member as the same sequence moves plain elements in their place; awaited, it resolves as they land.
// - CBS2: its controls act as the plain sequence's: `pause` holds, `time` seeks, `play` goes on, `speed`
//   2 runs it twice as fast, through the sequence's `repeat` turning back; `duration`, `complete`,
//   `cancel` and `state` too.
// - CBS3: a Segment of members' elements moves their Batch keys in the Batch and the rest as a plain
//   element's; a member named through the Batch and through its element is one subject (Q40).
// - CBS4: in a Segment of a Batch, a string, a key it doesn't have and a function that gives a string;
//   through members' elements, a transform the Batch doesn't draw, `transform` and a string for its key:
//   errors naming the key. A key it doesn't have, through an element, isn't one (Q33, Q40).
// - CBS5: a Segment's function hears the member's index and the Batch's count, through the Batch and
//   through a member's handle; a Segment moves, and its `stagger()` counts, only the members whose
//   elements have arrived (Q38, Q39).
// - CBS6: under reduced motion, and with `skipAnimations`, each member's keys land where their stops
//   end, as plain elements' do, a key the sequence's last Segment doesn't name included.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { createAnimate, createBatch, stagger, type WardicAnimate, type WardicBatch, WardicConfig, WardicProvider } from "@wardic/solid"
import { For, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"

afterEach(cleanup)

const BOX: JSX.CSSProperties = { width: "40px", height: "40px", background: "teal" }

const matrixOf = (el: Element): DOMMatrix => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
const xOf = (el: Element): number => matrixOf(el).m41
const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)
const redOf = (el: Element): number => Number(/\d+(\.\d+)?/.exec(getComputedStyle(el).backgroundColor)?.[0])

/** `frames` frames of each of `reads`: one array per read. */
const readsOver = async (frames: number, reads: ReadonlyArray<() => number>): Promise<ReadonlyArray<ReadonlyArray<number>>> => {
  const out = reads.map((): Array<number> => [])
  for (let f = 0; f < frames; f++) {
    await raf()
    reads.forEach((read, n) => out[n].push(read()))
  }
  return out
}

/** Each element's `read`, as a read of its own. */
const each = (elements: ReadonlyArray<Element>, read: (el: Element) => number): ReadonlyArray<() => number> => elements.map((el) => () => read(el))

/** Each frame of `batched` within 1e-6 of `plain`'s. */
const expectSame = (batched: ReadonlyArray<number>, plain: ReadonlyArray<number>): void => {
  expect(batched.length).toBe(plain.length)
  batched.forEach((value, f) => expect(value, `frame ${f}`).toBeCloseTo(plain[f], 6))
}

/** How `mountBoth` mounts: how many members' elements it renders, the provider's reduced motion, and `skipAnimations`. */
interface Mounting {
  readonly rendered?: number
  readonly reducedMotion?: "always" | "never"
  readonly skipAnimations?: boolean
}

/**
 * `count` members of a Batch on `x` and `opacity`, at 0 and 1, the first `rendered` of them with an
 * element, and as many plain elements, each with a title of its own, under one provider and one scope.
 */
const mountBoth = (count: number, mounting: Mounting = {}) => {
  const { rendered = count, reducedMotion = "never", skipAnimations = false } = mounting
  let grid!: WardicBatch
  let call!: WardicAnimate
  const members: Array<HTMLDivElement> = []
  const plain: Array<HTMLDivElement> = []
  const titles: Array<HTMLDivElement> = []
  const indices = Array.from({ length: rendered }, (_, i) => i)
  const Scene = (): JSX.Element => {
    grid = createBatch({ count, initial: false, animate: () => ({ x: 0, opacity: 1 }) })
    const [scope, made] = createAnimate()
    call = made
    return (
      <div ref={scope}>
        <For each={indices}>{(i) => <div class="member" style={BOX} {...grid.at(i, { ref: (el) => (members[i] = el as HTMLDivElement) })} />}</For>
        <For each={indices}>{(i) => <div class="plain" style={BOX} ref={(el) => (plain[i] = el)} />}</For>
        <div style={BOX} ref={(el) => (titles[0] = el)} />
        <div style={BOX} ref={(el) => (titles[1] = el)} />
      </div>
    )
  }
  render(() => (
    <WardicProvider env={DomLive} reducedMotion={reducedMotion}>
      <WardicConfig skipAnimations={skipAnimations}>
        <Scene />
      </WardicConfig>
    </WardicProvider>
  ))
  return { grid, animate: call, members, plain, titles }
}

describe("a Batch as a sequence's Segment on Solid 1 (#665)", () => {
  it("CBS1: Batch Segments of values, stops and a function move each member as the same sequence moves plain elements", async () => {
    const { grid, animate, members, plain, titles } = mountBoth(3)
    await raf()
    const delay = stagger(0.05)
    const fanned = (i: number): number => 20 + i * 30
    let landed = false
    void animate([
      [grid, { x: [0, 100], opacity: 0.5 }, { duration: 0.3 }],
      [grid, { x: (i) => fanned(i) }, { delay, at: "-0.1", ease: "easeInOut" }],
      [titles[0], { opacity: 0.2 }],
    ]).then(() => {
      landed = true
    })
    // The same, element by element: each at the Batch Segment's start, by its own delay; the last, the longest, ending it.
    animate([
      [plain, { x: [0, 100], opacity: 0.5 }, { duration: 0.3 }],
      ...plain.map((el, i) => [el, { x: fanned(i) }, { delay: delay(i, 3), at: 0.2, ease: "easeInOut" }] as const),
      [titles[1], { opacity: 0.2 }],
    ])
    const frames = await readsOver(60, [...each([...members, ...plain], xOf), ...each([...members, ...plain, ...titles], opacityOf)])
    // x, then opacity: the members' against the plain elements', and the two titles'.
    Array.from({ length: 3 }).forEach((_, i) => expectSame(frames[i], frames[i + 3]))
    Array.from({ length: 3 }).forEach((_, i) => expectSame(frames[6 + i], frames[9 + i]))
    expectSame(frames[12], frames[13])
    expect([frames[2].at(-1), frames[8].at(-1), frames[12].at(-1)]).toEqual([80, 0.5, 0.2])
    expect(landed).toBe(true)
  })

  it("CBS2: its controls act as the plain sequence's: pause, time, play, speed, repeat, duration, complete, cancel, state", async () => {
    const { grid, animate, members, plain } = mountBoth(2)
    await raf()
    const steps = (subject: typeof grid | ReadonlyArray<HTMLDivElement>) =>
      [
        [subject, { x: [0, 60, 30] }, { duration: 0.4, ease: ["easeIn", "easeOut"] }],
        [subject, { opacity: 0.3 }, { at: "<", duration: 0.2 }],
      ] as const
    const options = { repeat: 1, repeatType: "reverse", repeatDelay: 0.05 } as const
    const batched = animate(steps(grid), options)
    const own = animate(steps(plain), options)
    expect(batched.duration).toBeCloseTo(own.duration, 9)
    const reads = [...each([members[0], plain[0]], xOf), ...each([members[1], plain[1]], opacityOf)]
    const pairs = (frames: ReadonlyArray<ReadonlyArray<number>>): void => {
      expectSame(frames[0], frames[1])
      expectSame(frames[2], frames[3])
    }
    pairs(await readsOver(6, reads))
    batched.pause()
    own.pause()
    expect([batched.state, own.state]).toEqual(["paused", "paused"])
    const held = await readsOver(4, reads)
    expect(new Set(held[0]).size).toBe(1)
    pairs(held)
    // A seek into the repeat, turned back, then twice as fast to its end.
    batched.time = 0.55
    own.time = 0.55
    await raf()
    expect(xOf(members[0])).toBeCloseTo(xOf(plain[0]), 6)
    batched.speed = 2
    own.speed = 2
    batched.play()
    own.play()
    pairs(await readsOver(12, reads))
    expect([batched.state, own.state]).toEqual(["finished", "finished"])
    // Turned back by its repeat: at its first stop, within the ease's rounding, as the plain element is.
    expect(xOf(members[0])).toBeCloseTo(0, 6)
    // complete lands it at its end; cancel puts it back where it started.
    const completed = animate(steps(grid))
    animate(steps(plain)).complete()
    completed.complete()
    await raf()
    await raf()
    expect([xOf(members[0]), opacityOf(members[1]), completed.state]).toEqual([30, 0.3, "finished"])
    expect(xOf(plain[0])).toBe(30)
    const cancelled = animate([[grid, { x: 200 }, { duration: 0.5 }]])
    await readsOver(4, [() => xOf(members[0])])
    cancelled.cancel()
    await raf()
    await raf()
    expect([xOf(members[0]), cancelled.state]).toEqual([30, "idle"])
  })

  it("CBS3: members' elements move their Batch keys in the Batch and the rest as a plain element's; one member, one subject", async () => {
    const { grid, animate, members, plain } = mountBoth(2)
    await raf()
    const tomato = "rgb(255, 99, 71)"
    void animate([
      [".member", { x: 50, "background-color": tomato }, { duration: 0.3 }],
      [grid, { x: 100 }, { duration: 0.3 }],
      [members[0], { x: -20 }, { at: "<", duration: 0.2 }],
    ])
    animate([
      [".plain", { x: 50, "background-color": tomato }, { duration: 0.3 }],
      [plain, { x: 100 }, { duration: 0.3 }],
      [plain[0], { x: -20 }, { at: "<", duration: 0.2 }],
    ])
    const frames = await readsOver(45, [...each([...members, ...plain], xOf), ...each([...members, ...plain], redOf)])
    expectSame(frames[0], frames[2])
    expectSame(frames[1], frames[3])
    expectSame(frames[4], frames[6])
    expectSame(frames[5], frames[7])
    expect([frames[0].at(-1), frames[1].at(-1), frames[4].at(-1)]).toEqual([100, 100, 255])
  })

  it("CBS4: a string, a key the Batch doesn't have, an undrawn transform: errors naming the key", async () => {
    const { grid, animate, members } = mountBoth(2)
    await raf()
    expect(() => animate([[grid, { x: "2rem" as never }]])).toThrow(/"x" as "2rem": a Batch's key takes a number/)
    expect(() => animate([[grid, { rotate: 10 }]])).toThrow(/"rotate", which isn't one of its keys \(x, opacity\)/)
    expect(() => animate([[grid, { x: (i) => [0, "1em"][i] as never }]])).toThrow(/member 1's "x" as "1em"/)
    expect(() => animate([[".member", { x: "2rem" }]])).toThrow(/"x" as "2rem": a Batch's key takes a number/)
    expect(() => animate([[members[0], { rotate: 10 }]])).toThrow(/"rotate", a transform the Batch draws without it/)
    expect(() => animate([[members[0], { transform: "none" }]])).toThrow(/"transform": the Batch draws its whole transform/)
    expect(() => animate([[members[0], { "background-color": "red" }, { duration: 0.01 }]])).not.toThrow()
  })

  it("CBS5: a function hears the member's index and the Batch's count; only arrived members move, and count", async () => {
    // Three members, two of them rendered.
    const { grid, animate, members, plain } = mountBoth(3, { rendered: 2 })
    await raf()
    const delay = stagger(0.1, { from: "last" })
    const heard: Array<string> = []
    void animate([
      [grid, { x: (i, n) => { heard.push(`${i}/${n}`); return 10 * i + n } }, { duration: 0.2, delay }],
    ])
    // The same, element by element: two members, so the last waits 0, the first 0.1.
    animate([
      [plain[0], { x: 3 }, { duration: 0.2, delay: delay(0, 2) }],
      [plain[1], { x: 13 }, { duration: 0.2, delay: delay(1, 2), at: 0 }],
    ])
    expect(heard).toEqual(["0/3", "1/3"])
    const frames = await readsOver(25, each([...members, ...plain], xOf))
    expectSame(frames[0], frames[2])
    expectSame(frames[1], frames[3])
    // A member's handle: its own index, not its place in the Segment.
    await animate([[grid.at(1), { x: (i, n) => 100 + 10 * i + n }, { duration: 0.1 }]])
    expect(xOf(members[1])).toBe(113)
  })

  it("CBS6: under reduced motion and skipAnimations, members' keys land where their stops end, as plain elements' do", async () => {
    const sequence = (subject: WardicBatch | ReadonlyArray<HTMLDivElement>, title: HTMLDivElement) =>
      [
        [subject, { x: [0, 80], opacity: 0.5 }, { duration: 0.2 }],
        [title, { opacity: 0.2 }, { duration: 0.2 }],
      ] as const
    for (const mounting of [{ reducedMotion: "always" }, { skipAnimations: true }] as const) {
      const { grid, animate, members, plain, titles } = mountBoth(2, mounting)
      await raf()
      animate(sequence(grid, titles[0]), { delay: 0.1 })
      animate(sequence(plain, titles[1]), { delay: 0.1 })
      const frames = await readsOver(40, [...each([...members, ...plain], xOf), ...each([...members, ...plain], opacityOf)])
      Array.from({ length: 2 }).forEach((_, i) => expectSame(frames[i], frames[i + 2]))
      Array.from({ length: 2 }).forEach((_, i) => expectSame(frames[4 + i], frames[6 + i]))
      expect([frames[0].at(-1), frames[4].at(-1)]).toEqual([80, 0.5])
      cleanup()
    }
  })
})
