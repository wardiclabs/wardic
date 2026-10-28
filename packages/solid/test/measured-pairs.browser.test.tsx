// Measured pairs (#430, CONTEXT.md, Motion's `DOMKeyframesResolver`), on Solid 1: a positional key
// whose two ends differ in type is measured in px at both ends at the end of the task, its leg runs
// between them, and it lands on its target as given. Solid 2's is MW1.
//
// - MS1: an accordion opens from 0 to `auto`: through the px between, no frame painting its full height
//   first, and landed on `height: auto`, so content added later grows it.
// - MS2: it closes from `auto` to 0 from its height, with no jump; re-opened mid-close, from where it is.
// - MS3: `width: "50%"` from 120px runs in px and lands on `50%`, which follows its container after.
// - MS4: `x: "100%"` from 0 slides by the element's own width and lands on `translateX(100%)`, on a
//   tween and on a transform's Default transition, a spring.
// - MS5: Keyframes of two stops, `[0, "auto"]`, are a Measured pair too, from a key at `auto`, its
//   start its first stop.
// - MS6: under reduced motion, a Measured pair snaps to its target as given, nothing measured.
// - MS7: an exit from `auto` to 0 animates from its height.
// - MS8: twenty accordions opened in one task all animate, each to its own height.
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"
import { resetScene, settle } from "./reorder-harness.tsx"

afterEach(resetScene)

const LINEAR = { type: "tween", duration: 0.4, ease: "linear" } as const
const PANEL = { width: "120px", overflow: "hidden", background: "teal", "margin-left": "120px", "line-height": "20px" } as const

const show = (ui: () => JSX.Element, reducedMotion?: "always"): void => {
  render(() => (
    <WardicProvider env={DomLive} reducedMotion={reducedMotion}>
      {ui()}
    </WardicProvider>
  ))
}

/** `lines` lines of 20px: a panel's natural height is 20 × lines. */
const Lines = (props: { readonly lines: number }): JSX.Element => <For each={Array.from({ length: props.lines }, (_, i) => i)}>{(i) => <div>line {i}</div>}</For>

/** `read(el)` each frame for `ms`. */
const sample = async (el: Element, read: (el: Element) => number, ms: number): Promise<Array<number>> => {
  const out: Array<number> = []
  const t0 = performance.now()
  while (performance.now() - t0 < ms) {
    await raf()
    out.push(read(el))
  }
  return out
}

const heightOf = (el: Element): number => el.getBoundingClientRect().height

/** An accordion's height: `auto` open, 0 shut. */
const openTo = (open: boolean): "auto" | 0 => Bool.match(open, { onTrue: (): "auto" | 0 => "auto", onFalse: (): "auto" | 0 => 0 })
const widthOf = (el: Element): number => el.getBoundingClientRect().width
const xOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41

