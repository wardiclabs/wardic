// Shared-element (`layoutId`) FLIP tests in a REAL browser. The old happy-dom
// version mocked getBoundingClientRect with scripted boxes; here the swap is
// verified by REAL measured positions. The pure registry-ownership unit test
// (makeSharedLayoutRegistry) is environment-agnostic and kept as-is.
import { cleanup, render } from "@solidjs/testing-library"
import { makeSharedLayoutRegistry, SharedLayoutContext, wardic, WardicProvider } from "@wardic/solid"
import { DomLive } from "@wardic/dom"
import { afterEach, expect, it } from "vitest"
import { createSignal, Show } from "solid-js"
import { leftOf, raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const CSS = `
  .ind{position:absolute;top:0;width:100px;height:40px}
  .ind.a{left:20px}
  .ind.afinal{left:120px}
  .ind.b{left:300px}
`
const styled = () => <style>{CSS}</style>

const transformOf = (el: HTMLElement): string => el.style.transform

it("first appearance: a brand-new layoutId (no prior box) does NOT FLIP — it renders at its real position", async () => {
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      {styled()}
      <div style={{ position: "relative" }}>
        <wardic.div data-flip class="ind b" layoutId="fresh" />
      </div>
    </WardicProvider>
  ))
  const el = container.querySelector("[data-flip]") as HTMLElement
  const base = leftOf(container.querySelector("div")!) // container origin (viewport)
  await raf()
  await raf()
  // No prior box -> no FLIP transform; element sits at its real left (~base+300).
  expect(transformOf(el)).not.toContain("translate")
  expect(leftOf(el) - base).toBeCloseTo(300, 0)
})

it("swap: a twin entering at B FLIPs from the leaving twin's box at A, then settles at B", async () => {
  const [atB, setAtB] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      {styled()}
      <div data-root style={{ position: "relative" }}>
        <Show when={atB()} fallback={<wardic.div data-a class="ind a" layoutId="ind" />}>
          <wardic.div data-b class="ind b" layoutId="ind" />
        </Show>
      </div>
    </WardicProvider>
  ))
  const root = container.querySelector("[data-root]") as HTMLElement
  const base = leftOf(root)
  await raf()
  await raf() // A mounted at +20 — registry holds A's box

  setAtB(true) // A unmounts, B mounts at +300 and FLIPs from A's box (+20)
  await raf()
  const b = container.querySelector("[data-b]") as HTMLElement
  // Seeded back near A's position (well left of B's real +300).
  await until(() => leftOf(b) - base < 150)
  expect(leftOf(b) - base).toBeLessThan(150)
  // Springs to B's real position.
  await until(() => Math.abs(leftOf(b) - base - 300) < 2)
  expect(Math.abs(leftOf(b) - base - 300)).toBeLessThan(2)
})

it("reserved projection props (layoutScroll/layoutRoot/layoutAnchor) are typed, no-op, and do NOT leak to the DOM", async () => {
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      {styled()}
      <wardic.div data-flip class="ind a" layoutId="ind" layoutScroll layoutRoot layoutAnchor={{ x: 0.5, y: 0.5 }} />
    </WardicProvider>
  ))
  const el = container.querySelector("[data-flip]") as HTMLElement
  await raf()
  await raf()
  expect(el.getAttribute("layoutScroll")).toBeNull()
  expect(el.getAttribute("layoutRoot")).toBeNull()
  expect(el.getAttribute("layoutAnchor")).toBeNull()
  expect(el.getAttribute("layoutId")).toBeNull()
})

it("makeSharedLayoutRegistry: setBox/getBox/isOwner/clearIfOwner ownership semantics (pure)", () => {
  const reg = makeSharedLayoutRegistry()
  const owner1 = {}
  const owner2 = {}
  const box1 = { x: 20, y: 0, left: 20, top: 0, right: 120, bottom: 40, width: 100, height: 40 }
  const box2 = { x: 300, y: 0, left: 300, top: 0, right: 400, bottom: 40, width: 100, height: 40 }

  expect(reg.getBox("id")).toBeUndefined()
  expect(reg.isOwner("id", owner1)).toBe(false)

  reg.setBox("id", box1, owner1)
  expect(reg.getBox("id")).toEqual(box1)
  expect(reg.isOwner("id", owner1)).toBe(true)
  expect(reg.isOwner("id", owner2)).toBe(false)

  // Non-owner clear is a no-op.
  reg.clearIfOwner("id", owner2)
  expect(reg.getBox("id")).toEqual(box1)

  // Twin re-claim moves ownership.
  reg.setBox("id", box2, owner2)
  expect(reg.isOwner("id", owner1)).toBe(false)
  expect(reg.getBox("id")).toEqual(box2)

  // Stale clear by the prior owner is a no-op; the current owner CAN clear.
  reg.clearIfOwner("id", owner1)
  expect(reg.getBox("id")).toEqual(box2)
  reg.clearIfOwner("id", owner2)
  expect(reg.getBox("id")).toBeUndefined()
})

