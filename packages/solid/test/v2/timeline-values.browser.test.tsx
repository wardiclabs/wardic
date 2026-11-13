// Timeline values in Solid 2 (#240, ADR-0043 *Amendment (#240)*): a `style` key whose Live value derives
// from a container's scroll by ranges alone runs on the box's native scroll timeline while the key shows
// it, the gate still writing it inline under the animation. Chromium.
//
// - TL1: `createTransform(scrollYProgress, input, output)` on `opacity`, and on `scaleX`, each runs one
//   animation on the box's ScrollTimeline, drawing Wardic's value; made before the scroll's own values.
// - TL2: a container accessor: none until its ref is there, then on its timeline, and a new element's,
//   though it's scrolled as far, so its value doesn't change; none once the ref's gone, its value held.
// - TL3: an `animate` entry on the key cancels it in the flush that writes the entry's first value, and
//   it runs again once the key is back at its Live value.
// - TL4: the function form, `createTransform(scrollYProgress, (p) => p)`, runs none: the gate draws it.
// - TL5: without `ScrollTimeline`, none: the gate draws it.
// - TL6: the key gone from the `style` stops it; back, it runs again.
// - TL7: an Imperative animation of the key stops it while it draws the key.
// - TL8: the key's source swapped for another scroll value's runs the new one.
import { DomLive } from "@wardic/dom"
import { createAnimate, createScroll, createTransform, wardic, type WardicAnimate, WardicProvider } from "@wardic/solid/unstable/v2"
import { createSignal, flush } from "solid-js"
import { describe, expect, it } from "vitest"
import { afterPaint, raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await raf()
  await afterPaint()
}

/** A 200 × 100 scroll box over a 1000px column: 900px of scroll. */
const Box = (props: { readonly box: (el: HTMLDivElement) => void }) => (
  <div ref={props.box} style={{ width: "200px", height: "100px", overflow: "auto" }}>
    <div style={{ height: "1000px" }} />
  </div>
)

/** Scroll `box` to `top` from a task, as a wheel would, and fire its event. */
const scrollTo = (box: HTMLElement, top: number): void => {
  box.scrollTop = top
  box.dispatchEvent(new Event("scroll"))
}

/** `el`'s animations, once each has started. */
const runningOn = async (el: Element): Promise<ReadonlyArray<Animation>> => {
  await Promise.all(el.getAnimations().map((a) => a.ready))
  return el.getAnimations()
}

/** The ScrollTimeline `el`'s one animation runs on, and its source. */
const sourceOf = async (el: Element): Promise<Element | null> => {
  const animations = await runningOn(el)
  expect(animations, "one animation").toHaveLength(1)
  const timeline = (animations[0] as Animation).timeline
  expect(timeline).toBeInstanceOf(ScrollTimeline)
  return (timeline as ScrollTimeline).source
}

const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)

