// `createAnimate()` on Solid 1 (#433, Motion's `useAnimate`): an Animation scope's Imperative
// animations of plain elements and Wardic ones, and their Playback controls.
//
// - CA1: a plain element animates to its target and the controls resolve; a second call goes on from
//   where the first left it, its other transform keys kept, and from its velocity.
// - CA2: a selector finds the scope's elements alone; a `delay` function staggers them by index.
// - CA3: on a Wardic element the call takes its keys (Motion's latest-wins): a Retarget of another key
//   mid-flight leaves it running, a change of another key leaves them where it left them, a key the
//   element never set stays, and a change of the element's own target for a key takes it back.
// - CA4: `pause` holds and `play` resumes; `speed` 2 runs it in half the time; `time` set seeks, and,
//   paused, holds there; `duration` is the longest key's.
// - CA5: `complete` jumps to the end and resolves; `cancel` puts the keys back and never resolves;
//   `stop` freezes it for good, `play` doing nothing after; `state` follows each.
// - CA6: under reduced motion a positional key snaps and opacity animates.
// - CA7: the scope's owner's cleanup stops its animations where they are.
// - CA8: Keyframes run through their stops, and `height: "auto"` is measured, on a plain element.
// - CA9: `onComplete` comes at the landing; a selector that finds nothing resolves at once; `animations`
//   holds those in flight.
// - CA10: a key taken while it returns to its Base value (its target dropped), here its `style` value,
//   stays the call's: a later Retarget of another key, landing, doesn't hand it back.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { createAnimate, wardic, type WardicAnimate, type WardicAnimationScope, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, type JSX, Show } from "solid-js"
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
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Mount `children` under a scope; its scope, its `animate` and its root. */
const mountScope = (children: () => JSX.Element, reducedMotion: "always" | "never" = "never"): { readonly scope: WardicAnimationScope; readonly animate: WardicAnimate; readonly unmount: () => void } => {
  let scope!: WardicAnimationScope
  let animate!: WardicAnimate
  const Scene = (): JSX.Element => {
    ;[scope, animate] = createAnimate()
    return <div ref={scope}>{children()}</div>
  }
  const { unmount } = render(() => (
    <WardicProvider env={DomLive} reducedMotion={reducedMotion}>
      <Scene />
    </WardicProvider>
  ))
  return { scope, animate, unmount }
}

const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement

