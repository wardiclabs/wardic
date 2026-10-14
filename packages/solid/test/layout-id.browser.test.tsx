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
import { createSignal, type JSX, Show } from "solid-js"
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

it("crossfade (S5): a twin inside a closing container stays locked onto its Lead until the container goes (#5)", async () => {
  // Solid disposes the modal's avatar node with the modal, before presence hands the modal back;
  // the engine brings the avatar back too, as a leaving Follower of the card's avatar. Before #5's
  // fix the modal's stretch carried it uncorrected: 4.5px wider than the card's avatar and 1px off
  // by the end, a ghost that dissolved into the card's circle as the modal faded.
  const [open, setOpen] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      {styled()}
      <div data-root style={{ position: "relative", width: "600px", height: "300px" }}>
        <wardic.div data-card layoutId="s5-card" style={{ position: "absolute", left: "12px", top: "36px", width: "72px", height: "56px" }}>
          <wardic.div data-card-avatar layoutId="s5-avatar" style={{ position: "absolute", left: "6px", top: "6px", width: "20px", height: "20px" }} />
        </wardic.div>
        <AnimatePresence>
          <Show when={open()}>
            <wardic.div
              data-modal
              layoutId="s5-card"
              exit={{ opacity: 0 }}
              style={{ position: "absolute", left: "200px", top: "12px", width: "100px", height: "112px", "z-index": 2 }}
            >
              <wardic.div data-modal-avatar layoutId="s5-avatar" style={{ position: "absolute", left: "10px", top: "10px", width: "34px", height: "34px" }} />
            </wardic.div>
          </Show>
        </AnimatePresence>
      </div>
    </WardicProvider>
  ))
  const root = container.querySelector("[data-root]") as HTMLElement
  const cardAvatar = container.querySelector("[data-card-avatar]") as HTMLElement
  await raf()
  await raf()
  setOpen(true)
  await until(() => {
    const m = container.querySelector("[data-modal]")
    return m instanceof HTMLElement && op(m) > 0.99 && Math.abs(leftOf(m) - leftOf(root) - 200) < 0.5
  })
  await until(() => op(container.querySelector("[data-card]") as HTMLElement) < 0.01)
  const modal = container.querySelector("[data-modal]") as HTMLElement
  const modalAvatar = container.querySelector("[data-modal-avatar]") as HTMLElement

  setOpen(false) // presence keeps the modal: it crossfades back onto the card, its avatar onto the card's
  // From the first frame presence's hand-back has reached: the frame before it paints the modal,
  // and its avatar, where they stood (the S3 interleaving above).
  let frames = 0
  let worst = 0
  await until(() => {
    if (!modal.isConnected) return true
    if (modal.style.transform === "none" || modal.style.transform === "") return false
    frames++
    const a = cardAvatar.getBoundingClientRect()
    const b = modalAvatar.getBoundingClientRect()
    worst = Math.max(worst, Math.abs(a.left - b.left), Math.abs(a.top - b.top), Math.abs(a.width - b.width), Math.abs(a.height - b.height))
    return false
  })
  expect(frames, "frames the closing modal was on screen").toBeGreaterThan(5)
  expect(worst, "the modal's avatar off the card's, px").toBeLessThan(0.5)
})

/** Each frame's painted left, `n` frames, read just after paint. */
const leftsAfterPaint = (el: () => Element, n: number, base: number): Promise<Array<number>> =>
  new Promise((resolve) => {
    const out: Array<number> = []
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      out.push(el().getBoundingClientRect().left - base)
      if (out.length >= n) return resolve(out)
      requestAnimationFrame(() => ch.port2.postMessage(undefined))
    }
    requestAnimationFrame(() => ch.port2.postMessage(undefined))
  })

/** A start that goes on from `before`: its first frame no further from it than its next step (#170). */
const expectContinuous = (before: number, [first, second]: ReadonlyArray<number>, what: string) => {
  expect(Math.abs(first! - before), `${what}: jump at the start (next step ${Math.abs(second! - first!).toFixed(2)}px)`).toBeLessThanOrEqual(
    Math.abs(second! - first!) + 1,
  )
}

