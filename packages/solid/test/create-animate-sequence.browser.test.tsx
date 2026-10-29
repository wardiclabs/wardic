// A sequence through `createAnimate()` on Solid 1 (#433's PR 2, Motion's sequences): Segments compiled
// by core's `Sequence` to each element's Keyframes, run on PR 1's Playback controls.
//
// - CS1: Segments one after another across two plain elements: the second waits for the first; it
//   resolves after both, its `duration` the whole sequence's.
// - CS2: `at`: `"<"` starts beside the Segment before, `"-0.2"` overlaps it, and a label's time.
// - CS3: a sequence seeks as one: `time` set holds each element where the sequence is then.
// - CS4: a function Segment's callback hears its value each frame, from 0 to 1 over its time; its
//   own stops, colours through the Interpolators; `cancel` tells it its first again.
// - CS5: a spring Segment runs as an easing over its time to rest, overshooting, and the next waits for it.
// - CS6: on a Wardic element a sequence takes its keys, as a call does: they stay at its end until
//   the element's own target for them changes.
// - CS7: the sequence's options: `duration` scales it, `repeat` replays it, `delay` holds it, and
//   `onComplete` comes at its end.
// - CS8: a selector's elements staggered by a `delay` function; a Segment's own `repeat`.
// - CS9: a value's own transition is laid over its Segment's (Motion's); `defaultTransition` is a
//   Segment's when it gives none, its `delay` the whole sequence's; a list's missing members are left out.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { createAnimate, wardic, type WardicAnimate, WardicProvider } from "@wardic/solid"
import { createSignal, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const BOX: JSX.CSSProperties = { width: "40px", height: "40px", background: "teal" }
const LINEAR = { duration: 0.4, ease: "linear" } as const

const matrixOf = (el: Element): DOMMatrix => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
const xOf = (el: Element): number => matrixOf(el).m41
const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

/** Mount `children` under a scope; its `animate`. */
const mountScope = (children: () => JSX.Element): WardicAnimate => {
  let animate!: WardicAnimate
  const Scene = (): JSX.Element => {
    const [scope, made] = createAnimate()
    animate = made
    return <div ref={scope}>{children()}</div>
  }
  render(() => (
    <WardicProvider env={DomLive}>
      <Scene />
    </WardicProvider>
  ))
  return animate
}

const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement

/** Two plain boxes, `a` and `b`. */
const twoBoxes = (): JSX.Element => (
  <>
    <div id="a" style={BOX} />
    <div id="b" style={BOX} />
  </>
)

describe("createAnimate's sequences on Solid 1 (#433)", () => {
  it("CS1: Segments one after another; it resolves after both, its duration the whole sequence's", async () => {
    const animate = mountScope(twoBoxes)
    await frames(2)
    const a = byId("a")
    const b = byId("b")
    const sequence = animate([
      [a, { x: 100 }, LINEAR],
      [b, { opacity: 0 }, LINEAR],
    ])
    expect(sequence.duration, "both Segments").toBeCloseTo(0.8, 1)
    await until(() => xOf(a) > 20)
    expect(xOf(a), "the first under way").toBeLessThan(95)
    expect(opacityOf(b), "the second waiting").toBe(1)
    await until(() => opacityOf(b) < 0.9)
    expect(xOf(a), "the first done").toBeCloseTo(100, 0)
    await sequence
    expect(sequence.state).toBe("finished")
    expect(opacityOf(b)).toBe(0)
    expect(xOf(a)).toBeCloseTo(100, 0)
  })

  it("CS2: at: < starts beside the Segment before, -0.2 overlaps it, and a label's time", async () => {
    const animate = mountScope(() => (
      <>
        <div id="a" style={BOX} />
        <div id="b" style={BOX} />
        <div id="c" style={BOX} />
        <div id="d" style={BOX} />
      </>
    ))
    await frames(2)
    const [a, b, c, d] = ["a", "b", "c", "d"].map(byId) as [HTMLElement, HTMLElement, HTMLElement, HTMLElement]
    const sequence = animate([
      [a, { x: 100 }, LINEAR],
      "start",
      [b, { x: 100 }, { ...LINEAR, at: "<" }],
      [c, { x: 100 }, { ...LINEAR, at: "-0.2" }],
      [d, { x: 100 }, { ...LINEAR, at: "start" }],
    ])
    // a and b 0–0.4, c 0.2–0.6, d 0.4–0.8.
    expect(sequence.duration).toBeCloseTo(0.8, 1)
    sequence.pause()
    sequence.time = 0.3
    await frames(2)
    expect(xOf(a)).toBeCloseTo(75, 0)
    expect(xOf(b), "beside a").toBeCloseTo(75, 0)
    expect(xOf(c), "overlapping a").toBeCloseTo(25, 0)
    expect(xOf(d), "waiting for its label").toBeCloseTo(0, 3)
    sequence.time = 0.6
    await frames(2)
    expect(xOf(c)).toBeCloseTo(100, 0)
    expect(xOf(d)).toBeCloseTo(50, 0)
  })

  it("CS3: a sequence seeks as one", async () => {
    const animate = mountScope(twoBoxes)
    await frames(2)
    const a = byId("a")
    const b = byId("b")
    const sequence = animate([
      [a, { x: 100 }, LINEAR],
      [b, { opacity: 0 }, LINEAR],
    ])
    sequence.pause()
    sequence.time = 0.6
    await frames(2)
    expect(xOf(a), "the first done").toBeCloseTo(100, 0)
    expect(opacityOf(b), "the second halfway").toBeCloseTo(0.5, 2)
    expect(sequence.state).toBe("paused")
    sequence.time = 0.2
    await frames(2)
    expect(xOf(a), "back in the first").toBeCloseTo(50, 0)
    expect(opacityOf(b), "the second not begun").toBeCloseTo(1, 3)
    sequence.play()
    await sequence
    expect(xOf(a)).toBeCloseTo(100, 0)
    expect(opacityOf(b)).toBe(0)
  })

  it("CS4: a function Segment's callback hears its value each frame; its own stops; cancel tells it its first", async () => {
    const animate = mountScope(twoBoxes)
    await frames(2)
    const a = byId("a")
    const heard: Array<number> = []
    const colours: Array<string> = []
    const sequence = animate([
      [a, { x: 100 }, LINEAR],
      [(value: number) => heard.push(value), LINEAR],
      [(value: string) => colours.push(value), ["rgb(255, 0, 0)", "rgb(0, 0, 255)"], { ...LINEAR, at: "<" }],
    ])
    sequence.pause()
    sequence.time = 0.2
    await frames(2)
    expect(heard.at(-1), "0 until its Segment").toBe(0)
    sequence.time = 0.6
    await frames(2)
    expect(heard.at(-1), "halfway through its Segment").toBeCloseTo(0.5, 3)
    expect(colours.at(-1), "a colour halfway").toMatch(/^rgba?\(/)
    expect(colours.at(-1)).not.toBe("rgb(255, 0, 0)")
    expect(colours.at(-1)).not.toBe("rgb(0, 0, 255)")
    sequence.play()
    await sequence
    expect(heard.at(-1), "its end").toBe(1)
    expect(colours.at(-1)).toBe("rgb(0, 0, 255)")
    // Its callback told only by the sequence's own frames: none after the end.
    const told = heard.length
    await frames(4)
    expect(heard.length).toBe(told)

    const back: Array<number> = []
    const cancelled = animate([[(value: number) => back.push(value), [10, 20], { duration: 1 }]])
    await until(() => back.length > 2)
    cancelled.cancel()
    expect(back.at(-1), "its first stop again").toBe(10)
  })

  it("CS5: a spring Segment runs as an easing over its time to rest, overshooting, and the next waits for it", async () => {
    const animate = mountScope(twoBoxes)
    await frames(2)
    const a = byId("a")
    const b = byId("b")
    const sequence = animate([
      [a, { x: 100 }, { type: "spring", stiffness: 300, damping: 10 }],
      [b, { x: 100 }, LINEAR],
    ])
    const spring = sequence.duration - 0.4
    expect(spring, "its time to rest").toBeGreaterThan(0.5)
    let most = 0
    while (sequence.time < spring - 0.05) {
      most = Math.max(most, xOf(a))
      expect(xOf(b), "b waits for the spring").toBeCloseTo(0, 3)
      await raf()
    }
    expect(most, "it overshoots").toBeGreaterThan(110)
    await sequence
    expect(xOf(a)).toBeCloseTo(100, 0)
    expect(xOf(b)).toBeCloseTo(100, 0)
  })

  it("CS6: on a Wardic element a sequence takes its keys until the element's own target for them changes", async () => {
    const [x, setX] = createSignal(0)
    const [opacity, setOpacity] = createSignal(1)
    const animate = mountScope(() => <wardic.div id="w" animate={{ x: x(), opacity: opacity() }} transition={{ duration: 0.1 }} style={BOX} />)
    await frames(4)
    const w = byId("w")
    await animate([
      [w, { x: 100 }, { duration: 0.2 }],
      [w, { x: 150 }, { duration: 0.2 }],
    ])
    expect(xOf(w)).toBeCloseTo(150, 0)
    setOpacity(0.5)
    await until(() => opacityOf(w) < 0.51)
    await frames(3)
    expect(xOf(w), "x stays where the sequence left it").toBeCloseTo(150, 0)
    setX(40)
    await until(() => Math.abs(xOf(w) - 40) < 0.5)
    expect(xOf(w), "its own target taken back").toBeCloseTo(40, 0)
  })

  it("CS7: the sequence's options: duration scales it, repeat replays it, delay holds it, onComplete at its end", async () => {
    const animate = mountScope(twoBoxes)
    await frames(2)
    const a = byId("a")
    const b = byId("b")
    let completed = 0
    const sequence = animate(
      [
        [a, { x: 100 }, LINEAR],
        [b, { x: 100 }, LINEAR],
      ],
      { duration: 0.4, delay: 0.2, repeat: 1, onComplete: () => completed++ },
    )
    // Twice through 0.4 s, after 0.2 s.
    expect(sequence.duration).toBeCloseTo(1, 1)
    sequence.pause()
    sequence.time = 0.1
    await frames(2)
    expect(xOf(a), "held through its delay").toBeCloseTo(0, 3)
    sequence.time = 0.3
    await frames(2)
    expect(xOf(a), "a in half the time").toBeCloseTo(50, 0)
    sequence.time = 0.5
    await frames(2)
    expect(xOf(a)).toBeCloseTo(100, 0)
    expect(xOf(b), "b in the second half").toBeCloseTo(50, 0)
    sequence.time = 0.7
    await frames(2)
    expect(xOf(a), "again, from its start").toBeCloseTo(50, 0)
    expect(completed).toBe(0)
    sequence.play()
    await sequence
    expect(completed).toBe(1)
    expect(xOf(b)).toBeCloseTo(100, 0)
  })

  it("CS8: a selector's elements staggered by a delay function; a Segment's own repeat", async () => {
    const animate = mountScope(() => (
      <ul>
        <li class="item" id="i0" style={BOX} />
        <li class="item" id="i1" style={BOX} />
        <div id="a" style={BOX} />
      </ul>
    ))
    await frames(2)
    const sequence = animate([
      [".item", { opacity: 0 }, { ...LINEAR, delay: (index: number) => index * 0.2 }],
      [byId("a"), { x: [0, 100] }, { ...LINEAR, repeat: 1, at: 0 }],
    ])
    // The items 0–0.4 and 0.2–0.6; a twice over 0–0.8.
    expect(sequence.duration).toBeCloseTo(0.8, 1)
    sequence.pause()
    sequence.time = 0.3
    await frames(2)
    expect(opacityOf(byId("i0"))).toBeCloseTo(0.25, 2)
    expect(opacityOf(byId("i1")), "the second later").toBeCloseTo(0.75, 2)
    expect(xOf(byId("a"))).toBeCloseTo(75, 0)
    sequence.time = 0.5
    await frames(2)
    expect(xOf(byId("a")), "a again, from 0").toBeCloseTo(25, 0)
  })

  it("CS9: a value's own transition over its Segment's; defaultTransition, its delay the sequence's; missing members left out", async () => {
    const animate = mountScope(twoBoxes)
    await frames(2)
    const a = byId("a")
    const b = byId("b")
    const own = animate([[a, { x: 100, opacity: 0 }, { ease: "linear", duration: 0.4, opacity: { duration: 0.8 } }]])
    own.pause()
    own.time = 0.4
    await frames(2)
    expect(xOf(a)).toBeCloseTo(100, 0)
    expect(opacityOf(a), "linear, from the Segment's own").toBeCloseTo(0.5, 2)
    own.play()
    await own
    const defaults = animate([[a, { x: 0 }], [b, { x: 100 }]], { defaultTransition: { duration: 0.2, ease: "linear", delay: 0.2 } })
    defaults.pause()
    defaults.time = 0.1
    await frames(2)
    expect(xOf(a), "the whole sequence held").toBeCloseTo(100, 0)
    defaults.time = 0.3
    await frames(2)
    expect(xOf(a), "a in its 0.2 s").toBeCloseTo(50, 0)
    expect(xOf(b), "b after it").toBeCloseTo(0, 3)
    defaults.time = 0.5
    await frames(2)
    expect(xOf(b)).toBeCloseTo(50, 0)
    defaults.play()
    await defaults
    await animate([[[b, null as unknown as Element], { opacity: 0.5 }, { duration: 0.1 }]])
    expect(opacityOf(b)).toBeCloseTo(0.5, 2)
  })
})
