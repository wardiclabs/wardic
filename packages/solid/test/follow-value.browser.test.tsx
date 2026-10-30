// `createFollowValue`, and `createSpring` as its spring case, on Solid 1 (#441, Motion's `useFollowValue`
// and `useSpring`), into `style`. Core's FV1–FV7 pin the numbers against Motion's; these, the binding.
//
// - FW1: a tween follow moves `style` over its duration, and lands.
// - FW2: a source with a unit (`"10px"`) is followed as its number and shown with that unit; `jump`
//   takes a string, mid-flight too; a later unit is read as the first one, as Motion's.
// - FW3: `createSpring` with no physics bounces as Motion's `useSpring` (100 / 10 / 1): it passes its
//   target, then rests on it.
// - FW4: a `delay` holds it while the source keeps changing; once the source rests, it moves.
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { createFollowValue, createSpring, type FollowAccessor, wardic, WardicProvider } from "@wardic/solid"
import { createSignal } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { BOX, translateXOf } from "./base-values-harness.ts"
import { raf, until } from "./browser-helpers.ts"
import { resetScene, sampleFrames, settle } from "./reorder-harness.tsx"

afterEach(resetScene)

/** Call `set` with the milliseconds since it started, each frame, for `ms`. */
const everyFrameFor = (ms: number, set: (elapsed: number) => void): Promise<void> =>
  new Promise((resolve) => {
    const start = performance.now()
    const tick = (): void => {
      const elapsed = performance.now() - start
      set(elapsed)
      if (elapsed < ms) {
        requestAnimationFrame(tick)
        return
      }
      resolve()
    }
    requestAnimationFrame(tick)
  })

describe("createFollowValue and createSpring on Solid 1 (#441)", () => {
  it("FW1: a tween follow moves style over its duration, and lands", async () => {
    let el!: HTMLDivElement
    let eased!: FollowAccessor<number>
    const [x, setX] = createSignal(0)
    const Box = () => {
      eased = createFollowValue(x, { type: "tween", duration: 0.4, ease: "linear" })
      return <wardic.div ref={el} style={{ ...BOX, x: eased }} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await settle()
    const frames = sampleFrames(() => translateXOf(el))
    const start = performance.now()
    setX(100)
    await until(() => eased() === 100, 3000)
    const took = performance.now() - start
    await settle()
    const painted = frames.stop().map((f) => f.v)
    expect(painted.filter((v) => v > 1 && v < 99).length, "it moves there over frames").toBeGreaterThan(10)
    expect(took, "over its 0.4 s").toBeGreaterThan(350)
    expect(el.style.transform).toBe("translateX(100px)")
  })

  it("FW2: a unit string is followed as its number and shown with its unit; jump takes a string; a later unit reads as the first", async () => {
    let el!: HTMLDivElement
    let width!: FollowAccessor<string>
    const [w, setW] = createSignal("10px")
    const Box = () => {
      width = createFollowValue(w, { type: "tween", duration: 0.2 })
      return <wardic.div ref={el} style={{ ...BOX, width }} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await settle()
    expect(el.style.width).toBe("10px")
    const frames = sampleFrames(() => el.style.width)
    setW("110px")
    await until(() => width() === "110px", 3000)
    await settle()
    const between = frames.stop().filter((f) => /^[\d.]+px$/.test(f.v) && Number.parseFloat(f.v) > 11 && Number.parseFloat(f.v) < 109)
    expect(between.length, "through px values").toBeGreaterThan(3)
    expect(el.style.width).toBe("110px")
    // A jump mid-flight ends the run where it's set, and it rests there until the source changes.
    setW("210px")
    for (let i = 0; i < 3; i++) await raf()
    width.jump("40px")
    await settle()
    await settle()
    expect([width(), el.style.width], "a jump mid-flight, at once, and it stays").toEqual(["40px", "40px"])
    setW("2em")
    await until(() => width() === "2px", 3000)
    await settle()
    expect(el.style.width, "Motion's: the unit it started with").toBe("2px")
  })

  it("FW3: createSpring with no physics bounces as Motion's useSpring: past its target, then at rest on it", async () => {
    let el!: HTMLDivElement
    let spring!: FollowAccessor<number>
    const [x, setX] = createSignal(0)
    const Box = () => {
      spring = createSpring(x)
      return <wardic.div ref={el} style={{ ...BOX, x: spring }} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await settle()
    const frames = sampleFrames(() => translateXOf(el))
    setX(100)
    // Motion's comes to rest within 0.001 after about 2.3 s.
    await until(() => spring() === 100, 5000)
    await settle()
    const painted = frames.stop().map((f) => f.v)
    expect(Math.max(...painted), "past 100, as Motion's peaks at 116").toBeGreaterThan(110)
    expect(el.style.transform).toBe("translateX(100px)")
  })

  it("FW4: a delay holds it while its source keeps changing; once the source rests, it moves there", async () => {
    let el!: HTMLDivElement
    let held!: FollowAccessor<number>
    const [x, setX] = createSignal(0)
    const Box = () => {
      held = createFollowValue(x, { type: "tween", duration: 0.1, delay: 0.15 })
      return <wardic.div ref={el} style={{ ...BOX, x: held }} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await settle()
    const frames = sampleFrames(() => translateXOf(el))
    // A change every frame for 0.4 s: longer than the delay, never still for it.
    await everyFrameFor(400, (ms) => setX(Math.round(ms / 4)))
    const whileChanging = frames.stop().map((f) => f.v)
    expect(whileChanging.every((v) => v === 0), "held where it was").toBe(true)
    await until(() => held() === x(), 3000)
    await settle()
    expect(translateXOf(el), "then it went there").toBe(x())
  })
})
