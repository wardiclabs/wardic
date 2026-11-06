// Scroll, velocity, time and onUpdate in Solid (#233, #234, ADR-0043 *Amendment (#233, #234)*).
//
// - SL1: createScroll follows a container's scroll, and a value derived from it paints in the frame
//   of the scroll.
// - SL2: a target's progress through Motion's offsets (`@wardic/dom/ScrollOffset`), on its axis.
// - SL3: a container given as an accessor: 0s until its ref is there, then its scroll; a new element
//   follows the new one.
// - SL4: createVelocity: 0 at rest, the value's change a second while it moves, and 0 once it stops.
// - SL5: createTime: milliseconds of frames, ending with its owner.
// - SL6: createScroll brings the `scroll` Feature (#518): a provider given none reads the Environment's
//   own `ScrollSource` when it gives one.
// - OU1: onUpdate is called once a frame Wardic changed the element's values, with every one of them
//   before they're drawn, in one object reused; not on a frame that changed nothing.
// - OU2: createWard's `onUpdate` too, read when it's called.
import { render } from "@solidjs/testing-library"
import * as ScrollSource from "@wardic/core/ScrollSource"
import { DomLive } from "@wardic/dom"
import * as ScrollOffset from "@wardic/dom/ScrollOffset"
import { createScroll, createTime, createTransform, createVelocity, createWard, wardic, WardicProvider } from "@wardic/solid"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Atom } from "effect/reactivity"
import { type Accessor, createRoot, createSignal } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { afterPaint, raf } from "./browser-helpers.ts"
import { resetScene, settle, wait } from "./reorder-harness.tsx"

afterEach(resetScene)

/** A 200 × 100 scroll box over a 1000px column, an 80px-tall target at 400px down it. */
const Box = (props: { readonly box: (el: HTMLDivElement) => void; readonly target?: (el: HTMLDivElement) => void }) => (
  <div ref={props.box} style={{ position: "relative", width: "200px", height: "100px", overflow: "auto" }}>
    <div style={{ position: "relative", height: "1000px" }}>
      <div ref={props.target} style={{ position: "absolute", top: "400px", width: "50px", height: "80px" }} />
    </div>
  </div>
)

/** Scroll `box` to `top` from a task, as a wheel would, and fire its event. */
const scrollTo = (box: HTMLElement, top: number): void => {
  box.scrollTop = top
  box.dispatchEvent(new Event("scroll"))
}

