// A key's velocity, from its frames, whatever drew them (#464, Motion's `getVelocity`), and at rest
// once nothing has moved it for 30 ms.
//
// - VL1: a spring that takes over a moving tween carries its speed on outward first, as Motion's.
// - VL2: a spring after a tween that landed starts at rest: the older spring's velocity is gone, so a
//   critically damped spring doesn't overshoot (the issue's 113, 122, 129…).
// - VL3: a spring chained in the frame a linear tween lands carries its last speed; one started later
//   starts at rest.
// - VL4: a jump (`duration: 0`) leaves no velocity: a spring chained after it doesn't fly off.
// - VL5: an Imperative animation's spring takes over a moving tween call with its speed too.
// - VL7: a spring stopped mid-flight leaves no velocity 100 ms later: the next starts at rest.
// - VL8: so does a declarative one (Animation controls' `stop()`), for the element's next Retarget.
// - VL9: a spring stopped and followed in the same task carries its speed on.
// - VL6: an exit that takes over a moving tween starts with its speed, as Motion's.
// - VL10: an exit reads a key a paused Imperative animation holds at rest: its held frames move nothing.
// - VL11: an exit after a long task reads a moving spring's key at rest: it drew nothing for 100 ms.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, createAnimate, createAnimationControls, wardic, type WardicAnimate, type WardicTransition, WardicProvider } from "@wardic/solid"
import * as Predicate from "effect/Predicate"
import { createSignal, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const BOX: JSX.CSSProperties = { width: "40px", height: "40px", background: "teal" }
const xOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41
const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** `el`'s x on each of the next `n` frames. */
const xs = async (el: Element, n: number): Promise<ReadonlyArray<number>> => {
  const out: Array<number> = []
  for (let i = 0; i < n; i++) {
    await raf()
    out.push(xOf(el))
  }
  return out
}

/** A box animating `x` to a signal's target on a signal's transition, `onComplete` told at each landing. */
const mountBox = (onComplete: () => void = () => undefined): {
  readonly setX: (x: number) => void
  readonly setTransition: (t: WardicTransition) => void
  readonly set: (x: number, t: WardicTransition) => void
} => {
  const [x, setX] = createSignal(0)
  const [transition, setTransition] = createSignal<WardicTransition>({ duration: 0.1 })
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div id="box" initial={{ x: 0 }} animate={{ x: x() }} transition={transition()} onAnimationComplete={() => onComplete()} style={BOX} />
    </WardicProvider>
  ))
  return {
    setX,
    setTransition: (t) => setTransition(() => t),
    set: (to, t) => {
      setTransition(() => t)
      setX(to)
    },
  }
}

const SPRING_BACK: WardicTransition = { type: "spring", stiffness: 100, damping: 10 }
const CRITICAL: WardicTransition = { type: "spring", stiffness: 100, damping: 20 }
/** A slow critically damped spring: its first frames show the speed it starts with. */
const SOFT: WardicTransition = { type: "spring", stiffness: 20, damping: 9 }

