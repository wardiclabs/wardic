// `createBatch` on Solid 2 (#665, ADR-0070 decisions 10–15 and *Amendment (#665)*): Solid 1's, its
// landings an async value. Its shared work is Solid 1's tests' (`../create-batch.browser.test.tsx`).
//
// - CV1: a batched element draws what a `w.div` with the same props draws, frame by frame, through a
//   change of `animate`.
// - CV2: `settled()` is `undefined` and not pending before anything moves, pending while members move,
//   then the landing, with how many set off; `next("settled")` resolves with it; an unmount stops it.
// - CV3: `when("settled")` tells an effect every landing.
// - CV4: `createAnimate`'s `animate(grid, …)` moves its members on Solid 2 too, each as the same call on a
//   plain element under the same provider moves it, frame for frame: its controls are awaited, and
//   `scope.settled()` is pending while it plays.
// - CV5: `animate(memberEl, …)` moves its Batch keys as `animate(grid.at(i), …)` does, the rest as a
//   plain element's call, paused and sought as one; the Batch holds what it moved, so its next change
//   goes on from there (Q14).
//   The element's own `style`, given before the handle's spread, stays: the handle gives none.
// - CV6: a list of members goes as one Batch call, its stagger counting the members that move, not one
//   already there (Q35).
// - CV7: through an element, a transform the Batch doesn't draw (or `transform` itself), and three stops
//   for its key, are errors naming the key (Q33, Q34).
//
// Its misuse errors are the shared work's, and Solid 1's CB7 holds them: one thrown in a Solid 2 render
// halts that root's reactive system for the file's later tests.
import { DomLive } from "@wardic/dom"
import type { JSX } from "@solidjs/web"
import { createAnimate, createBatch, stagger, w, type WardicAnimate, type WardicAnimationScope, WardicProvider } from "@wardic/solid/unstable/v2"
import { createEffect, createSignal, For, isPending } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const BOX: JSX.CSSProperties = { width: "40px", height: "40px", background: "teal" }
const SPRING = { type: "spring", stiffness: 210, damping: 20 } as const
const TWEEN = { duration: 0.4 } as const

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

