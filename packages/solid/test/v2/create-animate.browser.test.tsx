// `createAnimate()` on Solid 2 (#433, Motion's `useAnimate`): the Solid 1 binding's, its scope with
// `settled()` (#433's Q8).
//
// - CV1: `scope.settled()` is `undefined` before a landing and not pending; pending while an animation
//   is in flight; the last to land once none is (in an object: the controls are awaitable, which an
//   async value would wait on); one stopped ends its flight without landing.
// - CV2: a selector inside the scope animates plain elements; on a ward's element the call takes its
//   keys until the ward's own target for them changes.
// - CV3: the scope's owner's cleanup stops its animations where they are.
// - CV4: a sequence (#433's PR 2): its Segments in order, a function Segment's callback told each
//   frame, `scope.settled()` pending until it lands, then holding it.
import { DomLive } from "@wardic/dom"
import type { JSX } from "@solidjs/web"
import { createAnimate, ward, type WardicAnimate, type WardicAnimationScopeV2, WardicProvider } from "@wardic/solid/unstable/v2"
import { createSignal, isPending, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const BOX: JSX.CSSProperties = { width: "40px", height: "40px", background: "teal" }

const xOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41
const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}
const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement

/** Mount `children` under a scope: its scope and its `animate`. */
const mountScope = (children: () => JSX.Element): { readonly scope: WardicAnimationScopeV2; readonly animate: WardicAnimate } => {
  let scope!: WardicAnimationScopeV2
  let animate!: WardicAnimate
  const Scene = (): JSX.Element => {
    ;[scope, animate] = createAnimate()
    return <div ref={scope}>{children()}</div>
  }
  mount(() => (
    <WardicProvider env={DomLive}>
      <Scene />
    </WardicProvider>
  ))
  return { scope, animate }
}

describe("createAnimate on Solid 2 (#433)", () => {
  it("CV1: scope.settled() is pending while one is in flight, and the last to land after", async () => {
    const { scope, animate } = mountScope(() => (
      <>
        <div id="p" style={BOX} />
        <div id="q" style={BOX} />
      </>
    ))
    await frames(2)
    expect(scope.settled(), "nothing landed").toBeUndefined()
    expect(isPending(() => scope.settled()), "nor pending").toBe(false)
    const first = animate(byId("p"), { x: 60 }, { duration: 0.3 })
    await frames(3)
    expect(isPending(() => scope.settled()), "in flight").toBe(true)
    await first
    await frames(2)
    expect(isPending(() => scope.settled())).toBe(false)
    expect(scope.settled()?.animation, "the last to land").toBe(first)
    const stopped = animate(byId("q"), { x: 60 }, { duration: 2 })
    await frames(3)
    expect(isPending(() => scope.settled())).toBe(true)
    stopped.stop()
    await frames(2)
    expect(isPending(() => scope.settled()), "a stop ends its flight").toBe(false)
    expect(scope.settled()?.animation, "without landing").toBe(first)
  })

  it("CV2: a selector animates the scope's plain elements; a ward's keys are the call's until its own target changes", async () => {
    const [x, setX] = createSignal(0)
    const [opacity, setOpacity] = createSignal(1)
    const Card = (): JSX.Element => {
      const card = ward({ animate: () => ({ x: x(), opacity: opacity() }), transition: { duration: 0.1 }, style: BOX })
      return <div id="w" {...card} ref={card} />
    }
    const { animate } = mountScope(() => (
      <>
        <li class="i" id="a" />
        <li class="i" id="b" />
        <Card />
      </>
    ))
    await frames(4)
    await animate(".i", { opacity: 0.25 }, { duration: 0.1 })
    expect(opacityOf(byId("a"))).toBeCloseTo(0.25, 2)
    expect(opacityOf(byId("b"))).toBeCloseTo(0.25, 2)
    const w = byId("w")
    await animate(w, { x: 100 }, { duration: 0.1 })
    setOpacity(0.5)
    await until(() => opacityOf(w) < 0.51)
    await frames(3)
    expect(opacityOf(w)).toBeLessThan(0.51)
    expect(xOf(w), "x stays where the call left it").toBeCloseTo(100, 0)
    setX(30)
    await until(() => Math.abs(xOf(w) - 30) < 0.5)
    expect(xOf(w), "its own target taken back").toBeCloseTo(30, 0)
  })

  it("CV3: the scope's owner's cleanup stops its animations where they are", async () => {
    const [shown, setShown] = createSignal(true)
    let animate!: WardicAnimate
    let p!: HTMLElement
    const Owner = (): JSX.Element => {
      ;[, animate] = createAnimate()
      return null
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <div ref={(n: HTMLElement) => (p = n)} style={BOX} />
        <Show when={shown()}>
          <Owner />
        </Show>
      </WardicProvider>
    ))
    await frames(2)
    animate(p, { x: 100 }, { duration: 1, ease: "linear" })
    await frames(10)
    setShown(false)
    await raf()
    const at = xOf(p)
    await frames(8)
    expect(xOf(p), "stopped where it was").toBeCloseTo(at, 3)
    expect(at).toBeLessThan(90)
  })

  it("CV4: a sequence runs its Segments in order, and scope.settled() holds it once it lands", async () => {
    const { scope, animate } = mountScope(() => (
      <>
        <div id="p" style={BOX} />
        <div id="q" style={BOX} />
      </>
    ))
    await frames(2)
    // Read before: its first read is never pending (CV1).
    expect(scope.settled()).toBeUndefined()
    const p = byId("p")
    const q = byId("q")
    const heard: Array<number> = []
    const sequence = animate([
      [p, { x: 60 }, { duration: 0.3, ease: "linear" }],
      [q, { x: 60 }, { duration: 0.3, ease: "linear" }],
      [(value: number) => heard.push(value), { duration: 0.2, at: "<" }],
    ])
    await until(() => xOf(p) > 10)
    expect(isPending(() => scope.settled()), "in flight").toBe(true)
    expect(xOf(q), "q waits for p").toBeCloseTo(0, 3)
    await until(() => xOf(q) > 10)
    expect(xOf(p)).toBeCloseTo(60, 0)
    await sequence
    await frames(2)
    expect(xOf(q)).toBeCloseTo(60, 0)
    expect(heard.at(-1), "the callback's end").toBe(1)
    expect(isPending(() => scope.settled())).toBe(false)
    expect(scope.settled()?.animation, "the sequence landed").toBe(sequence)
  })
})