describe("Timeline values in Solid 2 (#240)", () => {
  it("TL1: a range transform of a progress, on opacity and on scaleX, each runs on the box's ScrollTimeline, drawing Wardic's value", async () => {
    let box!: HTMLDivElement
    let fade!: HTMLDivElement
    let bar!: HTMLDivElement
    const Scene = () => {
      const { scrollYProgress } = createScroll({ container: () => box })
      const opacity = createTransform(scrollYProgress, [0, 1], [0.2, 1])
      const scaleX = createTransform(scrollYProgress, [0, 1], [0, 1])
      const barStyle = { width: "100px", height: "10px", "transform-origin": "0 0", scaleX }
      return (
        <>
          <Box box={(el) => (box = el)} />
          <wardic.div ref={(n: HTMLElement) => (fade = n as HTMLDivElement)} style={{ width: "10px", height: "10px", opacity }} />
          <wardic.div ref={(n: HTMLElement) => (bar = n as HTMLDivElement)} style={barStyle} />
        </>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    expect(await sourceOf(fade)).toBe(box)
    expect(await sourceOf(bar)).toBe(box)
    scrollTo(box, 450)
    await settle()
    expect(opacityOf(fade)).toBeCloseTo(0.6, 3)
    expect(Number(fade.style.opacity), "written under it").toBeCloseTo(0.6, 6)
    expect(bar.getBoundingClientRect().width).toBeCloseTo(50, 1)
  })

  it("TL2: a container accessor: none until its ref is there, then on its timeline, and a new element's, its value the same", async () => {
    const [shown, setShown] = createSignal<HTMLDivElement | undefined>(undefined)
    let first!: HTMLDivElement
    let second!: HTMLDivElement
    let fade!: HTMLDivElement
    const Scene = () => {
      const { scrollYProgress } = createScroll({ container: shown })
      const opacity = createTransform(scrollYProgress, [0, 1], [0.2, 1])
      return (
        <>
          <Box box={(el) => (first = el)} />
          <Box box={(el) => (second = el)} />
          <wardic.div ref={(n: HTMLElement) => (fade = n as HTMLDivElement)} style={{ width: "10px", height: "10px", opacity }} />
        </>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    first.scrollTop = 450
    second.scrollTop = 450
    await settle()
    expect(await runningOn(fade), "no ref yet").toHaveLength(0)
    setShown(first)
    flush()
    await settle()
    expect(await sourceOf(fade)).toBe(first)
    expect(opacityOf(fade)).toBeCloseTo(0.6, 3)
    setShown(second)
    flush()
    await settle()
    expect(await sourceOf(fade), "the new one's").toBe(second)
    expect(opacityOf(fade)).toBeCloseTo(0.6, 3)
    setShown(undefined)
    flush()
    await settle()
    expect(await runningOn(fade), "the ref gone").toHaveLength(0)
    expect(opacityOf(fade), "held").toBeCloseTo(0.6, 3)
  })

  it("TL3: an animate entry on the key cancels it in the flush that writes the entry's first value; back at its Live value, it runs again", async () => {
    let box!: HTMLDivElement
    let fade!: HTMLDivElement
    const [animate, setAnimate] = createSignal<{ readonly opacity?: number }>({})
    const Scene = () => {
      const { scrollYProgress } = createScroll({ container: () => box })
      const opacity = createTransform(scrollYProgress, [0, 1], [0.2, 1])
      return (
        <>
          <Box box={(el) => (box = el)} />
          <wardic.div ref={(n: HTMLElement) => (fade = n as HTMLDivElement)} animate={animate()} transition={{ duration: 0.2, ease: "linear" }} style={{ width: "10px", height: "10px", opacity }} />
        </>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    scrollTo(box, 450)
    await settle()
    expect(await runningOn(fade)).toHaveLength(1)
    setAnimate({ opacity: 0.1 })
    flush()
    expect(fade.getAnimations(), "not before the flush").toHaveLength(1)
    await raf()
    expect(fade.getAnimations(), "cancelled at the flush").toHaveLength(0)
    const first = Number(fade.style.opacity)
    expect(first, "the entry's first value, drawn inline").toBeLessThanOrEqual(0.6)
    expect(opacityOf(fade)).toBeCloseTo(first, 6)
    await wait(300)
    expect(opacityOf(fade)).toBeCloseTo(0.1, 6)
    // The entry holds the key while the scroll moves.
    scrollTo(box, 900)
    await settle()
    expect(fade.getAnimations()).toHaveLength(0)
    expect(opacityOf(fade)).toBeCloseTo(0.1, 6)
    setAnimate({})
    flush()
    await wait(300)
    await settle()
    expect(await sourceOf(fade), "its Live value's again").toBe(box)
    expect(opacityOf(fade)).toBeCloseTo(1, 3)
  })

  it("TL4: the function form runs none, and the gate draws it", async () => {
    let box!: HTMLDivElement
    let fade!: HTMLDivElement
    const Scene = () => {
      const { scrollYProgress } = createScroll({ container: () => box })
      const opacity = createTransform(scrollYProgress, (p) => 0.2 + p * 0.8)
      return (
        <>
          <Box box={(el) => (box = el)} />
          <wardic.div ref={(n: HTMLElement) => (fade = n as HTMLDivElement)} style={{ width: "10px", height: "10px", opacity }} />
        </>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    scrollTo(box, 450)
    await settle()
    expect(await runningOn(fade)).toHaveLength(0)
    expect(opacityOf(fade)).toBeCloseTo(0.6, 6)
  })

  it("TL5: without ScrollTimeline, none, and the gate draws it", async () => {
    const own = { ScrollTimeline: globalThis.ScrollTimeline, ViewTimeline: globalThis.ViewTimeline }
    Reflect.deleteProperty(globalThis, "ScrollTimeline")
    Reflect.deleteProperty(globalThis, "ViewTimeline")
    try {
      let box!: HTMLDivElement
      let fade!: HTMLDivElement
      const Scene = () => {
        const { scrollYProgress } = createScroll({ container: () => box })
        const opacity = createTransform(scrollYProgress, [0, 1], [0.2, 1])
        return (
          <>
            <Box box={(el) => (box = el)} />
            <wardic.div ref={(n: HTMLElement) => (fade = n as HTMLDivElement)} style={{ width: "10px", height: "10px", opacity }} />
          </>
        )
      }
      mount(() => (
        <WardicProvider env={DomLive}>
          <Scene />
        </WardicProvider>
      ))
      await settle()
      scrollTo(box, 450)
      await settle()
      expect(await runningOn(fade)).toHaveLength(0)
      expect(opacityOf(fade)).toBeCloseTo(0.6, 6)
    } finally {
      Object.assign(globalThis, own)
    }
  })

  it("TL6: the key gone from the style stops it; back, it runs again", async () => {
    let box!: HTMLDivElement
    let fade!: HTMLDivElement
    const [which, setWhich] = createSignal<"faded" | "plain">("faded")
    const Scene = () => {
      const { scrollYProgress } = createScroll({ container: () => box })
      const opacity = createTransform(scrollYProgress, [0, 1], [0.2, 1])
      const styles = { faded: { width: "10px", height: "10px", opacity }, plain: { width: "10px", height: "10px" } }
      return (
        <>
          <Box box={(el) => (box = el)} />
          <wardic.div ref={(n: HTMLElement) => (fade = n as HTMLDivElement)} style={styles[which()]} />
        </>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    scrollTo(box, 450)
    await settle()
    expect(await sourceOf(fade)).toBe(box)
    setWhich("plain")
    flush()
    await settle()
    expect(await runningOn(fade), "gone").toHaveLength(0)
    expect(opacityOf(fade)).toBe(1)
    setWhich("faded")
    flush()
    await settle()
    expect(await sourceOf(fade), "back").toBe(box)
    expect(opacityOf(fade)).toBeCloseTo(0.6, 3)
  })

  it("TL7: an Imperative animation of the key stops it while it draws the key", async () => {
    let box!: HTMLDivElement
    let fade!: HTMLDivElement
    let animate!: WardicAnimate
    const Scene = () => {
      const [scope, animateIn] = createAnimate()
      animate = animateIn
      const { scrollYProgress } = createScroll({ container: () => box })
      const opacity = createTransform(scrollYProgress, [0, 1], [0.2, 1])
      return (
        <div ref={scope}>
          <Box box={(el) => (box = el)} />
          <wardic.div ref={(n: HTMLElement) => (fade = n as HTMLDivElement)} style={{ width: "10px", height: "10px", opacity }} />
        </div>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    scrollTo(box, 450)
    await settle()
    expect(await sourceOf(fade)).toBe(box)
    const run = animate(fade, { opacity: 0.1 }, { duration: 0.2, ease: "linear" })
    await raf()
    expect(fade.getAnimations(), "taken at the flush").toHaveLength(0)
    await run
    expect(opacityOf(fade)).toBeCloseTo(0.1, 6)
  })

  it("TL8: the key's source swapped for another scroll value's runs the new one", async () => {
    let box!: HTMLDivElement
    let fade!: HTMLDivElement
    const [which, setWhich] = createSignal<"rising" | "low">("rising")
    const Scene = () => {
      const { scrollYProgress } = createScroll({ container: () => box })
      const styles = {
        rising: { width: "10px", height: "10px", opacity: createTransform(scrollYProgress, [0, 1], [0.2, 1]) },
        low: { width: "10px", height: "10px", opacity: createTransform(scrollYProgress, [0, 1], [0, 0.4]) },
      }
      return (
        <>
          <Box box={(el) => (box = el)} />
          <wardic.div ref={(n: HTMLElement) => (fade = n as HTMLDivElement)} style={styles[which()]} />
        </>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    scrollTo(box, 450)
    await settle()
    expect(opacityOf(fade)).toBeCloseTo(0.6, 3)
    setWhich("low")
    flush()
    await settle()
    expect(await sourceOf(fade)).toBe(box)
    expect(opacityOf(fade), "the new one's").toBeCloseTo(0.2, 3)
  })
})