describe("a key's velocity from its frames (#464)", () => {
  it("VL1: a spring that takes over a moving tween carries its speed on outward first", async () => {
    const box = mountBox()
    await frames(3)
    box.set(300, { duration: 1, ease: "linear" })
    await until(() => xOf(byId("box")) > 100)
    const at = xOf(byId("box"))
    box.set(0, SPRING_BACK)
    const after = await xs(byId("box"), 4)
    // At about 300 px/s, it goes on outward before it turns: today's turned at once.
    expect(Math.max(...after), "on outward first").toBeGreaterThan(at + 2)
  })

  it("VL2: a spring after a tween that landed starts at rest: no older spring's velocity", async () => {
    const box = mountBox()
    await frames(3)
    box.set(300, { type: "spring", stiffness: 100, damping: 10 })
    await until(() => xOf(byId("box")) > 60)
    box.set(100, { duration: 0.2 })
    await until(() => Math.abs(xOf(byId("box")) - 100) < 0.01)
    await wait(100)
    box.set(110, CRITICAL)
    const after = await xs(byId("box"), 40)
    expect(Math.max(...after), "a critically damped spring doesn't overshoot").toBeLessThan(110.5)
  })

  it("VL3: a spring chained in the frame a linear tween lands carries its last speed; one started later starts at rest", async () => {
    let chain: (() => void) | undefined
    let chained: ReadonlyArray<number> | undefined
    const box = mountBox(() => callIf(chain))
    await frames(3)
    // 0.31 s: its last frame a third of a step, about 3 px (a frame's velocity is its last step's, as Motion's).
    box.set(100, { duration: 0.31, ease: "linear" })
    // Armed once the tween runs: chained in its landing's frame, sampled from there.
    chain = () => {
      chain = undefined
      box.set(400, SOFT)
      void xs(byId("box"), 3).then((sampled) => (chained = sampled))
    }
    await until(() => Predicate.isNotUndefined(chained))
    // Later: 100 ms after another landing.
    cleanup()
    const late = mountBox()
    await frames(3)
    late.set(100, { duration: 0.31, ease: "linear" })
    await until(() => Math.abs(xOf(byId("box")) - 100) < 0.01)
    await wait(100)
    late.set(400, SOFT)
    const fromRest = await xs(byId("box"), 3)
    // About 190 px/s carried: some 7 px ahead of a start from rest by its third frame.
    expect((chained as ReadonlyArray<number>)[2] as number, "with its speed").toBeGreaterThan((fromRest[2] as number) + 4)
  })

  it("VL4: a jump leaves no velocity: a spring chained after it doesn't fly off", async () => {
    let chain: (() => void) | undefined
    const box = mountBox(() => callIf(chain))
    await frames(3)
    box.set(200, { duration: 0 })
    chain = () => {
      chain = undefined
      box.set(250, CRITICAL)
    }
    await until(() => xOf(byId("box")) > 200.5)
    const after = await xs(byId("box"), 40)
    expect(Math.max(...after), "no spike from the jump").toBeLessThan(250.5)
  })

  it("VL5: an Imperative animation's spring takes over a moving tween call with its speed", async () => {
    let animate!: WardicAnimate
    const Scene = (): JSX.Element => {
      const [scope, made] = createAnimate()
      animate = made
      return <div ref={scope}><div id="p" style={BOX} /></div>
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await frames(3)
    const p = byId("p")
    void animate(p, { x: 300 }, { duration: 1, ease: "linear" })
    await until(() => xOf(p) > 100)
    const at = xOf(p)
    void animate(p, { x: 0 }, SPRING_BACK)
    const after = await xs(p, 4)
    expect(Math.max(...after), "on outward first").toBeGreaterThan(at + 2)
  })

  it("VL7: a spring stopped mid-flight leaves no velocity 100 ms later", async () => {
    let animate!: WardicAnimate
    const Scene = (): JSX.Element => {
      const [scope, made] = createAnimate()
      animate = made
      return <div ref={scope}><div id="p" style={BOX} /></div>
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await frames(3)
    const p = byId("p")
    const flying = animate(p, { x: 300 }, SPRING_BACK)
    await until(() => xOf(p) > 60)
    flying.stop()
    await wait(100)
    const at = xOf(p)
    void animate(p, { x: at + 10 }, CRITICAL)
    const after = await xs(p, 40)
    expect(Math.max(...after), "from rest: no overshoot").toBeLessThan(at + 10.5)
  })

  it("VL8: a declarative spring stopped mid-flight leaves no velocity 100 ms later", async () => {
    const controls = createAnimationControls()
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div id="c" initial={{ x: 0 }} animate={controls} style={BOX} />
      </WardicProvider>
    ))
    await frames(3)
    const c = byId("c")
    void controls.start({ x: 300 }, SPRING_BACK)
    await until(() => xOf(c) > 60)
    controls.stop()
    await wait(100)
    const at = xOf(c)
    void controls.start({ x: at + 10 }, CRITICAL)
    const after = await xs(c, 40)
    expect(Math.max(...after), "from rest: no overshoot").toBeLessThan(at + 10.5)
  })

  it("VL9: a spring stopped and followed in the same task carries its speed on", async () => {
    let animate!: WardicAnimate
    const Scene = (): JSX.Element => {
      const [scope, made] = createAnimate()
      animate = made
      return <div ref={scope}><div id="p" style={BOX} /></div>
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await frames(3)
    const p = byId("p")
    const flying = animate(p, { x: 300 }, SPRING_BACK)
    await until(() => xOf(p) > 60)
    const at = xOf(p)
    flying.stop()
    void animate(p, { x: 0 }, SPRING_BACK)
    const after = await xs(p, 4)
    expect(Math.max(...after), "on outward first").toBeGreaterThan(at + 2)
  })
})

describe("an exit's velocity (#464)", () => {
  it("VL6: an exit that takes over a moving tween starts with its speed", async () => {
    const [shown, setShown] = createSignal(true)
    const [x, setX] = createSignal(0)
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={shown()}>
            <wardic.div ref={(n: HTMLElement) => (el = n)} initial={{ x: 0 }} animate={{ x: x() }} exit={{ x: 0, transition: SPRING_BACK }} transition={{ duration: 1, ease: "linear" }} style={BOX} />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await frames(3)
    setX(300)
    await until(() => xOf(el) > 100)
    const at = xOf(el)
    setShown(false)
    const after = await xs(el, 4)
    expect(Math.max(...after), "on outward first").toBeGreaterThan(at + 2)
  })

  it("VL10: an exit reads a key a paused animation holds at rest 100 ms later", async () => {
    const [shown, setShown] = createSignal(true)
    let animate!: WardicAnimate
    let el!: HTMLElement
    const Scene = (): JSX.Element => {
      const [scope, made] = createAnimate()
      animate = made
      return (
        <div ref={scope}>
          <AnimatePresence>
            <Show when={shown()}>
              <wardic.div ref={(n: HTMLElement) => (el = n)} initial={{ x: 0 }} exit={{ x: 0, transition: CRITICAL }} style={BOX} />
            </Show>
          </AnimatePresence>
        </div>
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await frames(3)
    const flying = animate(el, { x: 300 }, SPRING_BACK)
    await until(() => xOf(el) > 60)
    // Paused, its leg still holds `x` but draws nothing: past 30 ms, `x` is at rest.
    flying.pause()
    await wait(100)
    const at = xOf(el)
    setShown(false)
    const after = await xs(el, 6)
    expect(Math.max(...after), "from rest: back at once").toBeLessThan(at + 0.5)
    expect(Math.min(...after), "and it exits").toBeLessThan(at - 1)
  })

  it("VL11: an exit after a long task reads a moving spring's key at rest", async () => {
    const [shown, setShown] = createSignal(true)
    const [x, setX] = createSignal(0)
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={shown()}>
            <wardic.div ref={(n: HTMLElement) => (el = n)} initial={{ x: 0 }} animate={{ x: x() }} exit={{ x: 0, transition: CRITICAL }} transition={SPRING_BACK} style={BOX} />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await frames(3)
    setX(300)
    await until(() => xOf(el) > 60)
    const at = xOf(el)
    // A long task: no frame draws `x` for 100 ms, so it's at rest when the exit reads it.
    const began = performance.now()
    while (performance.now() - began < 100) {
      // busy
    }
    setShown(false)
    const after = await xs(el, 6)
    expect(Math.max(...after), "from rest: back at once").toBeLessThan(at + 0.5)
    expect(Math.min(...after), "and it exits").toBeLessThan(at - 1)
  })
})

/** Call `f` when it's there. */
function callIf(f: (() => void) | undefined): void {
  if (f) f()
}
