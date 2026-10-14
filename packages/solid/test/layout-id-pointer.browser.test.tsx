// A Follower takes no pointer input (#165, ADR-0010 *Amendment (#165)*): locked onto its Lead's
// box, a Follower painted above the Lead (later in the DOM, a higher z-index) would take the
// Lead's clicks, while it fades out and at rest, hidden at opacity 0. Motion gives every non-Lead
// with a `layoutId` `pointer-events: none` (motion-dom 13.3.0, `applyProjectionStyles`). Before
// #165, PE1–PE3 hit the Follower, and PE4's promoted twin stayed hidden.
//
// The twins sit 400px down the page: the browser files share one real mouse (`realMouse`), and
// one parked high could hover another file's elements.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid"
import { createSignal, type JSX, Show } from "solid-js"
import { afterEach, expect, it } from "vitest"
import { commands } from "vitest/browser"
import "./browser-commands.ts"
import { leftOf, raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const CSS = `
  .pe{position:absolute;top:0;width:80px;height:40px}
  .pe.left{left:20px}
  .pe.right{left:300px}
`
const ROOT: JSX.CSSProperties = { position: "absolute", top: "400px", left: "0px", width: "600px", height: "100px" }
const styled = () => <style>{CSS}</style>

const op = (el: HTMLElement): number => Number(el.style.opacity || "1")
/** The element hit at `el`'s painted centre. */
const hitAt = (el: Element): Element | null => {
  const r = el.getBoundingClientRect()
  return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
}
/** A real click at `el`'s painted centre. */
const clickAt = async (el: Element): Promise<void> => {
  const r = el.getBoundingClientRect()
  const x = r.left + r.width / 2
  const y = r.top + r.height / 2
  await commands.realMouse("down", x, y)
  await commands.realMouse("up", x, y)
  await commands.realMouse("move", 5, 5) // parked where the other files expect it
}

it("PE1: a live Follower painted above its Lead passes the Lead's clicks through, while it fades and at rest", async () => {
  const [open, setOpen] = createSignal(false)
  const clicks = { a: 0, b: 0 }
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      {styled()}
      <div data-root style={ROOT}>
        {/* A paints above B (z-index 2): once B leads, A is a Follower over it. */}
        <wardic.div data-a class="pe left" layoutId="pe1" style={{ "z-index": 2 }} onClick={() => clicks.a++} />
        <Show when={open()}>
          <wardic.div data-b class="pe right" layoutId="pe1" style={{ "z-index": 1 }} onClick={() => clicks.b++} />
        </Show>
      </div>
    </WardicProvider>
  ))
  const root = container.querySelector("[data-root]") as HTMLElement
  const a = container.querySelector("[data-a]") as HTMLElement
  await raf()
  await raf()

  setOpen(true) // B mounts, leads from A's box; A relegates to a Follower locked onto B
  await raf()
  const b = container.querySelector("[data-b]") as HTMLElement
  let followerHits = 0
  let frames = 0
  await until(() => {
    frames++
    if (hitAt(b) === a) followerHits++
    return Math.abs(leftOf(b) - leftOf(root) - 300) < 1 && op(a) < 0.01
  })
  expect(frames, "frames sampled through the crossfade").toBeGreaterThan(5)
  expect(followerHits, "frames the fading Follower took the Lead's point").toBe(0)

  // At rest, hidden at opacity 0 and still locked over B.
  expect(a.style.pointerEvents).toBe("none")
  expect(hitAt(b)).toBe(b)
  await clickAt(b)
  expect(clicks).toEqual({ a: 0, b: 1 })
})

it("PE2: a leaving Follower closing back onto its Lead passes the Lead's point through until it's removed", async () => {
  const [open, setOpen] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      {styled()}
      <div data-root style={ROOT}>
        <wardic.div data-thumb class="pe left" layoutId="pe2" style={{ "z-index": 1 }} />
        <AnimatePresence>
          <Show when={open()}>
            <wardic.div data-modal class="pe right" layoutId="pe2" style={{ "z-index": 2 }} exit={{ opacity: 0 }} />
          </Show>
        </AnimatePresence>
      </div>
    </WardicProvider>
  ))
  const root = container.querySelector("[data-root]") as HTMLElement
  const thumb = container.querySelector("[data-thumb]") as HTMLElement
  await raf()
  await raf()
  setOpen(true)
  await until(() => {
    const m = container.querySelector("[data-modal]")
    return m instanceof HTMLElement && Math.abs(leftOf(m) - leftOf(root) - 300) < 1 && op(m) > 0.99
  })
  const modal = container.querySelector("[data-modal]") as HTMLElement

  setOpen(false) // presence retains the modal: it crossfades back onto the thumbnail, above it
  let modalHits = 0
  let frames = 0
  await until(() => {
    if (!modal.isConnected) return true
    frames++
    if (modal.contains(hitAt(thumb))) modalHits++
    return false
  })
  expect(frames, "frames the leaving Follower was on screen").toBeGreaterThan(5)
  expect(modalHits, "frames the leaving Follower took the thumbnail's point").toBe(0)
  expect(hitAt(thumb)).toBe(thumb)
})

