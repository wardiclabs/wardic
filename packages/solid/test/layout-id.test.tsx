// @vitest-environment happy-dom
import { cleanup, render } from "@solidjs/testing-library"
import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest"
import { DomLive } from "@wardic/dom"
import { createSignal, Show } from "solid-js"
import { makeSharedLayoutRegistry, SharedLayoutContext, wardic, WardicProvider } from "@wardic/solid"

/**
 * Shared-element (`layoutId`) FLIP tests (ADR-0005, framer-motion parity).
 *
 * happy-dom has NO layout engine — every `getBoundingClientRect` is all-zeros. So
 * we MOCK `Element.prototype.getBoundingClientRect` to return SCRIPTED boxes,
 * keyed per-element via a `data-pos` attribute so the "A" twin and the "B" twin
 * report different positions. We assert the WIRING + the inverted-transform Play
 * (the real visual result is verified in a browser):
 *
 *   - NO `<LayoutGroup>` is needed: the registry is provided at the WardicProvider
 *     root, so a `layoutId` element seeds it (a).
 *   - shared-element swap: an indicator at position A unmounts and a twin with the
 *     SAME layoutId mounts at position B; the B twin FLIPs from A's box — its
 *     committed `translateX` starts near `A.left - B.left` and springs to 0 (b).
 *   - first appearance (no prior box) does NOT FLIP (c).
 *   - the reserved projection props (layoutScroll/layoutRoot/layoutAnchor) are
 *     accepted by the types and do NOT leak to the DOM (no-op) (d).
 *
 * Deterministic rAF + MONOTONIC clock harness — identical strategy to
 * layout-flip.test.tsx / animate-presence.test.tsx.
 */
type RafCallback = (t: number) => void

let pending: Map<number, RafCallback>
let nextId: number
let clock: number

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

// Scripted box-resolver: keyed by the element's `data-pos` attribute so the A and
// B twins report different positions even across the same-frame swap.
let resolveBox: (el: Element) => Box

beforeEach(() => {
  pending = new Map()
  nextId = 1
  clock = 0
  resolveBox = () => boxFor(0, 0)
  vi.stubGlobal("requestAnimationFrame", (cb: RafCallback) => {
    const id = nextId++
    pending.set(id, cb)
    return id
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    pending.delete(id)
  })
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
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

/** Parse `translateX(Npx)` out of a committed `transform` string (0 if absent). */
const translateXOf = (transform: string | undefined): number => {
  if (!transform) return 0
  const m = /translateX\(([-\d.]+)px\)/.exec(transform)
  return m ? Number(m[1]) : 0
}

// Box positions per twin, keyed by data-pos.
const POS_A = 20
const POS_B = 200
const posResolver = (el: Element): Box => {
  const pos = (el as HTMLElement).dataset?.pos
  if (pos === "a") return boxFor(POS_A, 0)
  if (pos === "b") return boxFor(POS_B, 0)
  return boxFor(0, 0)
}

describe("layoutId shared-element FLIP — no LayoutGroup", () => {
  it("(a) a layoutId element seeds the registry with NO <LayoutGroup> (no FLIP on first appearance)", async () => {
    resolveBox = posResolver

    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div data-pos="a" data-flip layoutId="ind">
          x
        </wardic.div>
      </WardicProvider>
    ))

    const el = container.querySelector("[data-flip]") as HTMLElement
    expect(el).toBeInstanceOf(HTMLElement)

    // (c) first appearance: no prior box -> no FLIP (no translateX committed).
    await settle()
    await drive(3)
    expect(translateXOf(el.style.transform)).toBe(0)
  })
})

describe("layoutId shared-element FLIP — swap", () => {
  it("(b) a twin entering at B FLIPs from the leaving twin's box at A", async () => {
    resolveBox = posResolver
    const [atB, setAtB] = createSignal(false)

    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <Show
          when={atB()}
          fallback={
            <wardic.div data-pos="a" data-flip="a" layoutId="ind">
              x
            </wardic.div>
          }
        >
          <wardic.div data-pos="b" data-flip="b" layoutId="ind">
            x
          </wardic.div>
        </Show>
      </WardicProvider>
    ))

    // A is mounted at POS_A — registry now holds A's box. No FLIP yet.
    const a = container.querySelector('[data-flip="a"]') as HTMLElement
    expect(a).toBeInstanceOf(HTMLElement)
    await settle()
    await drive(2)
    expect(translateXOf(a.style.transform)).toBe(0)

    // Swap: A unmounts, B mounts at POS_B. B reads A's box from the registry and
    // FLIPs from A -> B. delta.x = A.left - B.left = POS_A - POS_B (negative), so
    // the committed translateX starts near that and springs to 0.
    setAtB(true)
    await settle()
    await drive(2)

    const b = container.querySelector('[data-flip="b"]') as HTMLElement
    expect(b).toBeInstanceOf(HTMLElement)
    const startX = translateXOf(b.style.transform)
    expect(startX).toBeLessThan(0)
    expect(startX).toBeCloseTo(POS_A - POS_B, -1)

    // Springs toward identity (translateX -> 0).
    await drive(140)
    expect(translateXOf(b.style.transform)).toBeCloseTo(0, 1)
  })
})

