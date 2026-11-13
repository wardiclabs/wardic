// SVG presence children on Solid 2 (#702, ADR-0048 *Amendment (#702)*), as the Solid 1 binding's PS
// tests pin them, with an `<svg>` root popped under `popLayout` (#744, ADR-0048 *Amendment (#744)*).
// Real frames, under the diagnostics gate.
//
// - PSV1: a `wardic.circle` under a presence inside an `<svg>` runs its exit; it stays until it ends.
// - PSV2: its exit runs on an attribute key (`r`).
// - PSV3: `mode="wait"`: the leaving circle exits on `r` and `opacity`; the entering one waits off the
//   page until that exit has ended.
// - PSV4: a plain `<g>` with a Wardic element inside stays until that element's exit ends (#392).
// - PSV5: `popLayout`: an `<svg>` root is popped (#744): pinned where it was, out of the flow, taking no
//   input; a `layout` sibling slides into its place while it fades.
// - PSV6: `sync`: once an `<svg>` root is removed, a `layout` sibling slides into its space.
// - PSV7: an SVG Wardic element inside an HTML leaver runs its exit, and the leaver stays for it.
// - PSV8: `popLayout`: an inner SVG leaver isn't popped either: a circle exits on `r` where it was.
// - PSV9: an icon swap anchored right and bottom, in a positioned container with padding and a border:
//   the `<svg>` root popped in place, at a fractional place, and nothing left in the container but
//   the two icons.
// - PSV10: the container narrowing as it pops: pinned by the right, it keeps its distance from the
//   container's right.
// - PSV11: in a scaled container, with a transform of its own (its `x`), popped in place.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, type PresenceMode, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import * as Bool from "effect/Boolean"
import * as UndefinedOr from "effect/UndefinedOr"
import { createSignal, flush, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)
const rOf = (el: Element): number => Number(el.getAttribute("r"))

/** Where `el` is drawn, to a tenth of a pixel. */
const rectOf = (el: Element) => {
  const r = el.getBoundingClientRect()
  const tenth = (n: number): number => Math.round(n * 10) / 10
  return { left: tenth(r.left), top: tenth(r.top), right: tenth(r.right), bottom: tenth(r.bottom), width: tenth(r.width), height: tenth(r.height) }
}

const TWEEN = { type: "tween", duration: 0.3 } as const

/** Whether `el` was seen partway (`mid` of its value) while connected, until it's gone. */
const seenPartway = async (el: Element, valueOf: (el: Element) => number, mid: (value: number) => boolean): Promise<boolean> => {
  let seen = false
  await until(() => {
    if (Bool.and(mid(valueOf(el)), el.isConnected)) seen = true
    return !el.isConnected
  }, 3000)
  return seen
}

/** Partway between 1 and 0. */
const between = (o: number): boolean => Math.min(o, 1 - o) > 0.1

/** 1 when a 20-radius circle's `r` and its opacity are both partway, else 0. */
const bothPartway = (el: Element): number => Number(Bool.and(between(rOf(el) / 20), between(opacityOf(el))))

/** A presence around one child, inside an `<svg>` or, with `html`, a `<div>` before `after`; `close` takes it out. */
const mountOne = (child: () => JSX.Element, options: { readonly mode?: PresenceMode; readonly html?: boolean; readonly after?: () => JSX.Element } = {}) => {
  const [open, setOpen] = createSignal(true)
  const presence = () => (
    <AnimatePresence mode={options.mode}>
      <Show when={open()}>{child()}</Show>
    </AnimatePresence>
  )
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      <Show
        when={options.html}
        fallback={
          <svg width="200" height="100">
            {presence()}
          </svg>
        }
      >
        <div style={{ position: "relative", width: "200px" }}>
          {presence()}
          {options.after?.()}
        </div>
      </Show>
    </WardicProvider>
  ))
  return {
    q: (k: string): Element => host.querySelector(`[data-k="${k}"]`)!,
    close: () => {
      setOpen(false)
      flush()
    },
  }
}