it("crossfade (S6): the Lead unmounted mid-flight, its promoted twin goes on from where the Lead was seen (#170)", async () => {
  // Scenario 16's overlap toggled off mid-flight. Before #170 the twin started from where the Lead
  // would have rested, 40-odd px ahead of where it was painted, and flew back from there.
  const [open, setOpen] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      {styled()}
      <div data-root style={{ position: "relative" }}>
        <wardic.div data-a class="ind a" layoutId="s6" style={{ "z-index": 2 }} />
        <Show when={open()}>
          <wardic.div data-b class="ind b" layoutId="s6" style={{ "z-index": 1 }} />
        </Show>
      </div>
    </WardicProvider>
  ))
  const base = leftOf(container.querySelector("[data-root]") as HTMLElement)
  const a = container.querySelector("[data-a]") as HTMLElement
  await raf()
  await raf()
  setOpen(true)
  const b = () => container.querySelector("[data-b]") as HTMLElement
  const flight = await leftsAfterPaint(b, 8, base)
  const seen = flight.at(-1)!
  expect(seen, "B mid-flight").toBeLessThan(250)
  setOpen(false)
  expectContinuous(seen, await leftsAfterPaint(() => a, 2, base), "A")
})

it("switch (S7): a <Show> swapped back mid-flight seeds the twin from where the leaver was seen (#170)", async () => {
  const [atB, setAtB] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      {styled()}
      <div data-root style={{ position: "relative" }}>
        <Show when={atB()} fallback={<wardic.div data-a class="ind a" layoutId="s7" />}>
          <wardic.div data-b class="ind b" layoutId="s7" />
        </Show>
      </div>
    </WardicProvider>
  ))
  const base = leftOf(container.querySelector("[data-root]") as HTMLElement)
  await raf()
  await raf()
  setAtB(true) // A leaves, B switches in from A's box
  const flight = await leftsAfterPaint(() => container.querySelector("[data-b]") as HTMLElement, 8, base)
  const seen = flight.at(-1)!
  expect(seen, "B mid-flight").toBeLessThan(250)
  setAtB(false) // B leaves mid-flight, A switches back in from where B was seen
  expectContinuous(seen, await leftsAfterPaint(() => container.querySelector("[data-a]") as HTMLElement, 2, base), "A")
})

