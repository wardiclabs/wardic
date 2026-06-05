// @vitest-environment happy-dom
import { cleanup, render } from "@solidjs/testing-library"
import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest"
import { DomLive } from "@wardic/dom"
import { createSignal } from "solid-js"
import { LayoutGroup, measureLayoutBox, wardic, WardicProvider } from "@wardic/solid"

/**
 * Layout FLIP tests.
 *
 * happy-dom has NO layout engine — every `getBoundingClientRect` is all-zeros. So
 * we MOCK `Element.prototype.getBoundingClientRect` to return SCRIPTED boxes (a
 * "before" box, then an "after" box once a trigger fires). We then assert the
 * WIRING and the inverted-transform Play (the actual visual result is verified in
 * a real browser): on a reflow the element's committed `transform` starts near the
 * INVERTED delta (`translateX` ~ -(after.left - before.left)) and springs toward
 * identity (`translateX -> 0`).
 *
 * Deterministic rAF + monotonic clock harness — identical strategy to
 * animate-presence.test.tsx: both the Clock's rAF loop and the gate's flush rAF
 * are hand-driven; the absolute clock is MONOTONIC (never reset between drive()
 * calls) so a late-subscribing FLIP spring never sees a negative dt.
 */
type RafCallback = (t: number) => void

let pending: Map<number, RafCallback>
let nextId: number
let clock: number

// The scripted box the mocked getBoundingClientRect returns for an element. A
// per-element override (keyed by a data attribute) lets two members report
// different boxes in the same pass.
interface Box {
  x: number
  y: number
  width: number
  height: number
  top: number
  right: number
  bottom: number
  left: number
}
const boxFor = (left: number, top: number, width = 100, height = 40): Box => ({
  x: left,
  y: top,
  width,
  height,
  top,
  right: left + width,
  bottom: top + height,
  left,
})

// The current box-resolver: given an element, return its scripted box. Swapped
// by each test to script "before" vs "after". Records every call for batching
// assertions.
let resolveBox: (el: Element) => Box
let rectCalls: Array<Element>

beforeEach(() => {
  pending = new Map()
  nextId = 1
  clock = 0
  resolveBox = () => boxFor(0, 0)
  rectCalls = []
  vi.stubGlobal("requestAnimationFrame", (cb: RafCallback) => {
    const id = nextId++
    pending.set(id, cb)
    return id
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    pending.delete(id)
  })
  // Mock the (otherwise all-zero) layout read.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    rectCalls.push(this)
    return resolveBox(this) as unknown as DOMRect
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  cleanup()
})

const fireFrame = (t: number): void => {
  const batch = [...pending.values()]
  pending.clear()
  for (const cb of batch) cb(t)
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const settle = (): Promise<void> => tick()

const drive = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i++) {
    clock += 16
    fireFrame(clock)
    await tick()
  }
}

/**
 * Parse the committed x-translation out of a `transform` string (0 if absent /
 * `"none"`). Handles BOTH forms: the box-based projection engine emits
 * `translate3d(Xpx, Ypx, Zpx)` (standalone `layout`, ADR-0009); the flat delta-key
 * `<LayoutGroup>` path also emits `translate3d(...)` now (migrated in P1b-ii-a-3).
 * The legacy `translateX(Xpx)` form is only the `layoutId` delta-key Play (P1c).
 */
const translateXOf = (transform: string | undefined): number => {
  if (!transform || transform === "none") return 0
  const m3 = /translate3d\(([-\d.]+)px/.exec(transform)
  if (m3) return Number(m3[1])
  const m = /translateX\(([-\d.]+)px\)/.exec(transform)
  return m ? Number(m[1]) : 0
}

/** Parse the FIRST `scale(x, …)` x-factor from a committed transform (1 if absent / `"none"`). */
const scaleXOf = (transform: string | undefined): number => {
  if (!transform || transform === "none") return 1
  const m = /scale\(([-\d.]+)/.exec(transform)
  return m ? Number(m[1]) : 1
}

describe("layout FLIP — measureLayoutBox", () => {
  it("(c) clears the inline transform for the read, then restores it", () => {
    const el = document.createElement("div")
    el.style.transform = "translateX(50px)"
    let transformDuringRead: string | undefined
    vi.spyOn(el, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      transformDuringRead = this.style.transform
      return boxFor(10, 20) as unknown as DOMRect
    })

    const box = measureLayoutBox(el)

    // During the read the inline transform was cleared...
    expect(transformDuringRead).toBe("")
    // ...and restored to its prior value afterward.
    expect(el.style.transform).toBe("translateX(50px)")
    // ...and the returned box mirrors the (untransformed) rect.
    expect(box.left).toBe(10)
    expect(box.top).toBe(20)
  })
})

describe("layout FLIP — standalone layout element", () => {
  it("(a) a layoutDependency change re-measures and plays an inverted FLIP toward identity", async () => {
    // BEFORE box: left = 0. The mount seed measures this.
    resolveBox = () => boxFor(0, 0)
    const [dep, setDep] = createSignal(0)

    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div data-flip layout layoutDependency={dep()}>
          x
        </wardic.div>
      </WardicProvider>
    ))

    const el = container.querySelector("[data-flip]") as HTMLElement
    expect(el).toBeInstanceOf(HTMLElement)

    // (d) no FLIP on initial mount: no translateX committed yet.
    await settle()
    await drive(2)
    expect(translateXOf(el.style.transform)).toBe(0)

    // Reflow: the element's new box is left = 120. Flip the dependency to trigger
    // a re-measure + Play. delta.x = before.left - after.left = 0 - 120 = -120,
    // so the committed transform should START near -120 and spring toward 0.
    resolveBox = () => boxFor(120, 0)
    setDep(1)

    await settle()
    await drive(2)
    const startX = translateXOf(el.style.transform)
    // Started near the inverted delta (-120), well away from identity.
    expect(startX).toBeLessThan(-50)
    expect(startX).toBeCloseTo(-120, -1)

    // Springs toward identity (translateX -> 0).
    await drive(120)
    expect(translateXOf(el.style.transform)).toBeCloseTo(0, 1)
  })
})