it("PE3: a Follower promoted back to Lead takes clicks again, with the app's own pointer-events", async () => {
  const [open, setOpen] = createSignal(false)
  const clicks = { a: 0 }
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      {styled()}
      <div data-root style={ROOT}>
        <wardic.div data-a class="pe left" layoutId="pe3" style={{ "z-index": 2, "pointer-events": "all" }} onClick={() => clicks.a++} />
        <Show when={open()}>
          <wardic.div data-b class="pe right" layoutId="pe3" style={{ "z-index": 1 }} />
        </Show>
      </div>
    </WardicProvider>
  ))
  const root = container.querySelector("[data-root]") as HTMLElement
  const a = container.querySelector("[data-a]") as HTMLElement
  await raf()
  await raf()
  setOpen(true) // a crossfade: A ends a hidden Follower over B
  await until(() => {
    const b = container.querySelector("[data-b]")
    return b instanceof HTMLElement && Math.abs(leftOf(b) - leftOf(root) - 300) < 1 && op(a) < 0.01
  })
  expect(a.style.pointerEvents, "a Follower").toBe("none")

  setOpen(false) // B unmounts: A is promoted, and flies home from B's box
  await until(() => Math.abs(leftOf(a) - leftOf(root) - 20) < 1 && op(a) > 0.99)
  expect(a.style.pointerEvents, "the app's own value, back").toBe("all")
  expect(hitAt(a)).toBe(a)
  await clickAt(a)
  expect(clicks.a).toBe(1)
})

it("PE4: a Follower promoted in place, its Lead gone from its own box, shows and takes clicks again", async () => {
  const [open, setOpen] = createSignal(false)
  const [bLeft, setBLeft] = createSignal(false)
  const clicks = { a: 0 }
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      {styled()}
      <div data-root style={ROOT}>
        <wardic.div data-a class="pe left" layoutId="pe4" style={{ "z-index": 2 }} onClick={() => clicks.a++} />
        <Show when={open()}>
          <wardic.div data-b classList={{ pe: true, left: bLeft(), right: !bLeft() }} layoutId="pe4" layoutDependency={bLeft()} style={{ "z-index": 1 }} />
        </Show>
      </div>
    </WardicProvider>
  ))
  const root = container.querySelector("[data-root]") as HTMLElement
  const a = container.querySelector("[data-a]") as HTMLElement
  await raf()
  await raf()
  setOpen(true) // a crossfade: A is a hidden Follower over B
  await until(() => {
    const b = container.querySelector("[data-b]")
    return b instanceof HTMLElement && Math.abs(leftOf(b) - leftOf(root) - 300) < 1 && op(a) < 0.01
  })
  setBLeft(true) // B moves onto A's own box; A, hidden, follows
  const b = container.querySelector("[data-b]") as HTMLElement
  // Until B rests there: its layout moves at once, and its FLIP from where it was paints a frame
  // later, so its left edge alone reads 20 before it has flown at all. Since #170 A is promoted
  // from where B paints, so B mid-flight would send A flying too.
  await until(() => Math.abs(leftOf(b) - leftOf(root) - 20) < 0.5 && (b.style.transform === "none" || b.style.transform === ""))
  await raf()
  await raf()
  expect(op(a), "still a hidden Follower").toBeLessThan(0.01)

  setOpen(false) // B unmounts at A's box: nothing to move, A is promoted where it stands
  await raf()
  await raf()
  await raf()
  expect(op(a), "the promoted twin shows").toBeCloseTo(1, 2)
  expect(a.style.pointerEvents).toBe("")
  expect(hitAt(a)).toBe(a)
  await clickAt(a)
  expect(clicks.a).toBe(1)
})