describe("createScroll (#234)", () => {
  it("SL1: follows a container's scroll, and a value derived from it paints in the frame of the scroll", async () => {
    let box!: HTMLDivElement
    let bar!: HTMLDivElement
    let progress!: Accessor<number>
    const Scene = () => {
      const { scrollY, scrollYProgress } = createScroll({ container: () => box })
      progress = scrollYProgress
      const opacity = createTransform(scrollYProgress, [0, 1], [0.2, 1])
      void scrollY
      return (
        <>
          <Box box={(el) => (box = el)} />
          <wardic.div ref={bar} style={{ width: "10px", height: "10px", opacity }} />
        </>
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    scrollTo(box, 450)
    expect(progress(), "set inside the event").toBe(0.5)
    await afterPaint()
    expect(Number(bar.style.opacity)).toBeCloseTo(0.6, 6)
  })

  it("SL2: a target's progress through Motion's offsets, on its axis", async () => {
    let box!: HTMLDivElement
    let target!: HTMLDivElement
    let through!: Accessor<number>
    let enter!: Accessor<number>
    const Scene = () => {
      through = createScroll({ container: () => box, target: () => target, offset: ["start end", "end start"] }).scrollYProgress
      enter = createScroll({ container: () => box, target: () => target, offset: ScrollOffset.Enter }).scrollYProgress
      return <Box box={(el) => (box = el)} target={(el) => (target = el)} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    // "start end" → "end start": 300 → 480; Enter: 300 → 380.
    scrollTo(box, 390)
    expect(through()).toBeCloseTo(0.5, 9)
    expect(enter()).toBe(1)
    scrollTo(box, 340)
    expect(enter()).toBeCloseTo(0.5, 9)
  })

  it("SL3: a container accessor: 0s until its ref is there, then its scroll, and a new element's", async () => {
    const [shown, setShown] = createSignal<HTMLDivElement | undefined>(undefined)
    let first!: HTMLDivElement
    let second!: HTMLDivElement
    let y!: Accessor<number>
    const Scene = () => {
      y = createScroll({ container: shown }).scrollY
      return (
        <>
          <Box box={(el) => (first = el)} />
          <Box box={(el) => (second = el)} />
        </>
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    first.scrollTop = 120
    second.scrollTop = 30
    expect(y(), "no ref yet").toBe(0)
    setShown(first)
    expect(y()).toBe(120)
    setShown(second)
    expect(y()).toBe(30)
    scrollTo(first, 200)
    expect(y(), "the old container is let go").toBe(30)
  })

  it("SL6: brings the scroll Feature, the Environment's own ScrollSource when it gives one", async () => {
    const given: ScrollSource.Scroll = { x: { current: 5, length: 50, progress: 0.1 }, y: { current: 42, length: 100, progress: 0.42 } }
    const env = Layer.mergeAll(DomLive, Layer.succeed(ScrollSource.ScrollSource, { scroll: () => Effect.succeed(Atom.make(given)) }))
    let values!: ReturnType<typeof createScroll>
    const Scene = () => {
      values = createScroll()
      return <div />
    }
    render(() => (
      <WardicProvider env={env}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    expect([values.scrollX(), values.scrollY(), values.scrollXProgress(), values.scrollYProgress()]).toEqual([5, 42, 0.1, 0.42])
  })
})

describe("createVelocity and createTime (#234)", () => {
  it("SL4: velocity: 0 at rest, the change a second while it moves, 0 once it stops", async () => {
    const [x, setX] = createSignal(0)
    let v!: Accessor<number>
    const Scene = () => {
      v = createVelocity(x)
      return null
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    expect(v()).toBe(0)
    const seen: Array<number> = []
    for (let i = 1; i <= 10; i++) {
      setX(i * 10)
      await raf()
      seen.push(v())
    }
    // 10 a frame, at about 60 frames a second: hundreds a second, every frame it moves.
    expect(seen.slice(2).every((s) => s > 200 && s < 2000), `velocities ${seen.join(" ")}`).toBe(true)
    await settle()
    expect(v()).toBe(0)
  })

  it("SL5: time: milliseconds of frames, ending with its owner", async () => {
    let time!: Accessor<number>
    const dispose = createRoot((dispose) => {
      render(() => (
        <WardicProvider env={DomLive}>
          {(() => {
            time = createTime()
            return null
          })()}
        </WardicProvider>
      ))
      return dispose
    })
    await raf()
    const t0 = performance.now()
    const start = time()
    await wait(300)
    const elapsed = time() - start
    expect(elapsed).toBeGreaterThan(200)
    expect(elapsed).toBeLessThan(performance.now() - t0 + 40)
    dispose()
  })
})

describe("onUpdate (#233)", () => {
  it("OU1: once a frame that changed the element's values, with all of them before they're drawn, in one object reused", async () => {
    const calls: Array<{ readonly at: number; readonly latest: Readonly<Record<string, number | string>>; readonly copy: Record<string, number | string> }> = []
    let frame = 0
    const counting = (): void => {
      frame++
      requestAnimationFrame(counting)
    }
    requestAnimationFrame(counting)
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          initial={{ x: 0, opacity: 1 }}
          animate={{ x: 100, opacity: 0.5 }}
          transition={{ type: "tween", duration: 0.2 }}
          onUpdate={(latest) => void calls.push({ at: frame, latest, copy: { ...latest } })}
        />
      </WardicProvider>
    ))
    await wait(500)
    const n = calls.length
    expect(n).toBeGreaterThan(5)
    expect(new Set(calls.map((c) => c.at)).size, "once a frame").toBe(n)
    expect(new Set(calls.map((c) => c.latest)).size, "one object, reused").toBe(1)
    expect(calls[n - 1]!.copy).toEqual({ x: 100, opacity: 0.5 })
    expect(typeof calls[1]!.copy["x"], "before it's drawn: a number, not a transform").toBe("number")
    await settle()
    expect(calls.length, "nothing changed: no call").toBe(n)
  })

  it("OU2: createWard's onUpdate too, read when it's called", async () => {
    const heard: Array<string> = []
    // Two functions: the config hands over the second after the change, and only it should be called.
    const handlers = { first: () => void heard.push("first"), second: () => void heard.push("second") } as const
    const [which, setWhich] = createSignal<keyof typeof handlers>("first")
    const [to, setTo] = createSignal(0)
    const Scene = () => {
      const ward = createWard(() => ({
        animate: { x: to() },
        transition: { type: "tween", duration: 0.05 },
        onUpdate: handlers[which()],
      }))
      return <div {...ward()} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    heard.length = 0
    setWhich("second")
    setTo(40)
    await wait(200)
    expect(heard.length).toBeGreaterThan(0)
    expect(new Set(heard)).toEqual(new Set(["second"]))
  })
})
