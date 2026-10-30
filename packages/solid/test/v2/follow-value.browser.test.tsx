// `createFollowValue`, and `createSpring` as its spring case, on Solid 2 (#441): Solid 1's FW1–FW3.
//
// - FWV1: a tween follow moves `style` over its duration, and lands.
// - FWV2: a source with a unit (`"10px"`) is followed as its number and shown with that unit; `jump`
//   takes a string, mid-flight too; a later unit is read as the first one, as Motion's.
// - FWV3: `createSpring` with no physics bounces as Motion's `useSpring`: it passes its target, then
//   rests on it.
import { DomLive } from "@wardic/dom"
import { createFollowValue, createSpring, type FollowAccessor, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { createSignal, flush } from "solid-js"
import { describe, expect, it } from "vitest"
import { afterPaint, raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await raf()
  await afterPaint()
}
const BOX = { width: "40px", height: "40px" } as const

/** The painted translateX: the computed matrix's e, 0 for none. */
const translateXOf = (el: Element): number => {
  const t = getComputedStyle(el).transform
  if (t === "" || t === "none") return 0
  return Number(/\(([^)]+)\)/.exec(t)![1]!.split(",")[4])
}

/** Read `read()` just after each painted frame, until stopped. */
const sampleFrames = <T,>(read: () => T): { readonly stop: () => ReadonlyArray<T> } => {
  const frames: Array<T> = []
  const channel = new MessageChannel()
  let on = true
  const post = (): void => channel.port2.postMessage(undefined)
  channel.port1.onmessage = () => {
    frames.push(read())
    if (on) requestAnimationFrame(post)
  }
  requestAnimationFrame(post)
  return {
    stop: () => {
      on = false
      channel.port1.close()
      return frames
    },
  }
}

describe("createFollowValue and createSpring on Solid 2 (#441)", () => {
  it("FWV1: a tween follow moves style over its duration, and lands", async () => {
    let el!: HTMLElement
    let eased!: FollowAccessor<number>
    const [x, setX] = createSignal(0)
    const Box = () => {
      eased = createFollowValue(x, { type: "tween", duration: 0.4, ease: "linear" })
      return <wardic.div ref={(n: HTMLElement) => (el = n)} style={{ ...BOX, x: eased }} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await settle()
    const frames = sampleFrames(() => translateXOf(el))
    const start = performance.now()
    setX(100)
    flush()
    await until(() => eased() === 100, 3000)
    const took = performance.now() - start
    await settle()
    const painted = frames.stop()
    expect(painted.filter((v) => v > 1 && v < 99).length, "it moves there over frames").toBeGreaterThan(10)
    expect(took, "over its 0.4 s").toBeGreaterThan(350)
    expect(el.style.transform).toBe("translateX(100px)")
  })

  it("FWV2: a unit string is followed as its number and shown with its unit; jump takes a string; a later unit reads as the first", async () => {
    let el!: HTMLElement
    let width!: FollowAccessor<string>
    const [w, setW] = createSignal("10px")
    const Box = () => {
      width = createFollowValue(w, { type: "tween", duration: 0.2 })
      return <wardic.div ref={(n: HTMLElement) => (el = n)} style={{ ...BOX, width }} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await settle()
    expect(el.style.width).toBe("10px")
    const frames = sampleFrames(() => el.style.width)
    setW("110px")
    flush()
    await until(() => width() === "110px", 3000)
    await settle()
    const between = frames.stop().filter((v) => /^[\d.]+px$/.test(v) && Number.parseFloat(v) > 11 && Number.parseFloat(v) < 109)
    expect(between.length, "through px values").toBeGreaterThan(3)
    expect(el.style.width).toBe("110px")
    // A jump mid-flight ends the run where it's set, and it rests there until the source changes.
    setW("210px")
    flush()
    for (let i = 0; i < 3; i++) await raf()
    width.jump("40px")
    await settle()
    await settle()
    expect([width(), el.style.width], "a jump mid-flight, at once, and it stays").toEqual(["40px", "40px"])
    setW("2em")
    flush()
    await until(() => width() === "2px", 3000)
    await settle()
    expect(el.style.width, "Motion's: the unit it started with").toBe("2px")
  })

  it("FWV3: createSpring with no physics bounces as Motion's useSpring: past its target, then at rest on it", async () => {
    let el!: HTMLElement
    let spring!: FollowAccessor<number>
    const [x, setX] = createSignal(0)
    const Box = () => {
      spring = createSpring(x)
      return <wardic.div ref={(n: HTMLElement) => (el = n)} style={{ ...BOX, x: spring }} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await settle()
    const frames = sampleFrames(() => translateXOf(el))
    setX(100)
    flush()
    // Motion's comes to rest within 0.001 after about 2.3 s.
    await until(() => spring() === 100, 5000)
    await settle()
    expect(Math.max(...frames.stop()), "past 100, as Motion's peaks at 116").toBeGreaterThan(110)
    expect(el.style.transform).toBe("translateX(100px)")
  })
})