describe("createAnimate on Solid 1 (#433)", () => {
  it("CA1: a plain element animates and resolves; a second call goes on from there, keeping its other keys and its velocity", async () => {
    const { animate } = mountScope(() => <div id="p" style={BOX} />)
    await frames(2)
    const p = byId("p")
    const first = animate(p, { x: 100 }, LINEAR)
    await frames(6)
    expect(xOf(p), "on its way").toBeGreaterThan(5)
    expect(xOf(p)).toBeLessThan(95)
    await first
    expect(first.state).toBe("finished")
    expect(xOf(p)).toBeCloseTo(100, 0)
    await animate(p, { scale: 2 }, { duration: 0.1 })
    expect(matrixOf(p).a, "scaled").toBeCloseTo(2, 2)
    expect(xOf(p), "its x kept").toBeCloseTo(100, 0)
    // A spring interrupted mid-flight by another back: no jump at the switch, and it carries on outward first.
    animate(p, { x: 300 }, { type: "spring", stiffness: 60, damping: 12 })
    await frames(10)
    const at = xOf(p)
    animate(p, { x: 0 }, { type: "spring", stiffness: 100, damping: 20 })
    await raf()
    const after = xOf(p)
    expect(Math.abs(after - at), "goes on from where it is").toBeLessThan(30)
    await raf()
    expect(xOf(p), "with its velocity, outward a little first").toBeGreaterThan(at - 5)
  })

  it("CA2: a selector finds the scope's elements alone, and a delay function staggers them", async () => {
    const outside = <li class="item" id="out" />
    render(() => <ul>{outside}</ul>)
    const { animate } = mountScope(() => (
      <ul>
        <li class="item" id="a" />
        <li class="item" id="b" />
      </ul>
    ))
    await frames(2)
    const done = animate(".item", { opacity: 0 }, { duration: 0.2, ease: "linear", delay: (i) => i * 0.2 })
    await frames(8)
    expect(opacityOf(byId("a")), "the first under way").toBeLessThan(0.9)
    expect(opacityOf(byId("b")), "the second still waiting").toBe(1)
    await done
    expect(opacityOf(byId("a"))).toBe(0)
    expect(opacityOf(byId("b"))).toBe(0)
    expect(opacityOf(byId("out")), "not the page's").toBe(1)
  })

  it("CA3: on a Wardic element the call takes its keys until the element's own target for them changes", async () => {
    const [x, setX] = createSignal(0)
    const [opacity, setOpacity] = createSignal(1)
    const { animate } = mountScope(() => <wardic.div id="w" animate={{ x: x(), opacity: opacity() }} transition={{ duration: 0.1 }} style={BOX} />)
    await frames(4)
    const w = byId("w")
    const running = animate(w, { x: 200 }, { duration: 0.3, ease: "linear" })
    await frames(5)
    setOpacity(0.8)
    await running
    expect(xOf(w), "ran on through a Retarget of another key").toBeCloseTo(200, 0)
    await animate(w, { x: 100, scale: 1.5 }, { duration: 0.1 })
    expect(xOf(w)).toBeCloseTo(100, 0)
    setOpacity(0.5)
    await until(() => opacityOf(w) < 0.51)
    await frames(3)
    expect(opacityOf(w), "the other key animated").toBeLessThan(0.51)
    expect(xOf(w), "x stays where the call left it").toBeCloseTo(100, 0)
    expect(matrixOf(w).a, "a key the element never set stays").toBeCloseTo(1.5, 2)
    setX(40)
    await until(() => Math.abs(xOf(w) - 40) < 0.5)
    expect(xOf(w), "its own target taken back").toBeCloseTo(40, 0)
    expect(matrixOf(w).a).toBeCloseTo(1.5, 2)
  })

  it("CA4: pause holds and play resumes; speed 2 is twice as fast; time set seeks; duration is the longest key's", async () => {
    const { animate } = mountScope(() => (
      <>
        <div id="p" style={BOX} />
        <div id="q" style={BOX} />
      </>
    ))
    await frames(2)
    const p = byId("p")
    const c = animate(p, { x: 100, opacity: 0 }, { x: { duration: 0.4, ease: "linear" }, opacity: { duration: 0.8, ease: "linear" } })
    expect(c.duration, "the longest key's").toBeCloseTo(0.8, 1)
    await frames(6)
    c.pause()
    expect(c.state).toBe("paused")
    await raf()
    const held = xOf(p)
    await frames(6)
    expect(xOf(p), "held").toBeCloseTo(held, 3)
    c.play()
    await frames(4)
    expect(xOf(p), "on again").toBeGreaterThan(held + 1)
    // A seek while paused holds where it goes.
    c.pause()
    c.time = 0.2
    await frames(2)
    expect(xOf(p), "at 0.2 s").toBeCloseTo(50, 0)
    expect(c.time).toBeCloseTo(0.2, 2)
    await frames(4)
    expect(xOf(p), "still").toBeCloseTo(50, 0)
    c.time = 0.3
    await frames(2)
    expect(xOf(p)).toBeCloseTo(75, 0)
    c.play()
    await c
    expect(xOf(p)).toBeCloseTo(100, 0)
    // Twice as fast.
    const q = byId("q")
    const fast = animate(q, { x: 100 }, { duration: 0.4, ease: "linear" })
    fast.speed = 2
    const started = performance.now()
    await fast
    expect(performance.now() - started, "about 0.2 s").toBeLessThan(330)
  })

  it("CA5: complete jumps to the end and resolves; cancel goes back and never resolves; stop freezes for good", async () => {
    const { animate } = mountScope(() => (
      <>
        <div id="p" style={BOX} />
        <div id="q" style={BOX} />
        <div id="r" style={BOX} />
      </>
    ))
    await frames(2)
    const done = animate(byId("p"), { x: 100 }, { duration: 2, ease: "linear" })
    await frames(3)
    done.complete()
    await done
    expect(done.state).toBe("finished")
    expect(xOf(byId("p"))).toBeCloseTo(100, 0)
    const q = byId("q")
    const cancelled = animate(q, { x: 100 }, { duration: 2, ease: "linear" })
    let resolved = false
    void cancelled.then(() => (resolved = true))
    await frames(10)
    expect(xOf(q)).toBeGreaterThan(1)
    cancelled.cancel()
    await frames(2)
    expect(xOf(q), "back where it started").toBeCloseTo(0, 3)
    expect(cancelled.state).toBe("idle")
    const r = byId("r")
    const stopped = animate(r, { x: 100 }, { duration: 2, ease: "linear" })
    await frames(10)
    stopped.stop()
    await raf()
    const at = xOf(r)
    stopped.play()
    await frames(6)
    expect(xOf(r), "frozen for good").toBeCloseTo(at, 3)
    expect(stopped.state).toBe("idle")
    await wait(50)
    expect(resolved, "a cancelled one never resolves").toBe(false)
  })

  it("CA6: under reduced motion a positional key snaps and opacity animates", async () => {
    const { animate } = mountScope(() => <div id="p" style={BOX} />, "always")
    await frames(2)
    const p = byId("p")
    animate(p, { x: 100, opacity: 0 }, { duration: 0.6, ease: "linear" })
    await frames(3)
    expect(xOf(p), "snapped").toBeCloseTo(100, 0)
    expect(opacityOf(p), "on its way").toBeGreaterThan(0.2)
  })

  it("CA7: the scope's owner's cleanup stops its animations where they are", async () => {
    const [shown, setShown] = createSignal(true)
    let animate!: WardicAnimate
    let p!: HTMLElement
    const Owner = (): JSX.Element => {
      ;[, animate] = createAnimate()
      return null
    }
    render(() => (
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

  it("CA8: Keyframes run through their stops, and height auto is measured, on a plain element", async () => {
    const { animate } = mountScope(() => (
      <>
        <div id="p" style={BOX} />
        <div id="h" style={{ height: "0px", overflow: "hidden" }}>
          <div style={{ height: "80px" }} />
        </div>
      </>
    ))
    await frames(2)
    const p = byId("p")
    const seen: Array<number> = []
    const stops = animate(p, { opacity: [1, 0, 0.5] }, { duration: 0.4, ease: "linear" })
    while (stops.state === "running") {
      seen.push(opacityOf(p))
      await raf()
    }
    expect(Math.min(...seen), "through its middle stop").toBeLessThan(0.15)
    expect(opacityOf(p)).toBeCloseTo(0.5, 2)
    const h = byId("h")
    const grow = animate(h, { height: "auto" }, { duration: 0.2, ease: "linear" })
    await frames(5)
    const mid = h.getBoundingClientRect().height
    await grow
    expect(mid, "through the px between").toBeGreaterThan(5)
    expect(mid).toBeLessThan(75)
    expect(h.style.height, "lands on auto").toBe("auto")
    expect(h.getBoundingClientRect().height).toBeCloseTo(80, 0)
  })

  it("CA9: onComplete at the landing; a selector that finds nothing resolves at once; animations holds those in flight", async () => {
    const { scope, animate } = mountScope(() => <div id="p" style={BOX} />)
    await frames(2)
    let completed = false
    const c = animate(byId("p"), { x: 50 }, { duration: 0.1, onComplete: () => (completed = true) })
    expect(scope.animations).toEqual([c])
    await c
    expect(completed).toBe(true)
    expect(scope.animations, "none in flight").toEqual([])
    const none = animate(".missing", { x: 50 })
    expect(none.state).toBe("finished")
    await none
  })

  it("CA10: a key taken while it returns to its style value stays the call's through a later Retarget", async () => {
    const [faded, setFaded] = createSignal(true)
    const [x, setX] = createSignal(0)
    const target = (): { readonly opacity?: number; readonly x: number } =>
      Bool.match(faded(), { onTrue: () => ({ opacity: 0.5, x: x() }), onFalse: () => ({ x: x() }) })
    const { animate } = mountScope(() => <wardic.div id="w" animate={target()} transition={{ duration: 1, ease: "linear" }} style={{ ...BOX, opacity: 0.9 }} />)
    await frames(4)
    const w = byId("w")
    // Its opacity dropped: it heads back to its style value, 0.9, over a second.
    setFaded(false)
    await frames(4)
    await animate(w, { opacity: 0.2 }, { duration: 0.1 })
    expect(opacityOf(w)).toBeCloseTo(0.2, 2)
    // A Retarget of x, which lands: its returns would hand opacity back to the style.
    setX(10)
    await until(() => Math.abs(xOf(w) - 10) < 0.1, 3000)
    await frames(4)
    expect(opacityOf(w), "not handed back").toBeCloseTo(0.2, 2)
  })
})