/** Whether `el`'s top was seen strictly between `from` and `to` before `done`. */
const slides = async (el: Element, from: number, to: number, done: () => boolean): Promise<boolean> => {
  let sawMid = false
  const low = Math.min(from, to) + 3
  const high = Math.max(from, to) - 3
  await until(() => {
    const top = el.getBoundingClientRect().top
    if (Bool.and(top > low, top < high)) sawMid = true
    return done()
  }, 3000)
  return sawMid
}

/** An exit that outlasts a sibling's 0.3 s layout slide: the leaver still fades as it lands. */
const SLOW = { type: "tween", duration: 0.8 } as const

/** A 40px `wardic.svg` icon that fades out, over `transition`. */
const icon = (transition: typeof TWEEN | typeof SLOW = TWEEN) => (
  <wardic.svg data-k="icon" width="40" height="40" style={{ display: "block" }} exit={{ opacity: 0 }} transition={transition}>
    <rect width="40" height="40" />
  </wardic.svg>
)

/** A 20px `layout` block after the presence. */
const after = () => <wardic.div data-k="after" layout transition={{ layout: TWEEN }} style={{ height: "20px" }} />

interface SwapOptions {
  readonly anchorX?: "left" | "right"
  readonly anchorY?: "top" | "bottom"
  /** The container's style: a positioned one is the popped icon's containing block. */
  readonly box?: JSX.CSSProperties
  /** Each icon's style. */
  readonly iconStyle?: JSX.CSSProperties
  /** Each icon's width, by its key: 40 when left out. */
  readonly width?: (k: "a" | "b") => number
  /** Icon "a"'s `x`, landed at once. */
  readonly x?: number
}

/**
 * An icon swap (#744): a presence in `popLayout` around a `<Show>` of two `wardic.svg` icons, "a" then
 * "b", 40px tall, in a container (`data-k="box"`). `swap` shows "b".
 */
const mountSwap = (options: SwapOptions = {}) => {
  const [first, setFirst] = createSignal(true)
  const swapIcon = (k: "a" | "b") => {
    const width = UndefinedOr.match(options.width, { onUndefined: () => 40, onDefined: (of) => of(k) })
    const animate = Bool.match(k === "a", {
      onTrue: () => UndefinedOr.match(options.x, { onUndefined: () => ({}), onDefined: (x) => ({ x }) }),
      onFalse: () => ({}),
    })
    return (
      <wardic.svg
        data-k={k}
        width={width}
        height="40"
        style={{ display: "block", ...options.iconStyle }}
        animate={animate}
        exit={{ opacity: 0 }}
        transition={{ ...SLOW, x: { duration: 0 } }}
      >
        <rect width={width} height="40" />
      </wardic.svg>
    )
  }
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      <div data-k="box" style={options.box}>
        <AnimatePresence mode="popLayout" anchorX={options.anchorX} anchorY={options.anchorY}>
          <Show when={first()} fallback={swapIcon("b")}>
            {swapIcon("a")}
          </Show>
        </AnimatePresence>
      </div>
    </WardicProvider>
  ))
  return {
    q: (k: string): Element => host.querySelector(`[data-k="${k}"]`)!,
    swap: () => {
      setFirst(false)
      flush()
    },
  }
}