it("lone unmount BOUNDS the registry — the slot is cleared next microtask", async () => {
  const reg = makeSharedLayoutRegistry()
  const [shown, setShown] = createSignal(true)
  render(() => (
    <WardicProvider env={DomLive}>
      {styled()}
      <SharedLayoutContext.Provider value={reg}>
        <Show when={shown()}>
          <wardic.div data-flip class="ind a" layoutId="lone" />
        </Show>
      </SharedLayoutContext.Provider>
    </WardicProvider>
  ))
  await raf()
  await raf()
  expect(reg.getBox("lone")).toBeDefined() // mounted: slot holds the element's box

  setShown(false)
  await Promise.resolve() // deferred clearIfOwner fires (no twin re-claimed)
  expect(reg.getBox("lone")).toBeUndefined()
})

it("cleanup re-measures the FINAL box — a same-frame twin FLIPs from where the leaver ACTUALLY ended", async () => {
  const [atB, setAtB] = createSignal(false)
  const [aMoved, setAMoved] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      {styled()}
      <div data-root style={{ position: "relative" }}>
        <Show
          when={atB()}
          fallback={<wardic.div data-a class="ind" classList={{ a: !aMoved(), afinal: aMoved() }} layoutId="ind2" />}
        >
          <wardic.div data-b class="ind b" layoutId="ind2" />
        </Show>
      </div>
    </WardicProvider>
  ))
  const root = container.querySelector("[data-root]") as HTMLElement
  const base = leftOf(root)
  await raf()
  await raf() // A mounted at +20

  setAMoved(true) // A moves to its FINAL position +120 (real layout)
  await raf()
  await raf()

  setAtB(true) // swap: A's cleanup re-measures +120; B mounts at +300 and FLIPs from +120
  await raf()
  const b = container.querySelector("[data-b]") as HTMLElement
  // Seeded near A's FINAL box (~+120), NOT its mount box (~+20).
  await until(() => transformOf(b).includes("translate"))
  const seeded = leftOf(b) - base
  expect(seeded).toBeGreaterThan(70) // clearly past the mount box (+20)
  expect(seeded).toBeLessThan(170) // around the final box (+120), not B's +300
  await until(() => Math.abs(leftOf(b) - base - 300) < 2)
  expect(Math.abs(leftOf(b) - base - 300)).toBeLessThan(2)
})

it("mount-before-cleanup: the later twin owns the slot; the leaver does NOT clobber or clear it", async () => {
  const reg = makeSharedLayoutRegistry()
  const [showA, setShowA] = createSignal(true)
  render(() => (
    <WardicProvider env={DomLive}>
      {styled()}
      <SharedLayoutContext.Provider value={reg}>
        <div style={{ position: "relative" }}>
          <Show when={showA()}>
            <wardic.div data-a class="ind a" layoutId="dual" />
          </Show>
          <wardic.div data-b class="ind b" layoutId="dual" />
        </div>
      </SharedLayoutContext.Provider>
    </WardicProvider>
  ))
  await raf()
  await raf()
  // B mounted AFTER A -> B owns the slot; its box (~left 300) is held.
  const owned = reg.getBox("dual")
  expect(owned).toBeDefined()
  const ownedLeft = owned!.left

  setShowA(false) // A leaves; isOwner(A) is false -> A's cleanup does nothing
  await Promise.resolve()
  // B (still alive) keeps owning the slot — its box survives (not cleared/clobbered).
  expect(reg.getBox("dual")).toBeDefined()
  expect(reg.getBox("dual")!.left).toBeCloseTo(ownedLeft, 0)
})