it("crossfade (S8): a Follower's layout child keeps its shape and rides it, opening and closing (#169)", async () => {
  // A badge (a plain `layout` node, ratio 3) in the card and in the modal. Opening, the card is a
  // Follower locked onto the growing modal; closing, the modal is a leaving Follower. Before #169
  // neither badge was corrected: opening it stretched to 39.5x18.1, closing it squashed to 23x6.
  const [open, setOpen] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      {styled()}
      <div data-root style={{ position: "relative", width: "600px", height: "300px" }}>
        <wardic.div data-card layoutId="s8" style={{ position: "absolute", left: "12px", top: "36px", width: "72px", height: "56px" }}>
          <wardic.div data-card-badge layout style={{ position: "absolute", left: "6px", top: "40px", width: "30px", height: "10px" }} />
        </wardic.div>
        <AnimatePresence>
          <Show when={open()}>
            <wardic.div
              data-modal
              layoutId="s8"
              exit={{ opacity: 0 }}
              style={{ position: "absolute", left: "200px", top: "12px", width: "100px", height: "112px", "z-index": 2 }}
            >
              <wardic.div data-modal-badge layout style={{ position: "absolute", left: "10px", top: "90px", width: "30px", height: "10px" }} />
            </wardic.div>
          </Show>
        </AnimatePresence>
      </div>
    </WardicProvider>
  ))
  /** The badge's painted ratio and its offset in its container, every frame until `done`. */
  const track = async (badge: () => Element | null, box: () => Element | null, done: () => boolean) => {
    const seen: Array<{ readonly ratio: number; readonly dx: number; readonly dy: number }> = []
    await until(() => {
      const b = badge()
      const c = box()
      if (b instanceof HTMLElement && b.isConnected && c instanceof HTMLElement) {
        const r = b.getBoundingClientRect()
        const q = c.getBoundingClientRect()
        seen.push({ ratio: r.width / r.height, dx: r.left - q.left, dy: r.top - q.top })
      }
      return done()
    })
    return seen
  }
  const card = container.querySelector("[data-card]") as HTMLElement
  await raf()
  await raf()
  setOpen(true)
  const opening = await track(
    () => container.querySelector("[data-card-badge]"),
    () => card,
    () => op(card) < 0.01,
  )
  expect(opening.length, "frames the card was locked on").toBeGreaterThan(5)
  for (const [i, f] of opening.entries()) {
    expect(Math.abs(f.ratio / 3 - 1), `opening frame ${i}: the card's badge ratio ${f.ratio.toFixed(2)}`).toBeLessThan(0.02)
    expect(Math.abs(f.dx - 6) + Math.abs(f.dy - 40), `opening frame ${i}: its offset in the card`).toBeLessThan(1)
  }
  const modal = container.querySelector("[data-modal]") as HTMLElement
  await until(() => op(modal) > 0.99 && op(card) < 0.01)
  setOpen(false)
  const closing = await track(
    () => container.querySelector("[data-modal-badge]"),
    () => modal,
    () => !modal.isConnected,
  )
  expect(closing.length, "frames the modal was leaving").toBeGreaterThan(5)
  for (const [i, f] of closing.entries()) {
    expect(Math.abs(f.ratio / 3 - 1), `closing frame ${i}: the modal's badge ratio ${f.ratio.toFixed(2)}`).toBeLessThan(0.02)
    expect(Math.abs(f.dx - 10) + Math.abs(f.dy - 90), `closing frame ${i}: its offset in the modal`).toBeLessThan(1)
  }
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

// --- A twin's own scale (#8, ADR-0010 *Amendment (#8)*) ------------------------------------------
// A twin held at `scale: 1.5` is drawn 1.5x about its centre, on top of its projection. A handover
// starts from where it is drawn, a Follower is drawn where its Lead is, and a new Lead carrying its
// own scale starts drawn on its twin. Before #8, S9 to S11 started from the unscaled box.

const OWN = { initial: { scale: 1.5 }, animate: { scale: 1.5 } } as const
const placed = (left: number): JSX.CSSProperties => ({ position: "absolute", left: `${left}px`, top: "40px", width: "80px", height: "40px", background: "teal" })
type Rect = { readonly l: number; readonly t: number; readonly r: number; readonly b: number }
const rectOf = (e: Element): Rect => {
  const r = e.getBoundingClientRect()
  return { l: r.left, t: r.top, r: r.right, b: r.bottom }
}
/** How far apart two boxes are: their furthest edge. */
const apart = (a: Rect, b: Rect): number => Math.max(Math.abs(a.l - b.l), Math.abs(a.t - b.t), Math.abs(a.r - b.r), Math.abs(a.b - b.b))
/** The boxes of `read`'s elements just after each of the next `n` painted frames. */
const rectsAfterPaint = <A,>(read: () => A, n: number): Promise<Array<A>> =>
  new Promise((resolve) => {
    const out: Array<A> = []
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      out.push(read())
      if (out.length >= n) return resolve(out)
      requestAnimationFrame(() => ch.port2.postMessage(undefined))
    }
    requestAnimationFrame(() => ch.port2.postMessage(undefined))
  })
const atRest = async (): Promise<void> => {
  for (let i = 0; i < 90; i++) await raf()
}
/** A start that goes on from `before`: its first frame no further from it than its next step. */
const expectDrawnOn = (before: Rect, [first, second]: ReadonlyArray<Rect>, what: string) => {
  const step = apart(first!, second!)
  expect(apart(first!, before), `${what}: jump at the start (next step ${step.toFixed(2)}px)`).toBeLessThanOrEqual(step + 1)
}
const opacityOf = (e: Element): number => Number(getComputedStyle(e).opacity)