describe("SVG presence children on Solid 2 (#702)", () => {
  it("PSV1: a `wardic.circle` under a presence runs its exit; it stays until it ends", async () => {
    const one = mountOne(() => <wardic.circle data-k="dot" cx={50} cy={50} r={20} exit={{ opacity: 0 }} transition={TWEEN} />)
    await frames(3)
    const dot = one.q("dot")
    expect(dot).toBeInstanceOf(SVGCircleElement)
    one.close()
    await raf()
    expect(dot.isConnected, "the circle stays for its exit").toBe(true)
    expect(await seenPartway(dot, opacityOf, between), "it faded while it stayed").toBe(true)
    expect(dot.isConnected, "gone once its exit ended").toBe(false)
  })

  it("PSV2: its exit runs on an attribute key", async () => {
    const one = mountOne(() => <wardic.circle data-k="dot" cx={50} cy={50} r={20} exit={{ r: 0 }} transition={TWEEN} />)
    await frames(3)
    const dot = one.q("dot")
    expect(rOf(dot)).toBe(20)
    one.close()
    expect(await seenPartway(dot, rOf, (r) => Bool.and(r > 2, r < 18)), "its radius shrank while it stayed").toBe(true)
  })

  it("PSV3: wait: the entering circle waits until the leaving one's exit has ended", async () => {
    const [dot, setDot] = createSignal<string | undefined>("a")
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <svg width="200" height="100">
          <AnimatePresence mode="wait">
            <Show when={dot()} keyed>
              {(k) => <wardic.circle data-k={k} cx={50} cy={50} r={20} exit={{ opacity: 0, r: 0 }} transition={TWEEN} />}
            </Show>
          </AnimatePresence>
        </svg>
      </WardicProvider>
    ))
    const q = (k: string): Element | null => host.querySelector(`[data-k="${k}"]`)
    await frames(3)
    const a = q("a")!
    setDot("b")
    flush()
    await frames(3)
    expect(a.isConnected, "a exits").toBe(true)
    expect(q("b"), "b waits off the page").toBeNull()
    expect(await seenPartway(a, bothPartway, (both) => both === 1), "a's radius and opacity were partway on one frame while it stayed").toBe(true)
    await until(() => q("b") !== null, 1000)
    expect(q("b")).toBeInstanceOf(SVGCircleElement)
  })

  it("PSV4: a plain `<g>` stays until the exit of the Wardic element inside it ends", async () => {
    const one = mountOne(() => (
      <g data-k="group">
        <wardic.circle data-k="dot" cx={50} cy={50} r={20} exit={{ opacity: 0 }} transition={TWEEN} />
      </g>
    ))
    await frames(3)
    const group = one.q("group")
    const dot = one.q("dot")
    one.close()
    await raf()
    expect(group.isConnected, "the group stays").toBe(true)
    expect(await seenPartway(dot, opacityOf, between), "the circle faded while the group stayed").toBe(true)
    expect(group.isConnected, "gone once the exit inside it ended").toBe(false)
  })

  it("PSV5: popLayout: an `<svg>` root is popped: pinned where it was, its `layout` sibling sliding into its place", async () => {
    const one = mountOne(() => icon(SLOW), { mode: "popLayout", html: true, after })
    await frames(5)
    const svg = one.q("icon")
    const next = one.q("after")
    const was = rectOf(svg)
    const nextWas = next.getBoundingClientRect().top
    one.close()
    expect(svg.isConnected, "it stays for its exit").toBe(true)
    expect(getComputedStyle(svg).position, "out of the flow").toBe("absolute")
    expect(getComputedStyle(svg).pointerEvents, "it takes no input while popped (#486)").toBe("none")
    await raf()
    expect(rectOf(svg), "in place").toEqual(was)
    const sawMid = await slides(next, nextWas, was.top, () => Math.abs(next.getBoundingClientRect().top - was.top) < 0.5)
    expect(sawMid, "its sibling slid into its place").toBe(true)
    expect(svg.isConnected, "while it was still exiting").toBe(true)
    expect(await seenPartway(svg, opacityOf, between), "it faded where it was pinned").toBe(true)
  })

  it("PSV6: sync: once an `<svg>` root is removed, a `layout` sibling slides into its space", async () => {
    const one = mountOne(() => icon(), { html: true, after })
    await frames(5)
    const svg = one.q("icon")
    const next = one.q("after")
    const svgTop = svg.getBoundingClientRect().top
    const nextWas = next.getBoundingClientRect().top
    one.close()
    await frames(3)
    expect(next.getBoundingClientRect().top, "it stays while the icon exits").toBeCloseTo(nextWas, 0)
    await until(() => !svg.isConnected, 3000)
    const sawMid = await slides(next, nextWas, svgTop, () => Math.abs(next.getBoundingClientRect().top - svgTop) < 0.5)
    expect(sawMid, "it slid into the space").toBe(true)
  })
  it("PSV7: an SVG Wardic element inside an HTML leaver runs its exit; the leaver stays for it", async () => {
    const one = mountOne(
      () => (
        <div data-k="card">
          <svg width="100" height="100">
            <wardic.circle data-k="dot" cx={50} cy={50} r={20} exit={{ opacity: 0 }} transition={TWEEN} />
          </svg>
        </div>
      ),
      { html: true },
    )
    await frames(3)
    const card = one.q("card")
    const dot = one.q("dot")
    one.close()
    await raf()
    expect(card.isConnected, "the card stays").toBe(true)
    expect(await seenPartway(dot, opacityOf, between), "the circle faded while the card stayed").toBe(true)
    expect(card.isConnected).toBe(false)
  })

  it("PSV8: popLayout: an inner SVG leaver isn't popped either", async () => {
    const one = mountOne(() => <wardic.circle data-k="dot" cx={50} cy={50} r={20} exit={{ r: 0 }} transition={TWEEN} />, { mode: "popLayout" })
    await frames(3)
    const dot = one.q("dot")
    one.close()
    await raf()
    expect(dot.isConnected).toBe(true)
    expect(getComputedStyle(dot).position).toBe("static")
    expect(dot.getAttribute("cx"), "drawn where it was").toBe("50")
    expect(await seenPartway(dot, rOf, (r) => Bool.and(r > 2, r < 18)), "its radius shrank in place").toBe(true)
  })

  it("PSV9: anchored right and bottom, an icon is popped in place in a positioned container with padding and a border", async () => {
    const swap = mountSwap({
      anchorX: "right",
      anchorY: "bottom",
      box: { position: "relative", width: "300px", height: "200px", padding: "7px 13px 11px 5px", border: "3px solid black" },
      iconStyle: { margin: "4.5px 9px 6px 2.25px" },
    })
    await frames(5)
    const a = swap.q("a") as SVGSVGElement
    const was = rectOf(a)
    swap.swap()
    expect(getComputedStyle(a).position, "out of the flow").toBe("absolute")
    expect([a.style.getPropertyValue("right"), a.style.getPropertyValue("bottom")], "pinned by its right and bottom").not.toContain("")
    expect([a.style.getPropertyValue("left"), a.style.getPropertyValue("top")], "not by its left or top").toEqual(["", ""])
    await raf()
    expect(rectOf(a), "in place, to a tenth of a pixel").toEqual(was)
    expect(Array.from(swap.q("box").children, (child) => child.getAttribute("data-k")), "nothing else left in the container").toEqual(["a", "b"])
  })

  it("PSV10: the container narrowing as it pops: pinned by the right, it keeps the container's right", async () => {
    const swap = mountSwap({ anchorX: "right", box: { position: "relative", width: "fit-content" }, width: (k) => Bool.match(k === "a", { onTrue: () => 80, onFalse: () => 40 }) })
    await frames(5)
    const a = swap.q("a")
    const box = swap.q("box")
    const before = { a: rectOf(a), box: rectOf(box) }
    swap.swap()
    await raf()
    await raf()
    const after = { a: rectOf(a), box: rectOf(box) }
    expect(after.box.right, "the container narrowed").toBe(before.box.right - 40)
    expect(after.box.right - after.a.right, "from the container's right").toBe(before.box.right - before.a.right)
  })

  it("PSV11: in a scaled container, with a transform of its own, an icon is popped in place", async () => {
    const swap = mountSwap({ x: 30, box: { position: "relative", width: "300px", padding: "10px 0 0 20px", transform: "scale(0.5)", "transform-origin": "0 0" } })
    await frames(5)
    const a = swap.q("a")
    const was = rectOf(a)
    expect(was.width, "drawn at half its size").toBe(20)
    swap.swap()
    expect(getComputedStyle(a).position, "out of the flow").toBe("absolute")
    await raf()
    expect(rectOf(a), "in place").toEqual(was)
  })
})
