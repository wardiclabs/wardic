// `ward.with({ ref, style })` on Solid 2 (#264, the Solid 1 ward's `ward({ ref, style })`): the
// element's own ref and style, given where the ward is spread, so a style can be derived from the
// ward's own value. Real frames.
//
// - WW1: Motion's swipe card: an opacity derived from the ward's own `read("x")`, given through
//   `.with`, paints in the ward's frame (followed as a Live value in the config is).
// - WW2: `.with`'s style goes over the config's, key by key: the config's other keys stay.
// - WW3: `.with({ ref })` is called with the element beside the ward's own, which still animates.
// - WW4: a reactive `.with` style follows its signal: the spread runs `.with` again, and its latest
//   props are the element's.
// - WW5: a key `.with` sets is where an animation returns to (ADR-0022) and what `read(key)` rests at.
import { DomLive } from "@wardic/dom"
import { createTransform, ward, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { createSignal, flush } from "solid-js"
import { describe, expect, it } from "vitest"
import { afterPaint, raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await raf()
  await afterPaint()
}

/** The painted translateX: the computed matrix's e, 0 for none. */
const translateXOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform).m41
const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)

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

const BOX = { width: "40px", height: "40px" } as const

describe("ward.with({ ref, style }) on Solid 2 (#264)", () => {
  it("WW1: Motion's swipe card: an opacity derived from the ward's own x, given through .with, paints in its frame", async () => {
    let card!: HTMLElement
    const [to, setTo] = createSignal(0)
    const Scene = () => {
      const swipe = ward({ animate: () => ({ x: to() }), transition: { type: "tween", duration: 0.5 }, style: BOX })
      const opacity = createTransform(swipe.read("x"), [-150, 0, 150], [0, 1, 0])
      return <div {...swipe.with({ ref: (n: HTMLElement) => (card = n), style: { opacity } })} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    expect(opacityOf(card), "at rest at x 0").toBe(1)
    const frames = sampleFrames(() => ({ x: translateXOf(card), opacity: opacityOf(card) }))
    setTo(150)
    flush()
    await wait(700)
    const painted = frames.stop()
    const moving = painted.filter((f) => f.x > 1 && f.x < 149)
    expect(moving.length, "frames mid-flight").toBeGreaterThan(5)
    for (const f of moving) expect(f.opacity, `opacity in the card's frame (x at ${f.x})`).toBeCloseTo(1 - f.x / 150, 3)
    expect(painted.at(-1)).toEqual({ x: 150, opacity: 0 })
  })

  it("WW2: .with's style goes over the config's, key by key", async () => {
    let el!: HTMLElement
    const Card = () => {
      const card = ward({ style: { ...BOX, opacity: 0.3, "background-color": "rgb(0, 0, 255)" } })
      return <div {...card.with({ ref: (n: HTMLElement) => (el = n), style: { opacity: 0.8 } })} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    await settle()
    expect(opacityOf(el), ".with's").toBeCloseTo(0.8, 5)
    expect(el.getBoundingClientRect().width, "the config's width").toBe(40)
    expect(getComputedStyle(el).backgroundColor, "the config's colour").toBe("rgb(0, 0, 255)")
  })

  it("WW3: .with({ ref }) is called with the element beside the ward's own, which still animates", async () => {
    let mine: HTMLElement | undefined
    let el!: HTMLElement
    const Card = () => {
      const card = ward({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { type: "tween", duration: 0.1 }, style: BOX })
      return (
        <div
          data-k="card"
          {...card.with({
            ref: [(n: HTMLElement) => (mine = n), (n: HTMLElement) => (el = n)],
          })}
        />
      )
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    const node = host.querySelector<HTMLElement>("[data-k=card]")!
    expect(mine, "the user's ref").toBe(node)
    expect(el, "every ref in a list").toBe(node)
    await until(() => opacityOf(node) > 0.99, 2000)
    expect(opacityOf(node), "the ward's own ref drove it").toBeGreaterThan(0.99)
  })

  it("WW4: a reactive .with style follows its signal", async () => {
    let el!: HTMLElement
    const [left, setLeft] = createSignal(10)
    const Card = () => {
      const card = ward({ style: { ...BOX, position: "relative" } })
      return <div {...card.with({ ref: (n: HTMLElement) => (el = n), style: { left: `${left()}px` } })} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    await settle()
    expect(el.style.left).toBe("10px")
    expect(el.style.position, "the config's").toBe("relative")
    setLeft(30)
    flush()
    await settle()
    expect(el.style.left, "its latest props").toBe("30px")
    expect(el.style.position, "the config's still").toBe("relative")
  })

  it("WW5: a key .with sets is where an animation returns to, and what read(key) rests at", async () => {
    let el!: HTMLElement
    let read!: () => unknown
    const [on, setOn] = createSignal(true)
    const Card = () => {
      const card = ward({ animate: () => Bool.match(on(), { onTrue: () => ({ opacity: 1 }), onFalse: () => ({}) }), transition: { type: "tween", duration: 0.1 }, style: BOX })
      read = card.read("opacity")
      return <div {...card.with({ ref: (n: HTMLElement) => (el = n), style: { opacity: 0.4 } })} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    await until(() => opacityOf(el) > 0.99, 2000)
    expect(opacityOf(el), "animated to 1").toBeGreaterThan(0.99)
    setOn(false)
    flush()
    await until(() => Math.abs(opacityOf(el) - 0.4) < 0.01, 2000)
    expect(opacityOf(el), "back to .with's 0.4").toBeCloseTo(0.4, 2)
    await settle()
    expect(read(), "read rests at .with's").toBe(0.4)
  })
})