it("own scale (S9): a crossfade beside a twin held at scale 1.5 starts where it's drawn, and the Follower is drawn on its Lead (#8)", async () => {
  const [open, setOpen] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "relative", height: "120px" }}>
        <wardic.div data-a layoutId="s9" {...OWN} style={placed(20)} />
        <Show when={open()}>
          <wardic.div data-b layoutId="s9" style={placed(300)} />
        </Show>
      </div>
    </WardicProvider>
  ))
  const a = container.querySelector("[data-a]") as HTMLElement
  await atRest()
  const seen = rectOf(a)
  expect(seen.r - seen.l, "A drawn at its own scale").toBeCloseTo(120, 0)
  setOpen(true)
  const b = () => container.querySelector("[data-b]") as HTMLElement
  const flight = await rectsAfterPaint(() => ({ a: rectOf(a), b: rectOf(b()), aShows: opacityOf(a) > 0.01 }), 30)
  expectDrawnOn(
    seen,
    flight.map((f) => f.b),
    "B",
  )
  for (const [i, f] of flight.entries()) if (f.aShows) expect(apart(f.a, f.b), `frame ${i}: the Follower on its Lead`).toBeLessThan(1)
})

it("own scale (S10): a promotion starts from where the unmounted Lead, held at scale 1.5, was drawn (#8)", async () => {
  const [open, setOpen] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "relative", height: "120px" }}>
        <wardic.div data-a layoutId="s10" style={placed(20)} />
        <Show when={open()}>
          <wardic.div data-b layoutId="s10" {...OWN} style={placed(300)} />
        </Show>
      </div>
    </WardicProvider>
  ))
  const a = container.querySelector("[data-a]") as HTMLElement
  await atRest()
  setOpen(true)
  await atRest()
  const seen = rectOf(container.querySelector("[data-b]") as HTMLElement)
  expect(seen.r - seen.l, "B drawn at its own scale").toBeCloseTo(120, 0)
  setOpen(false)
  expectDrawnOn(seen, await rectsAfterPaint(() => rectOf(a), 2), "A")
})

it("own scale (S11): a new Lead held at scale 1.5 starts drawn on its twin and grows into its scale, the Follower on it (#8)", async () => {
  const [open, setOpen] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "relative", height: "120px" }}>
        <wardic.div data-a layoutId="s11" style={placed(20)} />
        <Show when={open()}>
          <wardic.div data-b layoutId="s11" {...OWN} style={placed(300)} />
        </Show>
      </div>
    </WardicProvider>
  ))
  const a = container.querySelector("[data-a]") as HTMLElement
  await atRest()
  const seen = rectOf(a)
  setOpen(true)
  const b = () => container.querySelector("[data-b]") as HTMLElement
  const flight = await rectsAfterPaint(() => ({ a: rectOf(a), b: rectOf(b()), aShows: opacityOf(a) > 0.01 }), 90)
  expectDrawnOn(
    seen,
    flight.map((f) => f.b),
    "B",
  )
  for (const [i, f] of flight.entries()) if (f.aShows) expect(apart(f.a, f.b), `frame ${i}: the Follower on its Lead`).toBeLessThan(1)
  const rest = flight.at(-1)!.b
  expect(rest.r - rest.l, "B at rest, drawn at its own scale").toBeCloseTo(120, 0)
})

it("own scale (S12): a Switch from a twin held at scale 1.5 starts where it was drawn (#8; a guard, #170 reads it as painted)", async () => {
  const [which, setWhich] = createSignal("a")
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "relative", height: "120px" }}>
        <Show when={which() === "a"} fallback={<wardic.div data-b layoutId="s12" style={placed(300)} />}>
          <wardic.div data-a layoutId="s12" {...OWN} style={placed(20)} />
        </Show>
      </div>
    </WardicProvider>
  ))
  await atRest()
  const seen = rectOf(container.querySelector("[data-a]") as HTMLElement)
  setWhich("b")
  expectDrawnOn(seen, await rectsAfterPaint(() => rectOf(container.querySelector("[data-b]") as HTMLElement), 2), "B")
})
