// `WardicConfig`'s `skipAnimations` on Solid 1 (#468, Motion's `MotionConfig` `skipAnimations`): every
// animation of the elements below lands at its end on the next frame, with no delay, and is told as
// any landing is. Real frames; a box beside, outside the config, still animating, as the control.
//
// - SK1: a 2 s tween with a delay lands on the next frame, told start and complete; outside, it moves.
// - SK2: Keyframes land on their last stop; a parent's `staggerChildren` holds no Variant child back.
// - SK3: an exit removes its element at once, `onExitComplete` told.
// - SK4: a layout animation and a `layoutId` handover land at once.
// - SK5: a drag released past its constraints lands on the edge at once, `onDragTransitionEnd` told;
//   a flick lands where its momentum would rest, on the next frame.
// - SK6: `createAnimate`'s `animate()` lands at once, a sequence at its end, and a function Segment is
//   told its last value alone.
// - SK7: `createSpring` follows its source at once.
// - SK8: an inner config's `false` animates its subtree again, and one that gives none passes it on;
//   a transition's own `skipAnimations` lands without a config; a change of the config applies from
//   the next animation.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import {
  AnimatePresence,
  createAnimate,
  createSpring,
  type WardicAnimate,
  type WardicAnimationDefinition,
  wardic,
  WardicConfig,
  WardicProvider,
  type WardicTransition,
  type WardicVariants,
} from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"
import { add, glide, mouse, type Pt, resetScene, sampleFrames, settle, wait } from "./reorder-harness.tsx"

afterEach(async () => {
  await resetScene()
  cleanup()
})

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const matrixOf = (el: Element): DOMMatrix => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
const xOf = (el: Element): number => matrixOf(el).m41
const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)

const SLOW: WardicTransition = { type: "tween", duration: 2, ease: "linear" }
// Clear of the page's one mouse, parked at (5, 5) for every browser file.
const BOX = { display: "block", width: "40px", height: "40px", "margin-top": "120px", "margin-left": "120px" } as const

/** Render `ui` inside a provider; `q` finds a `data-k`. */
const mount = (ui: () => JSX.Element) => {
  const { container } = render(() => <WardicProvider env={DomLive}>{ui()}</WardicProvider>)
  return (k: string): HTMLElement => container.querySelector<HTMLElement>(`[data-k="${k}"]`)!
}

const to100 = (on: () => boolean) => Bool.match(on(), { onTrue: () => ({ x: 100 }), onFalse: () => ({ x: 0 }) })

