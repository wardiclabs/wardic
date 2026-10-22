// `whileInView`, `viewport` and the viewport callbacks, and `whileFocus`, on Solid 1 (#273, ADR-0047):
// both layers were accepted, typed and dropped; now they apply, in Motion's order. Real scrolling, a
// real mouse and a real keyboard.
//
// - IV1: `whileInView` applies once the element scrolls into view, and leaves as it scrolls out.
// - IV2: `onViewportEnter` / `onViewportLeave` with the browser's own entry; one that starts out of view
//   tells nothing until it enters.
// - IV3: `viewport.once`: in view from its first entry on, and no leave told.
// - IV4: `viewport.amount: "all"`: half in view isn't in, where `"some"` (the default) is.
// - IV5: `viewport.root` and `margin`: in view of a scrolling container's box grown by its margin,
//   where the page's view, clipped by the container, has it out.
// - IV6: the layers' order: `whileHover` over `whileInView`.
// - FC1: `whileFocus` at a keyboard's focus, not a pointer's click; over `whileInView`.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid"
import { createSignal, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { commands } from "vitest/browser"
import "./browser-commands.ts"
import { raf, until } from "./browser-helpers.ts"
import { centreOf, mouse, settle } from "./reorder-harness.tsx"

afterEach(async () => {
  await mouse.move({ x: 5, y: 5 })
  cleanup()
  window.scrollTo(0, 0)
})

const FAST = { type: "tween", duration: 0.05 } as const
const BOX = { width: "120px", height: "200px", background: "teal" } as const

/** `content` under a 4000 px page, settled; its element. */
const mount = async (content: (ref: (n: HTMLElement) => void) => JSX.Element): Promise<HTMLElement> => {
  const [el, setEl] = createSignal<HTMLElement>()
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "relative", height: "4000px" }}>{content((n) => setEl(n))}</div>
    </WardicProvider>
  ))
  await settle()
  return el()!
}

const opacityOf = (el: HTMLElement): number => Number(el.style.opacity)

/** Wait for `el`'s opacity to land on `value`, then check it did. */
const landsAt = async (el: HTMLElement, value: number, what: string): Promise<void> => {
  await until(() => opacityOf(el) === value, 2000)
  expect(opacityOf(el), what).toBe(value)
}

/** Scroll the page so `top` (px down the page) sits `at` px down the window. */
const scrollToShow = (top: number, at: number): void => window.scrollTo(0, top - at)

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