describe("layoutId shared-element FLIP — first appearance", () => {
  it("(c) a brand-new layoutId (no prior box) does NOT FLIP", async () => {
    resolveBox = posResolver

    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div data-pos="b" data-flip layoutId="fresh">
          x
        </wardic.div>
      </WardicProvider>
    ))

    const el = container.querySelector("[data-flip]") as HTMLElement
    await settle()
    await drive(5)
    // No prior box for "fresh" -> just seeded the registry, no FLIP.
    expect(translateXOf(el.style.transform)).toBe(0)
  })
})

describe("layoutId reserved projection props", () => {
  it("(d) layoutScroll / layoutRoot / layoutAnchor are typed, no-op, and do NOT leak to the DOM", async () => {
    resolveBox = posResolver

    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          data-flip
          layoutId="ind"
          layoutScroll
          layoutRoot
          layoutAnchor={{ x: 0.5, y: 0.5 }}
        >
          x
        </wardic.div>
      </WardicProvider>
    ))

    const el = container.querySelector("[data-flip]") as HTMLElement
    expect(el).toBeInstanceOf(HTMLElement)
    await settle()
    await drive(2)

    // None of the reserved props leak to the DOM as attributes (split off).
    expect(el.getAttribute("layoutScroll")).toBeNull()
    expect(el.getAttribute("layoutRoot")).toBeNull()
    expect(el.getAttribute("layoutAnchor")).toBeNull()
    expect(el.getAttribute("layoutId")).toBeNull()
    // And they are no-ops: first appearance, so no FLIP transform committed.
    expect(translateXOf(el.style.transform)).toBe(0)
  })
})