describe("WardicConfig's skipAnimations on Solid 1 (#468)", () => {
  it("SK1: a 2 s tween with a delay lands on the next frame, told; outside, it moves", async () => {
    const calls: Array<string> = []
    const tell = (name: string) => (definition: WardicAnimationDefinition) => calls.push(`${name} ${JSON.stringify(definition)}`)
    const [on, setOn] = createSignal(false)
    const q = mount(() => (
      <>
        <WardicConfig skipAnimations>
          <wardic.div data-k="in" initial={{ x: 0 }} animate={to100(on)} transition={{ ...SLOW, delay: 1 }} onAnimationStart={tell("start")} onAnimationComplete={tell("complete")} style={BOX} />
        </WardicConfig>
        <wardic.div data-k="out" initial={{ x: 0 }} animate={to100(on)} transition={SLOW} style={BOX} />
      </>
    ))
    await frames(3)
    calls.length = 0
    setOn(true)
    await frames(3)
    expect(xOf(q("in")), "landed").toBeCloseTo(100, 3)
    expect(calls, "told start and complete").toEqual(['start {"x":100}', 'complete {"x":100}'])
    expect(xOf(q("out")), "outside, on its way").toBeLessThan(20)
  })

  it("SK2: Keyframes land on their last stop; a stagger holds no Variant child back", async () => {
    const [on, setOn] = createSignal(false)
    const item: WardicVariants = { hidden: { x: 0 }, shown: { x: 100 } }
    const q = mount(() => (
      <WardicConfig skipAnimations>
        <wardic.div data-k="keys" initial={{ x: 0 }} animate={Bool.match(on(), { onTrue: () => ({ x: [0, 300, 50] }), onFalse: () => ({ x: 0 }) })} transition={SLOW} style={BOX} />
        <wardic.ul
          initial="hidden"
          animate={Bool.match(on(), { onTrue: () => "shown", onFalse: () => "hidden" })}
          variants={{ hidden: {}, shown: {} }}
          transition={{ staggerChildren: 0.5 }}
          style={{ "list-style": "none" }}
        >
          <wardic.li data-k="first" variants={item} transition={SLOW} style={BOX} />
          <wardic.li data-k="third" variants={item} transition={SLOW} style={BOX} />
        </wardic.ul>
      </WardicConfig>
    ))
    await frames(3)
    setOn(true)
    await frames(4)
    expect(xOf(q("keys")), "its last stop").toBeCloseTo(50, 3)
    expect(xOf(q("first"))).toBeCloseTo(100, 3)
    expect(xOf(q("third")), "no stagger slot").toBeCloseTo(100, 3)
  })

  it("SK3: an exit removes its element at once, onExitComplete told", async () => {
    const [shown, setShown] = createSignal(true)
    let exited = 0
    const q = mount(() => (
      <WardicConfig skipAnimations>
        <AnimatePresence onExitComplete={() => exited++}>
          <Show when={shown()}>
            <wardic.div data-k="leaving" initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SLOW} style={BOX} />
          </Show>
        </AnimatePresence>
      </WardicConfig>
    ))
    await frames(3)
    const el = q("leaving")
    setShown(false)
    await until(() => Bool.not(el.isConnected), 300)
    expect(el.isConnected, "gone within 300 ms of a 2 s exit").toBe(false)
    expect(exited).toBe(1)
  })

  it("SK4: a layout animation and a layoutId handover land at once", async () => {
    const [wide, setWide] = createSignal(false)
    const [which, setWhich] = createSignal(true)
    const width = () => Bool.match(wide(), { onTrue: () => "200px", onFalse: () => "100px" })
    const q = mount(() => (
      <>
        <WardicConfig skipAnimations>
          <wardic.div data-k="grows" layout transition={{ layout: SLOW }} style={{ width: width(), height: "20px", background: "teal" }} />
          <Show when={which()} fallback={<wardic.div data-k="b" layoutId="card" transition={SLOW} style={{ width: "40px", height: "40px", "margin-left": "300px" }} />}>
            <wardic.div data-k="a" layoutId="card" transition={SLOW} style={{ width: "40px", height: "40px" }} />
          </Show>
        </WardicConfig>
        <wardic.div data-k="control" layout transition={{ layout: SLOW }} style={{ width: width(), height: "20px", background: "teal" }} />
      </>
    ))
    await frames(3)
    setWide(true)
    setWhich(false)
    await frames(3)
    expect(q("grows").getBoundingClientRect().width, "at its new width").toBeCloseTo(200, 0)
    expect(q("control").getBoundingClientRect().width, "outside, on its way").toBeLessThan(150)
    expect(Math.abs(xOf(q("b"))), "the twin drawn on its own box").toBeLessThan(0.5)
  })

  it("SK6: createAnimate lands at once, a sequence at its end, a function Segment told its last value alone", async () => {
    let animate!: WardicAnimate
    const Scene = (): JSX.Element => {
      const [scope, made] = createAnimate()
      animate = made
      return (
        <div ref={scope}>
          <div id="sk6-plain" style={BOX} />
          <wardic.div id="sk6-wardic" style={BOX} />
        </div>
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <WardicConfig skipAnimations>
          <Scene />
        </WardicConfig>
      </WardicProvider>
    ))
    await frames(2)
    const plain = document.getElementById("sk6-plain")!
    const own = document.getElementById("sk6-wardic")!
    const first = animate(plain, { x: 100 }, SLOW)
    void animate(own, { x: 60 }, SLOW)
    await frames(3)
    expect(xOf(plain), "a plain element").toBeCloseTo(100, 3)
    expect(xOf(own), "a Wardic element").toBeCloseTo(60, 3)
    expect(first.state).toBe("finished")
    const told: Array<number> = []
    void animate([
      [plain, { x: 200 }, { duration: 1 }],
      [own, { opacity: 0.5 }, { duration: 1 }],
      [(v: number) => told.push(v), [0, 10], { duration: 1 }],
    ])
    await frames(3)
    expect(xOf(plain), "the sequence's end").toBeCloseTo(200, 3)
    expect(opacityOf(own)).toBeCloseTo(0.5, 3)
    expect(told, "its last value alone").toEqual([10])
  })

  it("SK7: createSpring follows its source at once", async () => {
    const [x, setX] = createSignal(0)
    let el!: HTMLElement
    const Box = (): JSX.Element => {
      const spring = createSpring(x, { stiffness: 50, damping: 10 })
      return <wardic.div ref={(n: HTMLElement) => (el = n)} style={{ ...BOX, x: spring }} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <WardicConfig skipAnimations>
          <Box />
        </WardicConfig>
      </WardicProvider>
    ))
    await frames(3)
    setX(150)
    await frames(3)
    expect(xOf(el), "on its source").toBeCloseTo(150, 3)
  })

  it("SK8: an inner false animates again; a transition's own lands with no config; a change applies from the next animation", async () => {
    const [on, setOn] = createSignal(false)
    const [skips, setSkips] = createSignal(false)
    const q = mount(() => (
      <>
        <WardicConfig skipAnimations>
          <WardicConfig skipAnimations={false}>
            <wardic.div data-k="inner" initial={{ x: 0 }} animate={to100(on)} transition={SLOW} style={BOX} />
          </WardicConfig>
          <WardicConfig transition={SLOW}>
            <wardic.div data-k="passed" initial={{ x: 0 }} animate={to100(on)} style={BOX} />
          </WardicConfig>
        </WardicConfig>
        <wardic.div data-k="own" initial={{ x: 0 }} animate={to100(on)} transition={{ ...SLOW, skipAnimations: true }} style={BOX} />
        <WardicConfig skipAnimations={skips()}>
          <wardic.div data-k="later" initial={{ x: 0 }} animate={to100(on)} transition={SLOW} style={BOX} />
        </WardicConfig>
      </>
    ))
    await frames(3)
    setOn(true)
    await frames(3)
    expect(xOf(q("inner")), "animating again").toBeLessThan(20)
    expect(xOf(q("passed")), "passed on").toBeCloseTo(100, 3)
    expect(xOf(q("own")), "its transition's").toBeCloseTo(100, 3)
    expect(xOf(q("later")), "not skipped yet").toBeLessThan(20)
    setSkips(true)
    await frames(3)
    const running = xOf(q("later"))
    expect(running, "the running one runs on").toBeLessThan(40)
    setOn(false)
    await frames(3)
    expect(xOf(q("later")), "the next lands at once").toBeCloseTo(0, 3)
  })
})