describe("layout FLIP — <LayoutGroup>", () => {
  it("(b) batches: one trigger reads BOTH members before any FLIP write", async () => {
    // Two members, both starting at the same before-box.
    resolveBox = () => boxFor(0, 0)
    const [dep, setDep] = createSignal(0)

    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <LayoutGroup layoutDependency={dep()}>
          <wardic.div data-flip-a layout>
            a
          </wardic.div>
          <wardic.div data-flip-b layout>
            b
          </wardic.div>
        </LayoutGroup>
      </WardicProvider>
    ))

    const a = container.querySelector("[data-flip-a]") as HTMLElement
    const b = container.querySelector("[data-flip-b]") as HTMLElement
    expect(a).toBeInstanceOf(HTMLElement)
    expect(b).toBeInstanceOf(HTMLElement)

    await settle()
    await drive(2)

    // Reflow both members to different new boxes; the group's layoutDependency
    // change requests a full projection re-measure (sibling reflow, Q5).
    resolveBox = (el) => (el === a ? boxFor(60, 0) : boxFor(90, 0))
    rectCalls = []
    setDep(1)

    // The projection MEASURE pass runs in the gate's pre-flush read-queue (one
    // frame later, not synchronously): it reads EVERY node's box once — both
    // members in one batched pass, no thrash.
    await settle()
    await drive(1)
    expect(rectCalls).toContain(a)
    expect(rectCalls).toContain(b)
    expect(rectCalls.filter((e) => e === a).length).toBe(1)
    expect(rectCalls.filter((e) => e === b).length).toBe(1)

    // Both then play an inverted FLIP toward identity (a: -60, b: -90 -> 0), via
    // the box engine (translate3d).
    expect(translateXOf(a.style.transform)).toBeLessThan(0)
    expect(translateXOf(b.style.transform)).toBeLessThan(0)

    await drive(140)
    expect(translateXOf(a.style.transform)).toBeCloseTo(0, 1)
    expect(translateXOf(b.style.transform)).toBeCloseTo(0, 1)
  })
})

describe("layout FLIP — nested (treeScale counter-scale, P1b-ii-a)", () => {
  it("a scaling layout parent makes its layout child counter-scale (1/treeScale), both settling to identity", async () => {
    // Parent scales 100 -> 200 on the dependency flip; the child's OWN box is
    // unchanged, so it is "carried" and must counter-scale to stay its real size.
    const [dep, setDep] = createSignal(0)
    const before = (el: Element): Box =>
      (el as HTMLElement).hasAttribute("data-parent") ? boxFor(0, 0, 100, 100) : boxFor(10, 10, 50, 50)
    resolveBox = before

    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div data-parent layout layoutDependency={dep()}>
          <wardic.div data-child layout>
            c
          </wardic.div>
        </wardic.div>
      </WardicProvider>
    ))

    const parent = container.querySelector("[data-parent]") as HTMLElement
    const child = container.querySelector("[data-child]") as HTMLElement
    expect(child.parentElement).toBe(parent) // DOM-walk will link child -> parent

    // No FLIP at rest.
    await settle()
    await drive(2)
    expect(scaleXOf(parent.style.transform)).toBeCloseTo(1, 1)
    expect(scaleXOf(child.style.transform)).toBeCloseTo(1, 1)

    // Reflow: parent doubles (child's own box unchanged). Parent appears at ~0.5
    // early (grows 0.5 -> 1); the child counter-scales ~2 (1/treeScale) to stay put.
    resolveBox = (el) =>
      (el as HTMLElement).hasAttribute("data-parent") ? boxFor(0, 0, 200, 200) : boxFor(10, 10, 50, 50)
    setDep(1)

    await settle()
    await drive(2)
    expect(scaleXOf(parent.style.transform)).toBeLessThan(0.9) // parent mid-grow (~0.5)
    expect(scaleXOf(child.style.transform)).toBeGreaterThan(1.4) // child counter-scales (~2)

    // Both settle to identity (no transform).
    await drive(160)
    expect(scaleXOf(parent.style.transform)).toBeCloseTo(1, 1)
    expect(scaleXOf(child.style.transform)).toBeCloseTo(1, 1)
  })
})