describe("layoutId registry hardening — ownership-token deferred clear + re-measure", () => {
  it("(reg) makeSharedLayoutRegistry: setBox/getBox/isOwner/clearIfOwner ownership semantics", () => {
    const reg = makeSharedLayoutRegistry()
    const owner1 = {}
    const owner2 = {}
    const box1 = boxFor(POS_A, 0)
    const box2 = boxFor(POS_B, 0)

    // Empty: no box, no owner.
    expect(reg.getBox("id")).toBeUndefined()
    expect(reg.isOwner("id", owner1)).toBe(false)

    // owner1 claims the slot.
    reg.setBox("id", box1, owner1)
    expect(reg.getBox("id")).toEqual(box1)
    expect(reg.isOwner("id", owner1)).toBe(true)
    expect(reg.isOwner("id", owner2)).toBe(false)

    // clearIfOwner by a NON-owner is a no-op (slot survives).
    reg.clearIfOwner("id", owner2)
    expect(reg.getBox("id")).toEqual(box1)

    // owner2 re-claims (twin re-claim): ownership moves, box updates.
    reg.setBox("id", box2, owner2)
    expect(reg.isOwner("id", owner1)).toBe(false)
    expect(reg.isOwner("id", owner2)).toBe(true)
    expect(reg.getBox("id")).toEqual(box2)

    // A stale clearIfOwner by owner1 (the leaver's scheduled microtask) is now a
    // no-op — owner2 still holds the seed.
    reg.clearIfOwner("id", owner1)
    expect(reg.getBox("id")).toEqual(box2)

    // The current owner CAN clear: slot is dropped (bounded).
    reg.clearIfOwner("id", owner2)
    expect(reg.getBox("id")).toBeUndefined()
    expect(reg.isOwner("id", owner2)).toBe(false)
  })

  it("(a) a lone unmount BOUNDS the registry — the slot is cleared next microtask", async () => {
    resolveBox = posResolver
    // Provide OUR OWN registry so the test can observe getBox after unmount.
    const reg = makeSharedLayoutRegistry()
    const [shown, setShown] = createSignal(true)

    render(() => (
      <WardicProvider env={DomLive}>
        <SharedLayoutContext.Provider value={reg}>
          <Show when={shown()}>
            <wardic.div data-pos="a" data-flip layoutId="lone">
              x
            </wardic.div>
          </Show>
        </SharedLayoutContext.Provider>
      </WardicProvider>
    ))

    // Mounted: the slot holds the element's box.
    await settle()
    expect(reg.getBox("lone")).toEqual(boxFor(POS_A, 0))

    // Unmount with NO twin: cleanup re-measures + schedules a microtask clear.
    setShown(false)
    // The deferred clearIfOwner fires next microtask (no twin re-claimed).
    await Promise.resolve()
    expect(reg.getBox("lone")).toBeUndefined()
  })

  it("(b) cleanup-time final position — a same-frame twin FLIPs from the leaver's FINAL box, not its mount box", async () => {
    // The leaver mounts at POS_A but MOVES to a different box before it unmounts;
    // its cleanup must re-measure the FINAL box so the entering twin FLIPs from
    // there (MEDIUM-2). We script getBoundingClientRect by data-pos, then flip the
    // "a" twin's resolved box to a NEW position right before the swap.
    const POS_A_FINAL = 80
    resolveBox = (el: Element): Box => {
      const pos = (el as HTMLElement).dataset?.pos
      if (pos === "a") return boxFor(POS_A, 0) // overridden below before unmount
      if (pos === "b") return boxFor(POS_B, 0)
      return boxFor(0, 0)
    }
    const [atB, setAtB] = createSignal(false)

    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <Show
          when={atB()}
          fallback={
            <wardic.div data-pos="a" data-flip="a" layoutId="ind2">
              x
            </wardic.div>
          }
        >
          <wardic.div data-pos="b" data-flip="b" layoutId="ind2">
            x
          </wardic.div>
        </Show>
      </WardicProvider>
    ))

    const a = container.querySelector('[data-flip="a"]') as HTMLElement
    expect(a).toBeInstanceOf(HTMLElement)
    await settle()
    await drive(2)

    // The "a" element has MOVED to its final position before the swap: re-script
    // the resolver so a's cleanup re-measure reads POS_A_FINAL (not its mount box).
    resolveBox = (el: Element): Box => {
      const pos = (el as HTMLElement).dataset?.pos
      if (pos === "a") return boxFor(POS_A_FINAL, 0)
      if (pos === "b") return boxFor(POS_B, 0)
      return boxFor(0, 0)
    }

    // Swap: a unmounts (re-measures its FINAL box -> registry), b mounts at POS_B
    // and FLIPs from the FINAL box. delta.x = A_FINAL.left - B.left.
    setAtB(true)
    await settle()
    await drive(2)

    const b = container.querySelector('[data-flip="b"]') as HTMLElement
    expect(b).toBeInstanceOf(HTMLElement)
    const startX = translateXOf(b.style.transform)
    // FLIPs from the FINAL box (POS_A_FINAL), not the mount box (POS_A).
    expect(startX).toBeCloseTo(POS_A_FINAL - POS_B, -1)
    expect(startX).not.toBeCloseTo(POS_A - POS_B, -1)

    // Springs toward identity.
    await drive(140)
    expect(translateXOf(b.style.transform)).toBeCloseTo(0, 1)
  })

  it("(c) mount-before-cleanup ordering — the twin keeps its box; the leaver does NOT clobber it", async () => {
    // Both twins are mounted SIMULTANEOUSLY (mount-before-cleanup): the second
    // mount's setBox makes it the owner, so when the first leaves its cleanup sees
    // isOwner==false and neither overwrites nor clears. We observe via our own
    // registry: after BOTH unmount in sequence we confirm the last owner's seed,
    // then a lone clear. Here we assert the ownership transfer survives the order.
    resolveBox = posResolver
    const reg = makeSharedLayoutRegistry()
    const [showA, setShowA] = createSignal(true)

    render(() => (
      <WardicProvider env={DomLive}>
        <SharedLayoutContext.Provider value={reg}>
          <Show when={showA()}>
            <wardic.div data-pos="a" data-flip="a" layoutId="dual">
              x
            </wardic.div>
          </Show>
          <wardic.div data-pos="b" data-flip="b" layoutId="dual">
            x
          </wardic.div>
        </SharedLayoutContext.Provider>
      </WardicProvider>
    ))

    // Both mounted: B mounted AFTER A, so B is the owner and the slot holds B's box.
    await settle()
    expect(reg.getBox("dual")).toEqual(boxFor(POS_B, 0))

    // A leaves (mount-before-cleanup for B): A's cleanup sees isOwner==false and
    // does nothing — B's box stays, and B (still alive) keeps owning the slot.
    setShowA(false)
    await Promise.resolve()
    // B is alive and owns the slot — its box survives (not cleared, not clobbered).
    expect(reg.getBox("dual")).toEqual(boxFor(POS_B, 0))
  })
})
