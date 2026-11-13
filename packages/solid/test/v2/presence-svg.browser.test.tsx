// SVG presence children on Solid 2 (#702, ADR-0048 *Amendment (#702)*), as the Solid 1 binding's PS
// tests pin them. Real frames, under the diagnostics gate.
//
// - PSV1: a `wardic.circle` under a presence inside an `<svg>` runs its exit; it stays until it ends.
// - PSV2: its exit runs on an attribute key (`r`).
// - PSV3: `mode="wait"`: the entering circle waits off the page until the leaving one's exit has ended.
// - PSV4: a plain `<g>` with a Wardic element inside stays until that element's exit ends (#392).
// - PSV5: `popLayout`: an `<svg>` root isn't popped: it runs its exit in place, in the flow, keeping its input.
// - PSV6: `sync`: once an `<svg>` root is removed, a `layout` sibling slides into its space.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, type PresenceMode, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import * as Bool from "effect/Boolean"
import { createSignal, flush, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)
const rOf = (el: Element): number => Number(el.getAttribute("r"))

const TWEEN = { type: "tween", duration: 0.3 } as const

/** Whether `el` was seen partway (`mid` of its value) while connected, until it's gone. */
const fadesOut = async (el: Element, valueOf: (el: Element) => number, mid: (value: number) => boolean): Promise<boolean> => {
  let seen = false
  await until(() => {
    if (Bool.and(mid(valueOf(el)), el.isConnected)) seen = true
    return !el.isConnected
  }, 3000)
  return seen
}

/** Partway between 1 and 0. */
const between = (o: number): boolean => Math.min(o, 1 - o) > 0.1

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

/** A 40px `wardic.svg` icon that fades out. */
const icon = () => (
  <wardic.svg data-k="icon" width="40" height="40" style={{ display: "block" }} exit={{ opacity: 0 }} transition={TWEEN}>
    <rect width="40" height="40" />
  </wardic.svg>
)

/** A 20px `layout` block after the presence. */
const after = () => <wardic.div data-k="after" layout transition={{ layout: TWEEN }} style={{ height: "20px" }} />

describe("SVG presence children on Solid 2 (#702)", () => {
  it("PSV1: a `wardic.circle` under a presence runs its exit; it stays until it ends", async () => {
    const one = mountOne(() => <wardic.circle data-k="dot" cx={50} cy={50} r={20} exit={{ opacity: 0 }} transition={TWEEN} />)
    await frames(3)
    const dot = one.q("dot")
    expect(dot).toBeInstanceOf(SVGCircleElement)
    one.close()
    await raf()
    expect(dot.isConnected, "the circle stays for its exit").toBe(true)
    expect(await fadesOut(dot, opacityOf, between), "it faded while it stayed").toBe(true)
    expect(dot.isConnected, "gone once its exit ended").toBe(false)
  })

  it("PSV2: its exit runs on an attribute key", async () => {
    const one = mountOne(() => <wardic.circle data-k="dot" cx={50} cy={50} r={20} exit={{ r: 0 }} transition={TWEEN} />)
    await frames(3)
    const dot = one.q("dot")
    expect(rOf(dot)).toBe(20)
    one.close()
    expect(await fadesOut(dot, rOf, (r) => Bool.and(r > 2, r < 18)), "its radius shrank while it stayed").toBe(true)
  })

  it("PSV3: wait: the entering circle waits until the leaving one's exit has ended", async () => {
    const [dot, setDot] = createSignal<string | undefined>("a")
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <svg width="200" height="100">
          <AnimatePresence mode="wait">
            <Show when={dot()} keyed>
              {(k) => <wardic.circle data-k={k} cx={50} cy={50} r={20} exit={{ opacity: 0 }} transition={TWEEN} />}
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
    await until(() => !a.isConnected, 3000)
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
    expect(await fadesOut(dot, opacityOf, between), "the circle faded while the group stayed").toBe(true)
    expect(group.isConnected, "gone once the exit inside it ended").toBe(false)
  })

  it("PSV5: popLayout: an `<svg>` root isn't popped: it exits in place, in the flow", async () => {
    const one = mountOne(icon, { mode: "popLayout", html: true, after })
    await frames(3)
    const svg = one.q("icon")
    const next = one.q("after")
    const was = svg.getBoundingClientRect()
    const nextWas = next.getBoundingClientRect().top
    one.close()
    await raf()
    expect(svg.isConnected, "it stays for its exit").toBe(true)
    expect(getComputedStyle(svg).position, "not pinned").toBe("static")
    expect(getComputedStyle(svg).pointerEvents, "it keeps its input").toBe("auto")
    expect(svg.getBoundingClientRect().top).toBe(was.top)
    expect(next.getBoundingClientRect().top, "still in the flow: its sibling stays below it").toBe(nextWas)
    expect(await fadesOut(svg, opacityOf, between), "it faded in place").toBe(true)
  })

  it("PSV6: sync: once an `<svg>` root is removed, a `layout` sibling slides into its space", async () => {
    const one = mountOne(icon, { html: true, after })
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
})