describe("whileInView, viewport and whileFocus on Solid 1 (#273)", () => {
  it("IV1: whileInView applies once the element scrolls into view, and leaves as it scrolls out", async () => {
    const el = await mount((ref) => (
      <wardic.div ref={ref} initial={{ opacity: 0.2 }} animate={{ opacity: 0.2 }} whileInView={{ opacity: 1 }} transition={FAST} style={{ ...BOX, position: "absolute", top: "2000px" }} />
    ))
    await frames(5)
    expect(opacityOf(el), "out of view").toBe(0.2)
    scrollToShow(2000, 100)
    await landsAt(el, 1, "in view")
    window.scrollTo(0, 0)
    await landsAt(el, 0.2, "out again")
  })

  it("IV2: onViewportEnter / onViewportLeave with the browser's own entry; nothing until it first enters", async () => {
    const calls: Array<string> = []
    const told = (name: string) => (entry: IntersectionObserverEntry) => calls.push(`${name} ${entry.isIntersecting} ${entry instanceof IntersectionObserverEntry}`)
    await mount((ref) => <wardic.div ref={ref} onViewportEnter={told("enter")} onViewportLeave={told("leave")} style={{ ...BOX, position: "absolute", top: "2000px" }} />)
    await frames(5)
    expect(calls, "out of view at the start: nothing").toEqual([])
    scrollToShow(2000, 100)
    await until(() => calls.length > 0, 2000)
    window.scrollTo(0, 0)
    await until(() => calls.length > 1, 2000)
    expect(calls).toEqual(["enter true true", "leave false true"])
  })

  it("IV3: viewport.once: in view from its first entry on, and no leave told", async () => {
    const calls: Array<string> = []
    const el = await mount((ref) => (
      <wardic.div
        ref={ref}
        initial={{ opacity: 0.2 }}
        animate={{ opacity: 0.2 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        onViewportEnter={() => calls.push("enter")}
        onViewportLeave={() => calls.push("leave")}
        transition={FAST}
        style={{ ...BOX, position: "absolute", top: "2000px" }}
      />
    ))
    scrollToShow(2000, 100)
    await landsAt(el, 1, "in view")
    window.scrollTo(0, 0)
    await frames(15)
    expect(opacityOf(el), "stays").toBe(1)
    expect(calls).toEqual(["enter"])
  })

  it("IV4: viewport.amount \"all\": half in view isn't in, where \"some\" is", async () => {
    let some!: HTMLElement
    const all = await mount((ref) => (
      <>
        <wardic.div ref={ref} initial={{ opacity: 0.2 }} animate={{ opacity: 0.2 }} whileInView={{ opacity: 1 }} viewport={{ amount: "all" }} transition={FAST} style={{ ...BOX, position: "absolute", top: "2000px" }} />
        <wardic.div
          ref={(n: HTMLElement) => (some = n)}
          initial={{ opacity: 0.2 }}
          animate={{ opacity: 0.2 }}
          whileInView={{ opacity: 1 }}
          transition={FAST}
          style={{ ...BOX, position: "absolute", top: "2000px", left: "200px" }}
        />
      </>
    ))
    // The top half in view: 100 of its 200 px.
    scrollToShow(2000, window.innerHeight - 100)
    await landsAt(some, 1, "some of it")
    await frames(5)
    expect(opacityOf(all), "not all of it").toBe(0.2)
    scrollToShow(2000, window.innerHeight - 300)
    await landsAt(all, 1, "all of it")
  })

  it("IV5: viewport.root and margin: in view of a scrolling container's box grown by its margin", async () => {
    let container!: HTMLElement
    let pageView!: HTMLElement
    const rooted = await mount((ref) => (
      <div ref={(n: HTMLElement) => (container = n)} style={{ position: "absolute", top: "100px", height: "300px", width: "400px", overflow: "auto" }}>
        <div style={{ position: "relative", height: "1200px" }}>
          {/* 100 px below the container's visible bottom: within its 200 px margin. */}
          <wardic.div
            ref={ref}
            initial={{ opacity: 0.2 }}
            animate={{ opacity: 0.2 }}
            whileInView={{ opacity: 1 }}
            viewport={{ root: () => container, margin: "0px 0px 200px 0px" }}
            transition={FAST}
            style={{ ...BOX, position: "absolute", top: "400px" }}
          />
          <wardic.div
            ref={(n: HTMLElement) => (pageView = n)}
            initial={{ opacity: 0.2 }}
            animate={{ opacity: 0.2 }}
            whileInView={{ opacity: 1 }}
            viewport={{ margin: "0px 0px 200px 0px" }}
            transition={FAST}
            style={{ ...BOX, position: "absolute", top: "400px", left: "200px" }}
          />
        </div>
      </div>
    ))
    await landsAt(rooted, 1, "in its container's grown box")
    await frames(5)
    expect(opacityOf(pageView), "clipped by the container from the page's view").toBe(0.2)
  })

  it("IV6: the layers' order: whileHover over whileInView", async () => {
    const el = await mount((ref) => (
      <wardic.div
        ref={ref}
        initial={{ opacity: 0.2 }}
        animate={{ opacity: 0.2 }}
        whileInView={{ opacity: 0.5 }}
        whileHover={{ opacity: 1 }}
        transition={FAST}
        style={{ ...BOX, position: "absolute", top: "100px", left: "100px" }}
      />
    ))
    await landsAt(el, 0.5, "in view")
    await mouse.move(centreOf(el))
    await landsAt(el, 1, "hovered, over in view")
    await mouse.move({ x: 5, y: 5 })
    await landsAt(el, 0.5, "in view again")
  })

  it("FC1: whileFocus at a keyboard's focus, not a pointer's click; over whileInView", async () => {
    const el = await mount((ref) => (
      <wardic.button
        ref={ref}
        initial={{ opacity: 0.2 }}
        animate={{ opacity: 0.2 }}
        whileInView={{ opacity: 0.5 }}
        whileFocus={{ opacity: 1 }}
        transition={FAST}
        style={{ ...BOX, position: "absolute", top: "100px", left: "100px" }}
      />
    ))
    await landsAt(el, 0.5, "in view")
    // A click focuses the button without showing it.
    await mouse.down(centreOf(el))
    await mouse.up(centreOf(el))
    await frames(10)
    expect(document.activeElement, "focused by the click").toBe(el)
    expect(opacityOf(el), "not :focus-visible").toBe(0.5)
    el.blur()
    // Tab until it's the button's turn (the first may land on the test frame itself).
    for (let i = 0; i < 5; i++) {
      if (document.activeElement === el) break
      await commands.realKey("press", "Tab")
    }
    expect(document.activeElement, "focused by the keyboard").toBe(el)
    await landsAt(el, 1, "focus-visible, over in view")
  })
})
