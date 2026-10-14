// Shared-element (`layoutId`) FLIP tests in a REAL browser. The old happy-dom
// version mocked getBoundingClientRect with scripted boxes; here the swap is
// verified by REAL measured positions. The switch seed and its hand-off live in the
// projection engine (ADR-0010 *Amendment (#13)*), so these assert painted positions
// only; the scroll / container / swap-ordering cases are in
// layout-id-scroll.browser.test.tsx.
import { cleanup, render } from "@solidjs/testing-library"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid"
import { DomLive } from "@wardic/dom"
import { afterEach, expect, it } from "vitest"
import { createSignal, Show } from "solid-js"
import { leftOf, raf, until, widthOf } from "./browser-helpers.ts"

afterEach(cleanup)

const CSS = `
  .ind{position:absolute;top:0;width:100px;height:40px}
  .ind.a{left:20px}
  .ind.afinal{left:120px}
  .ind.b{left:300px}
  .cf-parent{position:absolute;top:0;left:0;width:100px;height:100px}
  .cf-parent.grown{width:150px;height:150px}
  .cf-child{position:absolute;top:0;left:0;width:60px;height:60px}
  .cf-far{position:absolute;top:0;left:400px;width:60px;height:60px}
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

it("mount-before-cleanup: a leaver that unmounts after its twin settled does not move the twin", async () => {
  const [showA, setShowA] = createSignal(true)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      {styled()}
      <div data-root style={{ position: "relative" }}>
        <Show when={showA()}>
          <wardic.div data-a class="ind a" layoutId="dual" />
        </Show>
        <wardic.div data-b class="ind b" layoutId="dual" />
      </div>
    </WardicProvider>
  ))
  const root = container.querySelector("[data-root]") as HTMLElement
  const b = container.querySelector("[data-b]") as HTMLElement
  const base = leftOf(root)
  // B mounted after A, so B leads, crossfading from A's box. Wait for that crossfade to
  // start (B measured) and then settle home at +300 — unmounting A before B's first
  // measure would instead hand B the switch seed (the register-then-dispose path).
  await until(() => transformOf(b).includes("translate"))
  await until(() => Math.abs(leftOf(b) - base - 300) < 1 && !transformOf(b).includes("translate"))
  expect(Math.abs(leftOf(b) - base - 300)).toBeLessThan(1)

  // A (a Follower) leaves AFTER B's first measure: A's seed is held for the task,
  // but B is already measured, so nothing reaches it and it stays put.
  setShowA(false)
  let worst = 0
  for (let i = 0; i < 12; i++) {
    await raf()
    worst = Math.max(worst, Math.abs(leftOf(b) - base - 300))
  }
  expect(worst).toBeLessThan(1)
  expect(transformOf(b)).not.toContain("translate")
})

const op = (el: HTMLElement): number => Number(el.style.opacity || "1")

it("crossfade (S1): a twin mounting beside a LIVE twin leads from its box; the live one follows + fades out", async () => {
  const [open, setOpen] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      {styled()}
      <div data-root style={{ position: "relative" }}>
        {/* A: always mounted (e.g. the thumbnail). */}
        <wardic.div data-a class="ind a" layoutId="cf" initial={{ opacity: 1 }} animate={{ opacity: 1 }} />
        {/* B: mounts on open (e.g. the modal), in a different slot. */}
        <Show when={open()}>
          <wardic.div data-b class="ind b" layoutId="cf" initial={{ opacity: 1 }} animate={{ opacity: 1 }} />
        </Show>
      </div>
    </WardicProvider>
  ))
  const root = container.querySelector("[data-root]") as HTMLElement
  const base = leftOf(root)
  const a = container.querySelector("[data-a]") as HTMLElement
  await raf()
  await raf() // A is the lone lead, settled at +20, full opacity

  setOpen(true) // B mounts → B leads (animates from A's box +20); A relegates to follower
  await raf()
  const b = container.querySelector("[data-b]") as HTMLElement

  // B is seeded at A's box (well left of its own +300) and fading IN from ~0.
  await until(() => leftOf(b) - base < 200 && op(b) < 0.95)
  expect(leftOf(b) - base).toBeLessThan(200) // started at A's side, not its own +300

  // Crossfade (Motion's curves since #5): B fades in while A holds, then A fades out with B in,
  // A locked onto B (overlapping), so the two are never see-through together.
  let sawIn = false
  let sawOut = false
  await until(() => {
    if (op(b) > 0.2 && op(b) < 0.95 && op(a) > 0.99) sawIn = true
    if (op(a) > 0.05 && op(a) < 0.95 && op(b) > 0.99) sawOut = true
    return Math.abs(leftOf(b) - base - 300) < 2 // B settled at its own +300
  })
  expect(sawIn, "B fading in while A holds").toBe(true)
  expect(sawOut, "A fading out with B in").toBe(true)
  expect(op(b)).toBeCloseTo(1, 1) // lead fully in
  expect(op(a)).toBeLessThan(0.1) // follower faded out (hidden, held)
  expect(Math.abs(leftOf(a) - leftOf(b))).toBeLessThan(3) // follower locked onto the lead's box
})

it("crossfade under treeScale: a follower nested in a SCALING layout parent stays locked onto the lead", async () => {
  const [open, setOpen] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      {styled()}
      <div data-root style={{ position: "relative", width: "600px", height: "400px" }}>
        {/* The follower twin A lives inside a layout parent that scales on open. */}
        <wardic.div data-parent class="cf-parent" classList={{ grown: open() }} layout layoutDependency={open()}>
          <wardic.div data-a class="cf-child" layoutId="cf2" initial={{ opacity: 1 }} animate={{ opacity: 1 }} />
        </wardic.div>
        {/* The lead twin B mounts far away (left 400), under NO scaling ancestor. */}
        <Show when={open()}>
          <wardic.div data-b class="cf-far" layoutId="cf2" initial={{ opacity: 1 }} animate={{ opacity: 1 }} />
        </Show>
      </div>
    </WardicProvider>
  ))
  const a = container.querySelector("[data-a]") as HTMLElement
  const parent = container.querySelector("[data-parent]") as HTMLElement
  await raf()
  await raf()

  setOpen(true) // parent scales 100->150 AND B mounts (lead); A follows B through treeScale
  await raf()
  const b = container.querySelector("[data-b]") as HTMLElement

  // The invariant that matters: WHILE THE FOLLOWER IS STILL VISIBLE (fading out),
  // it stays locked onto the lead despite the simultaneously-scaling ancestor
  // (treeScale-corrected) — it must not drift toward its own box. Once it's hidden
  // (opacity ~0) its exact rest position is visually irrelevant, so we only sample
  // drift while visible. Settle when both springs (crossfade + parent scale) rest.
  let worstVisibleDrift = 0
  await until(() => {
    if (op(a) > 0.1) worstVisibleDrift = Math.max(worstVisibleDrift, Math.abs(leftOf(a) - leftOf(b)))
    return op(b) >= 0.99 && Math.abs(widthOf(parent) - 150) < 1
  })
  // Without treeScale correction the follower would be dragged by the parent's
  // scale (tens of px); locked + corrected it tracks the lead within a few px.
  expect(worstVisibleDrift).toBeLessThan(12)
  expect(op(a)).toBeLessThan(0.1) // follower ended hidden behind the lead
})

it("crossfade (S3): closing a layoutId twin under <AnimatePresence> flies it back onto the promoted twin, then removes it", async () => {
  // NOTE on scheduler ordering: a <Show>-driven leave disposes the leaver's owner
  // (projection dispose) BEFORE presence's tracker effect calls handleLeave, so the
  // reachable interleaving is dispose-first (the re-introduce path). The
  // handleLeave-before-dispose path is defensively handled in the engine.
  const [open, setOpen] = createSignal(false) // start closed: only the thumbnail
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      {styled()}
      <div data-root style={{ position: "relative" }}>
        <wardic.div data-thumb class="ind a" layoutId="s3" initial={{ opacity: 1 }} animate={{ opacity: 1 }} />
        <AnimatePresence>
          <Show when={open()}>
            <wardic.div
              data-modal
              class="ind b"
              layoutId="s3"
              initial={{ opacity: 1 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
          </Show>
        </AnimatePresence>
      </div>
    </WardicProvider>
  ))
  const root = container.querySelector("[data-root]") as HTMLElement
  const base = leftOf(root)
  const thumb = container.querySelector("[data-thumb]") as HTMLElement
  await raf()
  await raf() // thumbnail is the lone lead, visible at +20

  setOpen(true) // the modal mounts LATER -> it is the newest -> lead (crossfade in from thumb)
  // Seed-wait: the crossfade seeds the modal BACK at the thumbnail's box (+20) and
  // fading in — wait for that, so we don't match its raw mount position (+300, op 1)
  // before the projection engages.
  await until(() => {
    const m = container.querySelector("[data-modal]")
    return m instanceof HTMLElement && leftOf(m) - base < 150
  })
  const modal = container.querySelector("[data-modal]") as HTMLElement
  // Now let the crossfade-in settle: modal back at +300, fully in; thumbnail hidden.
  await until(() => Math.abs(leftOf(modal) - base - 300) < 3 && op(modal) >= 0.95)
  expect(op(thumb)).toBeLessThan(0.15) // thumbnail hidden behind the open modal

  setOpen(false) // close: AnimatePresence retains the modal; it crossfades back onto the thumbnail
  // Mid-crossfade: the modal STAYS connected, flies back toward the thumbnail (+20)
  // while fading out, and the thumbnail un-hides + flies home.
  let sawReturning = false
  await until(() => {
    if (modal.isConnected && leftOf(modal) - base < 250 && op(modal) < 0.95 && op(thumb) > 0.05) sawReturning = true
    return !modal.isConnected // removed on the crossfade's settle
  })
  expect(sawReturning).toBe(true) // the leaver crossfaded back (not an instant exit)
  expect(modal.isConnected).toBe(false) // onDone removed the retained node
  expect(leftOf(thumb) - base).toBeCloseTo(20, 0) // thumbnail back home
  expect(op(thumb)).toBeCloseTo(1, 1) // and fully visible again
})

it("lone layoutId leave (no twin) under <AnimatePresence> degrades to the normal exit", async () => {
  const [show, setShow] = createSignal(true)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      {styled()}
      <AnimatePresence>
        <Show when={show()}>
          <wardic.div data-lone class="ind a" layoutId="lone-s3" initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
        </Show>
      </AnimatePresence>
    </WardicProvider>
  ))
  const el = container.querySelector("[data-lone]") as HTMLElement
  await raf()
  await raf()

  setShow(false) // no twin -> handleLeave returns false -> normal exit animation runs
  let sawFade = false
  await until(() => {
    if (el.isConnected && op(el) < 0.95 && op(el) > 0.05) sawFade = true
    return !el.isConnected
  })
  expect(sawFade).toBe(true) // ran the normal exit (faded), not a crossfade
  expect(el.isConnected).toBe(false)
})