describe("Measured pairs on Solid 1 (#430)", () => {
  it("MS1: an accordion opens from 0 to auto through the px between, no frame at full height first, landed on auto", async () => {
    const [open, setOpen] = createSignal(false)
    const [lines, setLines] = createSignal(5)
    let el!: HTMLElement
    show(() => (
      <wardic.div ref={(n: HTMLElement) => (el = n)} style={{ ...PANEL, "margin-top": "120px" }} initial={{ height: 0 }} animate={{ height: openTo(open()) }} transition={LINEAR}>
        <Lines lines={lines()} />
      </wardic.div>
    ))
    await settle()
    expect(heightOf(el)).toBe(0)
    const seen: Array<number> = []
    const observer = new ResizeObserver((entries) => entries.forEach((entry) => seen.push(entry.contentRect.height)))
    observer.observe(el)
    setOpen(true)
    const frames = await sample(el, heightOf, 600)
    observer.disconnect()
    expect(frames[0], "the first frame near 0, not the full height").toBeLessThan(30)
    expect(frames.some((h) => h > 30 && h < 70), "through the px between").toBe(true)
    expect(Math.max(...seen.slice(0, 2)), "the observer never saw the target before it was drawn").toBeLessThan(30)
    expect(heightOf(el)).toBeCloseTo(100, 0)
    expect(el.style.height, "landed on its target as given").toBe("auto")
    setLines(8)
    await raf()
    await raf()
    expect(heightOf(el), "content added later grows it").toBeCloseTo(160, 0)
  })

  it("MS2: closes from auto to 0 from its height; re-opened mid-close, from where it is", async () => {
    const [open, setOpen] = createSignal(true)
    let el!: HTMLElement
    show(() => (
      <wardic.div ref={(n: HTMLElement) => (el = n)} style={{ ...PANEL, "margin-top": "120px" }} initial={false} animate={{ height: openTo(open()) }} transition={LINEAR}>
        <Lines lines={5} />
      </wardic.div>
    ))
    await settle()
    expect(heightOf(el)).toBeCloseTo(100, 0)
    setOpen(false)
    const closing = await sample(el, heightOf, 120)
    expect(Math.min(...closing.slice(0, 2)), "from its height, no jump: its first drawn frames near 100").toBeGreaterThan(80)
    const at = heightOf(el)
    expect(at, "mid-close").toBeGreaterThan(20)
    expect(at).toBeLessThan(90)
    setOpen(true)
    const reopening = await sample(el, heightOf, 600)
    expect(Math.abs(reopening[0]! - at), "re-opened from where it was").toBeLessThan(15)
    expect(heightOf(el)).toBeCloseTo(100, 0)
    expect(el.style.height).toBe("auto")
  })

  it("MS3: width 50% from 120px runs in px and lands on 50%, which follows its container", async () => {
    const [half, setHalf] = createSignal(false)
    const [box, setBox] = createSignal(400)
    let el!: HTMLElement
    show(() => (
      <div style={{ width: `${box()}px`, "margin-top": "120px", "margin-left": "120px" }}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={{ height: "20px", background: "teal" }} initial={{ width: "120px" }} animate={{ width: Bool.match(half(), { onTrue: () => "50%", onFalse: () => "120px" }) }} transition={LINEAR} />
      </div>
    ))
    await settle()
    expect(widthOf(el)).toBeCloseTo(120, 0)
    setHalf(true)
    const frames = await sample(el, widthOf, 600)
    expect(frames.some((w) => w > 140 && w < 190), "through the px between 120 and 200").toBe(true)
    expect(el.style.width).toBe("50%")
    setBox(600)
    await raf()
    await raf()
    expect(widthOf(el), "50% of its new container").toBeCloseTo(300, 0)
  })

  it("MS4: x 100% from 0 slides by its own width and lands on translateX(100%)", async () => {
    const [moved, setMoved] = createSignal(false)
    let el!: HTMLElement
    show(() => (
      <wardic.div
        ref={(n: HTMLElement) => (el = n)}
        style={{ width: "80px", height: "20px", background: "teal", "margin-top": "120px", "margin-left": "120px" }}
        animate={{ x: Bool.match(moved(), { onTrue: (): number | string => "100%", onFalse: (): number | string => 0 }) }}
        transition={LINEAR}
      />
    ))
    show(() => (
      <wardic.div
        data-sprung
        style={{ width: "80px", height: "20px", background: "teal", "margin-left": "120px" }}
        animate={{ x: Bool.match(moved(), { onTrue: (): number | string => "100%", onFalse: (): number | string => 0 }) }}
      />
    ))
    await settle()
    setMoved(true)
    const frames = await sample(el, xOf, 600)
    expect(frames.some((x) => x > 20 && x < 60), "through the px between 0 and its width").toBe(true)
    expect(xOf(el)).toBeCloseTo(80, 0)
    expect(el.style.transform).toContain("100%")
    // On its Default transition, a transform's spring, the same.
    const sprung = document.querySelector<HTMLElement>("[data-sprung]")!
    await until(() => sprung.style.transform.includes("100%"), 2000)
    expect(sprung.style.transform, "landed on its target as given").toContain("100%")
    expect(xOf(sprung)).toBeCloseTo(80, 0)
  })

  it("MS5: Keyframes of two stops, [0, auto], are a Measured pair too, from auto as well", async () => {
    const [stops, setStops] = createSignal(false)
    let el!: HTMLElement
    show(() => (
      <wardic.div
        ref={(n: HTMLElement) => (el = n)}
        style={{ ...PANEL, "margin-top": "120px" }}
        initial={false}
        animate={Bool.match(stops(), { onTrue: () => ({ height: [0, "auto"] as const }), onFalse: () => ({ height: "auto" as const }) })}
        transition={LINEAR}
      >
        <Lines lines={5} />
      </wardic.div>
    ))
    await settle()
    expect(heightOf(el), "at auto").toBeCloseTo(100, 0)
    // Its start is its first stop, 0, though the key rests at `auto`: checked once the stops resolve.
    setStops(true)
    const frames = await sample(el, heightOf, 600)
    // The first sample can come before the Clock's step in that frame: the first two.
    expect(Math.min(...frames.slice(0, 2)), "from its first stop").toBeLessThan(30)
    expect(frames.some((h) => h > 30 && h < 70), "through the px between").toBe(true)
    expect(el.style.height).toBe("auto")
  })

  it("MS6: under reduced motion, a Measured pair snaps to its target as given", async () => {
    const [open, setOpen] = createSignal(false)
    let el!: HTMLElement
    show(
      () => (
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={{ ...PANEL, "margin-top": "120px" }} initial={{ height: 0 }} animate={{ height: openTo(open()) }} transition={LINEAR}>
          <Lines lines={5} />
        </wardic.div>
      ),
      "always",
    )
    await settle()
    setOpen(true)
    const frames = await sample(el, heightOf, 200)
    expect(frames.every((h) => h === 0 || Math.abs(h - 100) < 0.5), "0, then its height: nothing between").toBe(true)
    expect(el.style.height).toBe("auto")
  })

  it("MS7: an exit from auto to 0 animates from its height", async () => {
    const [shown, setShown] = createSignal(true)
    show(() => (
      <AnimatePresence>
        <Show when={shown()}>
          <wardic.div data-leaving style={{ ...PANEL, "margin-top": "120px" }} initial={false} animate={{ height: "auto" }} exit={{ height: 0 }} transition={LINEAR}>
            <Lines lines={5} />
          </wardic.div>
        </Show>
      </AnimatePresence>
    ))
    await settle()
    const el = document.querySelector<HTMLElement>("[data-leaving]")!
    expect(heightOf(el)).toBeCloseTo(100, 0)
    setShown(false)
    const frames: Array<number> = []
    await until(() => {
      frames.push(heightOf(el))
      return !el.isConnected
    }, 2000)
    expect(Math.min(...frames.slice(0, 2)), "from its height, no jump: its first drawn frames near 100").toBeGreaterThan(80)
    expect(frames.some((h) => h > 20 && h < 80), "through the px between").toBe(true)
  })

  it("MS8: twenty accordions opened in one task all animate, each to its own height", async () => {
    const [open, setOpen] = createSignal(false)
    show(() => (
      <For each={Array.from({ length: 20 }, (_, i) => i)}>
        {(i) => (
          <wardic.div data-panel style={{ ...PANEL, width: "40px", display: "inline-block", "vertical-align": "top", "white-space": "nowrap" }} initial={{ height: 0 }} animate={{ height: openTo(open()) }} transition={LINEAR}>
            <Lines lines={1 + (i % 4)} />
          </wardic.div>
        )}
      </For>
    ))
    await settle()
    const panels = [...document.querySelectorAll<HTMLElement>("[data-panel]")]
    setOpen(true)
    await raf()
    for (let i = 0; i < 8; i++) await raf()
    const mid = panels.map(heightOf)
    expect(mid.every((h, i) => h > 0 && h < 20 * (1 + (i % 4))), "every one mid-flight").toBe(true)
    await until(() => panels.every((el) => el.style.height === "auto"), 2000)
    expect(panels.map(heightOf)).toEqual(panels.map((_, i) => 20 * (1 + (i % 4))))
  })
})
