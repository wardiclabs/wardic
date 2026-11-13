// SVG presence children on Solid 1 (#702, ADR-0048 *Amendment (#702)*): every element is a presence
// child, so an SVG one runs its exit as an HTML one does, and no SVG element is popped (Motion's). Real frames.
//
// - PS1: a `wardic.circle` under a presence inside an `<svg>` runs its exit; it stays until it ends;
//   `onExitComplete` after.
// - PS2: its exit runs on an attribute key (`r`).
// - PS3: `mode="wait"`: the entering circle waits off the page until the leaving one's exit has ended.
// - PS4: a plain `<g>` with a Wardic element inside stays until that element's exit ends (#392).
// - PS5: an SVG Wardic element inside an HTML leaver runs its exit, and the leaver stays for it.
// - PS6: `popLayout`: an `<svg>` root isn't popped: it runs its exit in place, in the flow, keeping its input.
// - PS7: `popLayout`: an inner SVG leaver isn't popped either.
// - PS8: `sync`: once an `<svg>` root is removed, a `layout` sibling slides into its space.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, type PresenceMode, wardic, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

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

/** A presence around one child, inside `outer`; `close` takes it out; `q` finds a `data-k`. */
const mountOne = (child: () => JSX.Element, options: { readonly mode?: PresenceMode; readonly svg?: boolean; readonly after?: () => JSX.Element } = {}) => {
  const [open, setOpen] = createSignal(true)
  let completes = 0
  const presence = () => (
    <AnimatePresence mode={options.mode} onExitComplete={() => completes++}>
      <Show when={open()}>{child()}</Show>
    </AnimatePresence>
  )
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      {Bool.match(options.svg === false, {
        onTrue: () => (
          <div style={{ position: "relative", width: "200px" }}>
            {presence()}
            {options.after?.()}
          </div>
        ),
        onFalse: () => (
          <svg width="200" height="100">
            {presence()}
          </svg>
        ),
      })}
    </WardicProvider>
  ))
  return {
    q: (k: string): Element => container.querySelector(`[data-k="${k}"]`)!,
    close: () => setOpen(false),
    completes: () => completes,
  }
}

/** A presence in `mode`, inside an `<svg>`, around a `<For>` of circles. */
const mountCircles = (start: ReadonlyArray<string>, mode: PresenceMode) => {
  const [items, setItems] = createSignal<ReadonlyArray<string>>(start)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <svg width="200" height="100">
        <AnimatePresence mode={mode}>
          <For each={items()}>{(k) => <wardic.circle data-k={k} cx={50} cy={50} r={20} exit={{ opacity: 0 }} transition={TWEEN} />}</For>
        </AnimatePresence>
      </svg>
    </WardicProvider>
  ))
  return {
    q: (k: string): Element | null => container.querySelector(`[data-k="${k}"]`),
    setItems,
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

describe("SVG presence children on Solid 1 (#702)", () => {
  it("PS1: a `wardic.circle` under a presence runs its exit; it stays until it ends", async () => {
    const one = mountOne(() => <wardic.circle data-k="dot" cx={50} cy={50} r={20} exit={{ opacity: 0 }} transition={TWEEN} />)
    await frames(3)
    const dot = one.q("dot")
    expect(dot).toBeInstanceOf(SVGCircleElement)
    one.close()
    await raf()
    expect(dot.isConnected, "the circle stays for its exit").toBe(true)
    expect(await fadesOut(dot, opacityOf, between), "it faded while it stayed").toBe(true)
    expect(dot.isConnected, "gone once its exit ended").toBe(false)
    expect(one.completes(), "onExitComplete once, after").toBe(1)
  })

  it("PS2: its exit runs on an attribute key", async () => {
    const one = mountOne(() => <wardic.circle data-k="dot" cx={50} cy={50} r={20} exit={{ r: 0 }} transition={TWEEN} />)
    await frames(3)
    const dot = one.q("dot")
    expect(rOf(dot)).toBe(20)
    one.close()
    expect(await fadesOut(dot, rOf, (r) => Bool.and(r > 2, r < 18)), "its radius shrank while it stayed").toBe(true)
    expect(one.completes()).toBe(1)
  })

  it("PS3: wait: the entering circle waits until the leaving one's exit has ended", async () => {
    const list = mountCircles(["a"], "wait")
    await frames(3)
    const a = list.q("a")!
    list.setItems(["b"])
    await frames(3)
    expect(a.isConnected, "a exits").toBe(true)
    expect(list.q("b"), "b waits off the page").toBeNull()
    await until(() => !a.isConnected, 3000)
    await until(() => list.q("b") !== null, 1000)
    expect(list.q("b")).toBeInstanceOf(SVGCircleElement)
  })

  it("PS4: a plain `<g>` stays until the exit of the Wardic element inside it ends", async () => {
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
    expect(one.completes()).toBe(1)
  })

  it("PS5: an SVG Wardic element inside an HTML leaver runs its exit; the leaver stays for it", async () => {
    const one = mountOne(
      () => (
        <div data-k="card">
          <svg width="100" height="100">
            <wardic.circle data-k="dot" cx={50} cy={50} r={20} exit={{ opacity: 0 }} transition={TWEEN} />
          </svg>
        </div>
      ),
      { svg: false },
    )
    await frames(3)
    const card = one.q("card")
    const dot = one.q("dot")
    one.close()
    await raf()
    expect(card.isConnected, "the card stays").toBe(true)
    expect(await fadesOut(dot, opacityOf, between), "the circle faded while the card stayed").toBe(true)
    expect(card.isConnected).toBe(false)
  })

  it("PS6: popLayout: an `<svg>` root isn't popped: it exits in place, in the flow", async () => {
    const one = mountOne(icon, { mode: "popLayout", svg: false, after })
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

  it("PS7: popLayout: an inner SVG leaver isn't popped either", async () => {
    const one = mountOne(() => <wardic.rect data-k="box" x={10} y={10} width={40} height={40} exit={{ opacity: 0 }} transition={TWEEN} />, { mode: "popLayout" })
    await frames(3)
    const box = one.q("box")
    one.close()
    await raf()
    expect(box.isConnected).toBe(true)
    expect(getComputedStyle(box).position).toBe("static")
    expect(box.getAttribute("x"), "drawn where it was").toBe("10")
    expect(await fadesOut(box, opacityOf, between)).toBe(true)
  })

  it("PS8: sync: once an `<svg>` root is removed, a `layout` sibling slides into its space", async () => {
    const one = mountOne(icon, { svg: false, after })
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