/** Each frame of `a` within 1e-6 of `b`'s. */
const expectSame = (a: ReadonlyArray<number>, b: ReadonlyArray<number>): void => {
  expect(a.length).toBe(b.length)
  a.forEach((x, f) => expect(x, `frame ${f}`).toBeCloseTo(b[f], 6))
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
    expectSame(there[1], there[0])
    expect(there[1].at(-1)).toBe(100)
    setTarget(30)
    const back = await xsOver(60, [ward, member])
    expectSame(back[1], back[0])
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

  it("CV3: when(\"settled\") tells an effect every landing", async () => {
    const [target, setTarget] = createSignal(0)
    const heard: Array<number> = []
    const Scene = (): JSX.Element => {
      const grid = createBatch({ count: 2, initial: false, animate: (i) => ({ x: target() + i }), transition: SPRING })
      createEffect(grid.when("settled"), (landing) => {
        heard.push(landing.moved)
      })
      return <For each={[0, 1]}>{(i) => <div style={BOX} {...grid.at(i)} />}</For>
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await raf()
    setTarget(40)
    for (let f = 0; f < 70; f++) await raf()
    setTarget(0)
    for (let f = 0; f < 70; f++) await raf()
    expect(heard).toEqual([2, 2])
  })

  it("CV4: animate(grid, …) moves each member as the same call on a plain element: awaited, scope.settled() pending meanwhile", async () => {
    const members: Array<HTMLDivElement> = []
    const plain: Array<HTMLDivElement> = []
    let grid!: ReturnType<typeof createBatch>
    let scope!: WardicAnimationScope
    let animate!: WardicAnimate
    const Scene = (): JSX.Element => {
      grid = createBatch({ count: 2, initial: false, animate: () => ({ x: 0 }) })
      ;[scope, animate] = createAnimate()
      return (
        <div ref={scope}>
          <For each={[0, 1]}>{(i) => <div style={BOX} {...grid.at(i, { ref: (el) => (members[i] = el as HTMLDivElement) })} />}</For>
          <For each={[0, 1]}>{(i) => <div style={BOX} ref={(el: HTMLDivElement) => (plain[i] = el)} />}</For>
        </div>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await raf()
    // Its first read is never pending (a ward's settled() isn't either): read before the call, as CV1 of createAnimate's does.
    expect(scope.settled()).toBeUndefined()
    const controls = animate(grid, { x: (i) => 50 + i * 10 }, SPRING)
    plain.forEach((el, i) => animate(el, { x: 50 + i * 10 }, SPRING))
    const frames = await xsOver(2, [...members, ...plain])
    expect(isPending(() => scope.settled()), "playing").toBe(true)
    const rest = await xsOver(60, [...members, ...plain])
    ;[0, 1].forEach((i) => expectSame([...frames[i], ...rest[i]], [...frames[i + 2], ...rest[i + 2]]))
    await controls
    expect(members.map(xOf)).toEqual([50, 60])
    await raf()
    expect(isPending(() => scope.settled()), "landed").toBe(false)
  })

  /** `count` batched members at `x()` and `count` plain elements under one provider and one scope; the Batch, `animate`, and the elements. */
  const mountBoth = (count: number, x: () => number = () => 0) => {
    const members: Array<HTMLDivElement> = []
    const plain: Array<HTMLDivElement> = []
    let grid!: ReturnType<typeof createBatch>
    let animate!: WardicAnimate
    const indices = Array.from({ length: count }, (_, i) => i)
    const Scene = (): JSX.Element => {
      grid = createBatch({ count, initial: false, animate: () => ({ x: x() }) })
      const [scope, made] = createAnimate()
      animate = made
      return (
        <div ref={scope}>
          <For each={indices}>{(i) => <div style={BOX} {...grid.at(i, { ref: (el) => (members[i] = el as HTMLDivElement) })} />}</For>
          <For each={indices}>{(i) => <div style={BOX} ref={(el: HTMLDivElement) => (plain[i] = el)} />}</For>
        </div>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    return { grid: () => grid, animate: () => animate, members, plain }
  }

  it("CV5: animate(memberEl) moves its Batch keys as animate(grid.at(i)), the rest as a plain element's call; the Batch goes on from there", async () => {
    const [target, setTarget] = createSignal(0)
    // eslint-disable-next-line solid/reactivity -- read in createBatch's animate, which tracks it
    const both = mountBoth(2, target)
    await raf()
    const animate = both.animate()
    const tomato = "rgb(255, 99, 71)"
    const split = animate(both.members[0], { x: 60, "background-color": tomato }, TWEEN)
    const batched = animate(both.grid().at(1), { x: 60 }, TWEEN)
    const own = animate(both.plain[0], { "background-color": tomato }, TWEEN)
    const xs = await xsOver(6, [both.members[0], both.members[1]])
    expectSame(xs[0], xs[1])
    expect(getComputedStyle(both.members[0]).backgroundColor).toBe(getComputedStyle(both.plain[0]).backgroundColor)
    // Paused and sought as one.
    ;[split, batched, own].forEach((controls) => {
      controls.pause()
      controls.time = 0.2
    })
    await raf()
    expect(xOf(both.members[0])).toBeCloseTo(xOf(both.members[1]), 6)
    expect(getComputedStyle(both.members[0]).backgroundColor).toBe(getComputedStyle(both.plain[0]).backgroundColor)
    ;[split, batched, own].forEach((controls) => controls.play())
    await split
    setTarget(100)
    const on = await xsOver(50, [both.members[0], both.members[1]])
    expectSame(on[0], on[1])
    expect(on[0][0]).toBeGreaterThan(59)
  })

  it("CV6: a list of members goes as one Batch call, its stagger counting the movers; a plain element keeps its index's", async () => {
    const both = mountBoth(3)
    await raf()
    const animate = both.animate()
    await animate(both.grid().at(2), { x: 80 }, { duration: 0 })
    const delay = stagger(0.05)
    // Members 0 and 1 move, ranks 0 and 1 of 2: member 2 is at 80 already.
    void animate([both.members[0], both.members[2], both.plain[0], both.members[1]], { x: 80 }, { ...SPRING, delay })
    ;[1, 2].forEach((p, rank) => animate(both.plain[p], { x: 80 }, { ...SPRING, delay: delay(rank, 2) }))
    const frames = await xsOver(40, [both.members[0], both.members[1], both.plain[1], both.plain[2]])
    expectSame(frames[0], frames[2])
    expectSame(frames[1], frames[3])
  })

  it("CV7: through an element, a transform the Batch doesn't draw, and three stops for its key, are errors naming the key", async () => {
    const both = mountBoth(1)
    await raf()
    const animate = both.animate()
    expect(() => animate(both.members[0], { rotate: 10 })).toThrow(/"rotate"/)
    expect(() => animate(both.members[0], { transform: "rotate(10deg)" })).toThrow(/"transform"/)
    expect(() => animate(both.members[0], { x: [0, 10, 20] })).toThrow(/"x"/)
  })
})