describe("a skipped drag release (#468)", () => {
  /** A 120x80 box free to drag at (40, 400), under a skipping config: low, clear of the other files' mounts. */
  const mountBox = async (extra: { readonly dragConstraints?: { readonly right: number }; readonly onDragTransitionEnd?: () => void }) => {
    const [el, setEl] = createSignal<HTMLElement>()
    render(() => (
      <WardicProvider env={DomLive}>
        <WardicConfig skipAnimations>
          <div style={{ position: "absolute", top: "400px", left: "40px" }}>
            <wardic.div ref={(n: HTMLElement) => setEl(n)} drag="x" {...extra} style={{ position: "relative", width: "120px", height: "80px", background: "#8af" }} />
          </div>
        </WardicConfig>
      </WardicProvider>
    ))
    await settle()
    const target = el()!
    const slot = target.getBoundingClientRect()
    return { el: target, slot, grab: { x: slot.left + 20, y: slot.top + 40 } as Pt, dx: () => target.getBoundingClientRect().left - slot.left }
  }

  it("SK5: past its constraints it lands on the edge at once, told; a flick lands where it would rest, on the next frame", async () => {
    let ended = 0
    const b = await mountBox({ dragConstraints: { right: 100 }, onDragTransitionEnd: () => ended++ })
    await mouse.down(b.grab)
    await glide(b.grab, add(b.grab, 180, 0), 12, 20)
    await wait(200)
    expect(b.dx(), "pulled past the edge").toBeGreaterThan(105)
    await mouse.up(add(b.grab, 180, 0))
    await frames(2)
    expect(b.dx(), "on the edge").toBeCloseTo(100, 0)
    await until(() => ended === 1, 500)
    expect(ended, "told").toBe(1)
    cleanup()

    const free = await mountBox({})
    await mouse.down(free.grab)
    await glide(free.grab, add(free.grab, 100, 0), 10, 20)
    for (let k = 1; k <= 3; k++) {
      await mouse.move(add(free.grab, 100 + 50 * k, 0))
      await wait(35)
    }
    const sampling = sampleFrames(() => free.dx())
    await mouse.up(add(free.grab, 300, 0))
    await wait(300)
    const seen = sampling.stop().map((f) => f.v)
    const rest = seen.at(-1)!
    expect(rest, "it went on past where it was let go").toBeGreaterThan(320)
    // No glide: every frame is held at the pointer (300 at most) or already at rest.
    const between = seen.filter((v) => Bool.and(v > 301, Math.abs(v - rest) > 0.5))
    expect(between, `frames: ${seen.map(Math.round).join(" ")}`).toEqual([])
  })
})
